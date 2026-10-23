// 라인업 편성 화면의 순수 계산(브라우저 API 없음). 편집 중인 편성(draft)은 { starters: [선수 id], bench: [선수 id] }.
import { validateLineup, buildLineup, buildLineupHealthy, lineupCost } from '../../src/lineup.mjs';
import { POSITION_TARGET } from '../../src/valuation.mjs';

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

/** 우리 구단 선수 */
export const rosterOfTeam = (players, teamId) => players.filter((p) => p.teamId === teamId);

const avg = (list, fn) => (list.length ? list.reduce((s, p) => s + fn(p), 0) / list.length : 0);

/** 팀 전력: 스타팅 OVR 평균 70% + 벤치 30% (web/lib/game.js teamPower와 같은 식) */
export function powerOf(starters, bench) {
  return avg(starters, (p) => p.ovr) * 0.7 + avg(bench, (p) => p.ovr) * 0.3;
}

/** 편집 중인 편성을 점검한다. 반환: { starters, bench (선수 객체), errors, totalCost, foreignStarters, power, positions, complete } */
export function evalDraft(draft, roster, rules) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const starters = draft.starters.map((id) => byId.get(id)).filter(Boolean);
  const bench = draft.bench.map((id) => byId.get(id)).filter(Boolean);
  const check = validateLineup(starters, bench, rules);
  const positions = Object.fromEntries(POSITIONS.map((pos) => [pos, starters.filter((p) => p.position === pos).length]));
  return {
    starters, bench, errors: check.errors, totalCost: check.totalCost,
    foreignStarters: starters.filter((p) => p.origin === 'foreign').length,
    power: powerOf(starters, bench), positions,
    complete: starters.length === rules.lineup.starters && bench.length === rules.lineup.bench
  };
}

/** 자동 편성(코스트 제한 안에서 가장 강한 엔트리 12명)을 draft 모양으로 */
export function autoDraft(roster, rules, injured = null) {
  const { starters, bench } = injured?.size ? buildLineupHealthy(roster, rules, rules.simulation.benchWeight, injured, rules.injuries?.minHealthy ?? 8) : buildLineup(roster, rules, rules.simulation.benchWeight); // 부상 선수는 뺀다(건강한 선수가 모자라면 벤치가 줄어든다)
  return { starters: starters.map((p) => p.id), bench: bench.map((p) => p.id) };
}

/** 선수의 역할: 'starter' | 'bench' | 'out' */
export const roleOf = (draft, id) => (draft.starters.includes(id) ? 'starter' : draft.bench.includes(id) ? 'bench' : 'out');

/** 선수 한 명의 역할을 바꾼다(이미 그 역할이면 제외로). 새 draft를 돌려준다 */
export function setRole(draft, id, role) {
  const cur = roleOf(draft, id);
  const next = { starters: draft.starters.filter((x) => x !== id), bench: draft.bench.filter((x) => x !== id) };
  const target = cur === role ? 'out' : role;
  if (target === 'starter') next.starters.push(id);
  else if (target === 'bench') next.bench.push(id);
  return next;
}

export const sameDraft = (a, b) => a.starters.length === b.starters.length && a.bench.length === b.bench.length
  && [...a.starters].sort().join() === [...b.starters].sort().join() && [...a.bench].sort().join() === [...b.bench].sort().join();

/** 없어진 선수(방출·이적)를 draft에서 뺀다 */
export function prune(draft, roster) {
  const ids = new Set(roster.map((p) => p.id));
  return { starters: draft.starters.filter((id) => ids.has(id)), bench: draft.bench.filter((id) => ids.has(id)) };
}

// ---- 코트 화면용: 포지션 자리(seat)와 벤치 칸(slot) ----------------------------------------------
// 화면에서는 스타팅 5명이 PG·SG·SF·PF·C 자리에 앉는다. draft.starters의 순서가 곧 자리 순서(0=PG … 4=C)다.
// 경기 시뮬레이션은 자리를 따지지 않는다(출전 시간은 OVR 순, src/game.mjs lineupMinutes).

const NEAR = { PG: ['SG'], SG: ['PG', 'SF'], SF: ['SG', 'PF'], PF: ['SF', 'C'], C: ['PF'] };
const FIT_SCORE = { exact: 2, near: 1, off: 0 };

