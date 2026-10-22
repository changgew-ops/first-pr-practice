import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../web/lib/session.js';
import { liveSeason } from '../web/lib/game.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };

// 브라우저의 localStorage 흉내
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const { listSlots, readSlot, writeSlot, deleteSlot, latestSlot, SLOTS } = await import('../web/lib/save.js');

test('저장 슬롯: 쓰고 읽고 지우고, 메타(단장 이름·구단·시즌·진행)가 남으며, 가장 최근 슬롯을 찾는다', () => {
  assert.deepEqual(SLOTS, ['auto', '1', '2', '3']);
  assert.ok(listSlots().every((s) => s.meta === null));
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: '김단장', seed: 4 });
  s.advance(5);
  assert.equal(writeSlot('1', s.game), true);
  const meta = listSlots().find((x) => x.slot === '1').meta;
  assert.equal(meta.gmName, '김단장'); assert.equal(meta.teamId, 'busan-kcc'); assert.equal(meta.season, '2026-27'); assert.equal(meta.day, 5); assert.equal(meta.stage, 'regular');
  const back = new Session(data, readSlot('1'));
  assert.equal(back.day, 5); assert.deepEqual(back.standings(), s.standings());
  const t = Session.create(data, { managerId: 'wonju-db', gmName: '박단장', seed: 6 });
  writeSlot('2', t.game);
  assert.equal(latestSlot().slot, '2');
  deleteSlot('2');
  assert.equal(readSlot('2'), null);
  assert.equal(latestSlot().slot, '1');
  localStorage.setItem('kblgm.v2.slot.3', '{깨진 json');
  assert.equal(readSlot('3'), null); // 깨진 저장은 null
});

test('저장 크기: 한 시즌 진행 + 시즌 결과가 쌓인 저장도 1MB 안쪽이다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'A', seed: 9 });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); s.endSeason(); s.autoOffseason();
  const size = JSON.stringify(s.game).length;
  assert.ok(size < 1_000_000, `${size}바이트`);
});

test('진행 중인 시즌을 이력 모양으로: 시즌 시작 전·오프시즌에는 없고, 진행 중에는 순위와 플레이오프가 있다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'A', seed: 12 });
  assert.equal(liveSeason(s), null);
  s.advance(12);
  const live = liveSeason(s);
  assert.equal(live.season, '2026-27'); assert.equal(live.live, true);
  assert.equal(live.teams.length, 10); assert.equal(live.playoffs, null); assert.ok(live.leaders.length > 0);
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); s.playoffRound();
  const mid = liveSeason(s);
  assert.equal(mid.playoffs.rounds[0].name, '6강'); assert.equal(mid.playoffs.rounds[0].series.length, 2); assert.equal(mid.championId, null);
  while (!s.playoffs.done) s.playoffRound();
  assert.equal(liveSeason(s).championId, s.playoffs.result().championId);
  s.endSeason();
  assert.equal(liveSeason(s), null);
});
