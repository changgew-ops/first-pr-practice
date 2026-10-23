import { rulesFor } from '../src/economy.mjs';
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
  assert.deepEqual(STEPS.map((x) => x.id), ['trade', 'resign', 'fa:1', 'fa:2', 'fa:3', 'fa:4', 'fa:5', 'draft', 'foreign']);
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

// ---------- 선수 정보 창·외국인 영입·FA 결과 ----------
import { positionAverages, statRows, contractLabel, extraFacts } from '../web/lib/player-info.js';
import { expandCard } from '../src/cards.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { createLeague } from '../src/league.mjs';
import { runOffseasonWith } from '../src/decisions.mjs';
import { createManagerBot } from '../src/manager-bot.mjs';

const cardsFor = (k) => read(`cards/${k}.json`).rows.map(expandCard);
const cardData = { ...data, careers: read('players/careers.json'), cards: { domestic: cardsFor('domestic'), foreign: cardsFor('foreign') } };

test('선수 정보 창: 포지션 평균·능력치 비교·계약 문구·상황 정보', () => {
  const league = createLeague(data.players, data.rules).players;
  const avgs = positionAverages(league);
  assert.deepEqual([...avgs.keys()].sort(), ['C', 'PF', 'PG', 'SF', 'SG']);
  const p = league.find((x) => x.position === 'PG' && x.origin === 'domestic');
  const rows = statRows(p, avgs);
  assert.equal(rows.length, 6);
  for (const r of rows) { assert.equal(r.value, p.stats[r.key]); assert.equal(r.diff, Math.round(r.value - avgs.get('PG')[r.key])); }
  assert.equal(statRows(p, null)[0].diff, null);
  assert.equal(contractLabel({ contract: { salaryEok: 2.3, yearsLeft: 2 } }), '연봉 2.3억 · 2년');
  assert.equal(contractLabel({ contract: { salaryEok: 2.3, yearsLeft: 0 } }), '연봉 2.3억 · 계약 만료');
  assert.match(contractLabel({ contract: { salaryUsd: 450000, yearsLeft: 1 } }), /\$450k · 1년/);
  assert.equal(contractLabel({ contract: { yearsLeft: 0 } }), '계약 없음');
  const ctx = { name: (id) => id };
  assert.deepEqual(extraFacts(ctx, { origin: 'domestic', contract: { yearsLeft: 0 } }).map((x) => x[0]), ['신인 후보']);
  assert.ok(extraFacts(ctx, { origin: 'domestic', teamId: null, prevTeamId: 'x', prevSalaryEok: 2, prevRank: 12, contract: { yearsLeft: 0 }, age: 25, ovr: 60, potential: 60, stats: p.stats, position: 'SF' }).some((x) => x[0] === '원소속'));
});

// 세션을 오프시즌 끝까지 밀며 결정 종류별 payload를 모은다
function walk(seed, { onPending }) {
  const s = Session.create(cardData, { managerId: MY, gmName: 'T', seed });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  let guard = 0;
  while (s.stage === 'offseason' && s.pending && guard++ < 80) {
    const { key, kind, payload } = s.pending;
    const value = onPending({ key, kind, payload, s });
    s.decide(key, value);
  }
  return s;
}
const defaults = ({ kind, payload }) => (kind === 'trade' ? { accept: [], proposals: [] } : kind === 'resign' ? {} : kind === 'freeAgency' ? [] : kind === 'compensation' ? { type: 'cash' } : kind === 'draft' ? payload.available[0].id : kind === 'foreign' ? (payload.candidates.find((c) => c.ok)?.player.id ?? 'auto') : null);

test('외국인 영입 payload: 현재 로스터(state)·먼저 영입된 선수(taken)·모든 후보의 ok/why·슬롯 정보', () => {
  let seen = 0;
  for (const seed of [100, 1, 2, 3]) {
    walk(seed, {
      onPending: (ctx) => {
        if (ctx.kind === 'foreign') {
          seen++;
          const pl = ctx.payload;
          assert.ok(Array.isArray(pl.state.players) && pl.state.funds, 'state');
          assert.ok(pl.candidates.length > 0 && pl.candidates.every((c) => typeof c.ok === 'boolean' && (c.ok ? c.why == null : typeof c.why === 'string' && c.usd > pl.maxUsd)));
          assert.equal(pl.slots, data.rules.roster.foreign);
          assert.ok(pl.vacancies >= 1 && pl.slot >= 1 && pl.slot <= pl.vacancies && pl.turn >= 1 && pl.turn <= pl.turns);
          assert.equal(pl.foreignUsd.total, rulesFor(data.rules, 2027).salaryCap.foreignUsdTotal); // 오프시즌 계약은 다음 시즌 규칙
          assert.ok(Array.isArray(pl.taken) && pl.taken.every((t) => t.teamId && t.playerName && t.usd > 0));
          const mine = pl.state.players.filter((p) => p.teamId === MY && p.origin === 'foreign');
          assert.equal(mine.length, pl.slots - pl.vacancies, '요약이 쓰는 현재 외국 선수 수 = 자리 − 빈 자리');
          assert.equal(pl.foreignUsd.used, mine.reduce((a, p) => a + p.contract.salaryUsd, 0));
        }
        return defaults(ctx);
      }
    });
  }
  assert.ok(seen > 0, '외국인 영입 결정이 한 번도 나오지 않았다');
});

