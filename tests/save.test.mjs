// 저장 용량: 압축(lz.js), 오래된 시즌 정리(game.js pruneGame), 용량 계산·경고, 파일 내보내기·가져오기(save.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { gameRecordRows, fullHistory, careerLines, pruneEntry, pruneLog, pruneGame, DEFAULT_KEEP_SEASONS } from '../web/lib/game.js';
import { aggregateLines } from '../web/lib/league-view.js';
import { newsSource } from '../web/lib/news-view.js';
import { attendanceTrend } from '../web/views/finance-card.js';
import { buildNews } from '../src/news.mjs';
import { compress, decompress } from '../web/lib/lz.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const MY = 'busan-kcc';

// 브라우저의 localStorage 흉내(length·key까지 있는 것). 'fail'을 켜면 setItem이 한도 초과처럼 던진다
const store = new Map();
let fail = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (fail) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null
};
const save = await import('../web/lib/save.js');
const { listSlots, readSlot, writeSlot, deleteSlot, encodeSlot, decodeSlot, capacityOf, capacityNotice, storageUsed, oldestManualSlot, buildExport, parseImport, importToSlot, QUOTA } = save;

function playYear(s) {
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs();
  while (!s.playoffs.done) s.playoffRound();
  s.endSeason(); s.autoOffseason();
}
const play = (n, seed = 21) => { const s = Session.create(data, { managerId: MY, gmName: '김단장', seed }); for (let i = 0; i < n; i++) playYear(s); return s; };
const through = (g) => JSON.parse(JSON.stringify(g)); // 저장·복원처럼 JSON을 한 번 거친다

let six; // 6시즌 진행한 세션(여러 테스트가 같이 쓴다)
const sixSeasons = () => (six ??= play(6));

test('압축: 한국어·반복·빈 문자열·긴 난수 문자열이 그대로 돌아오고, 출력은 localStorage에 안전한 글자뿐이다', () => {
  let x = 12345; const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const cases = ['', 'a', 'aa', 'a'.repeat(5000), 'abab'.repeat(300), '가나다라마바사 가나다라마바사 😀 \u0000\ud800끝', JSON.stringify({ 이름: '서장훈', stats: [1, 2, 3], note: '한글'.repeat(80) })];
  for (let i = 0; i < 60; i++) { let s = ''; const n = Math.floor(rnd() * 600), k = 1 + Math.floor(rnd() * 60); for (let j = 0; j < n; j++) s += String.fromCharCode(32 + Math.floor(rnd() * k) + (rnd() < 0.05 ? 0xac00 : 0)); cases.push(s); }
  let big = ''; for (let i = 0; i < 120000; i++) big += String.fromCharCode(32 + Math.floor(rnd() * 90)); cases.push(big); // 사전이 가득 차 다시 비우는 길이
  for (const s of cases) {
    const c = compress(s);
    assert.equal(decompress(c), s);
    assert.ok(!/[^က-迿]/.test(c), '대리쌍·제어 문자·널이 섞임');
  }
  assert.throws(() => decompress('가나'), /압축 데이터/);
  assert.throws(() => decompress(compress('abcdef').slice(0, 2)), /압축 데이터/);
});

test('압축: 실제 저장(JSON)은 원래 크기의 1/4 안쪽이다', () => {
  const text = JSON.stringify(sixSeasons().game);
  const c = compress(text);
  assert.equal(decompress(c), text);
  assert.ok(c.length < text.length / 4, `${text.length} → ${c.length}`);
});

