// 전술: 팀 구성에 따라 이득이 달라지는 경기 운영 방침. 순수 함수만 둔다(진행기 src/season-run.mjs가 팀을 만들 때 부른다).
// 전술마다 "구성 적합도(fit, -1~1)"가 있다: 그 전술이 요구하는 능력치를 출전 시간으로 가중한 라인업 평균(또는 상위 N명)이 리그 평균(ref)보다 높으면 +, 낮으면 −.
// 적합도 × edgeMax(점수)가 그 팀의 기대 득점에 더해지는 이득(edge)이라, 구성에 맞지 않는 전술은 오히려 손해다. 균형(balanced)은 늘 0이다.
// 득점 페이스(pace)는 두 팀의 평균이 그 경기의 기대 득점에 곱해지고, 3점 비중·리바운드·턴오버는 박스스코어의 기록 열만 바꾼다(src/game.mjs).
// 값은 rules.tactics(게임용 가정, _note).
import { lineupMinutes } from './game.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const BALANCED = 'balanced';

/** 전술 목록(규칙값 순서) */
export const tacticList = (rules) => rules.tactics?.list ?? [];
export const tacticOf = (id, rules) => tacticList(rules).find((t) => t.id === id) ?? null;

const score = (p, weights) => Object.entries(weights).reduce((s, [k, w]) => s + w * (p.stats[k] ?? 0), 0);

/** 전술이 보는 구성 점수(리그 평균 ref와 비교하기 전의 값). top이 있으면 그 점수 상위 N명의 평균, 없으면 출전 시간 가중 평균 */
export function metricOf(tactic, lineup, sim) {
  const m = tactic.metric;
  if (!m) return null;
  const all = [...lineup.starters, ...lineup.bench];
  if (m.top) {
    const top = all.map((p) => score(p, m.weights)).sort((a, b) => b - a).slice(0, m.top);
    return top.reduce((s, v) => s + v, 0) / top.length;
  }
  const minutes = lineupMinutes(lineup, sim);
  let sum = 0, total = 0;
  for (const p of all) { const w = minutes.get(p.id) ?? 0; sum += score(p, m.weights) * w; total += w; }
  return total ? sum / total : 0;
}

/**
 * 그 전술의 구성 적합도 -1~1 (균형은 0). refs({ 전술 id: 리그 평균 점수 })를 주면 그 값을 기준으로 삼아 "리그 평균 대비"가 되고,
 * 없으면 규칙값의 고정 ref를 쓴다. 리그 평균 대비로 재면 시즌이 지나 리그 능력치가 올라도 전술 이득이 한쪽으로 쏠리지 않는다.
 */
export function fitOf(id, lineup, rules, refs = null) {
  const t = tacticOf(id, rules);
  if (!t?.metric) return 0;
  return clamp((metricOf(t, lineup, rules.simulation) - (refs?.[id] ?? t.metric.ref)) / t.metric.spread, -1, 1);
}

/** 리그 모든 팀 라인업의 평균 점수: { 전술 id: 평균 } */
export function leagueRefs(lineups, rules) {
  const out = {};
  for (const t of tacticList(rules)) {
    if (!t.metric || !lineups.length) continue;
    out[t.id] = lineups.reduce((s, l) => s + metricOf(t, l, rules.simulation), 0) / lineups.length;
  }
  return out;
}

/** 모든 전술의 적합도, 높은 순: [{ id, name, fit }]. 균형도 들어 있다(0) */
export function recommend(lineup, rules, refs = null) {
  return tacticList(rules).map((t) => ({ id: t.id, name: t.name, desc: t.desc, fit: round2(fitOf(t.id, lineup, rules, refs)) })).sort((a, b) => b.fit - a.fit);
}

/** AI(와 "추천 따르기")가 고르는 전술: 적합도가 minFit 이상인 가장 좋은 전술, 없으면 균형 */
export function chooseAuto(lineup, rules, refs = null) {
  const best = recommend(lineup, rules, refs).find((r) => r.id !== BALANCED);
  return best && best.fit >= rules.tactics.minFit ? best.id : BALANCED;
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 전술이 팀에 주는 보정. tacMult: 감독의 전술 이해에 따른 배수(src/coaching.mjs tacMult).
 * 반환: { id, fit, pace, three, reb, to, oppTo, edge }. 전술이 꺼져 있으면 null(경기 계산이 이전과 똑같다)
 */
export function tacticMods(id, lineup, rules, tacMult = 1, refs = null) {
  const cfg = rules.tactics;
  if (!cfg?.enabled) return null;
  const t = tacticOf(id, rules) ?? tacticOf(BALANCED, rules);
  if (!t) return null;
  const fit = fitOf(t.id, lineup, rules, refs);
  return { id: t.id, fit: round2(fit), pace: t.pace ?? 1, three: t.three ?? 1, reb: t.reb ?? 1, to: t.to ?? 1, oppTo: t.oppTo ?? 1, edge: round2(cfg.edgeMax * fit * tacMult * (t.id === BALANCED ? 0 : 1)) };
}