test('외국인 영입: 한도를 못 맞추는 후보를 고르면(ok=false) 엔진이 무시하고 자동으로 고르며, 후보가 하나도 없으면 가상 외국인으로 채운다', () => {
  let bad = 0, ignored = 0, blockedSeed = 100;
  // 물가 반영 뒤에는 한도와 요구액이 함께 오르므로 한도에 걸리는 후보가 나오는 시드를 찾아 쓴다
  for (const seed of [100, ...Array.from({ length: 80 }, (_, i) => i + 1)]) { // 성장 곡선·물가가 바뀌면 같은 시드에서도 한도에 걸리는 후보가 나오는 해가 달라지므로 넉넉히 찾는다
    walk(seed, {
      onPending: (ctx) => {
        if (ctx.kind === 'foreign') {
          const blocked = ctx.payload.candidates.find((c) => !c.ok);
          if (blocked) { bad++; ignored++; return blocked.player.id; }
        }
        return defaults(ctx);
      }
    });
    if (bad > 0) { blockedSeed = seed; break; }
  }
  assert.ok(bad > 0, 'ok=false 후보가 없는 시나리오');
  // 끝까지 진행되고 외국인 자리가 채워진다
  const s = walk(100, { onPending: (ctx) => (ctx.kind === 'foreign' ? 'auto' : defaults(ctx)) });
  assert.equal(s.stage, 'regular');
  assert.equal(s.players.filter((p) => p.teamId === MY && p.origin === 'foreign').length, data.rules.roster.foreign);
});

test('FA 라운드 결과: 단장 제안마다 상태(수락·경쟁 패배·요구액 미만·점수 부족·캡·자리)가 기록되고, 같은 시드·같은 결정이면 같다', () => {
  const run = () => {
    const rounds = [];
    walk(5, {
      onPending: (ctx) => {
        if (ctx.kind === 'freeAgency') {
          rounds.push({ round: ctx.payload.round, last: ctx.payload.lastResults });
          // 값이 높은 FA 6명에게 요구액의 70%·100%를 섞어 제안(일부는 거절되도록)
          const top = [...ctx.payload.pool].filter((p) => p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr).slice(0, 6);
          return top.map((p, i) => ({ playerId: p.id, salaryEok: Math.round(ctx.payload.demandNow(p) * (i % 2 ? 0.7 : 1.0) * 10) / 10, years: 2 }));
        }
        return defaults(ctx);
      }
    });
    return rounds;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a[0].last, null);
  const all = a.slice(1).flatMap((r) => r.last ?? []);
  assert.ok(all.length > 0, '지난 라운드 결과가 다음 라운드에 실려 온다');
  const STATUS = new Set(['accepted', 'lost', 'low', 'score', 'cap', 'roster']);
  for (const r of all) {
    assert.ok(STATUS.has(r.status), r.status);
    assert.ok(r.name && r.salaryEok > 0 && r.years >= 1 && r.demandEok > 0);
    if (r.status === 'low') assert.ok(r.ratio < r.minRatio && r.minSalaryEok > r.salaryEok);
    if (r.status === 'score') assert.ok(r.score < r.need);
    if (r.status === 'lost') assert.ok(r.teamId && r.teamId !== MY);
  }
  assert.ok(new Set(all.map((r) => r.status)).size >= 2, '여러 종류의 결과가 나온다');
});

test('FA 결과 기록은 시장 결과를 바꾸지 않는다: 같은 제안이면 결과가 같고, 드래프트 payload에 전체 결과가 실린다', () => {
  let faResults = null;
  const s1 = walk(8, { onPending: (ctx) => { if (ctx.kind === 'draft' && ctx.key === 'draft:0') faResults = ctx.payload.faResults; return ctx.kind === 'freeAgency' ? ctx.payload.pool.filter((p) => p.origin === 'domestic').slice(0, 3).map((p) => ({ playerId: p.id, salaryEok: Math.round(ctx.payload.demandNow(p) * 10) / 10, years: 2 })) : defaults(ctx); } });
  const s2 = walk(8, { onPending: (ctx) => (ctx.kind === 'freeAgency' ? ctx.payload.pool.filter((p) => p.origin === 'domestic').slice(0, 3).map((p) => ({ playerId: p.id, salaryEok: Math.round(ctx.payload.demandNow(p) * 10) / 10, years: 2 })) : defaults(ctx)) });
  assert.deepEqual(s1.players.map((p) => [p.id, p.teamId]), s2.players.map((p) => [p.id, p.teamId]));
  assert.ok(Array.isArray(faResults) && faResults.every((r) => r.round >= 1 && r.round <= data.rules.transactions.freeAgency.rounds));
});

test('드래프트 payload에는 현재 로스터(state)가 있어 요약이 정확하다', () => {
  let checked = 0;
  walk(3, { onPending: (ctx) => { if (ctx.kind === 'draft' && !checked) { checked++; assert.ok(ctx.payload.state.players.some((p) => p.teamId === MY)); assert.ok(ctx.payload.state.funds); } return defaults(ctx); } });
  assert.equal(checked, 1);
});
