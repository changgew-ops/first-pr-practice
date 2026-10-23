import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLineup, validateLineup, lineupCost } from '../src/lineup.mjs';
import { simulateGame, leagueBaseline, lineupMinutes } from '../src/game.mjs';
import { createSchedule, playSeason, playSeries } from '../src/season.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { calcCost } from '../src/rating.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');
const sim = rules.simulation;

const teams = teamData.map((t) => ({
  id: t.id,
  name: t.name,
  lineup: buildLineup(players.filter((p) => p.teamId === t.id), rules, sim.benchWeight)
}));
const baseline = leagueBaseline(teams.map((t) => t.lineup), sim);

// 모든 능력치가 같은 합성 선수로 만든 팀 (강약 비교용)
function flatTeam(id, level) {
  const mk = (i) => ({
    id: `${id}-${i}`, name: `${id}${i}`, position: 'SF', origin: 'domestic', ovr: level, cost: 1,
    stats: { shooting: level, passing: level, defense: level, rebound: level, athletic: level, stamina: level }
  });
  const all = Array.from({ length: 12 }, (_, i) => mk(i));
  return { id, lineup: { starters: all.slice(0, 5), bench: all.slice(5) } };
}

test('buildLineup: 모든 구단이 코스트 제한 안에서 5+7 라인업을 만든다', () => {
  for (const t of teams) {
    const r = validateLineup(t.lineup.starters, t.lineup.bench, rules);
    assert.equal(r.ok, true, `${t.name}: ${r.errors.join(', ')}`);
  }
});

test('buildLineup: 코스트 제한 안에서 OVR 상위 순 탐욕 편성보다 점수가 낮지 않다', () => {
  const score = (l) => l.starters.reduce((s, p) => s + p.ovr, 0) + l.bench.reduce((s, p) => s + p.ovr, 0) * sim.benchWeight;
  for (const t of teams) {
    const roster = players.filter((p) => p.teamId === t.id).sort((a, b) => b.ovr - a.ovr);
    const picked = [];
    for (const p of roster) {
      const left = rules.lineup.starters + rules.lineup.bench - picked.length - 1;
      const cheapestRest = roster.filter((x) => !picked.includes(x) && x !== p).map((x) => x.cost).sort((a, b) => a - b).slice(0, left).reduce((a, b) => a + b, 0);
      if (picked.length < rules.lineup.starters + rules.lineup.bench && lineupCost(picked) + p.cost + cheapestRest <= rules.lineup.costCap) picked.push(p);
    }
    const greedy = { starters: picked.slice(0, 5), bench: picked.slice(5) };
    assert.ok(score(t.lineup) >= score(greedy) - 1e-9, t.name);
  }
});

test('simulateGame: 연장 포함 무승부가 없고 박스스코어 합계가 팀 득점과 일치한다', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const [a, b] = [teams[i % 10], teams[(i + 3) % 10]];
    const r = simulateGame(a, b, baseline, sim, rng);
    assert.notEqual(r.homePts, r.awayPts);
    assert.equal(r.winnerId, r.homePts > r.awayPts ? a.id : b.id);
    assert.equal(r.box.home.reduce((s, p) => s + p.points, 0), r.homePts);
    assert.equal(r.box.away.reduce((s, p) => s + p.points, 0), r.awayPts);
  }
});

test('lineupMinutes: 출전 시간 합계가 200분이다', () => {
  const m = lineupMinutes(teams[0].lineup, sim);
  assert.equal([...m.values()].reduce((a, b) => a + b, 0), 200);
});

test('simulateGame: 같은 시드면 같은 결과', () => {
  const a = simulateGame(teams[0], teams[1], baseline, sim, mulberry32(42));
  const b = simulateGame(teams[0], teams[1], baseline, sim, mulberry32(42));
  assert.deepEqual(a, b);
});

test('강팀이 약팀을 압도하고, 같은 전력이면 승률이 비슷하다', () => {
  const strong = flatTeam('strong', 80);
  const weak = flatTeam('weak', 55);
  const mid = flatTeam('mid', 67);
  const base = leagueBaseline([strong.lineup, weak.lineup, mid.lineup], sim);
  const rng = mulberry32(99);
  let strongWins = 0;
  for (let i = 0; i < 1000; i++) {
    if (simulateGame(i % 2 ? strong : weak, i % 2 ? weak : strong, base, sim, rng).winnerId === 'strong') strongWins++;
  }
  assert.ok(strongWins >= 900, `강팀 승 ${strongWins}/1000`);

  const twin = flatTeam('twin', 67);
  let midWins = 0;
  for (let i = 0; i < 2000; i++) {
    if (simulateGame(i % 2 ? mid : twin, i % 2 ? twin : mid, base, sim, rng).winnerId === 'mid') midWins++;
  }
  assert.ok(midWins >= 900 && midWins <= 1100, `동급 팀 승 ${midWins}/2000`);
});

