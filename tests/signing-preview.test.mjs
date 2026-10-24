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

test('시즌 중 FA 영입: 미리보기의 캡·소프트캡 패널티·인원·역할이 실제 영입 결과와 같다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 5 });
  s.advance(1);
  const market = s.faMarket();
  assert.ok(market.length > 0, '시즌 중 FA 시장에 선수가 있어야 한다');
  // 영입 가능한 후보 하나 찾기(가장 OVR이 높은 것부터)
  let tried = 0, done = false;
  for (const m of [...market].sort((a, b) => b.player.ovr - a.player.ovr)) {
    const offer = { salaryEok: m.asking, years: 1 };
    const check = s.faCheck(m.player.id, offer);
    if (!check.ok) continue;
    tried++;
    const imp = signingImpact({ roster: s.players, cand: m.player, offer, rules: s.rules, teamId: MY, check });
    assert.equal(imp.ok, true);
    const r = s.signFa(m.player.id, offer);
    assert.equal(r.ok, true, JSON.stringify(r));
    const after = mine(s);
    assert.equal(Math.round(payrollEok(after, MY) * 100) / 100, imp.domestic.after, '영입 후 국내 연봉 합');
    assert.equal(softCapPenaltyEok(payrollEok(after, MY), s.rules), imp.domestic.penaltyAfter, '소프트캡 패널티');
    assert.equal(after.length, imp.roster.after, '로스터 인원');
    // 예상 역할 = 영입 직후 엔진 편성에서의 자리(건강하고 직접 편성이 없을 때)
    const lu = s.lineupOf(MY);
    const role = lu.starters.some((p) => p.id === m.player.id) ? 'starter' : lu.bench.some((p) => p.id === m.player.id) ? 'bench' : 'out';
    assert.equal(role, imp.role.after, '예상 역할');
    assert.ok(ROLE_TEXT[imp.role.after]);
    done = true; break;
  }
  assert.ok(done, `영입 가능한 FA를 찾지 못했다(시도 ${tried})`);
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
  const players = [{ id: 'f1', teamId: 'T', origin: 'foreign', position: 'C', ovr: 75, stats: {}, contract: { salaryUsd: 500000, yearsLeft: 1 } }];
  const cand = { id: 'f2', teamId: null, origin: 'foreign', position: 'PF', ovr: 70, stats: {}, contract: {} };
  const imp = signingImpact({ roster: players, cand, offer: { salaryUsd: 400000, years: 1 }, rules, teamId: 'T' });
  assert.equal(imp.foreign.beforeUsd, 500000); assert.equal(imp.foreign.afterUsd, 900000); assert.equal(imp.foreign.limitUsd, rules.salaryCap.foreignUsdTotal);
  assert.equal(imp.domestic, undefined);
  const asia = signingImpact({ roster: players, cand: { ...cand, id: 'a1', origin: 'asia' }, offer: { salaryEok: 1.5, years: 1 }, rules, teamId: 'T' });
  assert.equal(asia.asia.afterEok, 1.5);
});
