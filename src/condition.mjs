// 컨디션: 선수별 0~100. 경기에서 뛴 시간만큼 떨어지고 하루가 지나면 회복한다(휴식하면 그만큼 더 채워진다).
// 상태는 진행기(src/season-run.mjs)가 시즌 동안만 들고 있고 저장하지 않는다 — 시드와 조작 기록(휴식 지정)으로 다시 돌리면 같은 값이 나온다.
// 경기 영향: 컨디션이 thr 아래인 선수가 많이 뛰는 팀은 기대 득점이 조금 깎인다(리그 평균과의 차이만큼이라 리그 전체 득점 수준은 변하지 않는다).
// 부상 확률: 이 기능이 켜져 있으면 src/injuries.mjs의 "연속 출전" 항 대신 컨디션이 같은 항(피로)을 정한다(둘을 같이 쓰면 이중 계산).
// 값은 rules.condition(게임용 가정, _note).
import { lineupMinutes } from './game.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const conditionOn = (rules) => Boolean(rules.condition?.enabled);
export const startCondition = (rules) => rules.condition?.start ?? 100;

/** 스태미나가 높을수록 같은 시간을 뛰어도 덜 떨어진다: 50이면 1, 80이면 1 − 0.6×0.3 */
export const drainFactor = (p, rules) => clamp(1 - rules.condition.staminaSlope * ((p.stats?.stamina ?? 50) - 50) / 100, 0.6, 1.5);

/**
 * 하루가 끝난 뒤의 컨디션 한 선수분. minutes: 그날 뛴 시간(0이면 쉼), recoveryMul: 체력 코치에 따른 회복 배수.
 * 떨어짐 = 분 × drainPerMin × 스태미나 계수, 회복 = (base + frac × (100 − 현재)) × recoveryMul
 */
export function nextCondition(cond, p, minutes, rules, recoveryMul = 1) {
  const c = rules.condition;
  let v = cond - minutes * c.drainPerMin * drainFactor(p, rules);
  v += (c.recover.base + c.recover.frac * (100 - v)) * recoveryMul;
  return clamp(v, 0, 100);
}

/** 컨디션 한 선수의 손실 점수(0 이하): thr 아래로 떨어진 만큼 */
const lossOf = (c, rules) => -Math.max(0, rules.condition.thr - c) / rules.condition.thr;

/** 팀 라인업의 컨디션 점수(출전 시간 가중, 0 이하). 리그 평균과의 차이가 팀 이득이다 */
export function lineupCondScore(lineup, cond, rules) {
  const minutes = lineupMinutes(lineup, rules.simulation);
  let sum = 0, total = 0;
  for (const p of [...lineup.starters, ...lineup.bench]) {
    const w = minutes.get(p.id) ?? 0;
    sum += lossOf(cond.get(p.id) ?? startCondition(rules), rules) * w; total += w;
  }
  return total ? sum / total : 0;
}

/** 팀 컨디션 이득(점수): edgePerPoint × (이 팀 점수 − 리그 평균 점수) */
export const condEdge = (score, leagueMean, rules) => Math.round(rules.condition.edge * (score - leagueMean) * 100) / 100;

/** 부상 판정에 넘기는 "연속 출전 경기 수" 대신 쓰는 값: 컨디션이 fatigueFrom 이하로 내려갈수록 피로 항이 최대(cap)까지 */
export function fatigueStreak(cond, rules) {
  const cap = rules.injuries?.fatigue?.cap ?? 10;
  const lo = rules.condition.lowCond;
  return Math.round(cap * clamp((100 - cond) / (100 - lo), 0, 1));
}

/** 화면 표시용 단계: 좋음·보통·피로·지침 */
export function condTier(c) {
  if (c >= 80) return { key: 'good', label: '좋음' };
  if (c >= 60) return { key: 'ok', label: '보통' };
  if (c >= 40) return { key: 'tired', label: '피로' };
  return { key: 'bad', label: '지침' };
}
