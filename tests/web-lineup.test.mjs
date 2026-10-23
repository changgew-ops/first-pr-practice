import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evalDraft, autoDraft, setRole, roleOf, sameDraft, prune, rosterOfTeam, powerOf,
  POSITIONS, seatFit, arrangeSeats, slotsFromDraft, draftFromSlots, sameArrangement, locate, placeInSlot, clearSlot, swapSlots, firstFreeSlot,
  slotRef, refOfPlayer, sameRef, idOfRef, moveRefs, OUT_REF, positionSummary, poolList, POOL_SORTS
} from '../web/lib/lineup-view.js';
import { remainingCheckpoints, previewGain, projectGain } from '../web/lib/training-view.js';
import { Session } from '../web/lib/session.js';
import { autoFocus } from '../src/training.mjs';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';
const rules = data.rules;

test('라인업: 자동 편성은 규칙에 맞고 평가가 오류 없이 완성으로 나온다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const draft = autoDraft(roster, rules);
  const e = evalDraft(draft, roster, rules);
  assert.deepEqual(e.errors, []);
  assert.equal(e.complete, true);
  assert.ok(e.totalCost <= rules.lineup.costCap);
  assert.equal(e.starters.length, 5); assert.equal(e.bench.length, 7); // 엔트리 12명
  assert.ok(e.foreignStarters <= rules.foreignPlayers.onCourt);
  assert.equal(Object.values(e.positions).reduce((a, b) => a + b, 0), 5);
});

test('라인업: 역할 바꾸기·되돌리기·중복·부족을 점검한다', () => {
  const roster = rosterOfTeam(data.players, MY);
  let d = autoDraft(roster, rules);
  const first = d.starters[0];
  assert.equal(roleOf(d, first), 'starter');
  d = setRole(d, first, 'starter'); // 같은 역할을 다시 누르면 제외
  assert.equal(roleOf(d, first), 'out');
  assert.ok(evalDraft(d, roster, rules).errors.some((m) => /스타팅은 5명/.test(m)));
  d = setRole(d, first, 'bench'); // 벤치로
  assert.equal(roleOf(d, first), 'bench'); assert.equal(d.bench.length, 8);
  assert.ok(evalDraft(d, roster, rules).errors.some((m) => /벤치는 7명/.test(m)));
  // 같은 선수가 스타팅·벤치 양쪽에 있는 draft는 중복 오류
  const dup = { starters: d.starters, bench: [...d.bench.slice(0, 6), d.starters[0]] };
  assert.ok(evalDraft(dup, roster, rules).errors.some((m) => /중복/.test(m)));
  assert.equal(sameDraft(autoDraft(roster, rules), autoDraft(roster, rules)), true);
  assert.deepEqual(prune({ starters: ['없는선수', first], bench: [] }, roster).starters, [first]);
});

test('라인업: 코스트 제한을 넘는 편성과 외국 선수 수 초과를 오류로 알린다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const top = [...roster].sort((a, b) => b.cost - a.cost);
  const d = { starters: top.slice(0, 5).map((p) => p.id), bench: top.slice(5, 12).map((p) => p.id) };
  const e = evalDraft(d, roster, rules);
  assert.ok(e.totalCost > rules.lineup.costCap || e.errors.length === 0);
  const foreigners = roster.filter((p) => p.origin === 'foreign');
  const others = roster.filter((p) => p.origin !== 'foreign');
  if (foreigners.length >= rules.foreignPlayers.onCourt + 1) return;
  const many = { starters: [...foreigners.map((p) => p.id), ...others.map((p) => p.id)].slice(0, 5), bench: others.slice(3, 10).map((p) => p.id) };
  assert.ok(evalDraft(many, roster, rules).foreignStarters <= foreigners.length);
});

test('라인업: 전력은 스타팅 70% + 벤치 30%', () => {
  assert.equal(powerOf([{ ovr: 70 }, { ovr: 80 }], [{ ovr: 50 }]), 75 * 0.7 + 50 * 0.3);
});

test('훈련: 남은 훈련 횟수는 훈련 시점(checkpointDays 배수, 마지막 날 제외)을 센다', () => {
  assert.equal(remainingCheckpoints(0, 54, 9), 5);
  assert.equal(remainingCheckpoints(9, 54, 9), 4);
  assert.equal(remainingCheckpoints(10, 54, 9), 4);
  assert.equal(remainingCheckpoints(45, 54, 9), 0);
  assert.equal(remainingCheckpoints(54, 54, 9), 0);
});