/** 선수 포지션이 자리와 맞는 정도: 'exact'(같음) | 'near'(인접 포지션) | 'off'(어색) */
export const seatFit = (player, seat) => (player.position === seat ? 'exact' : NEAR[seat]?.includes(player.position) ? 'near' : 'off');

/** 선수들(최대 5명)을 포지션이 가장 잘 맞게 자리에 앉힌다. 반환: 길이 5의 선수 id 배열(빈자리는 null) */
export function arrangeSeats(players) {
  const list = [...players].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, POSITIONS.length);
  let best = null;
  const seats = Array(POSITIONS.length).fill(null);
  (function visit(i, score) {
    if (i === list.length) { if (!best || score > best.score) best = { score, seats: [...seats] }; return; }
    POSITIONS.forEach((seat, si) => {
      if (seats[si]) return;
      seats[si] = list[i].id;
      visit(i + 1, score + FIT_SCORE[seatFit(list[i], seat)]);
      seats[si] = null;
    });
  })(0, 0);
  return best ? best.seats : [...seats];
}

/** draft → 슬롯 { seats: [id|null ×5], bench: [id|null ×벤치 칸 수] }. arrange=true면 자리를 새로 정하고, false면 draft 순서를 자리 순서로 쓴다 */
export function slotsFromDraft(draft, roster, rules, { arrange = false } = {}) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const starters = draft.starters.filter((id) => byId.has(id));
  const seats = arrange ? arrangeSeats(starters.map((id) => byId.get(id))) : POSITIONS.map((_, i) => starters[i] ?? null);
  const bench = Array.from({ length: rules.lineup.bench }, (_, i) => draft.bench.filter((id) => byId.has(id))[i] ?? null);
  return { seats, bench };
}

/** 슬롯 → draft (빈칸은 건너뛴다. 스타팅은 자리 순서 그대로) */
export const draftFromSlots = (slots) => ({ starters: slots.seats.filter(Boolean), bench: slots.bench.filter(Boolean) });

/** 스타팅은 자리 순서까지, 벤치는 구성만 비교 */
export const sameArrangement = (a, b) => a.starters.join() === b.starters.join() && [...a.bench].sort().join() === [...b.bench].sort().join();

const cloneSlots = (s) => ({ seats: [...s.seats], bench: [...s.bench] });
const AREA_KEY = { seat: 'seats', bench: 'bench' };
const getAt = (s, t) => s[AREA_KEY[t.area]][t.index];
const setAt = (s, t, v) => { s[AREA_KEY[t.area]][t.index] = v; };

/** 선수가 있는 칸: { area: 'seat'|'bench', index } 또는 null(제외) */
export function locate(slots, id) {
  let i = slots.seats.indexOf(id);
  if (i >= 0) return { area: 'seat', index: i };
  i = slots.bench.indexOf(id);
  return i >= 0 ? { area: 'bench', index: i } : null;
}

/** 선수를 칸에 넣는다. 이미 다른 칸에 있었다면 서로 자리를 바꾸고, 제외 선수였다면 그 칸에 있던 선수가 제외로 밀려난다 */
export function placeInSlot(slots, id, target) {
  const next = cloneSlots(slots);
  const from = locate(slots, id);
  const occupant = getAt(next, target);
  if (occupant === id) return next;
  if (from) setAt(next, from, occupant ?? null);
  setAt(next, target, id);
  return next;
}

export function clearSlot(slots, target) { const next = cloneSlots(slots); setAt(next, target, null); return next; }

export function swapSlots(slots, a, b) {
  const next = cloneSlots(slots);
  const va = getAt(next, a); const vb = getAt(next, b);
  setAt(next, a, vb ?? null); setAt(next, b, va ?? null);
  return next;
}

/** 목록에서 한 번에 넣기: 포지션이 가장 잘 맞는 빈 스타팅 자리, 없으면 첫 빈 벤치 칸. 빈 칸이 없으면 null */
export function firstFreeSlot(slots, player) {
  const free = POSITIONS.map((pos, i) => ({ area: 'seat', index: i, pos })).filter((t) => !slots.seats[t.index]);
  if (free.length) {
    free.sort((a, b) => FIT_SCORE[seatFit(player, b.pos)] - FIT_SCORE[seatFit(player, a.pos)] || a.index - b.index);
    return { area: free[0].area, index: free[0].index };
  }
  const bi = slots.bench.indexOf(null);
  return bi >= 0 ? { area: 'bench', index: bi } : null;
}

