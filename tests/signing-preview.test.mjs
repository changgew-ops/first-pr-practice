// 영입 미리보기(web/lib/preview-signing.js) = 실제 결과: 미리보기가 말한 캡·연봉·역할·인원이 실제로 영입한 뒤의 값과 같은지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { payrollEok, softCapPenaltyEok } from '../src/valuation.mjs';
import { signingImpact, ROLE_TEXT } from '../web/lib/preview-signing.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const base = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
const MY = 'busan-kcc';
const mine = (s) => s.players.filter((p) => p.teamId === MY);

const noWaiver = { ...base, rules: { ...rules, waivers: { ...rules.waivers, enabled: false } } };

test('시즌 중 FA 영입: 미리보기의 캡·소프트캡 패널티·인원·역할이 실제 영입 결과와 같다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 21 });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason(); s.autoOffseason();
  s.advance(10);
  const market = s.faMarket();
  assert.ok(market.length > 3, `시장 ${market.length}명`);
  const cand = [...market].sort((a, b) => b.player.ovr - a.player.ovr)[0];
  const victim = mine(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr)[0];
  const offer = { salaryEok: cand.asking, years: 2 };
  // 자리가 없으면 영입할 수 없다: 엔진의 검증 결과(faCheck)를 미리보기가 그대로 보여 준다
  const blockedCheck = s.faCheck(cand.player.id, offer);
  assert.equal(blockedCheck.ok, false);
  const blocked = signingImpact({ roster: s.players, cand: cand.player, offer, rules: s.rules, teamId: MY, check: blockedCheck });
  assert.equal(blocked.ok, false); assert.ok(blocked.reason);
  // 방출을 함께 보면: 미리보기 = 실제 방출 + 영입 뒤의 값
  assert.equal(s.releasePlayer(victim.id).ok, true);
  const check = s.faCheck(cand.player.id, offer);
  assert.equal(check.ok, true, check.reason);
  const imp = signingImpact({ roster: s.players, cand: cand.player, offer, rules: s.rules, teamId: MY, check });
  assert.equal(imp.ok, true);
  const r = s.signFa(cand.player.id, offer);
  assert.equal(r.ok, true, r.errors?.[0]);
  const after = mine(s);
  assert.equal(Math.round(payrollEok(after, MY) * 100) / 100, imp.domestic.after, '영입 후 국내 연봉 합');
  assert.equal(softCapPenaltyEok(payrollEok(after, MY), s.rules), imp.domestic.penaltyAfter, '소프트캡 패널티');
  assert.equal(after.length, imp.roster.after, '로스터 인원');
  assert.equal(after.filter((p) => p.origin === 'domestic').length, imp.roster.countByOrigin.after);
  // 예상 역할 = 영입 직후 엔진 편성에서의 자리(건강하고 직접 편성이 없을 때). 부상자가 있으면 건너뛴다
  if (!s.injuries.some((i) => i.teamId === MY) && !s.lineup && !s.rest.length) {
    const lu = s.lineupOf(MY);
    const role = lu.starters.some((p) => p.id === cand.player.id) ? 'starter' : lu.bench.some((p) => p.id === cand.player.id) ? 'bench' : 'out';
    assert.equal(role, imp.role.after, '예상 역할');
  }
  assert.ok(ROLE_TEXT[imp.role.after]);
});

test('미리보기: 소프트캡 초과 패널티·하드 한도·경쟁자·다음 시즌 확정 지출 계산', () => {
  const players = [
    { id: 'a', teamId: 'T', origin: 'domestic', position: 'PG', ovr: 70, stats: {}, contract: { salaryEok: 10, yearsLeft: 3 } },
    { id: 'b', teamId: 'T', origin: 'domestic', position: 'PG', ovr: 60, stats: {}, contract: { salaryEok: 15, yearsLeft: 1 } },
    { id: 'c', teamId: 'T', origin: 'domestic', position: 'PG', ovr: 65, stats: {}, contract: { salaryEok: 3, yearsLeft: 2 } }
  ];
  const cand = { id: 'x', teamId: null, origin: 'domestic', position: 'PG', ovr: 68, stats: {}, contract: {} };
  const r = { ...rules, lineup: { ...rules.lineup, starters: 1, bench: 1 } };
  const imp = signingImpact({ roster: players, cand, offer: { salaryEok: 6, years: 2 }, rules: r, teamId: 'T' });
  // 28 → 34억: 캡 30 넘음 → 초과 4, 10% 이하 구간이라 30% = 1.2
  assert.equal(imp.domestic.before, 28); assert.equal(imp.domestic.after, 34);
  assert.equal(imp.domestic.over, 4); assert.equal(imp.domestic.penaltyBefore, 0); assert.equal(imp.domestic.penaltyAfter, softCapPenaltyEok(34, r));
  assert.equal(imp.domestic.overHard, false);
  assert.deepEqual(imp.competitors.map((c) => c.player.id), ['a', 'c']); // 같은 PG OVR 상위 2명
  assert.equal(imp.competitors[0].diff, -2);
  // 다음 시즌 확정 지출: 남은 계약 2년 초과 → a(10)+c(3)+이 계약(6, 2년) = 19
  assert.equal(imp.next.eok, 19); assert.equal(imp.next.thisContractContinues, true);
  assert.equal(imp.roster.before, 3); assert.equal(imp.roster.after, 4);
  const big = signingImpact({ roster: players, cand, offer: { salaryEok: 30, years: 1 }, rules: r, teamId: 'T' });
  assert.equal(big.domestic.overHard, true); // 58억 > 한도(36)
  // 영입 대신 방출을 같이 보면 그 연봉이 빠진다
  const swap = signingImpact({ roster: players, cand, offer: { salaryEok: 6, years: 2 }, rules: r, teamId: 'T', releaseId: 'b' });
  assert.equal(swap.domestic.after, 19); assert.equal(swap.roster.after, 3);
  // 엔진 검증 결과를 그대로 전달한다
  const blocked = signingImpact({ roster: players, cand, offer: { salaryEok: 6, years: 2 }, rules: r, teamId: 'T', check: { ok: false, reason: '캡 초과' } });
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, '캡 초과');
});