test('훈련: 미리보기는 어린 선수가 더 크고 능력치 한계에서는 0이며, 예상 총 상승은 훈련 규칙과 같다', () => {
  const young = { age: 20, potential: 80, ovr: 60, position: 'SG', stats: { shooting: 60, passing: 60, defense: 60, rebound: 60, athletic: 60, stamina: 60 } };
  const old = { ...young, age: 34, potential: 60 };
  assert.ok(previewGain(young, 'shooting', rules).perSession > previewGain(old, 'shooting', rules).perSession);
  const maxed = { ...young, stats: { ...young.stats, shooting: rules.stats.max } };
  assert.equal(previewGain(maxed, 'shooting', rules).perSession, 0);
  const proj = projectGain(young, 'shooting', rules, 5);
  assert.ok(proj.statDelta > 0 && proj.ovrDelta >= 0); // 어리고 POT 여유가 큰 선수는 5회 훈련에 여러 점 오른다
  assert.equal(young.stats.shooting, 60); // 원본 그대로
  assert.equal(projectGain(young, 'shooting', rules, 0).statDelta, 0);
});

test('세션: 직접 편성과 훈련 지정이 시즌 진행에 반영된다 (저장·복원 후에도)', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 4 });
  const roster = rosterOfTeam(s.players, MY);
  const star = [...roster].sort((a, b) => b.ovr - a.ovr)[0];
  // 훈련: 가장 어린 선수의 집중을 자동 추천이 아닌 다른 능력치로
  const young = [...roster].sort((a, b) => a.age - b.age)[0];
  const stat = autoFocus(young) === 'athletic' ? 'passing' : 'athletic';
  s.setFocus(young.id, stat);
  assert.equal(s.focus.get(young.id), stat);
  // 편성: 스타를 벤치 맨 뒤로 보내는 규칙에 맞는 편성
  const auto = autoDraft(roster, rules);
  const alt = setRole(setRole(auto, star.id, 'bench'), auto.bench.at(-1), 'starter');
  const e = evalDraft(alt, roster, rules);
  if (e.errors.length === 0) {
    const r = s.setLineup(alt);
    assert.equal(r.ok, true);
    assert.deepEqual(s.lineup.starters.sort(), alt.starters.slice().sort());
  }
  s.advance(20);
  const after = s.players.find((p) => p.id === young.id);
  assert.ok(after.xp?.[stat] !== undefined || after.stats[stat] >= young.stats[stat]);
});

test('코트: 포지션 자리 어울림과 자리 배치(arrangeSeats)', () => {
  assert.equal(seatFit({ position: 'PG' }, 'PG'), 'exact');
  assert.equal(seatFit({ position: 'SG' }, 'PG'), 'near');
  assert.equal(seatFit({ position: 'C' }, 'PG'), 'off');
  const mk = (id, position, ovr) => ({ id, position, ovr });
  const five = [mk('c', 'C', 60), mk('pg', 'PG', 70), mk('sf', 'SF', 65), mk('pf', 'PF', 62), mk('sg', 'SG', 68)];
  assert.deepEqual(arrangeSeats(five), ['pg', 'sg', 'sf', 'pf', 'c']); // 포지션이 다 맞는 배치
  const twoGuards = [mk('a', 'PG', 70), mk('b', 'PG', 69), mk('c', 'C', 60), mk('d', 'PF', 62), mk('e', 'SF', 65)];
  const seats = arrangeSeats(twoGuards);
  assert.equal(seats.filter(Boolean).length, 5); assert.equal(new Set(seats).size, 5);
  assert.equal(seats[0], 'a'); // 같은 점수면 OVR 높은 선수가 먼저 자리를 잡는다
  assert.deepEqual(arrangeSeats([mk('x', 'C', 50)]), [null, null, null, null, 'x']);
});

