import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextCondition, drainFactor, lineupCondScore, condEdge, fatigueStreak, condTier, startCondition } from '../src/condition.mjs';
import { injuryChance } from '../src/injuries.mjs';
import { buildLineup } from '../src/lineup.mjs';
import { createLeague } from '../src/league.mjs';
import { beginSeason } from '../src/season-run.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';
const p50 = { stats: { stamina: 50 } };

test('컨디션: 뛴 시간만큼 떨어지고 쉬면 회복한다, 스태미나가 높을수록 덜 떨어진다, 0~100을 벗어나지 않는다', () => {
  const played = nextCondition(100, p50, 30, rules);
  assert.ok(played < 100 && played > 80);
  const tired = nextCondition(60, p50, 0, rules);
  assert.ok(tired > 60, '쉬면 오른다');
  assert.ok(nextCondition(60, { stats: { stamina: 80 } }, 30, rules) > nextCondition(60, { stats: { stamina: 30 } }, 30, rules));
  assert.ok(drainFactor({ stats: { stamina: 90 } }, rules) < 1 && drainFactor({ stats: { stamina: 20 } }, rules) > 1);
  assert.equal(nextCondition(100, p50, 0, rules), 100);
  assert.ok(nextCondition(0, p50, 48, rules) >= 0);
  // 매일 30분을 뛰는 선수의 균형점(규칙값 노트: 67 안팎), 벤치는 90대
  let c = 100; for (let i = 0; i < 60; i++) c = nextCondition(c, p50, 30, rules);
  assert.ok(c > 62 && c < 72, `주전 균형 ${c.toFixed(1)}`);
  let b = 100; for (let i = 0; i < 60; i++) b = nextCondition(b, p50, 11, rules);
  assert.ok(b > 90, `벤치 균형 ${b.toFixed(1)}`);
  // 체력 코치가 좋으면 더 빨리 회복한다
  assert.ok(nextCondition(60, p50, 0, rules, 1.3) > nextCondition(60, p50, 0, rules, 1));
});

test('팀 이득: 컨디션이 같으면 0, 지친 팀은 리그 평균보다 손해, 리그 평균은 0', () => {
  const league = createLeague(players, rules, { teamData: teams });
  const lu = (id) => buildLineup(league.players.filter((p) => p.teamId === id), rules, rules.simulation.benchWeight);
  const a = lu(MY), b = lu('wonju-db');
  const fresh = new Map();
  assert.equal(lineupCondScore(a, fresh, rules), 0);
  const tiredMap = new Map([...a.starters].map((p) => [p.id, 30]));
  const sa = lineupCondScore(a, tiredMap, rules), sb = lineupCondScore(b, tiredMap, rules);
  assert.ok(sa < 0 && sb === 0);
  const mean = (sa + sb) / 2;
  assert.ok(condEdge(sa, mean, rules) < 0 && condEdge(sb, mean, rules) > 0);
  assert.ok(Math.abs(condEdge(sa, mean, rules) + condEdge(sb, mean, rules)) < 0.02);
});

test('부상 연결: 피로 항을 컨디션이 정한다(컨디션이 낮을수록 부상 확률이 오르고, 최대는 연속 출전 항과 같은 상한)', () => {
  assert.equal(fatigueStreak(100, rules), 0);
  assert.equal(fatigueStreak(rules.condition.lowCond, rules), rules.injuries.fatigue.cap);
  assert.equal(fatigueStreak(0, rules), rules.injuries.fatigue.cap);
  const p = { age: 27, stats: { stamina: 50 } };
  assert.ok(injuryChance(p, 30, rules, fatigueStreak(40, rules)) > injuryChance(p, 30, rules, fatigueStreak(95, rules)));
});

test('단계 표시', () => {
  assert.equal(condTier(90).key, 'good'); assert.equal(condTier(65).key, 'ok'); assert.equal(condTier(45).key, 'tired'); assert.equal(condTier(10).key, 'bad');
  assert.equal(startCondition(rules), 100);
});

test('진행기: 하루가 지나면 뛴 선수의 컨디션이 떨어지고, 휴식을 지정하면 그 선수는 쉬어 회복한다(경기는 한 번만)', () => {
  const league = createLeague(players, rules, { teamData: teams });
  const run = beginSeason(league, teams, rules, mulberry32(3), { manager: MY, seed: 3 });
  const star = run.players.filter((p) => p.teamId === MY).sort((a, b) => b.ovr - a.ovr)[0];
  assert.equal(run.conditionOf(star.id), 100);
  const bad = run.setRest(run.players.filter((p) => p.teamId === MY).map((p) => p.id));
  assert.equal(bad.ok, false); // 엔트리를 채울 수 없다
  assert.ok(run.setRest([star.id]).ok);
  assert.deepEqual(run.rest, [star.id]);
  const day1 = run.playDay();
  const mine = day1.games.find((g) => g.homeId === MY || g.awayId === MY);
  const box = (mine.homeId === MY ? mine.box.home : mine.box.away);
  assert.ok(!box.some((l) => l.id === star.id), '쉬는 선수는 박스스코어에 없다');
  assert.deepEqual(run.rest, []); // 하루 지나면 비워진다
  assert.equal(run.conditionOf(star.id), 100);
  run.playDay();
  assert.ok(run.conditionOf(star.id) < 100, '다음 날 뛰었으니 떨어진다');
  // 여러 날 뛰면 주전은 벤치보다 눈에 띄게 지친다
  run.playDays(12);
  const roster = run.players.filter((p) => p.teamId === MY).sort((a, b) => b.ovr - a.ovr);
  assert.ok(run.conditionOf(roster[0].id) < 90);
});

test('AI 구단은 많이 지친 선수를 쉬게 하되 건강한 선수가 최소 인원 밑으로 떨어지지 않는다', () => {
  const league = createLeague(players, rules, { teamData: teams });
  const run = beginSeason(league, teams, rules, mulberry32(8), { manager: MY, seed: 8 });
  run.playDays(30);
  let rested = 0;
  for (const t of teams) {
    if (t.id === MY) continue;
    const roster = run.players.filter((p) => p.teamId === t.id);
    const below = roster.filter((p) => run.conditionOf(p.id) < rules.condition.restBelow).length;
    rested += below;
    assert.ok(roster.length - Math.min(below, roster.length - rules.condition.minHealthyAfterRest) >= rules.condition.minHealthyAfterRest);
  }
  assert.ok(rested >= 0);
});

test('세션: 휴식 지정이 조작 기록으로 저장되고 복원해도 컨디션·순위가 같다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 81 });
  s.advance(8);
  const star = s.players.filter((p) => p.teamId === MY).sort((a, b) => b.ovr - a.ovr)[0];
  assert.ok(s.setRest([star.id]).ok);
  s.advance(5);
  const copy = restore(data, serialize(s));
  assert.equal(copy.conditions.get(star.id), s.conditions.get(star.id));
  assert.deepEqual(copy.standings().map((x) => `${x.id}:${x.wins}`), s.standings().map((x) => `${x.id}:${x.wins}`));
  assert.ok(s.game.actions.some((a) => a.type === 'rest'));
});
