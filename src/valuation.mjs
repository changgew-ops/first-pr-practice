// 선수·구단 가치 평가와 연봉·캡 계산 (FA, 트레이드, 시즌 종료 처리가 함께 쓴다)
import { rawSalaryEok } from './factory.mjs';

export const isDomestic = (p) => p.origin === 'domestic';
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const domesticOf = (players, teamId) => players.filter((p) => p.teamId === teamId && p.origin === 'domestic');
export const foreignOf = (players, teamId) => players.filter((p) => p.teamId === teamId && p.origin === 'foreign');
export const asiaOf = (players, teamId) => players.filter((p) => p.teamId === teamId && p.origin === 'asia');
export const payrollEok = (players, teamId) => domesticOf(players, teamId).reduce((s, p) => s + p.contract.salaryEok, 0);
/** 아시아쿼터 연봉(억 원). 국내 연봉 캡에는 들어가지 않지만 구단 지출에는 들어간다 */
export const asiaPayrollEok = (players, teamId) => asiaOf(players, teamId).reduce((s, p) => s + p.contract.salaryEok, 0);
export const foreignPayrollUsd = (players, teamId) => foreignOf(players, teamId).reduce((s, p) => s + p.contract.salaryUsd, 0);

/** 선수 가치: 현재 능력 + 성장 여지(젊을수록 크게) − 노쇠 */
export function valueOf(p) {
  const room = Math.max(0, p.potential - p.ovr);
  const youth = p.age <= 24 ? 0.5 : p.age <= 27 ? 0.25 : 0;
  return p.ovr + room * youth - Math.max(0, p.age - 31) * 0.8;
}

/** 거래용 가치. 가치 점수를 지수로 바꿔 스타 한 명이 평범한 선수 여러 명보다 훨씬 크게 평가되도록 한다 */
export const worthOf = (p, rules) => Math.exp((valueOf(p) - 50) / rules.transactions.trade.worthScale);

/** 선수가 시장에서 요구하는 연봉(억 원). 어리고 성장 여지가 크면 높고, 노장은 낮다. rules를 주면 그 시즌 물가 지수를 곱한다 */
export function demandEok(p, rules = null) {
  const room = Math.max(0, p.potential - p.ovr);
  const youth = p.age <= 24 ? 0.4 : p.age <= 27 ? 0.2 : 0;
  const ageFactor = p.age <= 31 ? 1 : p.age <= 34 ? 0.9 : 0.8;
  const idx = rules?.econ?.index ?? 1; // 물가 지수(src/economy.mjs): 새로 맺는 계약의 요구 연봉이 그 시즌 수준으로 오른다
  return Math.max(Math.round(0.3 * idx * 10) / 10, Math.floor(rawSalaryEok(p.ovr + room * youth) * ageFactor * idx * 10) / 10);
}

/** 소프트캡 초과 기금(억 원): 초과 구간 비율에 따라 초과분의 30/40/50% */
export function softCapPenaltyEok(payroll, rules) {
  const cap = rules.salaryCap.domesticEok;
  const over = payroll - cap;
  if (over <= 1e-9) return 0;
  const ratio = over / cap;
  const [, rate] = rules.salaryCap.soft.penaltyTiers.find(([upTo]) => ratio <= upTo + 1e-12);
  return Math.round(over * rate * 100) / 100;
}

/** 캡 여유(억 원). 하드 한도는 캡 × (1 + 최대 초과 비율) */
export const capRoomEok = (payroll, rules) => rules.salaryCap.domesticEok - payroll;
export const hardLimitEok = (rules) => rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio);

export const POSITION_TARGET = { PG: 3, SG: 2, SF: 3, PF: 2, C: 2 };

/** 포지션 필요도 가산점: 없으면 크게, 목표 인원보다 적으면 조금 */
export function needBonus(roster, position, noneBonus = 6, shortBonus = 2) {
  const c = roster.filter((p) => p.position === position).length;
  return c === 0 ? noneBonus : c < POSITION_TARGET[position] ? shortBonus : 0;
}

/** 지난 시즌 순위로 본 구단 성향 */
export function strategyOf(rank, teamCount = 10) {
  if (rank <= Math.ceil(teamCount * 0.4)) return 'contend';
  if (rank > Math.floor(teamCount * 0.7)) return 'rebuild';
  return 'balanced';
}

/** 입력 문자열로 만든 결정적 값 [0,1). 선수별 "기분" 같은 숨은 변수에 쓴다 */
export function hash01(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
