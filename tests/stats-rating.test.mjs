import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invNormalCdf, buildRatingModel, statRatings, shrinkRatings, updateSkillsFromSeason, credibility } from '../src/stats-rating.mjs';
import { parseStatsCsv, ratingsFromRows, priorForPosition } from '../src/stats-import.mjs';
import { buildLineup } from '../src/lineup.mjs';
import { leagueBaseline } from '../src/game.mjs';
import { playSeason } from '../src/season.mjs';
import { addBox, emptyTotals } from '../src/stats.mjs';
import { mulberry32 } from '../src/rng.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');
const model = rules.ratingModel;

const corr = (a, b) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y) / n;
  const mb = b.reduce((x, y) => x + y) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb);
};

// 한 시즌 시뮬레이션 기록 (공용)
function simulateTotals(seed, seasons = 1) {
  const teams = teamData.map((t) => ({ id: t.id, lineup: buildLineup(players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight) }));
  const base = leagueBaseline(teams.map((t) => t.lineup), rules.simulation);
  const totals = new Map();
  for (let s = 0; s < seasons; s++) {
    const r = playSeason(teams, rules, base, mulberry32(seed + s), { keepGames: true });
    for (const g of r.games) { addBox(totals, g.box.home); addBox(totals, g.box.away); }
  }
  return totals;
}

test('invNormalCdf: 알려진 값과 대칭', () => {
  assert.ok(Math.abs(invNormalCdf(0.5)) < 1e-3);
  assert.ok(Math.abs(invNormalCdf(0.975) - 1.96) < 0.01);
  assert.ok(Math.abs(invNormalCdf(0.025) + 1.96) < 0.01);
  assert.ok(Math.abs(invNormalCdf(0.84134) - 1) < 0.01);
});

test('parseStatsCsv: 별칭 컬럼, 주석, 오류 처리', () => {
  const ok = parseStatsCsv('# 예시\nname,games,minutes,points,rebounds,assists,steals,blocks,fgm,fga,tpm,tpa,ftm,fta\n가나다,10,300,100,30,20,5,2,40,90,10,30,10,14\n');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].name, '가나다');
  assert.equal(ok[0].totals.points, 100);
  assert.throws(() => parseStatsCsv('name,games\n가나다,10\n'), /필요한 컬럼/);
  assert.throws(() => parseStatsCsv('name,games,minutes,pts,reb,ast,stl,blk,fgm,fga,tpm,tpa,ftm,fta\n가나다,10,x,1,1,1,1,1,1,1,1,1,1,1\n'), /올바르지 않습니다/);
});

test('기록 → 능력치: 시뮬레이션 기록으로 원래 능력치를 되찾는다', () => {
  const totals = simulateTotals(100, 2);
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...totals.entries()].map(([id, t]) => ({ name: id, totals: t }));
  const positions = new Map(rows.map((r) => [r.name, byId.get(r.name).position]));
  const rated = ratingsFromRows(rows, positions, model);
  const qualified = rows.filter((r) => r.totals.minutes >= 600);
  const check = (stat, min) => {
    const c = corr(qualified.map((r) => byId.get(r.name).stats[stat]), qualified.map((r) => rated.get(r.name).stats[stat]));
    assert.ok(c >= min, `${stat} 상관 ${c.toFixed(2)} < ${min}`);
  };
  check('shooting', 0.85);
  check('rebound', 0.85);
  check('passing', 0.8);
  check('defense', 0.6);
});

test('기록 → 능력치: 효율이 좋을수록 슛 능력치가 높다', () => {
  const mk = (pts, fga, tpm, tpa) => ({ ...emptyTotals(), games: 40, minutes: 1200, points: pts, fgm: Math.round(pts / 2.2), fga, tpm, tpa, ftm: 50, fta: 70, rebounds: 150, assists: 100, steals: 40, blocks: 10 });
  const league = Array.from({ length: 30 }, (_, i) => mk(500 + i * 15, 450 + i * 3, 30 + i, 100 + i));
  const rm = buildRatingModel(league, model);
  const low = statRatings(mk(400, 520, 20, 90), rm);
  const high = statRatings(mk(700, 480, 70, 150), rm);
  assert.ok(high.shooting > low.shooting + 10, `${low.shooting} vs ${high.shooting}`);
});

test('기록이 적은 선수는 기준점 쪽으로 당겨진다', () => {
  const league = simulateTotals(7);
  const rm = buildRatingModel([...league.values()], model);
  const raw = { shooting: 90, passing: 90, defense: 90, rebound: 90, athletic: 90, stamina: 90 };
  const prior = priorForPosition('PG', model);
  const small = shrinkRatings(raw, 120, rm, prior);
  const full = shrinkRatings(raw, 1500, rm, prior);
  assert.equal(credibility(1500, model), 1);
  for (const k of Object.keys(raw)) {
    assert.equal(full[k], 90);
    assert.ok(small[k] < 90 && small[k] > prior[k], `${k}: ${small[k]}`);
  }
});

test('시즌 중 갱신: 신체 능력은 그대로, 기술 능력치는 반영률 상한 안에서만 움직인다', () => {
  const totals = simulateTotals(21);
  const start = new Map(players.map((p) => [p.id, { ...p.stats }]));
  const updates = updateSkillsFromSeason(players, start, totals, model);
  assert.ok(updates.size > 50);
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const [id, next] of updates) {
    const p = byId.get(id);
    assert.equal(next.athletic, p.stats.athletic);
    assert.equal(next.stamina, p.stats.stamina);
    for (const k of ['shooting', 'passing', 'defense', 'rebound']) {
      assert.ok(next[k] >= 20 && next[k] <= 99);
      // 한 번의 갱신으로 반영률 상한(25%)보다 많이 움직일 수 없다 (목표값이 최대 ±80 떨어져 있어도 20 이내)
      assert.ok(Math.abs(next[k] - p.stats[k]) <= 22, `${k}: ${p.stats[k]} → ${next[k]}`);
    }
  }
});

test('시즌 중 갱신: 기록이 없는 선수는 갱신 대상이 아니다', () => {
  const totals = simulateTotals(21);
  const start = new Map(players.map((p) => [p.id, { ...p.stats }]));
  const updates = updateSkillsFromSeason(players, start, totals, model);
  for (const p of players) if (!totals.has(p.id)) assert.ok(!updates.has(p.id));
  assert.equal(updateSkillsFromSeason(players, start, new Map(), model).size, 0);
});
