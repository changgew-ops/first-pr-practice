import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { invariants } from './helpers.mjs';
import { mulberry32 } from '../src/rng.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');

test('playLeagueYear: 한 해를 진행하면 시즌이 오르고 규칙이 유지되며 기록이 쌓인다', () => {
  const league = createLeague(players, rules);
  const r = playLeagueYear(league, teamData, rules, mulberry32(1));
  assert.equal(r.league.season, league.season + 1);
  assert.equal(r.result.standings.length, 10);
  assert.ok(r.result.championId);
  invariants(r.league, 'Y1');
  const games = [...r.totals.values()].reduce((s, t) => s + t.games, 0);
  assert.ok(games > 1000);
  for (const t of r.totals.values()) assert.ok(t.games <= 54);
});

test('시즌 중 갱신: 신체 능력은 시즌 중 변하지 않고, 기술 능력치는 일부 선수가 변한다', () => {
  const league = createLeague(players, rules);
  const r = playLeagueYear(league, teamData, rules, mulberry32(2));
  let skillChanged = 0;
  for (const p of r.seasonPlayers) {
    const start = r.startStats.get(p.id);
    assert.equal(p.stats.athletic, start.athletic, `${p.name} 운동능력`);
    assert.equal(p.stats.stamina, start.stamina, `${p.name} 체력`);
    if (['shooting', 'passing', 'defense', 'rebound'].some((k) => p.stats[k] !== start[k])) skillChanged++;
    assert.equal(p.potential, league.players.find((x) => x.id === p.id).potential, '시즌 중 갱신은 POT를 올리지 않는다');
  }
  assert.ok(skillChanged >= 40, `갱신된 선수 ${skillChanged}명`);
});

test('시즌 중 갱신을 끄면 시즌 중 능력치가 그대로다', () => {
  const league = createLeague(players, rules);
  const r = playLeagueYear(league, teamData, rules, mulberry32(2), { inSeasonUpdates: false });
  for (const p of r.seasonPlayers) assert.deepEqual(p.stats, r.startStats.get(p.id));
});

test('훈련 관리 구단: 같은 조건에서 훈련한 구단 선수들의 능력치가 더 많이 오른다', () => {
  // 성장 여지(잠재력 − 능력치)가 가장 큰 구단을 고른다. 나이 든 선수만 있는 구단은 훈련해도 오를 곳이 없다
  const room = (t) => players.filter((p) => p.teamId === t.id).reduce((s, p) => s + Math.max(0, p.potential - p.ovr), 0);
  const manager = [...teamData].sort((a, b) => room(b) - room(a))[0].id;
  const gain = (opts, seed) => {
    const league = createLeague(players, rules);
    const r = playLeagueYear(league, teamData, rules, mulberry32(seed), opts);
    const mine = r.seasonPlayers.filter((p) => p.teamId === manager);
    return mine.reduce((s, p) => s + p.ovr - league.players.find((x) => x.id === p.id).ovr, 0) / mine.length;
  };
  let withTraining = 0, without = 0;
  for (const seed of [1, 2, 3]) { withTraining += gain({ manager }, seed); without += gain({}, seed); }
  assert.ok((withTraining - without) / 3 >= 0.1, `훈련 효과 +${((withTraining - without) / 3).toFixed(2)}`);
});

test('여러 해 연속 진행: 같은 시드면 같은 결과이고 매년 규칙이 유지된다', () => {
  const run = () => {
    let league = createLeague(players, rules);
    const rng = mulberry32(9);
    const champs = [];
    for (let y = 0; y < 4; y++) {
      const r = playLeagueYear(league, teamData, rules, rng);
      champs.push(r.result.championId);
      invariants(r.league, `Y${y + 1}`);
      league = r.league;
    }
    return { champs, league };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.champs, b.champs);
  assert.deepEqual(a.league, b.league);
});
