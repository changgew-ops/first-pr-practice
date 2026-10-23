import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPreview, simulateOdds, seriesWinProb, gameWinProb, oddsOf, expectedBest, previewNewsVars } from '../src/preview.mjs';
import { Session } from '../web/lib/session.js';
import { getNews } from '../web/lib/news-view.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const cfg = data.rules.preview;

const ids = data.teams.map((t) => t.id);
const powers = Object.fromEntries(ids.map((id, i) => [id, 70 - i * 0.6]));
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const players = ids.flatMap((id, ti) => Array.from({ length: 12 }, (_, i) => ({
  id: `${id}-${i}`, name: `${id}${i}`, baseName: `${id}${i}`, teamId: id, position: POS[i % 5], ovr: 80 - ti - i * 2, potential: 80 - ti - i, cost: 10 - i / 2, age: 20 + i * 2, origin: i === 0 ? 'foreign' : i === 11 ? 'asia' : 'domestic'
}))).concat({ id: 'free', name: '무소속', teamId: null, position: 'C', ovr: 99, cost: 20, age: 25, origin: 'domestic' });
const input = { season: '2026-27', myId: ids[3], teams: data.teams.map((t) => ({ id: t.id, name: t.name })), players, powers, prestige: Object.fromEntries(ids.map((id, i) => [id, 1 - i * 0.08])), games: 54, playoffs: data.rules.playoffs, rules: cfg };

test('시리즈·경기 승리 확률: 대칭이고 판 수가 길수록 강팀에 유리하다', () => {
  assert.ok(Math.abs(gameWinProb(0, 0.3) - 0.5) < 1e-12);
  assert.ok(Math.abs(seriesWinProb(0.5, 5) - 0.5) < 1e-12 && Math.abs(seriesWinProb(0.5, 7) - 0.5) < 1e-12);
  assert.ok(Math.abs(seriesWinProb(0.7, 5) + seriesWinProb(0.3, 5) - 1) < 1e-12);
  assert.ok(seriesWinProb(0.6, 7) > seriesWinProb(0.6, 5) && seriesWinProb(0.6, 5) > 0.6);
});

test('가상 배당: 확률의 역수에 마진을 얹고 하한·상한을 지킨다', () => {
  assert.equal(oddsOf(0.5, { margin: 0.15, minOdds: 1.2, maxOdds: 99 }), 1.7);
  assert.equal(oddsOf(0.9, { margin: 0.15, minOdds: 1.2, maxOdds: 99 }), 1.2); // 하한
  assert.equal(oddsOf(0.0001, { margin: 0.15, minOdds: 1.2, maxOdds: 99 }), 99); // 상한
  assert.equal(oddsOf(0, cfg), cfg.maxOdds ?? 99);
});

test('몬테카를로: 확률 합이 맞고(우승 1·결승 2·6강 6·1위 1) 전력이 높을수록 우승 확률이 높다', () => {
  const sim = simulateOdds(powers, { games: 54, playoffs: data.rules.playoffs, cfg, seedKey: 't' });
  const sum = (k) => Object.values(sim).reduce((s, x) => s + x[k], 0);
  assert.ok(Math.abs(sum('titleP') - 1) < 1e-9 && Math.abs(sum('finalP') - 2) < 1e-9 && Math.abs(sum('playoffP') - 6) < 1e-9 && Math.abs(sum('topSeedP') - 1) < 1e-9);
  assert.ok(sim[ids[0]].titleP > sim[ids[4]].titleP && sim[ids[4]].titleP > sim[ids[9]].titleP);
  assert.ok(sim[ids[0]].avgWins > 27 && sim[ids[9]].avgWins < 27);
  assert.ok(sim[ids[0]].titleP > 0.15 && sim[ids[0]].titleP < 0.7, `1위 후보 우승 확률 ${sim[ids[0]].titleP}`);
});

