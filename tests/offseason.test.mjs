import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { progressPlayer, retireProbability, runOffseason } from '../src/offseason.mjs';
import { createLeague } from '../src/league.mjs';
import { calcOvr } from '../src/rating.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { invariants } from './helpers.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');

const mk = (age, level, potential) => {
  const stats = { shooting: level, passing: level, defense: level, rebound: level, athletic: level, stamina: level };
  const ovr = calcOvr('SF', stats);
  return { id: 'p', name: 'p', position: 'SF', age, stats, ovr, cost: 5, potential, rarity: 'common' };
};

// 시즌 종료 처리용 가짜 순위표
const standings = teamData.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));



test('retireProbability: 나이가 들수록 높아지고 40세 이상은 반드시 은퇴, 저능력 선수가 더 높다', () => {
  const a = rules.aging;
  let prev = 0;
  for (let age = 20; age <= 41; age++) {
    const p = retireProbability(age, 65, a);
    assert.ok(p >= prev - 1e-12, `age ${age}`);
    prev = p;
  }
  assert.equal(retireProbability(40, 90, a), 1);
  assert.ok(retireProbability(34, 50, a) > retireProbability(34, 70, a));
});

test('progressPlayer: 젊고 잠재력이 크면 오르고, 나이가 들면 내려간다', () => {
  const rng = mulberry32(3);
  let youngDelta = 0, oldDelta = 0, peakDelta = 0;
  for (let i = 0; i < 300; i++) {
    const y = progressPlayer(mk(20, 55, 80), rules, rng); youngDelta += y.ovr - 55;
    const o = progressPlayer(mk(34, 70, 70), rules, rng); oldDelta += o.ovr - 70;
    const m = progressPlayer(mk(27, 70, 70), rules, rng); peakDelta += m.ovr - 70;
  }
  assert.ok(youngDelta / 300 >= 1.5, `젊은 선수 평균 +${(youngDelta / 300).toFixed(2)}`);
  assert.ok(oldDelta / 300 <= -1, `노장 평균 ${(oldDelta / 300).toFixed(2)}`);
  assert.ok(Math.abs(peakDelta / 300) <= 0.6, `전성기 평균 ${(peakDelta / 300).toFixed(2)}`);
});

test('progressPlayer: 나이 +1, 범위 유지, 원본 불변, 27세부터는 POT가 현재 OVR로 수렴', () => {
  const p = mk(26, 66, 74);
  const snapshot = JSON.stringify(p);
  const n = progressPlayer(p, rules, mulberry32(1));
  assert.equal(JSON.stringify(p), snapshot);
  assert.equal(n.age, 27);
  assert.equal(n.potential, n.ovr);
  for (const v of Object.values(n.stats)) assert.ok(v >= 20 && v <= 99);
  const capped = progressPlayer(mk(20, 97, 99), rules, mulberry32(2));
  for (const v of Object.values(capped.stats)) assert.ok(v <= 99);
});

test('신체 능력이 기술 능력치보다 먼저 떨어진다', () => {
  const rng = mulberry32(8);
  let phys = 0, skill = 0;
  for (let i = 0; i < 300; i++) {
    const n = progressPlayer(mk(30, 70, 70), rules, rng);
    phys += (n.stats.athletic - 70) + (n.stats.stamina - 70);
    skill += (n.stats.shooting - 70) + (n.stats.passing - 70) + (n.stats.defense - 70) + (n.stats.rebound - 70);
  }
  assert.ok(phys / 2 < skill / 4, `신체 ${(phys / 600).toFixed(2)} vs 기술 ${(skill / 1200).toFixed(2)}`);
});

test('runOffseason: 한 번 돌린 뒤에도 로스터·연봉 캡·번호·포지션 규칙이 유지된다', () => {
  const league = createLeague(players, rules);
  const { league: next, report } = runOffseason(league, standings, teamData, rules, mulberry32(11));
  assert.equal(next.season, league.season + 1);
  invariants(next, 'Y1');
  // 은퇴한 선수는 명단에 없다
  const ids = new Set(next.players.map((p) => p.id));
  for (const r of report.retired) assert.ok(!ids.has(r.id), `${r.name} 은퇴했는데 남아 있음`);
  // 드래프트: 하위 팀부터 지명, 신인은 어리다
  assert.equal(report.drafted.length, rules.offseason.draft.rounds * 10);
  assert.equal(report.drafted[0].teamId, standings.at(-1).id);
  for (const d of report.drafted) {
    const p = next.players.find((x) => x.id === d.id) ?? next.freeAgents.find((x) => x.id === d.id);
    if (p) assert.ok(p.age <= 24, `${p.name} ${p.age}세`);
  }
  // 살아남은 선수는 한 살 더 먹는다
  const before = new Map(league.players.map((p) => [p.id, p]));
  for (const p of next.players) if (before.has(p.id)) assert.equal(p.age, before.get(p.id).age + 1);
});

test('runOffseason: 같은 시드면 같은 결과, 원본 상태는 바뀌지 않는다', () => {
  const league = createLeague(players, rules);
  const snapshot = JSON.stringify(league);
  const a = runOffseason(league, standings, teamData, rules, mulberry32(5));
  const b = runOffseason(league, standings, teamData, rules, mulberry32(5));
  assert.equal(JSON.stringify(league), snapshot);
  assert.deepEqual(a.league, b.league);
});

test('runOffseason: 8년 연속 진행해도 규칙이 깨지지 않고 평균 능력치가 안정적이다', () => {
  let league = createLeague(players, rules);
  const rng = mulberry32(77);
  for (let y = 0; y < 8; y++) {
    league = runOffseason(league, standings, teamData, rules, rng).league;
    invariants(league, `Y${y + 1}`);
  }
  const avg = league.players.reduce((s, p) => s + p.ovr, 0) / league.players.length;
  const age = league.players.reduce((s, p) => s + p.age, 0) / league.players.length;
  assert.ok(avg >= 56 && avg <= 68, `평균 OVR ${avg.toFixed(1)}`);
  assert.ok(age >= 22 && age <= 30, `평균 나이 ${age.toFixed(1)}`);
  assert.ok(league.freeAgents.length <= rules.offseason.freeAgentPoolMax);
});