// ---- 눌러서 바꾸기·끌어 놓기 공용: 칸/선수를 가리키는 ref ------------------------------------------------
// ref = { kind: 'slot', area: 'seat'|'bench', index } | { kind: 'pool', id }(편성에 없는 선수) | { kind: 'out' }(편성에서 빼는 곳)

export const slotRef = (area, index) => ({ kind: 'slot', area, index });
export const OUT_REF = { kind: 'out' };

/** 선수 → ref: 편성에 있으면 그 칸, 없으면 pool */
export function refOfPlayer(slots, id) {
  const at = locate(slots, id);
  return at ? { kind: 'slot', ...at } : { kind: 'pool', id };
}

export const sameRef = (a, b) => Boolean(a && b && a.kind === b.kind && (a.kind === 'out' || (a.kind === 'pool' ? a.id === b.id : a.area === b.area && a.index === b.index)));

/** ref가 가리키는 선수 id(빈 칸·빼기는 null) */
export const idOfRef = (slots, ref) => (ref.kind === 'pool' ? ref.id : ref.kind === 'slot' ? getAt(slots, ref) ?? null : null);

/**
 * from을 to로 옮긴다(눌러서 두 번·끌어 놓기 공통). 새 slots를 돌려주고, 바뀔 게 없으면 같은 객체를 돌려준다.
 *  칸 ↔ 칸: 서로 바꾼다(빈 칸이면 이동)   칸 → pool 선수: 그 선수가 이 칸에 들어오고 원래 선수는 빠진다
 *  pool 선수 → 칸: 그 칸에 들어가고 있던 선수는 빠진다   칸 → 빼기: 그 칸을 비운다   그 밖: 변화 없음
 */
export function moveRefs(slots, from, to) {
  if (!from || !to || sameRef(from, to)) return slots;
  if (from.kind === 'slot' && to.kind === 'slot') return swapSlots(slots, from, to);
  if (from.kind === 'slot' && to.kind === 'pool') return placeInSlot(slots, to.id, from);
  if (from.kind === 'slot' && to.kind === 'out') return getAt(slots, from) ? clearSlot(slots, from) : slots;
  if (from.kind === 'pool' && to.kind === 'slot') return placeInSlot(slots, from.id, to);
  return slots;
}

/**
 * 포지션별 현황(선수 본래 포지션 기준): 로스터 전체, 그중 국내 선수, 스타팅·벤치·제외 인원, 국내 권장 인원(오프시즌 영입 기준 POSITION_TARGET).
 * status: 'short'(국내 선수가 권장보다 적음) | 'ok'
 */
export function positionSummary(roster, slots, target = POSITION_TARGET) {
  return POSITIONS.map((pos) => {
    const list = roster.filter((p) => p.position === pos);
    const where = (p) => locate(slots, p.id)?.area ?? 'out';
    const domestic = list.filter((p) => p.origin === 'domestic').length;
    return {
      pos, total: list.length, domestic, target: target?.[pos] ?? null,
      starters: list.filter((p) => where(p) === 'seat').length, bench: list.filter((p) => where(p) === 'bench').length, out: list.filter((p) => where(p) === 'out').length,
      status: target?.[pos] != null && domestic < target[pos] ? 'short' : 'ok'
    };
  });
}

export const POOL_SORTS = {
  ovr: ['OVR순', (a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)],
  cost: ['코스트순', (a, b) => b.cost - a.cost || b.ovr - a.ovr || a.id.localeCompare(b.id)],
  pos: ['포지션순', (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || b.ovr - a.ovr || a.id.localeCompare(b.id)],
  age: ['나이 어린 순', (a, b) => a.age - b.age || b.ovr - a.ovr || a.id.localeCompare(b.id)]
};

/** 선수 목록: 포지션 필터(null이면 전체)와 정렬 */
export function poolList(roster, { pos = null, sort = 'ovr' } = {}) {
  return roster.filter((p) => !pos || p.position === pos).sort((POOL_SORTS[sort] ?? POOL_SORTS.ovr)[1]);
}

export { lineupCost };
