import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseGoals, describeGoal, evaluateGoal, evaluateSeason, expectedRank, trustOf, lowStreakOf, goalProgress, rewardOf, trustTier } from '../src/goals.mjs';
import { newGame, playYear, seasonGoals, bonusFunds } from '../web/lib/game.js';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const rules = data.rules;

test('기대 순위: 직전 순위와 전력 순위의 평균, 직전 기록이 없으면 중간으로 본다', () => {
  assert.equal(expectedRank(2, 4), 3);
  assert.equal(expectedRank(10, 8), 9);
  assert.equal(expectedRank(null, 1), 3); // (5.5 + 1) / 2 = 3.25
});

test('목표 난이도: 약팀은 낮게, 강팀은 높게 주고 항상 3개(주·보조·추가)다', () => {
  const base = { payrollRatio: 0.8, hasYouth: false, season: 2026, teamId: 'x' };
  const strong = chooseGoals({ ...base, expected: 1 }, rules), mid = chooseGoals({ ...base, expected: 5 }, rules), weak = chooseGoals({ ...base, expected: 10 }, rules);
  for (const g of [strong, mid, weak]) assert.deepEqual(g.map((x) => x.role), ['main', 'sub', 'extra']);
  assert.deepEqual([strong[0].kind, strong[0].value], ['stage', '결승']);
  assert.deepEqual([mid[0].kind, mid[0].value], ['rank', 6]);
  assert.deepEqual([weak[0].kind, weak[0].value], ['rank', 9]);
  assert.equal(weak[1].value, 0.3);
  assert.equal(strong[2].kind, 'profit');
  // 연봉이 캡에 가까우면 추가 목표가 '캡 준수'로 바뀐다
  assert.equal(chooseGoals({ ...base, expected: 5, payrollRatio: 0.99 }, rules)[2].kind, 'payroll');
  // 젊은 선수가 없으면 신인 출전 목표는 나오지 않는다
  const kinds = new Set(Array.from({ length: 40 }, (_, i) => chooseGoals({ ...base, expected: 5, hasYouth: false, season: 2026 + i }, rules)[2].kind));
  assert.deepEqual([...kinds], ['profit']);
  const withYouth = new Set(Array.from({ length: 40 }, (_, i) => chooseGoals({ ...base, expected: 5, hasYouth: true, season: 2026 + i }, rules)[2].kind));
  assert.ok(withYouth.has('youth') && withYouth.has('profit'));
});

test('목표 판정: 종류별 달성·초과 달성', () => {
  const actual = { rank: 3, wins: 30, losses: 24, stage: '4강', net: 1.5, payrollRatio: 0.95, youthMinutes: 700 };
  assert.deepEqual(evaluateGoal({ kind: 'rank', value: 3 }, actual), { met: true, over: false, shown: 3 });
  assert.equal(evaluateGoal({ kind: 'rank', value: 5 }, actual).over, true);
  assert.equal(evaluateGoal({ kind: 'rank', value: 2 }, actual).met, false);
  assert.equal(evaluateGoal({ kind: 'stage', value: '4강' }, actual).met, true);
  assert.equal(evaluateGoal({ kind: 'stage', value: '6강' }, actual).over, true);
  assert.equal(evaluateGoal({ kind: 'stage', value: '결승' }, actual).met, false);
  assert.equal(evaluateGoal({ kind: 'stage', value: '6강' }, { ...actual, stage: null }).met, false);
  assert.equal(evaluateGoal({ kind: 'winPct', value: 0.5 }, actual).met, true);
  assert.equal(evaluateGoal({ kind: 'profit', value: 0 }, { ...actual, net: -0.1 }).met, false);
  assert.equal(evaluateGoal({ kind: 'payroll', value: 1 }, { ...actual, payrollRatio: 1.01 }).met, false);
  assert.equal(evaluateGoal({ kind: 'youth', value: 600 }, actual).met, true);
  for (const g of [{ kind: 'rank', value: 4 }, { kind: 'stage', value: '우승' }, { kind: 'winPct', value: 0.4 }, { kind: 'profit', value: 0 }, { kind: 'payroll', value: 1 }, { kind: 'youth', value: 600 }]) assert.ok(describeGoal(g).title.length > 3);
});

test('시즌 평가: 신뢰도가 목표 달성에 따라 오르내리고 0~100에서 자른다, 연속 위험은 해임 위험', () => {
  const goals = [{ kind: 'rank', value: 6, role: 'main' }, { kind: 'winPct', value: 0.5, role: 'sub' }, { kind: 'profit', value: 0, role: 'extra' }];
  const good = evaluateSeason({ goals, actual: { rank: 2, wins: 40, losses: 14, stage: '우승', net: 3, payrollRatio: 0.9, youthMinutes: 0 }, before: { trust: 60, low: 0 } }, rules);
  assert.equal(good.goals.every((g) => g.met), true);
  assert.equal(good.delta, 12 + 5 + 5 + 3); // 주+보조+추가 + 크게 넘은 보너스
  assert.equal(good.trust, 85); assert.equal(good.reward, true); assert.equal(good.status, 'ok');
  assert.equal(evaluateSeason({ goals, actual: { rank: 1, wins: 50, losses: 4, stage: '우승', net: 3 }, before: { trust: 95, low: 0 } }, rules).trust, 100);
  const bad = evaluateSeason({ goals, actual: { rank: 9, wins: 10, losses: 44, stage: null, net: -5 }, before: { trust: 30, low: 0 } }, rules);
  assert.equal(bad.delta, -10 - 4 - 5); assert.equal(bad.trust, 11); assert.equal(bad.low, 1); assert.equal(bad.status, 'warn');
  const worse = evaluateSeason({ goals, actual: { rank: 9, wins: 10, losses: 44, stage: null, net: -5 }, before: { trust: bad.trust, low: bad.low } }, rules);
  assert.equal(worse.status, 'risk'); assert.equal(worse.fired, false, '해임은 기본 꺼짐');
  const on = evaluateSeason({ goals, actual: { rank: 9, wins: 10, losses: 44, stage: null, net: -5 }, before: { trust: bad.trust, low: bad.low } }, { ...rules, goals: { ...rules.goals, firing: true } });
  assert.equal(on.fired, true);
  assert.equal(evaluateSeason({ goals, actual: { rank: 9, wins: 10, losses: 44, stage: null, net: -5 }, before: { trust: 1, low: 0 } }, rules).trust, 0);
  assert.equal(trustTier(80, rules), '두터움'); assert.equal(trustTier(10, rules), '위험');
});