test('슬롯: 압축해서 쓰고 읽으며, 메타는 압축을 풀지 않고 읽고, 옛(압축 전) 저장도 읽는다', () => {
  const s = sixSeasons();
  assert.equal(writeSlot('1', s.game), true);
  const raw = localStorage.getItem('kblgm.v2.slot.1');
  assert.ok(raw.startsWith('KZ1\n'));
  assert.ok(raw.length < JSON.stringify(s.game).length / 4);
  const slot = listSlots().find((x) => x.slot === '1');
  assert.equal(slot.meta.seasonsPlayed, 6); assert.equal(slot.meta.teamId, MY);
  assert.ok(slot.size >= raw.length);
  assert.deepEqual(readSlot('1'), through(pruneGame(s.game, DEFAULT_KEEP_SEASONS)));
  // 옛 저장: 압축 없는 { meta, game } JSON
  const old = Session.create(data, { managerId: 'wonju-db', gmName: '박단장', seed: 3 }); old.advance(4);
  localStorage.setItem('kblgm.v2.slot.2', JSON.stringify({ meta: { gmName: '박단장', teamId: 'wonju-db', season: '2026-27', stage: 'regular', day: 4, seasonsPlayed: 0, savedAt: 5 }, game: old.game }));
  assert.equal(listSlots().find((x) => x.slot === '2').meta.gmName, '박단장');
  const back = new Session(data, readSlot('2'));
  assert.equal(back.day, 4); assert.deepEqual(back.standings(), old.standings());
  // 깨진 압축은 null(예외를 던지지 않는다)
  localStorage.setItem('kblgm.v2.slot.3', `KZ1\n{"gmName":"x"}\n${compress('{"a":1}').slice(0, 3)}`);
  assert.equal(readSlot('3'), null);
  assert.equal(listSlots().find((x) => x.slot === '3').meta.gmName, 'x');
});

test('정리: 최근 K시즌은 그대로, 오래된 시즌은 보고서·내 경기·육성 기록이 빠지고 화면이 읽는 필드는 남는다', () => {
  const g = sixSeasons().game;
  const p = pruneGame(g, 2);
  assert.equal(p.log.length, 6);
  for (const i of [4, 5]) assert.equal(p.log[i], g.log[i]); // 같은 객체: 손대지 않음
  for (const i of [0, 1, 2, 3]) {
    const e = p.log[i], o = g.log[i];
    for (const k of ['report', 'myGames', 'devProgram', 'contracts']) assert.ok(!(k in e), `${i}: ${k}`);
    for (const k of ['season', 'startYear', 'standings', 'series', 'championId', 'stage', 'lines', 'wl', 'split', 'po', 'ledger', 'playerNames', 'fundsAfter']) assert.deepEqual(e[k], o[k], `${i}: ${k}`);
    assert.ok(e.leaders.length <= 1 && e.leaders.every((l) => l.teamId === MY));
  }
  assert.ok(g.log[0].report && g.log[0].myGames.length, '원본(살아 있는 세션)은 줄어들지 않는다');
  assert.ok(JSON.stringify(p).length < JSON.stringify(g).length * 0.8);
  assert.deepEqual(pruneLog(pruneLog(g.log, 2), 2), pruneLog(g.log, 2)); // 여러 번 줄여도 같다
  assert.equal(pruneGame(g, 0).log.at(-1), g.log.at(-1)); // 가장 최근 시즌은 항상 전체
  assert.equal(pruneGame({ ...g, log: [] }, 3).log.length, 0);
});

test('정리: 소속이 없는 옛 줄(7칸)의 시즌은 leaders가 소속을 대신하므로 그대로 둔다', () => {
  const e = { myTeamId: MY, lines: { a: [1, 2, 3, 4, 5, 6, 7] }, leaders: [{ id: 'a', teamId: 'x', ppg: 3 }, { id: 'b', teamId: MY, ppg: 9 }], report: { x: 1 }, myGames: [] };
  const out = pruneEntry(e);
  assert.deepEqual(out.leaders, e.leaders); assert.ok(!('report' in out));
});

