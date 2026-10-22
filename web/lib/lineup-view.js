// 라인업 편성 화면의 순수 계산(브라우저 API 없음). 편집 중인 편성(draft)은 { starters: [선수 id], bench: [선수 id] }.
import { validateLineup, buildLineup, lineupCost } from '../../src/lineup.mjs';

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

/** 자동 편성(코스트 제한 안에서 가장 강한 10명)을 draft 모양으로 */
export function autoDraft(roster, rules) {
  const { starters, bench } = buildLineup(roster, rules, rules.simulation.benchWeight);
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

export { lineupCost };
