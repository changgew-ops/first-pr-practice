import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardKey, keyOfPlayer, buildCatalog, newCodexKeys, filterCatalog, codexProgress } from '../src/codex.mjs';
import { expandCard, cardPlayer } from '../src/cards.mjs';
import { Session } from '../web/lib/session.js';
import { serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const players = read('players.json');
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players, history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards };
const MY = 'busan-kcc';
const real = players.filter((p) => p.real);

test('도감 목록: 시즌 카드 전부 + 시작 로스터의 시즌 카드, 키는 중복 없이 kblId:시즌', () => {
  const cat = buildCatalog(cards, real, '2026-27');
  assert.equal(cat.length, cards.domestic.length + cards.foreign.length + real.length);
  assert.equal(new Set(cat.map((c) => c.key)).size, cat.length, '키 중복 없음');
  const c0 = cat[0];
  assert.equal(c0.key, cardKey(cards.domestic[0].kblId, cards.domestic[0].season));
  assert.ok(c0.display.includes(c0.name));
  assert.ok(cat.some((c) => c.season === '2026-27' && c.display.startsWith('26 ')));
  assert.ok(cat.every((c) => ['common', 'rare', 'ace', 'legend'].includes(c.rarity) && c.ovr > 0));
  assert.equal(buildCatalog(cards, real, '2026-27'), cat, '같은 입력은 캐시');
});

test('카드 키: 카드 선수는 kblId:시즌, 카드가 아닌 선수는 null', () => {
  const card = cards.domestic.find((c) => c.season === '1998-99');
  const p = cardPlayer(card, { id: 'x1', teamId: MY });
  assert.equal(keyOfPlayer(p), cardKey(card.kblId, '1998-99'));
  assert.equal(keyOfPlayer({ id: 'y', name: '신인' }), null);
  assert.equal(keyOfPlayer(null), null);
});

test('새로 모은 카드: 우리 구단 선수만, 이미 있는 키·중복은 제외', () => {
  const a = cards.domestic[0], b = cards.domestic[5];
  const pa = cardPlayer(a, { id: 'a', teamId: MY }), pb = cardPlayer(b, { id: 'b', teamId: 'other' }), pa2 = cardPlayer(a, { id: 'a2', teamId: MY });
  assert.deepEqual(newCodexKeys([], [pa, pb, pa2], MY), [keyOfPlayer(pa)]);
  assert.deepEqual(newCodexKeys([keyOfPlayer(pa)], [pa, pb], MY), []);
  assert.deepEqual(newCodexKeys(new Set([keyOfPlayer(pa)]), [pa], MY), []);
});

test('필터·진행률', () => {
  const cat = buildCatalog(cards, real, '2026-27');
  const have = new Set([cat[0].key, cat[1].key, cat.at(-1).key]);
  const prog = codexProgress(cat, have);
  assert.equal(prog.total, cat.length); assert.equal(prog.got, 3);
  assert.equal(Object.values(prog.byRarity).reduce((s, [g]) => s + g, 0), 3);
  assert.equal(Object.values(prog.byRarity).reduce((s, [, t]) => s + t, 0), cat.length);
  assert.equal(filterCatalog(cat, have, { collected: 'yes' }).length, 3);
  assert.equal(filterCatalog(cat, have, { collected: 'no' }).length, cat.length - 3);
  const pg = filterCatalog(cat, have, { position: 'PG' });
  assert.ok(pg.length > 0 && pg.every((c) => c.position === 'PG'));
  assert.ok(filterCatalog(cat, have, { kind: 'f' }).every((c) => c.kind === 'f'));
  assert.ok(filterCatalog(cat, have, { season: '2026-27' }).every((c) => c.season === '2026-27'));
  const name = cat[0].name;
  assert.ok(filterCatalog(cat, have, { query: name }).some((c) => c.key === cat[0].key));
  assert.equal(filterCatalog(cat, have, { rarity: 'all', position: 'all', kind: 'all', season: 'all' }).length, cat.length);
});

test('세션: 시작 로스터가 도감에 들어가고, 시즌·오프시즌을 거치며 늘어나며, 저장·복원해도 같다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 't', seed: 8 });
  const mine = s.players.filter((p) => p.teamId === MY);
  const cat = buildCatalog(cards, real, data.rules.season);
  const keys = new Set(cat.map((c) => c.key));
  assert.ok(s.codex.length >= mine.length - 1, `시작 도감 ${s.codex.length}장 / 로스터 ${mine.length}명`);
  assert.ok(s.codex.every((k) => keys.has(k)), '도감 키는 모두 전체 목록에 있다');
  const before = s.codex.length;
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason(); s.autoOffseason();
  assert.ok(s.codex.length > before, '드래프트·FA·외국인으로 새 카드를 영입했다');
  assert.ok(s.codex.every((k) => keys.has(k)), '영입한 카드도 전체 목록 안에 있다');
  assert.equal(new Set(s.codex).size, s.codex.length);
  const back = restore(data, serialize(s));
  assert.deepEqual(back.codex, s.codex);
  assert.deepEqual(back.achievements, s.achievements);
  // 이전 저장(도감 필드 없음)은 현재 로스터에서 다시 채운다
  const game = JSON.parse(serialize(s)); delete game.codex;
  assert.ok(new Session(data, game).codex.length >= mine.length - 1);
});