test('정리: 저장·복원한 뒤 화면이 읽는 값(선수 기록 표·리그 기록·구단 역사·뉴스·재정)이 정리 전과 같다', () => {
  const s = sixSeasons();
  const g = s.game;
  const text = serialize(new Session({ ...data, rules: { ...data.rules, save: { keepSeasonsDetail: 2 } } }, through(g))); // 규칙값 save.keepSeasonsDetail
  const back = restore(data, text);
  assert.ok(back.game.log.slice(0, 4).every((e) => !e.report));
  const ids = new Set(g.log.flatMap((e) => Object.keys(e.lines)));
  assert.ok(ids.size > 100);
  for (const id of ids) {
    assert.deepEqual(gameRecordRows(back.game, id), gameRecordRows(g, id), `선수 기록 표 ${id}`);
    assert.deepEqual(careerLines(back.game, id), careerLines(g, id));
  }
  g.log.forEach((e, i) => assert.deepEqual(aggregateLines(back.game.log[i]), aggregateLines(e), `리그 기록 ${e.season}`));
  assert.deepEqual(fullHistory(back.game, data).seasons, fullHistory(g, data).seasons); // 리그 순위·구단 역사
  assert.deepEqual(attendanceTrend(back.game, data), attendanceTrend(g, data));
  assert.deepEqual(buildNews(newsSource(back, data)), buildNews(newsSource(s, data)), '뉴스');
  // 같은 시드·같은 선택이면 같은 결과: 복원한 세션과 원래 세션이 한 시즌을 더 치러도 같다
  const full = new Session(data, through(g));
  playYear(back); playYear(full);
  assert.deepEqual(back.game.league, full.game.league);
  assert.deepEqual(back.game.log.slice(-3), full.game.log.slice(-3)); // 최근 시즌은 전체 형태라 같다
});

test('정리: 20시즌 저장도 압축·정리하면 1MB 안쪽이다(시즌당 요약만 남는다)', { timeout: 120000 }, () => {
  const s = play(20, 7);
  const raw = JSON.stringify(s.game).length;
  const packed = encodeSlot({ gmName: 'T' }, s.game, DEFAULT_KEEP_SEASONS).length;
  assert.ok(packed < 1_000_000 && packed < raw * 0.25, `${raw} → ${packed}`);
  assert.deepEqual(decodeSlot(encodeSlot({ gmName: 'T' }, s.game)).game.log.length, 20);
});

test('용량 계산: 80% 넘으면 warn, 95% 넘으면 full, 저장소 사용량은 키+값 글자 수', () => {
  assert.equal(capacityOf(0).level, 'ok');
  assert.equal(capacityOf(QUOTA * 0.5).level, 'ok');
  assert.equal(capacityOf(QUOTA * 0.8).level, 'ok');
  assert.equal(capacityOf(QUOTA * 0.81).level, 'warn');
  assert.equal(capacityOf(QUOTA * 0.96).level, 'full');
  assert.equal(capacityOf(QUOTA * 0.5).percent, 50);
  assert.equal(capacityOf(50, 100, 0.4).level, 'warn');
  store.clear();
  localStorage.setItem('abc', '12345');
  assert.equal(storageUsed(), 8);
  store.clear();
});

test('용량 알림 문구: 저장 실패나 80% 초과일 때만 나오고, 실패는 항상 full', () => {
  assert.equal(capacityNotice({ ok: true, status: capacityOf(10) }), null);
  assert.equal(capacityNotice({ ok: true, status: undefined }), null);
  const warn = capacityNotice({ ok: true, status: capacityOf(QUOTA * 0.85) });
  assert.equal(warn.level, 'warn'); assert.match(warn.text, /85%/); assert.match(warn.text, /지우거나 파일로 내보내/);
  assert.equal(capacityNotice({ ok: true, status: capacityOf(QUOTA * 0.97) }).level, 'full');
  const bad = capacityNotice({ ok: false, status: capacityOf(10) });
  assert.equal(bad.level, 'full'); assert.match(bad.text, /저장하지 못했습니다/);
});

test('지울 슬롯 제안: 직접 저장 슬롯 중 가장 오래된 것(자동 저장·빈 슬롯은 제외)', () => {
  const m = (savedAt) => ({ savedAt });
  assert.equal(oldestManualSlot([{ slot: 'auto', meta: m(1) }, { slot: '1', meta: m(50) }, { slot: '2', meta: m(20) }, { slot: '3', meta: null }]), '2');
  assert.equal(oldestManualSlot([{ slot: 'auto', meta: m(1) }, { slot: '1', meta: null }]), null);
});

