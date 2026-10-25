import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synergyOf, synergyOn, baseRosterOf, baseRosterFor, isBaseRoster } from '../src/synergy.mjs';
import { computeTeamMods, effectiveOf } from '../src/effective.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const data = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';

// 시작 로스터(id → 시작 구단) 1~N번 선수를 만든다: card는 시즌 카드, teamId는 지금 소속
const P = (id, teamId, card, ovr = 70) => ({ id, teamId, ovr, card });
const card = (season, teamId) => ({ season, label: season.slice(2, 4), teamId });
const BASE = baseRosterOf([P('a', 'T1'), P('b', 'T1'), P('c', 'T1'), P('d', 'T1')]);

test('시너지: 시작 시점에는 모든 구단의 시너지가 0이다 (시작 로스터 표식)', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'S', seed: 3 });
  const base = baseRosterFor(data.players);
  for (const t of data.teams) {
    const roster = s.players.filter((p) => p.teamId === t.id);
    const slots = synergyOf(roster, rules, base);
    assert.ok(slots.every((x) => x.level === 0 && x.count === 0), `${t.id} 시너지 0`);
  }
});

test('시너지: 표식은 시작 때 있던 선수가 시작 구단에 그대로 있을 때만 유효하다', () => {
  assert.equal(isBaseRoster(P('a', 'T1'), BASE), true);
  assert.equal(isBaseRoster(P('a', 'T2'), BASE), false, '다른 구단으로 옮기면 표식을 잃는다');
  assert.equal(isBaseRoster(P('zz', 'T1'), BASE), false, '시작 로스터에 없던 새 선수는 표식이 없다');
  assert.equal(isBaseRoster(P('a', 'T1'), null), false);
});

test('시너지: 시작 로스터 26 선수 셋은 세지 않고, 옮겨 간 26 카드는 센다', () => {
  const c = card('2026-27', 'T1');
  const stay = ['a', 'b', 'c', 'd'].map((id) => P(id, 'T1', c));
  assert.equal(synergyOf(stay, rules, BASE)[0].level, 0);
  // a·b·c를 T2로 이적: 같은 구단 카드(T1 26) 3명이 한 팀에 모여 team 칸 1단계
  const moved = ['a', 'b', 'c'].map((id) => P(id, 'T2', c));
  const t = synergyOf(moved, rules, BASE)[0];
  assert.equal(t.id, 'team'); assert.equal(t.level, 1); assert.equal(t.count, 3);
  // 한 명이 남아 있으면(표식 유효) 그 선수만 빠진다
  assert.equal(synergyOf([P('a', 'T1', c), P('b', 'T2', c), P('c', 'T2', c)], rules, BASE)[0].count, 2);
});

test('시너지: 나중에 드래프트·FA로 다시 뽑은 26 카드는 새 선수 id라 항상 센다 (재드래프트)', () => {
  const c = card('2026-27', 'T1');
  // 시작 로스터에 있던 a가 방출되고, 같은 시즌 카드가 새 id(n1)로 T1에 다시 들어온다
  const re = [P('n1', 'T1', c), P('n2', 'T1', c), P('n3', 'T1', c)];
  const t = synergyOf(re, rules, BASE)[0];
  assert.equal(t.level, 1, '같은 구단 같은 시즌 카드 3명 = team 1단계');
  // 같은 이유로 시작 로스터 선수 id가 팀을 떠났다 돌아와도 센다 아니다: 돌아와 시작 구단에 있으면 다시 표식이 유효
  assert.equal(isBaseRoster(P('a', 'T1', c), BASE), true);
});

test('시너지: year 칸은 같은 해 다른 구단 카드도 묶고, 최대 3단계에서 멈춘다', () => {
  const cs = ['25-26', '25-26', '25-26', '25-26', '25-26', '25-26', '25-26', '25-26', '25-26'];
  const ps = cs.map((s, i) => P(`y${i}`, 'T9', card(`20${s}`, `X${i % 3}`)));
  const y = synergyOf(ps, rules, {})[1];
  assert.equal(y.id, 'year'); assert.equal(y.level, y.max); assert.equal(y.need, null);
  assert.equal(y.edge, Math.round(y.max * y.perLevel * 100) / 100);
});

