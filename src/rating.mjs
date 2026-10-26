export const STAT_KEYS = ['shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina'];

// 포지션별 OVR 가중치 (합계 1)
export const POSITION_WEIGHTS = {
  PG: { shooting: 0.22, passing: 0.28, defense: 0.14, rebound: 0.04, athletic: 0.16, stamina: 0.16 },
  SG: { shooting: 0.3, passing: 0.14, defense: 0.14, rebound: 0.06, athletic: 0.18, stamina: 0.18 },
  SF: { shooting: 0.2, passing: 0.12, defense: 0.18, rebound: 0.14, athletic: 0.18, stamina: 0.18 },
  PF: { shooting: 0.12, passing: 0.08, defense: 0.2, rebound: 0.26, athletic: 0.16, stamina: 0.18 },
  C: { shooting: 0.06, passing: 0.08, defense: 0.24, rebound: 0.32, athletic: 0.14, stamina: 0.16 }
};

// OVR 눈금(2026-10 개정): 능력치의 포지션 가중 평균(raw)이 60을 넘는 구간만 위로 늘려 최고 선수가 100에 닿게 한다.
//   OVR = raw (raw ≤ OVR_PIVOT),  OVR = raw + (raw−P) × (OVR_CURVE × (raw−P)) 꼴의 매끄러운 2차 곡선 (raw > P)
//   raw 62→62, 66→67, 70→74, 73→79, 76→86, 80→95, 82→100. 경기 엔진은 OVR이 아니라 능력치를 쓰므로 승부는 그대로이고,
//   OVR 단위로 짜인 규칙(성장 여지·연봉 곡선·희귀도·외국인 가격 등)은 아래 legacyOvr(예전 눈금)로 되돌려 계산한다.
export const OVR_PIVOT = 60;
export const OVR_CURVE = 0.0372;
export const OVR_MAX = 100;

/** 예전 눈금(raw 가중 평균) → 지금 눈금(소수) */
export const stretchOvr = (raw) => (raw <= OVR_PIVOT ? raw : OVR_PIVOT + (raw - OVR_PIVOT) * (1 + OVR_CURVE * (raw - OVR_PIVOT)));
/** 지금 눈금 → 예전 눈금(stretchOvr의 역함수, 소수). 예전 눈금으로 쓰인 상수(성장 여지·연봉 곡선 등)에 넣기 전에 쓴다 */
export const legacyOvr = (ovr) => (ovr <= OVR_PIVOT ? ovr : OVR_PIVOT + (Math.sqrt(1 + 4 * OVR_CURVE * (ovr - OVR_PIVOT)) - 1) / (2 * OVR_CURVE));
/** 예전 눈금의 값을 지금 눈금의 정수 OVR로 (상한 OVR_MAX) */
export const fromLegacyOvr = (raw) => Math.min(OVR_MAX, Math.round(stretchOvr(raw)));
/** ovr에 예전 눈금 기준으로 delta만큼 더한 값(잠재력 보너스 등). 결과는 [ovr, OVR_MAX]로 자른다 */
export const ovrPlus = (ovr, delta) => Math.max(ovr, fromLegacyOvr(legacyOvr(ovr) + delta));
/** 잠재력 − OVR을 예전 눈금으로 잰 성장 여지(0 이상) */
export const ovrGap = (p) => Math.max(0, legacyOvr(p.potential) - legacyOvr(p.ovr));

export function calcOvr(position, stats) {
  const w = POSITION_WEIGHTS[position];
  if (!w) throw new Error(`unknown position: ${position}`);
  let sum = 0;
  for (const k of STAT_KEYS) sum += stats[k] * w[k];
  return Math.min(OVR_MAX, Math.round(stretchOvr(sum)));
}

export const COST_MIN = 1;
export const COST_MAX = 20;
const COST_OVR_FLOOR = 40;
const COST_CURVE = 1.6;

// 능력치(OVR) 기반 카드 코스트. 높은 OVR일수록 코스트가 가파르게 오른다.
export function calcCost(ovr) {
  const t = Math.max(0, Math.min(1, (ovr - COST_OVR_FLOOR) / (99 - COST_OVR_FLOOR)));
  return COST_MIN + Math.round(Math.pow(t, COST_CURVE) * (COST_MAX - COST_MIN));
}
