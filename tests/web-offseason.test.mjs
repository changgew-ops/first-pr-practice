import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { currentStep, buildCtx, teamSummary, positionCounts, offerHint, usedPlayerIds, resignPlan, minAcceptSalary, faPlan, compensationCandidates, draftRanking, STEPS, round1 } from '../web/lib/offseason-view.js';
import { demandEok, domesticOf } from '../src/valuation.mjs';
import { offerScore } from '../src/freeagency.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';

function toOffseason(seed) {
  const s = Session.create(data, { managerId: MY, gmName: 'T', seed });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  return s;
}

test('currentStep: 결정 종류와 지금까지의 결정으로 단계를 정한다 (보상 선택은 방금 낸 FA 라운드)', () => {
  assert.equal(currentStep({ kind: 'trade', key: 'trade' }), 'trade');
  assert.equal(currentStep({ kind: 'resign', key: 'resign' }), 'resign');
  assert.equal(currentStep({ kind: 'freeAgency', key: 'fa:3' }), 'fa:3');
  assert.equal(currentStep({ kind: 'compensation', key: 'comp:0' }, { trade: {}, 'fa:1': [], 'fa:2': [] }), 'fa:2');
  assert.equal(currentStep({ kind: 'draft', key: 'draft:1' }), 'draft');
  assert.deepEqual(STEPS.map((x) => x.id), ['trade', 'resign', 'fa:1', 'fa:2', 'fa:3', 'fa:4', 'fa:5', 'draft']);
});

test('buildCtx: 엔진이 오프시즌 시작에 만드는 ctx와 같다', () => {
  const s = toOffseason(31);
  const mine = buildCtx(s.game.seasonEnd, data.teams.length, data.rules, MY);
  const engine = s.pending.payload.ctx;
  assert.deepEqual([...mine.ranks], [...engine.ranks]);
  assert.deepEqual([...mine.winPct], [...engine.winPct]);
  assert.deepEqual([...mine.prestige], [...engine.prestige]);
  assert.equal(mine.season, engine.season);
});

test('트레이드 제안 힌트·사용 선수 집합·현황 요약', () => {
  const s = toOffseason(32);
  const { offers, league, ctx } = s.pending.payload;
  assert.ok(offers.length > 0);
  for (const o of offers) {
    const hint = offerHint(o, league, ctx, data.rules, MY);
    assert.ok(hint.incoming > 0 && hint.outgoing > 0 && ['good', 'even', 'bad'].includes(hint.tone));
    assert.equal(hint.countDelta, o.give.length - o.get.length);
  }
  const used = usedPlayerIds(offers, new Set([offers[0].id]), [{ giveA: ['a'], giveB: ['b'] }]);
  assert.ok(used.has('a') && used.has('b') && offers[0].give.every((p) => used.has(p.id)) && offers[0].get.every((p) => used.has(p.id)));
  const sum = teamSummary(league.players, s.funds, MY, data.rules);
  assert.equal(sum.domesticCount, domesticOf(league.players, MY).length);
  assert.ok(sum.payroll > 0 && sum.hardLimit > sum.cap);
  assert.equal(positionCounts(league.players, MY).reduce((a, r) => a + r.count, 0), sum.domesticCount);
});

test('resignPlan: 미리 본 재계약 결과가 엔진이 실제로 처리한 결과와 같다', () => {
  const s = toOffseason(33);
  s.decide('trade', { accept: [], proposals: [] });
  const { expiring, league, ctx } = s.pending.payload;
  assert.equal(s.pending.kind, 'resign');
  assert.ok(expiring.length > 0);
  // 일부는 요구액, 일부는 낮게, 일부는 높게 제시한다
  const offers = {};
  expiring.forEach((p, i) => { offers[p.id] = { salaryEok: round1(demandEok(p) * [1, 0.7, 1.2, 1.02][i % 4]), years: 2 }; });
  const plan = resignPlan(expiring, offers, league.players, ctx, data.rules, MY);
  const predicted = new Set([...plan.byId].filter(([, v]) => v.status === 'ok').map(([id]) => id));
  s.decide('resign', offers);
  s.autoOffseason();
  const renewed = new Set(s.game.log.at(-1).report.renewed.filter((r) => r.teamId === MY && r.salaryEok != null && !r.asia).map((r) => r.id));
  assert.deepEqual([...renewed].sort(), [...predicted].sort());
});

test('minAcceptSalary·faPlan·보상 후보·드래프트 순위', () => {
  const s = toOffseason(34);
  s.decide('trade', { accept: [], proposals: [] });
  s.decide('resign', {});
  assert.equal(s.pending.kind, 'freeAgency');
  const { pool, state, demandNow, round } = s.pending.payload;
  const ctx = buildCtx(s.game.seasonEnd, data.teams.length, data.rules, MY);
  const roster = domesticOf(state.players, MY);
  const p = pool.find((x) => x.origin === 'domestic');
  const min = minAcceptSalary(p, MY, roster, ctx, data.rules, round, demandNow(p));
  assert.ok(min == null || offerScore(p, min, MY, roster, ctx, data.rules, round).accept);
  if (min != null && min > 0.4) assert.ok(!offerScore(p, round1(min - 0.1), MY, roster, ctx, data.rules, round).accept);
  const offers = Object.fromEntries(pool.filter((x) => x.origin === 'domestic').slice(0, 3).map((x) => [x.id, { salaryEok: round1(demandNow(x) * 1.05), years: 2 }]));
  const plan = faPlan(pool, offers, state.players, data.rules, MY);
  assert.equal(plan.byId.size, 3);
  assert.ok(plan.payroll >= teamSummary(state.players, state.funds, MY, data.rules).payroll);
  const { eligible, protectedIds } = compensationCandidates(state.players, 'none', MY, data.rules);
  assert.equal(protectedIds.size, data.rules.transactions.compensation.protectedPlayers);
  assert.ok(eligible.every((x) => !protectedIds.has(x.id)));
  const rank = draftRanking([{ id: 1, position: 'PG', ovr: 50, potential: 60 }, { id: 2, position: 'C', ovr: 55, potential: 75 }], []);
  assert.equal(rank[0].p.id, 2); assert.equal(rank[0].rank, 1); assert.ok(rank[0].score >= rank[1].score);
});