test('신뢰도·보너스: 로그의 마지막 평가를 읽고, 없으면 시작값, 보너스는 물가를 곱한다', () => {
  assert.equal(trustOf([], rules), rules.goals.trust.start);
  assert.equal(trustOf([{ eval: { trust: 70, low: 0 } }, {}], rules), 70);
  assert.equal(lowStreakOf([{ eval: { trust: 10, low: 2 } }]), 2);
  assert.equal(rewardOf({ reward: true }, 1, rules), 3);
  assert.equal(rewardOf({ reward: true }, 1.1, rules), 3.3);
  assert.equal(rewardOf({ reward: false }, 1, rules), 0);
});

test('진행 막대: 시즌 시작 전은 진행 중, 순위 목표는 지금 순위로 달성권 여부를 보여 준다', () => {
  const live = { rank: 4, wins: 10, losses: 8, played: 18, total: 54, stage: undefined, net: 2, payrollRatio: 0.9, youthMinutes: 100 };
  assert.equal(goalProgress({ kind: 'rank', value: 6 }, { ...live, played: 0 }).state, 'pending');
  assert.equal(goalProgress({ kind: 'rank', value: 6 }, live).state, 'ok');
  assert.equal(goalProgress({ kind: 'rank', value: 3 }, live).state, 'risk');
  const p = goalProgress({ kind: 'winPct', value: 0.5 }, live);
  assert.ok(p.ratio > 0 && p.ratio < 1);
  assert.equal(goalProgress({ kind: 'profit', value: 0 }, { ...live, net: -3 }).state, 'risk');
});

test('게임 연결: 목표는 시즌 시작 상태에서 정해져 같은 상태면 같고, 시즌 결과에 평가(eval)가 저장된다', () => {
  const g0 = newGame(data, 'wonju-db', 42);
  const a = seasonGoals(g0, data), b = seasonGoals(newGame(data, 'wonju-db', 42), data);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  const g1 = playYear(g0, data);
  const ev = g1.log[0].eval;
  assert.ok(ev && ev.goals.length === 3);
  assert.deepEqual(ev.goals.map((x) => [x.kind, x.value]), a.map((x) => [x.kind, x.value]), '저장된 평가의 목표가 시즌 초 목표와 같다');
  assert.ok(ev.trust >= 0 && ev.trust <= 100);
  assert.equal(ev.trust, rules.goals.trust.start + ev.delta > 100 ? 100 : Math.max(0, rules.goals.trust.start + ev.delta));
  // 같은 시드 같은 결과
  assert.deepEqual(playYear(newGame(data, 'wonju-db', 42), data).log[0].eval, ev);
  // JSON 저장 크기: 평가는 작다
  assert.ok(JSON.stringify(ev).length < 600, `eval ${JSON.stringify(ev).length}자`);
});

test('보너스: 신뢰도가 높아 평가에 보너스가 있으면 우리 구단 자금에만 더해진다', () => {
  const funds = { a: 10, b: 5 };
  const entry = { myTeamId: 'a', eval: { bonus: 3.3 } };
  assert.deepEqual(bonusFunds(funds, entry), { a: 13.3, b: 5 });
  assert.equal(bonusFunds(funds, { myTeamId: 'a', eval: {} }), funds);
  assert.equal(bonusFunds(funds, { myTeamId: 'a' }), funds, '이전 저장(평가 없음)은 그대로');
});

test('세션: 목표·신뢰도 읽기, 오프시즌에는 목표가 없고, 마지막 평가를 읽는다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 7 });
  assert.equal(s.goals.length, 3);
  assert.equal(s.trust, rules.goals.trust.start);
  assert.equal(s.lastEval, null);
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs();
  while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  assert.equal(s.goals, null);
  assert.equal(s.lastEval.goals.length, 3);
  assert.equal(s.trust, s.lastEval.trust);
  s.autoOffseason();
  assert.equal(s.goals.length, 3, '다음 시즌 목표가 새로 나온다');
  assert.equal(s.trust, s.lastEval.trust);
});

test('이전 저장 호환: 평가가 없는 로그에서도 신뢰도는 시작값, 목표는 만들어진다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 3 });
  const game = JSON.parse(JSON.stringify(s.game));
  const back = new Session(data, game);
  assert.equal(back.trust, rules.goals.trust.start);
  assert.equal(back.goals.length, 3);
});