test('저장 실패: 한도를 넘으면 writeSlot이 false를 돌려주고 기존 저장은 그대로이며, 창에 알린다', () => {
  store.clear();
  const s = play(0, 5); s.advance(3);
  assert.equal(writeSlot('1', s.game), true);
  const before = localStorage.getItem('kblgm.v2.slot.1');
  const events = [];
  globalThis.window = new EventTarget();
  window.addEventListener('kblgm:save', (e) => events.push(e.detail));
  try {
    s.advance(2); fail = true;
    assert.equal(writeSlot('1', s.game), false);
    fail = false;
    assert.equal(localStorage.getItem('kblgm.v2.slot.1'), before);
    assert.equal(writeSlot('2', s.game), true);
  } finally { fail = false; delete globalThis.window; }
  assert.deepEqual(events.map((e) => [e.slot, e.ok]), [['1', false], ['2', true]]);
  assert.ok(events[0].status.used > 0 && events[0].status.level);
  store.clear();
});

test('내보내기·가져오기: 슬롯을 압축 없는 JSON으로 내보내고, 검사를 통과하면 다른 슬롯에 같은 게임이 들어간다', () => {
  store.clear();
  const s = sixSeasons();
  writeSlot('1', s.game);
  const out = buildExport('1');
  assert.equal(out.filename, 'kblgm-busan-kcc-2032-33-1.json');
  const doc = JSON.parse(out.text);
  assert.equal(doc.format, 'kblgm-save'); assert.equal(doc.formatVersion, 1); assert.equal(doc.gameVersion, 2); assert.equal(doc.meta.seasonsPlayed, 6);
  assert.ok(!out.text.startsWith('KZ1'));
  const teamIds = data.teams.map((t) => t.id);
  const parsed = parseImport(out.text, { teamIds });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meta.teamId, MY);
  assert.equal(importToSlot('3', parsed.game), true);
  assert.deepEqual(readSlot('3'), readSlot('1'));
  const back = new Session(data, readSlot('3'));
  assert.deepEqual(back.standings(), s.standings());
  assert.equal(buildExport('2'), null); // 빈 슬롯
  // game만 담은 JSON도 받는다
  assert.equal(parseImport(JSON.stringify(s.game), { teamIds }).ok, true);
  store.clear();
});

test('가져오기 검사: 깨진 JSON·다른 형식·버전·시드·없는 구단·불완전한 내용을 거른다', () => {
  const g = sixSeasons().game;
  const teamIds = data.teams.map((t) => t.id);
  const bad = (text, re) => { const r = parseImport(text, { teamIds }); assert.equal(r.ok, false); assert.match(r.error, re); };
  bad('{깨진', /JSON/);
  bad('[]', /형식/);
  bad('"문자열"', /형식/);
  bad(JSON.stringify({ format: 'other', game: g }), /다른 형식/);
  bad(JSON.stringify({ format: 'kblgm-save', formatVersion: 9, game: g }), /더 새로운/);
  bad(JSON.stringify({ format: 'kblgm-save', formatVersion: 1 }), /게임 상태/);
  bad(JSON.stringify({ ...g, version: 1 }), /버전/);
  bad(JSON.stringify({ ...g, seed: 'abc' }), /시드/);
  bad(JSON.stringify({ ...g, seed: undefined }), /시드/);
  bad(JSON.stringify({ ...g, managerId: 'no-such-team' }), /구단/);
  bad(JSON.stringify({ ...g, log: null }), /불완전/);
  bad(JSON.stringify({ ...g, stage: 'halftime' }), /단계/);
  bad(JSON.stringify({ ...g, stage: 'offseason', seasonEnd: null }), /시즌 종료/);
  assert.equal(parseImport(JSON.stringify(g)).ok, true); // 구단 목록을 안 주면 구단 검사는 건너뜀
});