test('외국인·아시아쿼터 후보는 각자의 한도로 계산한다', () => {
  const filler = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, teamId: 'T', origin: 'domestic', position: ['PG', 'SG', 'SF', 'PF', 'C'][i % 5], ovr: 60 - i, stats: {}, contract: { salaryEok: 1, yearsLeft: 1 } }));
  const players = [...filler, { id: 'f1', teamId: 'T', origin: 'foreign', position: 'C', ovr: 75, stats: {}, contract: { salaryUsd: 500000, yearsLeft: 1 } }];
  const cand = { id: 'f2', teamId: null, origin: 'foreign', position: 'PF', ovr: 70, stats: {}, contract: {} };
  const imp = signingImpact({ roster: players, cand, offer: { salaryUsd: 400000, years: 1 }, rules, teamId: 'T' });
  assert.equal(imp.foreign.beforeUsd, 500000); assert.equal(imp.foreign.afterUsd, 900000); assert.equal(imp.foreign.limitUsd, rules.salaryCap.foreignUsdTotal);
  assert.equal(imp.domestic, undefined);
  const asia = signingImpact({ roster: players, cand: { ...cand, id: 'a1', origin: 'asia' }, offer: { salaryEok: 1.5, years: 1 }, rules, teamId: 'T' });
  assert.equal(asia.asia.afterEok, 1.5);
});

test('tradeImpact: 캡·로스터·다음 시즌 지출이 실제 교환 결과와 같다', async () => {
  const { tradeImpact } = await import('../web/lib/preview-signing.js');
  const { executeTrade, validateTrade } = await import('../src/trade.mjs');
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 5 });
  const league = { players: s.players.map((p) => ({ ...p })) };
  const other = base.teams.find((t) => t.id !== MY).id;
  const mineDom = league.players.filter((p) => p.teamId === MY && p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr);
  const theirs = league.players.filter((p) => p.teamId === other && p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr);
  const trade = { teamA: MY, teamB: other, giveA: [mineDom[0].id], giveB: [theirs[0].id] };
  const check = validateTrade(league, trade, s.rules, { window: 'offseason' });
  const give = [mineDom[0]], get = [theirs[0]];
  const imp = tradeImpact({ roster: league.players, give, get, rules: s.rules, teamId: MY, check });
  assert.equal(imp.ok, check.ok);
  const done = executeTrade(league, trade);
  const after = done.players.filter((p) => p.teamId === MY);
  assert.equal(imp.domestic.after, Math.round(payrollEok(after, MY) * 100) / 100);
  assert.equal(imp.roster.after, after.length);
  const cont = after.filter((p) => (p.contract?.yearsLeft ?? 0) > 1).reduce((a, p) => a + (p.origin === 'foreign' ? p.contract.salaryUsd * s.rules.transactions.funds.foreignUsdToEok : p.contract.salaryEok), 0);
  assert.equal(imp.next.eok, Math.round(cont * 100) / 100);
  assert.ok(['starter', 'bench', 'out'].includes(imp.incoming[0].role));
});

test('로스터가 모자라 편성이 안 되는 단계(재계약 등)에서도 미리보기가 예외 없이 역할 미정으로 나온다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 3 });
  const few = s.players.filter((p) => p.teamId === MY).slice(0, 3);
  const cand = s.players.find((p) => p.teamId !== MY && p.origin === 'domestic');
  const imp = signingImpact({ roster: few, cand: { ...cand, teamId: null }, offer: { salaryEok: 2, years: 2 }, rules: s.rules, teamId: MY });
  assert.equal(imp.role.after, null);
  assert.equal(imp.roster.after, 4);
});
