// 육성(훈련): 선수마다 집중 능력치 하나를 정하면 훈련 횟수만큼 경험치가 쌓이고,
// 임계값을 넘을 때마다 능력치가 +1 오른다. 난수를 쓰지 않는 결정적 계산이다.
import { STAT_KEYS, POSITION_WEIGHTS, calcOvr, calcCost, ovrGap } from './rating.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function ageMultiplier(age, cfg) {
  for (const [maxAge, mult] of cfg.ageMultipliers) if (age <= maxAge) return mult;
  return cfg.ageMultipliers.at(-1)[1];
}

// 잠재력(POT)과 현재 OVR의 차이가 클수록 빠르고, 한계에 가까우면 거의 늘지 않는다
export function potentialMultiplier(p, cfg) {
  const room = ovrGap(p) / cfg.potentialRoomRef; // 예전 OVR 눈금으로 잰 성장 여지
  return clamp(room, cfg.minPotentialMultiplier, cfg.maxPotentialMultiplier);
}

export const trainingThreshold = (stat, cfg) => Math.max(4, cfg.thresholdBase + cfg.thresholdPerPoint * (stat - 50));

/**
 * 훈련 sessions회 반영. 반환: 새 선수 객체 (원본은 바꾸지 않음)
 * p.xp에 능력치별 남은 경험치를 저장한다. gainMul: 코치 능력치에 따른 성장 배수(기본 1).
 */
export function trainPlayer(p, focus, sessions, rules, gainMul = 1) {
  if (!STAT_KEYS.includes(focus)) throw new Error(`알 수 없는 능력치: ${focus}`);
  const cfg = rules.training;
  const stats = { ...p.stats };
  const xp = { ...(p.xp ?? {}) };
  const gain = sessions * cfg.baseGain * ageMultiplier(p.age, cfg) * potentialMultiplier(p, cfg) * gainMul; // gainMul: 담당 코치의 능력치 배수(src/coaching.mjs)
  xp[focus] = (xp[focus] ?? 0) + gain;
  while (stats[focus] < rules.stats.max && xp[focus] >= trainingThreshold(stats[focus], cfg)) {
    xp[focus] -= trainingThreshold(stats[focus], cfg);
    stats[focus] += 1;
  }
  if (stats[focus] >= rules.stats.max) xp[focus] = 0;
  const ovr = calcOvr(p.position, stats);
  return { ...p, stats, xp, ovr, cost: calcCost(ovr) };
}

/** 자동 훈련 계획: 포지션 가중치가 크고 아직 올릴 여지가 있는 능력치를 고른다 */
export function autoFocus(p) {
  const w = POSITION_WEIGHTS[p.position];
  let best = STAT_KEYS[0];
  let bestScore = -Infinity;
  for (const k of STAT_KEYS) {
    const score = w[k] * (99 - p.stats[k]);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}
