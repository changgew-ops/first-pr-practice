import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadHistory } from '../src/history.mjs';
import { seedLegacy, appendSeason, prestigeOf, prestigeTable, stageOfHistory } from '../src/legacy.mjs';
import { settleSeason, initialFunds } from '../src/funds.mjs';
import { offerScore } from '../src/freeagency.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');
const history = loadHistory();

test('stageOfHistory: 2024-25는 LG 우승, SK는 1위라 4강 직행 후 탈락, 소노는 진출 못함', () => {
  const s = history.seasons.find((x) => x.season === '2024-25');
  assert.equal(stageOfHistory(s, 'changwon-lg'), '우승');
  assert.ok(['결승', '4강'].includes(stageOfHistory(s, 'seoul-sk')));
  assert.equal(stageOfHistory(s, 'goyang-sono'), null);
  const old = history.seasons.find((x) => x.season === '2000-01'); // 플레이오프 화면이 없는 시즌은 우승팀만 안다
  assert.equal(stageOfHistory(old, 'seoul-samsung'), '우승');
  assert.equal(stageOfHistory(old, 'busan-kcc'), null);
});

test('seedLegacy: 구단마다 30개 시즌(소노·가스공사 계보 포함), 통산 우승 횟수가 위키와 같다', () => {
  const legacy = seedLegacy(history.seasons, teamData);
  const titles = (id) => legacy[id].filter((r) => r.stage === '우승').length;
  const regular = (id) => legacy[id].filter((r) => r.regularChampion).length;
  for (const t of teamData) assert.ok(legacy[t.id].length >= 29, t.id);
  assert.equal(titles('ulsan-hyundai-mobis'), 7);
  assert.equal(titles('busan-kcc'), 7);
  assert.equal(regular('ulsan-hyundai-mobis'), 7);
  assert.equal(regular('wonju-db'), 6); // 2019-20은 중단된 시즌이라 제외
});

test('prestigeOf: 기록이 없으면 중립(0.5), 최근 성적이 좋고 우승이 많을수록 높다', () => {
  assert.equal(prestigeOf([], rules), 0.5);
  const good = Array.from({ length: 10 }, (_, i) => ({ season: `s${i}`, winPct: 0.7, stage: '우승', regularChampion: true }));
  const bad = Array.from({ length: 10 }, (_, i) => ({ season: `s${i}`, winPct: 0.3, stage: null, regularChampion: false }));
  assert.ok(prestigeOf(good, rules) > 0.9);
  assert.ok(prestigeOf(bad, rules) < 0.05);
  // 실제 이력: 최근 5년 성적이 가장 나쁜 삼성이 SK보다 낮다
  const t = prestigeTable(seedLegacy(history.seasons, teamData), rules);
  assert.ok(t['seoul-samsung'].score < t['seoul-sk'].score);
  for (const v of Object.values(t)) assert.ok(v.score >= 0 && v.score <= 1);
});

test('appendSeason: 새 시즌을 모든 구단에 한 줄씩 붙이고 우승팀을 기록한다', () => {
  const legacy = seedLegacy(history.seasons, teamData);
  const standings = teamData.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));
  const playoffs = { championId: standings[2].id, series: [
    { higherId: standings[2].id, lowerId: standings[5].id }, { higherId: standings[3].id, lowerId: standings[4].id },
    { higherId: standings[0].id, lowerId: standings[3].id }, { higherId: standings[1].id, lowerId: standings[2].id },
    { higherId: standings[2].id, lowerId: standings[1].id }] };
  const next = appendSeason(legacy, '2026-27', { standings, playoffs }, rules);
  for (const t of teamData) assert.equal(next[t.id].length, legacy[t.id].length + 1);
  assert.equal(next[standings[2].id].at(-1).stage, '우승');
  assert.equal(next[standings[0].id].at(-1).regularChampion, true);
  assert.equal(legacy[standings[0].id].length, next[standings[0].id].length - 1); // 원본은 바뀌지 않는다
});

test('전통은 수입과 FA 선호에 반영된다 (중립이면 영향 없음)', () => {
  const funds = initialFunds(teamData, rules);
  const standings = teamData.map((t, i) => ({ id: t.id, wins: 27, losses: 27 }));
  const playoffs = { championId: standings[0].id, series: [
    { higherId: standings[2].id, lowerId: standings[5].id }, { higherId: standings[3].id, lowerId: standings[4].id },
    { higherId: standings[0].id, lowerId: standings[3].id }, { higherId: standings[1].id, lowerId: standings[2].id },
    { higherId: standings[0].id, lowerId: standings[1].id }] };
  const base = settleSeason(funds, players, standings, playoffs, teamData, rules).ledger;
  const rich = { [teamData[3].id]: { score: 1 } };
  const withP = settleSeason(funds, players, standings, playoffs, teamData, rules, rich).ledger;
  assert.ok(withP[teamData[3].id].revenue > base[teamData[3].id].revenue);
  assert.equal(withP[teamData[4].id].revenue, base[teamData[4].id].revenue); // 정보가 없는 구단은 중립
  const p = { ...players.find((x) => x.origin === 'domestic'), prevTeamId: null, teamId: null };
  const roster = [];
  const ctx = (prestige) => ({ season: 2026, winPct: new Map(), prestige: new Map([['seoul-sk', prestige]]) });
  const hi = offerScore(p, 3, 'seoul-sk', roster, ctx(1), rules).score;
  const lo = offerScore(p, 3, 'seoul-sk', roster, ctx(0), rules).score;
  assert.ok(hi > lo);
  assert.equal(offerScore(p, 3, 'seoul-sk', roster, { season: 2026, winPct: new Map() }, rules).score, offerScore(p, 3, 'seoul-sk', roster, ctx(0.5), rules).score);
});

test('리그: 실제 이력에서 시작해 시즌마다 이력이 붙고, 이력 없이도 돌아간다', () => {
  const l0 = createLeague(players, rules, { history, teamData });
  const n0 = l0.legacy[teamData[0].id].length;
  const r = playLeagueYear(l0, teamData, rules, mulberry32(4));
  assert.equal(r.league.legacy[teamData[0].id].length, n0 + 1);
  assert.equal(r.league.legacy[teamData[0].id].at(-1).season, '2026-27');
  const l1 = createLeague(players, rules); // 이력 없음
  const r1 = playLeagueYear(l1, teamData, rules, mulberry32(4));
  assert.equal(r1.league.legacy, undefined);
});