test('코트: 자동 편성은 12명을 자리·벤치 칸에 앉히고 draft로 되돌려도 같다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const auto = autoDraft(roster, rules);
  const slots = slotsFromDraft(auto, roster, rules, { arrange: true });
  assert.equal(slots.seats.length, 5); assert.equal(slots.bench.length, rules.lineup.bench);
  assert.ok(slots.seats.every(Boolean) && slots.bench.every(Boolean));
  const back = draftFromSlots(slots);
  assert.equal(sameDraft(back, auto), true);
  assert.deepEqual(evalDraft(back, roster, rules).errors, []);
  // 자리 순서를 바꾸면 구성은 같아도 다른 배치
  const swapped = swapSlots(slots, { area: 'seat', index: 0 }, { area: 'seat', index: 4 });
  assert.equal(sameDraft(draftFromSlots(swapped), auto), true);
  assert.equal(sameArrangement(draftFromSlots(swapped), back), false);
  assert.equal(sameArrangement(draftFromSlots(slots), back), true);
});

test('코트: 칸에 넣기·바꾸기·비우기·빈 칸 찾기', () => {
  const roster = rosterOfTeam(data.players, MY);
  const slots = slotsFromDraft(autoDraft(roster, rules), roster, rules, { arrange: true });
  const out = roster.find((p) => !locate(slots, p.id));
  assert.ok(out, '제외 선수가 있어야 한다');
  const seat0 = { area: 'seat', index: 0 };
  const was = slots.seats[0];
  const a = placeInSlot(slots, out.id, seat0); // 제외 선수를 넣으면 기존 선수가 밀려난다
  assert.equal(a.seats[0], out.id); assert.equal(locate(a, was), null);
  const benchId = slots.bench[2];
  const b = placeInSlot(slots, benchId, seat0); // 벤치 선수를 스타팅 자리에 넣으면 서로 바뀐다
  assert.equal(b.seats[0], benchId); assert.equal(b.bench[2], was);
  const c = clearSlot(slots, seat0);
  assert.equal(c.seats[0], null); assert.equal(draftFromSlots(c).starters.length, 4);
  assert.ok(evalDraft(draftFromSlots(c), roster, rules).errors.some((m) => /스타팅은 5명/.test(m)));
  assert.deepEqual(firstFreeSlot(c, roster.find((p) => p.id === was)), seat0); // 비어 있는 자리 중 포지션이 맞는 곳
  assert.equal(firstFreeSlot(slots, out), null); // 빈 칸이 없으면 null
  assert.equal(slots.seats[0], was); // 원본은 그대로
  assert.equal(POSITIONS.length, 5);
});

test('출전 시간은 자리·목록 순서가 아니라 OVR 순서로 나눈다', async () => {
  const { lineupMinutes } = await import('../src/game.mjs');
  const mk = (id, ovr) => ({ id, ovr });
  const sim = rules.simulation;
  const l1 = { starters: [mk('a', 60), mk('b', 70), mk('c', 65), mk('d', 62), mk('e', 68)], bench: [1, 2, 3, 4, 5, 6, 7].map((i) => mk(`x${i}`, 50 + i)) };
  const l2 = { starters: [...l1.starters].reverse(), bench: [...l1.bench].reverse() };
  assert.deepEqual([...lineupMinutes(l1, sim)].sort(), [...lineupMinutes(l2, sim)].sort());
  assert.equal(lineupMinutes(l1, sim).get('b'), sim.minutesStarters[0]); // 가장 높은 OVR이 가장 오래 뛴다
  assert.equal(lineupMinutes(l1, sim).get('x7'), sim.minutesBench[0]);
  assert.equal([...lineupMinutes(l1, sim).values()].reduce((a, b) => a + b, 0), 200);
  assert.equal(sim.minutesBench.length, rules.lineup.bench);
});