test('시너지: 칸 설정이 비면 꺼져 있다', () => {
  assert.equal(synergyOn({ synergy: { enabled: true, slots: [] } }), false);
  assert.deepEqual(synergyOf([], { synergy: { enabled: false, slots: [] } }), []);
});

test('시너지·단장 보정을 모두 끄면 결과가 예전과 같다(엔진 보정 변화 없음)', () => {
  const off = { ...rules, protagonist: { ...rules.protagonist, enabled: false }, synergy: { ...rules.synergy, slots: [] } };
  const run = (r, protagonist) => {
    const s = Session.create({ ...data, rules: r }, { managerId: MY, gmName: 'Z', seed: 21, protagonist });
    while (!s.regularDone) s.advance(9);
    return s.standings().map((x) => [x.teamId, x.wins]);
  };
  assert.deepEqual(run(off, true), run(off, false), '꺼진 상태에서는 초보 도움 옵션도 영향이 없다');
});

test('단장 보정: 켠 새 게임만 우리 구단 경기 보정에 더해진다', () => {
  const on = Session.create(data, { managerId: MY, gmName: 'P', seed: 8, protagonist: true });
  const off = Session.create(data, { managerId: MY, gmName: 'P', seed: 8 });
  const eOn = on.teamPower(MY), eOff = off.teamPower(MY);
  assert.ok(eOn.edge - eOff.edge > 0.39 && eOn.edge - eOff.edge < 0.41, `단장 보정 ${rules.protagonist.edge}`);
  const other = data.teams.find((t) => t.id !== MY).id;
  assert.equal(on.teamPower(other).edge, off.teamPower(other).edge, '다른 구단은 그대로');
});

test('시너지: 저장했다가 불러와도 같은 상태이고 표식은 저장에 들어가지 않는다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'R', seed: 6, protagonist: true });
  s.advance(15);
  const saved = serialize(s);
  assert.equal(JSON.stringify(saved).includes('baseRoster'), false);
  const r = restore(data, saved);
  assert.deepEqual(r.standings(), s.standings());
  assert.deepEqual(r.teamPower(MY), s.teamPower(MY));
});

test('영입 미리보기: 같은 구단·같은 해 카드가 세 번째로 들어오면 시너지 0 → 1단계로 보인다(시작 로스터 표식 반영)', async () => {
  const { signingImpact, tradeImpact } = await import('../web/lib/preview-signing.js');
  const s = Session.create(data, { managerId: MY, gmName: 'V', seed: 4 });
  const mine = s.players.filter((p) => p.teamId === MY && p.origin === 'domestic');
  const c = card('2025-26', 'busan-kcc');
  const mk = (i, ovr) => ({ ...mine[i], id: `vet-${i}`, ovr, card: c });
  const roster = [...s.players, mk(0, 95), mk(1, 94)].map((p) => (p.id.startsWith('vet-') ? { ...p, teamId: MY } : p));
  const cand = { ...mk(2, 93), teamId: null };
  const imp = signingImpact({ roster, cand, offer: { salaryEok: 1, years: 1 }, rules, teamId: MY, baseRoster: s.baseRoster });
  const team = imp.synergy.rows.find((r) => r.id === 'team');
  assert.equal(team.before, 0); assert.equal(team.after, 1); assert.equal(imp.synergy.changed, true);
  // 시작 로스터 선수만으로는 변화가 없다
  const base = signingImpact({ roster: s.players, cand: { ...mine.at(-1), teamId: null, id: 'zz' }, offer: { salaryEok: 1, years: 1 }, rules, teamId: MY, baseRoster: s.baseRoster });
  assert.equal(base.synergy.changed, false);
  assert.ok(tradeImpact({ roster: s.players, give: [mine[0]], get: [mine[1]], rules, teamId: MY, baseRoster: s.baseRoster }).synergy);
});