test('createSchedule: 54일, 하루 한 경기씩, 모든 쌍이 홈 3·원정 3', () => {
  const ids = teamData.map((t) => t.id);
  const days = createSchedule(ids);
  assert.equal(days.length, rules.regularSeasonGames);
  const pair = new Map();
  const homeCount = new Map(ids.map((id) => [id, 0]));
  for (const day of days) {
    assert.equal(day.length, 5);
    const seen = new Set();
    for (const g of day) {
      assert.ok(!seen.has(g.homeId) && !seen.has(g.awayId), '같은 날 중복 출전');
      seen.add(g.homeId); seen.add(g.awayId);
      assert.notEqual(g.homeId, g.awayId);
      const key = [g.homeId, g.awayId].sort().join('|');
      const e = pair.get(key) ?? { total: 0, home: new Map() };
      e.total++;
      e.home.set(g.homeId, (e.home.get(g.homeId) ?? 0) + 1);
      pair.set(key, e);
      homeCount.set(g.homeId, homeCount.get(g.homeId) + 1);
    }
  }
  assert.equal(pair.size, 45);
  for (const [key, e] of pair) {
    assert.equal(e.total, 6, key);
    for (const n of e.home.values()) assert.equal(n, 3, key);
  }
  for (const n of homeCount.values()) assert.equal(n, 27);
});

test('playSeason: 순위표 정합성과 플레이오프 대진', () => {
  const r = playSeason(teams, rules, baseline, mulberry32(5), { keepGames: true });
  assert.equal(r.games.length, 270);
  for (const s of r.standings) assert.equal(s.wins + s.losses, 54);
  assert.equal(r.standings.reduce((a, s) => a + s.wins, 0), 270);
  assert.equal(r.standings.reduce((a, s) => a + s.pointsFor, 0), r.standings.reduce((a, s) => a + s.pointsAgainst, 0));
  for (let i = 1; i < r.standings.length; i++) assert.ok(r.standings[i - 1].wins >= r.standings[i].wins);

  const top6 = r.standings.slice(0, 6).map((s) => s.id);
  const [q36, q45, s14, s23, fin] = r.playoffs.series;
  assert.deepEqual(new Set([q36.higherId, q36.lowerId]), new Set([top6[2], top6[5]]));
  assert.deepEqual(new Set([q45.higherId, q45.lowerId]), new Set([top6[3], top6[4]]));
  assert.equal(s14.higherId, top6[0]);
  assert.equal(s23.higherId, top6[1]);
  assert.ok([q45.winnerId].includes(s14.lowerId));
  assert.ok([q36.winnerId].includes(s23.lowerId));
  assert.equal(r.championId, fin.winnerId);
  assert.ok([s14.winnerId, s23.winnerId].includes(r.championId));
  const needs = [3, 3, 3, 3, 4];
  r.playoffs.series.forEach((s, i) => {
    assert.equal(Math.max(...Object.values(s.wins)), needs[i]);
    assert.equal(s.wins[s.winnerId], needs[i]);
    assert.ok(s.games.length >= needs[i] && s.games.length <= needs[i] * 2 - 1);
  });
});

test('playSeries: 홈 패턴(2-2-1)을 따른다', () => {
  const hi = teams[0];
  const lo = teams[9];
  const s = playSeries(hi, lo, 5, rules.playoffs.homePattern['5'], baseline, sim, mulberry32(3));
  s.games.forEach((g, i) => assert.equal(g.homeId, rules.playoffs.homePattern['5'][i] === 1 ? hi.id : lo.id));
});

test('같은 시드면 시즌 전체 결과가 같다', () => {
  const a = playSeason(teams, rules, baseline, mulberry32(11));
  const b = playSeason(teams, rules, baseline, mulberry32(11));
  assert.deepEqual(a.standings, b.standings);
  assert.equal(a.championId, b.championId);
});

test('밸런스: 60시즌 평균으로 강팀이 약팀보다 확실히 많이 이기고 득점 수준이 자연스럽다', () => {
  const wins = new Map(teams.map((t) => [t.id, 0]));
  let pts = 0;
  let games = 0;
  for (let s = 0; s < 60; s++) {
    const r = playSeason(teams, rules, baseline, mulberry32(1000 + s), { keepGames: true });
    for (const st of r.standings) wins.set(st.id, wins.get(st.id) + st.wins);
    for (const g of r.games) { pts += g.homePts + g.awayPts; games++; }
  }
  const strength = (t) => [...t.lineup.starters, ...t.lineup.bench].reduce((s, p) => s + p.ovr, 0);
  const ranked = [...teams].sort((a, b) => strength(b) - strength(a));
  const best = wins.get(ranked[0].id) / 60 / 54;
  const worst = wins.get(ranked[9].id) / 60 / 54;
  // 실제 로스터에서는 구단 간 승률 격차가 0.24 안팎이다(실제 리그는 더 벌어진다: 2024-25 SK 76% vs 삼성 30%). 시뮬레이션 격차 보정은 후속 과제.
  assert.ok(best - worst >= 0.2, `승률 격차 ${(best - worst).toFixed(2)}`);
  assert.ok(best <= 0.8 && worst >= 0.2, `최강 ${best.toFixed(2)} / 최약 ${worst.toFixed(2)}`);
  const ppg = pts / games;
  assert.ok(ppg >= 140 && ppg <= 165, `경기당 합산 득점 ${ppg.toFixed(1)}`);
});

test('calcCost가 라인업 코스트 계산과 연결된다', () => {
  for (const t of teams) {
    const all = [...t.lineup.starters, ...t.lineup.bench];
    assert.equal(lineupCost(all), all.reduce((s, p) => s + calcCost(p.ovr), 0));
  }
});
