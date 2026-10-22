import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, playYear, powerRanking, teamPower, payrollInfo, fullHistory, logToHistory, careerLines, stageOf, seasonLabel } from '../web/lib/game.js';
import { loadHistory } from '../src/history.mjs';
import { franchiseSummary } from '../src/history-summary.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };

test('newGame: 구단을 고르면 리그가 만들어지고 모르는 구단은 거부한다', () => {
  const g = newGame(data, 'busan-kcc', 7);
  assert.equal(g.managerId, 'busan-kcc');
  assert.equal(g.league.season, 2026);
  assert.equal(g.league.players.length, data.players.length);
  assert.equal(Object.keys(g.league.funds).length, 10);
  assert.throws(() => newGame(data, 'nowhere', 1), /알 수 없는 구단/);
});

test('화면용 선택자: 전력 순위는 1~10을 한 번씩, 연봉·인원 요약이 선수 목록과 맞는다', () => {
  const g = newGame(data, 'wonju-db', 1);
  const rank = powerRanking(g, data);
  assert.deepEqual(rank.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(rank[0].power >= rank[9].power);
  const pay = payrollInfo(g, data, 'wonju-db');
  const mine = g.league.players.filter((p) => p.teamId === 'wonju-db');
  assert.equal(pay.counts.domestic + pay.counts.foreign + pay.counts.asia, mine.length);
  const { lineup, cost } = teamPower(g, data, 'wonju-db');
  assert.equal(lineup.starters.length + lineup.bench.length, 10);
  assert.ok(cost <= data.rules.lineup.costCap);
});

test('playYear: 한 시즌을 진행해 결과를 쌓고, 같은 시드면 같은 결과이며, 저장(JSON)해도 이어진다', () => {
  const g0 = newGame(data, 'wonju-db', 42);
  const g1 = playYear(g0, data);
  assert.equal(g1.league.season, 2027);
  assert.equal(g1.log.length, 1);
  const e = g1.log[0];
  assert.equal(e.season, '2026-27');
  assert.equal(e.standings.length, 10);
  assert.equal(e.standings.reduce((s, r) => s + r.wins, 0), e.standings.reduce((s, r) => s + r.losses, 0));
  assert.equal(e.myGames.length, data.rules.regularSeasonGames);
  assert.equal(e.myGames.filter((x) => x.win).length, e.standings.find((s) => s.id === 'wonju-db').wins);
  assert.equal(e.series.length, 5);
  assert.equal(stageOf({ championId: e.championId, series: e.series }, e.championId), '우승');
  // 같은 시드 → 같은 결과
  assert.deepEqual(playYear(newGame(data, 'wonju-db', 42), data).log[0].standings, e.standings);
  // 저장했다가 불러와서 두 번째 시즌을 이어도 오류 없이 진행된다
  const restored = JSON.parse(JSON.stringify(g1));
  const g2 = playYear(restored, data);
  assert.equal(g2.log.length, 2);
  assert.equal(g2.league.season, 2028);
  assert.deepEqual(playYear(g1, data).log[1].standings, g2.log[1].standings); // 저장 전후가 같다
});

test('게임에서 진행한 시즌이 실제 이력과 같은 모양으로 이어진다 (구단 요약이 같은 함수로 계산된다)', () => {
  const g = playYear(newGame(data, 'busan-kcc', 3), data);
  const hist = fullHistory(g, data);
  assert.equal(hist.seasons.length, data.history.seasons.length + 1);
  const added = hist.seasons.at(-1);
  assert.equal(added.simulated, true);
  assert.equal(added.teams.length, 10);
  assert.equal(added.playoffs.rounds.length, 3);
  assert.deepEqual(added.playoffs.rounds.map((r) => r.series.length), [2, 2, 1]);
  assert.equal(added.playoffs.rounds.at(-1).series[0].winner, g.log[0].championId);
  const before = franchiseSummary({ seasons: data.history.seasons, franchises: data.history.franchises });
  const champ = g.log[0].championId;
  assert.equal(hist.summary.find((s) => s.id === champ).titles.length, before.find((s) => s.id === champ).titles.length + 1);
  assert.equal(logToHistory(g.log[0]).season, seasonLabel(2026));
});

test('careerLines: 선수의 게임 내 시즌 기록(경기·평균)이 쌓인다', () => {
  const g = playYear(newGame(data, 'wonju-db', 9), data);
  const star = Object.keys(g.log[0].lines).find((id) => g.log[0].lines[id][0] >= 40);
  const [row] = careerLines(g, star);
  assert.equal(row.season, '2026-27');
  assert.ok(row.ppg >= 0 && row.mpg > 0);
});
