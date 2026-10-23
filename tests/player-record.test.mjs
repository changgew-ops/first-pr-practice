import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { gameRecordRows } from '../web/lib/game.js';
import { loadHistory } from '../src/history.mjs';
import { addGameToSplits, compactRegular, entryRows, sumRows } from '../src/player-record.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const MY = 'busan-kcc';

function playSeason(seed) {
  const s = Session.create(data, { managerId: MY, gmName: 'T', seed });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs();
  while (!s.playoffs.done) s.playoffRound();
  return { s, entry: s.endSeason() };
}

test('게임 시즌 기록: 선수별 승-패는 경기 수와 맞고, 전 경기를 뛴 선수의 승-패는 소속 팀 승패와 같다', () => {
  const { entry } = playSeason(31);
  const record = new Map(entry.standings.map((r) => [r.id, [r.wins, r.losses]]));
  let full = 0;
  for (const [id, [w, l]] of Object.entries(entry.wl)) {
    const line = entry.lines[id];
    assert.equal(w + l, line[0], `${id} 승패 합 ≠ 경기 수`);
    if (!entry.split[id] && line[0] === data.rules.regularSeasonGames) {
      assert.deepEqual([w, l], record.get(line[13]), `${id} 전 경기 출전인데 팀 승패와 다름`);
      full++;
    }
  }
  assert.ok(full >= 5, `전 경기 출전 선수 ${full}명`);
  // 팀마다 (그 팀 경기에 출전한 선수들의 승 합) ≥ 팀 승 수(선수가 여럿 뛰므로)
  for (const r of entry.standings) assert.ok(Object.entries(entry.wl).some(([id, [w]]) => entry.lines[id][13] === r.id && w >= r.wins * 0.5));
});

test('게임 시즌 기록: 플레이오프 줄은 진출 팀 선수에게만 있고 경기=승+패, 우승팀 선수는 결승 줄이 있다', () => {
  const { entry } = playSeason(31);
  const rows = Object.entries(entry.po);
  assert.ok(rows.length >= 40, `플레이오프 선수 ${rows.length}명`);
  const qualified = new Set(entry.standings.slice(0, 6).map((r) => r.id));
  for (const [id, list] of rows) for (const r of list) {
    assert.ok(['p', 'f'].includes(r[0]));
    assert.ok(qualified.has(r[1]), `${id} 진출하지 않은 팀 ${r[1]}`);
    assert.equal(r[3] + r[4], r[2]);
  }
  assert.ok(rows.some(([, list]) => list.some((r) => r[0] === 'f' && r[1] === entry.championId)), '우승팀 결승 줄');
});

test('게임 시즌 기록: 같은 시드면 같은 기록, 저장·복원해도 같다', () => {
  const a = playSeason(7), b = playSeason(7);
  assert.deepEqual([a.entry.wl, a.entry.split, a.entry.po], [b.entry.wl, b.entry.split, b.entry.po]);
  const back = restore(data, JSON.parse(JSON.stringify(serialize(a.s))));
  assert.deepEqual(back.game.log[0].wl, a.entry.wl);
});

test('시즌 중 구단을 옮긴 선수는 구단별로 줄이 나뉘고 합치면 시즌 합계와 같다', () => {
  const box = (id, minutes, points) => ({ id, minutes, points, rebounds: 1, assists: 1, steals: 0, blocks: 0, fgm: 3, fga: 6, tpm: 1, tpa: 2, ftm: 0, fta: 0 });
  const splits = new Map();
  addGameToSplits(splits, { homeId: 'A', awayId: 'B', winnerId: 'A', box: { home: [box('p1', 30, 10), box('p2', 20, 5)], away: [box('p3', 25, 8)] } });
  addGameToSplits(splits, { homeId: 'B', awayId: 'C', winnerId: 'C', box: { home: [box('p1', 28, 12)], away: [box('p4', 30, 9)] } }); // p1이 B로 이적
  const { wl, split } = compactRegular(splits);
  assert.deepEqual(wl.p1, [1, 1]); assert.deepEqual(wl.p2, [1, 0]);
  assert.equal(split.p2, undefined);
  assert.equal(split.p1.length, 2);
  const entry = { season: '2027-28', lines: { p1: [2, 58, 22, 2, 2, 0, 0, 6, 12, 2, 4, 0, 0, 'B'] }, wl, split };
  const rows = entryRows(entry, 'p1');
  assert.deepEqual(rows.map((r) => [r.teamId, r.gp, r.w, r.l]), [['A', 1, 1, 0], ['B', 1, 0, 1]]);
  const tot = sumRows(rows);
  assert.equal(tot.gp, 2); assert.equal(tot.pts, 22); assert.equal(tot.fgPct, 0.5); assert.equal(tot.tpPct, 0.5); assert.equal(tot.ftPct, null);
  assert.deepEqual([tot.w, tot.l], [1, 1]);
});

test('이전 저장(승패·구단 분리가 없는 시즌 줄)도 열리고 승패는 "-"(null), 통산 승패도 알 수 없음', () => {
  const old = { season: '2026-27', lines: { x: [50, 1500, 500, 200, 100, 30, 10] } };
  const rows = entryRows(old, 'x');
  assert.equal(rows.length, 1); assert.equal(rows[0].w, null); assert.equal(rows[0].teamId, null); assert.equal(rows[0].fgm, 0);
  const tot = sumRows([...rows, ...entryRows({ season: '2027-28', lines: { x: [10, 200, 50, 20, 10, 3, 1, 5, 10, 1, 2, 3, 4, 'busan-kcc'] }, wl: { x: [6, 4] } }, 'x')]);
  assert.equal(tot.w, null); assert.equal(tot.gp, 60);
});

test('진행 중인 시즌도 선수 기록 줄에 나온다(정규리그 며칠 뒤)', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'T', seed: 5 });
  s.advance(9);
  const star = s.players.filter((p) => p.teamId === MY).sort((a, b) => b.ovr - a.ovr)[0];
  const rows = gameRecordRows(s.game, star.id, s);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].live && rows[0].game && rows[0].gp > 0 && rows[0].w + rows[0].l === rows[0].gp);
  assert.equal(rows[0].teamId, MY); assert.equal(rows[0].season, '2026-27');
});
