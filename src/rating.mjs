export const STAT_KEYS = ['shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina'];

// 포지션별 OVR 가중치 (합계 1)
export const POSITION_WEIGHTS = {
  PG: { shooting: 0.22, passing: 0.28, defense: 0.14, rebound: 0.04, athletic: 0.16, stamina: 0.16 },
  SG: { shooting: 0.3, passing: 0.14, defense: 0.14, rebound: 0.06, athletic: 0.18, stamina: 0.18 },
  SF: { shooting: 0.2, passing: 0.12, defense: 0.18, rebound: 0.14, athletic: 0.18, stamina: 0.18 },
  PF: { shooting: 0.12, passing: 0.08, defense: 0.2, rebound: 0.26, athletic: 0.16, stamina: 0.18 },
  C: { shooting: 0.06, passing: 0.08, defense: 0.24, rebound: 0.32, athletic: 0.14, stamina: 0.16 }
};

export function calcOvr(position, stats) {
  const w = POSITION_WEIGHTS[position];
  if (!w) throw new Error(`unknown position: ${position}`);
  let sum = 0;
  for (const k of STAT_KEYS) sum += stats[k] * w[k];
  return Math.round(sum);
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