test('프리뷰: 같은 입력은 같은 결과, 기자 표 합계가 맞고 베스트5는 가드2·포워드2·센터1', () => {
  const a = buildPreview(input), b = buildPreview(input);
  assert.deepEqual(a, b);
  assert.equal(a.reporterCount, cfg.reporters);
  const sum = (k) => a.rows.reduce((s, r) => s + r.votes[k], 0);
  assert.equal(sum('title'), cfg.reporters);
  assert.equal(sum('final'), cfg.reporters * 2);
  assert.equal(sum('playoff'), cfg.reporters * cfg.playoffPicks);
  assert.ok(a.reporters.every((r) => r.comment && r.name.endsWith('기자')));
  assert.equal(a.expectedBest.length, 5);
  const count = (g) => a.expectedBest.filter((p) => p.group === g).length;
  assert.deepEqual([count('G'), count('F'), count('C')], [2, 2, 1]);
  assert.ok(a.expectedBest.every((p) => p.teamId), '소속 없는 선수는 예상 베스트에 들지 않는다');
  assert.ok(a.rows.every((r) => r.titleOdds >= cfg.minOdds && r.titleOdds <= (cfg.maxOdds ?? 99)));
  for (const id of ids) assert.equal(a.keyPlayers[id].length, 3);
  assert.ok(a.myLine.includes('우승 확률') && a.disclaimer.includes('현금'));
});

test('프리뷰: 전력이나 시즌이 달라지면 결과가 달라진다(시드가 입력에서 나온다)', () => {
  const a = buildPreview(input);
  const c = buildPreview({ ...input, season: '2027-28' });
  assert.notDeepEqual(a.rows.map((r) => r.avgWins), c.rows.map((r) => r.avgWins));
});

test('예상 베스트: 코스트 가중이 지표에 들어간다', () => {
  const two = [
    { id: 'a', name: 'a', teamId: 't', position: 'C', ovr: 70, cost: 5 }, { id: 'b', name: 'b', teamId: 't', position: 'C', ovr: 69, cost: 12 }
  ];
  const best = expectedBest(two, { costWeight: 0.5 });
  assert.equal(best[0].id, 'b');
  assert.equal(expectedBest(two, { costWeight: 0 })[0].id, 'a');
});

test('뉴스 변수: 득표 문자열·배당이 있고 우리 팀 값이 들어간다', () => {
  const pv = buildPreview(input);
  const v = previewNewsVars(pv, (id) => id);
  assert.ok(v.pollText.includes('표') && v.pollCount === cfg.reporters && v.oddsFavValue >= cfg.minOdds);
  assert.ok(v.oddsMy != null && v.playoffMyPct >= 0 && v.quoteText);
});

test('세션: 시즌 시작 전에 열리고, 시즌이 시작돼도 같은 값이며, 오프시즌에는 없다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 7 });
  const a = s.preview();
  assert.equal(a.atStart, true);
  assert.equal(a.rows.length, 10);
  assert.deepEqual(a.rows.map((r) => r.id), s.preview().rows.map((r) => r.id));
  s.advance(3);
  const b = s.preview();
  assert.equal(b.atStart, false);
  assert.deepEqual(a.rows, b.rows);
});

test('뉴스: 개막 전에 기자단 설문 기사와 프리뷰 기사에 득표·가상 배당이 나온다', () => {
  const s = Session.create(data, { managerId: 'seoul-sk', gmName: 't', seed: 9 });
  const items = getNews(s, data).items;
  const poll = items.find((i) => i.kind === 'preview_poll');
  assert.ok(poll, 'preview_poll 기사');
  assert.ok(poll.paragraphs.length >= 2 && poll.paragraphs.length <= 4 && poll.comments.length >= 2 && poll.comments.length <= 5);
  assert.ok(/가상|현금/.test(poll.body));
  const prev = items.find((i) => i.kind === 'preview');
  assert.ok(/설문|배당/.test(prev.body) && prev.paragraphs.length <= 4 && prev.body.length <= 800, prev.body);
  s.advance(2);
  assert.ok(!getNews(s, data).items.some((i) => i.kind === 'preview_poll'), '시즌이 시작되면 개막 전 설문 기사는 나오지 않는다');
});