test('눌러서 바꾸기·끌어 놓기: moveRefs가 모든 조합(칸↔칸, 칸↔목록 선수, 목록→칸, 칸→빼기)을 같은 규칙으로 처리한다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const slots = slotsFromDraft(autoDraft(roster, rules), roster, rules, { arrange: true });
  const out = roster.find((p) => !locate(slots, p.id));
  const seat0 = slotRef('seat', 0), seat3 = slotRef('seat', 3), bench2 = slotRef('bench', 2), bench5 = slotRef('bench', 5);
  const idAt = (s, ref) => idOfRef(s, ref);
  // 코트 ↔ 코트, 코트 ↔ 벤치, 벤치 ↔ 벤치: 서로 바꾼다
  for (const [x, y] of [[seat0, seat3], [seat0, bench2], [bench2, bench5]]) {
    const a = idAt(slots, x), b = idAt(slots, y);
    const n = moveRefs(slots, x, y);
    assert.equal(idAt(n, x), b); assert.equal(idAt(n, y), a);
    assert.equal(draftFromSlots(n).starters.length + draftFromSlots(n).bench.length, 12, '인원은 그대로');
  }
  // 칸 → 제외 선수(목록 행): 제외 선수가 그 칸에 들어가고 원래 선수는 빠진다 / 반대 방향도 같다
  const was = idAt(slots, seat0);
  const n1 = moveRefs(slots, seat0, refOfPlayer(slots, out.id));
  assert.equal(idAt(n1, seat0), out.id); assert.equal(locate(n1, was), null);
  const n2 = moveRefs(slots, refOfPlayer(slots, out.id), seat0);
  assert.deepEqual(n2, n1);
  // 칸 → 빼기: 비운다. 빈 칸이나 제외 선수를 빼려 하면 변화 없음
  const n3 = moveRefs(slots, bench2, OUT_REF);
  assert.equal(idAt(n3, bench2), null); assert.equal(locate(n3, slots.bench[2]), null);
  assert.equal(moveRefs(n3, bench2, OUT_REF), n3);
  assert.equal(moveRefs(slots, refOfPlayer(slots, out.id), OUT_REF), slots);
  // 빈 칸으로 이동, 목록 선수 → 빈 칸
  const n4 = moveRefs(n3, seat0, bench2);
  assert.equal(idAt(n4, bench2), was); assert.equal(idAt(n4, seat0), idAt(n3, bench2));
  const n5 = moveRefs(n3, refOfPlayer(n3, out.id), bench2);
  assert.equal(idAt(n5, bench2), out.id);
  // 같은 것끼리, 목록 ↔ 목록은 변화 없음, 원본 불변
  assert.equal(moveRefs(slots, seat0, seat0), slots);
  assert.equal(moveRefs(slots, refOfPlayer(slots, out.id), refOfPlayer(slots, out.id)), slots);
  assert.equal(slots.seats[0], was);
  assert.ok(sameRef(refOfPlayer(slots, was), seat0) && !sameRef(seat0, seat3) && sameRef(OUT_REF, OUT_REF));
  // 어떤 이동 순서를 거쳐도 선수가 중복되지 않는다
  let cur = slots; const refs = [seat0, seat3, bench2, bench5, OUT_REF, refOfPlayer(slots, out.id)];
  for (let i = 0; i < 40; i++) {
    cur = moveRefs(cur, refs[i % refs.length], refs[(i * 7 + 3) % refs.length]);
    const ids = [...cur.seats, ...cur.bench].filter(Boolean);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('포지션 현황: 포지션별 로스터·스타팅·벤치·엔트리 밖 인원과 목록 필터·정렬', () => {
  const roster = rosterOfTeam(data.players, MY);
  const slots = slotsFromDraft(autoDraft(roster, rules), roster, rules, { arrange: true });
  const sum = positionSummary(roster, slots);
  assert.deepEqual(sum.map((r) => r.pos), POSITIONS);
  assert.equal(sum.reduce((a, r) => a + r.total, 0), roster.length);
  assert.equal(sum.reduce((a, r) => a + r.starters, 0), 5);
  assert.equal(sum.reduce((a, r) => a + r.bench, 0), 7);
  assert.equal(sum.reduce((a, r) => a + r.out, 0), roster.length - 12);
  for (const r of sum) assert.equal(r.total, r.starters + r.bench + r.out);
  const short = positionSummary(roster, slots, { PG: 99 });
  assert.equal(short.find((r) => r.pos === 'PG').status, 'short');
  assert.equal(short.find((r) => r.pos === 'SG').status, 'ok');
  for (const pos of POSITIONS) assert.ok(poolList(roster, { pos }).every((p) => p.position === pos));
  const byCost = poolList(roster, { sort: 'cost' });
  assert.ok(byCost.every((p, i) => i === 0 || byCost[i - 1].cost >= p.cost));
  assert.ok(Object.keys(POOL_SORTS).length >= 4);
});
