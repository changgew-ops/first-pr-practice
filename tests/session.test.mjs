import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';

const finishRegular = (s) => { while (!s.regularDone) s.advance(9); };

test('세션: 정규리그를 하루씩 진행하면 우리 경기가 쌓이고 순위가 맞는다', () => {
  const s = Session.create(data, { managerId: MY, gmName: '테스트', seed: 11 });
  assert.equal(s.stage, 'regular'); assert.equal(s.day, 0);
  assert.equal(s.nextGame().day, 1);
  s.advance(1);
  assert.equal(s.day, 1); assert.equal(s.myGames().length, 1);
  finishRegular(s);
  assert.equal(s.day, data.rules.regularSeasonGames);
  assert.equal(s.myGames().length, data.rules.regularSeasonGames);
  const st = s.standings();
  assert.equal(st.reduce((a, r) => a + r.wins, 0), st.reduce((a, r) => a + r.losses, 0));
  assert.equal(s.nextGame(), null);
  assert.deepEqual(s.advance(1), []); // 정규리그가 끝났으면 더 진행하지 않는다
});

test('세션: 저장했다가 불러와도(시드·조작 기록으로 다시 돌려) 같은 상태가 된다 — 시즌 중·플레이오프 중', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 5 });
  s.advance(10);
  const roster = s.players.filter((p) => p.teamId === MY).sort((a, b) => b.ovr - a.ovr);
  s.setFocus(roster[0].id, 'shooting');
  s.advance(20);
  const mid = restore(data, serialize(s));
  assert.equal(mid.day, 30);
  assert.deepEqual(mid.standings(), s.standings());
  assert.deepEqual(mid.players.find((p) => p.id === roster[0].id), s.players.find((p) => p.id === roster[0].id));
  finishRegular(s); s.startPlayoffs(); s.playoffRound();
  const po = restore(data, serialize(s));
  assert.equal(po.stage, 'playoffs'); assert.equal(po.playoffs.round, 1);
  assert.deepEqual(po.playoffs.result().series.map((x) => x.winnerId), s.playoffs.result().series.map((x) => x.winnerId));
});

test('세션: 직접 편성은 규칙에 맞을 때만 적용되고 경기에 쓰인다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 3 });
  const roster = s.players.filter((p) => p.teamId === MY);
  const bad = s.setLineup({ starters: roster.slice(0, 5).map((p) => p.id), bench: roster.slice(0, 7).map((p) => p.id) });
  assert.equal(bad.ok, false);
  // 가장 약한 12명: 규칙은 맞고 자동 편성보다 약하다
  const weak = roster.filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr).slice(0, 12);
  if (weak.length === 12) {
    const r = s.setLineup({ starters: weak.slice(0, 5).map((p) => p.id), bench: weak.slice(5).map((p) => p.id) });
    assert.equal(r.ok, true);
    assert.deepEqual(s.lineup.starters, weak.slice(0, 5).map((p) => p.id));
  }
  s.setLineup(null); assert.equal(s.lineup, null);
});

test('세션: 한 시즌 전체(플레이오프 → 오프시즌 결정 → 다음 시즌)를 사람이 결정하며 진행한다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 21 });
  finishRegular(s); s.startPlayoffs();
  while (!s.playoffs.done) s.playoffRound();
  assert.ok(['champion', 'out', 'notQualified'].includes(s.playoffStatus()));
  const entry = s.endSeason();
  assert.equal(entry.standings.length, 10); assert.equal(s.stage, 'offseason');
  const kinds = [];
  let guard = 0;
  while (s.pending && guard++ < 40) {
    const { key, kind, payload } = s.pending;
    kinds.push(kind);
    const value = kind === 'trade' ? { accept: [], proposals: [] } : kind === 'resign' ? {} : kind === 'freeAgency' ? [] : kind === 'compensation' ? { type: 'cash' } : payload.available[0].id;
    s.decide(key, value);
  }
  assert.deepEqual(kinds.slice(0, 2), ['trade', 'resign']);
  assert.ok(kinds.includes('freeAgency') && kinds.includes('draft'));
  assert.equal(s.stage, 'regular'); assert.equal(s.season, 2027); assert.equal(s.day, 0);
  assert.equal(s.game.log.length, 1); assert.ok(s.game.log[0].report.retired);
  // 오프시즌 도중 저장·복원
  const t = Session.create(data, { managerId: MY, gmName: 'B', seed: 22 });
  finishRegular(t); t.startPlayoffs(); while (!t.playoffs.done) t.playoffRound(); t.endSeason();
  t.decide('trade', { accept: [], proposals: [] });
  const back = restore(data, serialize(t));
  assert.equal(back.stage, 'offseason'); assert.equal(back.pending.key, 'resign');
});

test('세션: 오프시즌 남은 결정을 자동 단장에게 맡길 수 있다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 8 });
  finishRegular(s); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); s.endSeason();
  s.autoOffseason();
  assert.equal(s.stage, 'regular'); assert.equal(s.game.log.length, 1);
});

test('세션: 시즌 중 트레이드 — AI 제안을 받아들이거나 직접 제안하면 로스터가 바뀌고, 저장·복원해도 같다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 31 });
  s.advance(6);
  assert.equal(s.tradeOpen, true);
  const offers = s.tradeOffers();
  assert.deepEqual(s.tradeOffers().map((o) => o.id), offers.map((o) => o.id)); // 같은 날·같은 로스터면 같은 제안
  let done = null;
  for (const o of offers) {
    const r = s.acceptOffer(o.trade);
    if (r.ok) { done = o; break; }
  }
  if (!done) { // 제안이 없으면 직접 제안으로 확인
    const mine = s.players.filter((p) => p.teamId === MY && p.origin === 'domestic');
    const other = s.players.filter((p) => p.teamId === 'wonju-db' && p.origin === 'domestic');
    for (const a of mine) for (const b of other) {
      const r = s.proposeTrade({ teamA: MY, teamB: 'wonju-db', giveA: [a.id], giveB: [b.id] });
      if (r.executed) { done = { trade: { giveA: [a.id], giveB: [b.id] } }; break; }
    }
  }
  assert.ok(done, '성사된 트레이드가 있어야 한다');
  const moved = [...done.trade.giveA, ...done.trade.giveB];
  const before = new Map(Session.create(data, { managerId: MY, gmName: 'A', seed: 31 }).players.map((p) => [p.id, p.teamId]));
  assert.ok(moved.some((id) => s.players.find((p) => p.id === id).teamId !== before.get(id)));
  s.advance(10);
  const back = restore(data, serialize(s));
  assert.deepEqual(back.standings(), s.standings());
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId]), s.players.map((p) => [p.id, p.teamId]));
  // 마감(36일차) 이후에는 닫힌다
  while (s.day < 40) s.advance(1);
  assert.equal(s.tradeOpen, false);
  assert.equal(s.proposeTrade({ teamA: MY, teamB: 'wonju-db', giveA: [], giveB: [] }).executed, false);
});
