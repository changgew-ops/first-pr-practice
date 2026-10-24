// 영입·계약 영향 미리보기: "이 선수를 이 조건으로 데려오면 우리 팀이 어떻게 되는가"를 계산하는 순수 함수(DOM·세션 없음).
// 화면 숫자와 실제 결과가 어긋나지 않게, 캡·연봉 계산은 엔진이 쓰는 함수(src/valuation.mjs payrollEok·softCapPenaltyEok·hardLimitEok,
// src/lineup.mjs buildLineup)를 그대로 부르고, 영입 가능 여부(check)는 엔진의 검증 결과(세션 faCheck·foreignCheck·오프시즌 faPlan)를 받아 보여 준다.
import { payrollEok, asiaPayrollEok, foreignPayrollUsd, softCapPenaltyEok, hardLimitEok } from '../../src/valuation.mjs';
import { buildLineup } from '../../src/lineup.mjs';

const r2 = (v) => Math.round(v * 100) / 100;

const roleIn = (lineup, id) => (lineup.starters.some((p) => p.id === id) ? 'starter' : lineup.bench.some((p) => p.id === id) ? 'bench' : 'out');
export const ROLE_TEXT = { starter: '스타팅', bench: '벤치', out: '엔트리 밖' };

/**
 * 입력
 *  roster: 우리 구단 선수들(전 구분), cand: 영입할 선수(원본 선수 객체), offer: { salaryEok, years } | 외국인 { salaryUsd, years },
 *  rules, teamId, releaseId(대신 내보낼 선수 id, 선택), check(엔진 검증 결과 { ok, reason|errors }, 선택), nextCounts(선택: 다음 시즌 확정 지출 계산에서 현재 시즌을 이미 뺀 것으로 볼지: 오프시즌 단계면 true)
 * 반환
 *  { ok, reason, origin, domestic?: {before, after, cap, hardLimit, roomBefore, roomAfter, over, penaltyBefore, penaltyAfter, overHard},
 *    foreign?: {beforeUsd, afterUsd, limitUsd}, asia?: {beforeEok, afterEok},
 *    role: { before, after }, competitors: [{ player, diff(OVR: 영입 선수 − 경쟁자) }], roster: { before, after, max },
 *    next: { eok(다음 시즌 확정 지출: 남은 계약이 이어지는 선수 + 이 계약), years } }
 */
export function signingImpact({ roster, cand, offer, rules, teamId, releaseId = null, check = null, nextCounts = false }) {
  const origin = cand.origin ?? 'domestic';
  const salaryEok = origin === 'foreign' ? (offer.salaryUsd ?? 0) * (rules.transactions?.funds?.foreignUsdToEok ?? 0) : offer.salaryEok;
  const signed = { ...cand, teamId, contract: { ...(cand.contract ?? {}), ...(origin === 'foreign' ? { salaryUsd: offer.salaryUsd } : { salaryEok: offer.salaryEok }), yearsLeft: offer.years } };
  const before = roster.filter((p) => p.teamId === teamId);
  const keep = before.filter((p) => p.id !== releaseId);
  const after = [...keep.filter((p) => p.id !== cand.id), signed];
  const out = { ok: check ? Boolean(check.ok) : true, reason: check && !check.ok ? (check.reason ?? check.errors?.[0] ?? null) : null, origin };

  if (origin === 'domestic') {
    const b = payrollEok(before, teamId), a = payrollEok(after, teamId), cap = rules.salaryCap.domesticEok;
    out.domestic = { before: r2(b), after: r2(a), cap, hardLimit: r2(hardLimitEok(rules)), roomBefore: r2(cap - b), roomAfter: r2(cap - a), over: r2(Math.max(0, a - cap)), penaltyBefore: softCapPenaltyEok(b, rules), penaltyAfter: softCapPenaltyEok(a, rules), overHard: a > hardLimitEok(rules) + 1e-9 };
  } else if (origin === 'foreign') {
    const b = foreignPayrollUsd(before, teamId), a = foreignPayrollUsd(after, teamId);
    out.foreign = { beforeUsd: b, afterUsd: a, limitUsd: rules.salaryCap.foreignUsdTotal, perPlayerUsd: rules.salaryCap.foreignUsdPerPlayer };
  } else {
    out.asia = { beforeEok: r2(asiaPayrollEok(before, teamId)), afterEok: r2(asiaPayrollEok(after, teamId)) };
  }

  // 예상 역할: 자동 편성(엔진이 쓰는 buildLineup)에서 이 선수의 자리
  const bw = rules.simulation?.benchWeight ?? 0.45;
  const lineupOf = (list) => buildLineup(list, rules, bw);
  out.role = { before: cand.teamId === teamId ? roleIn(lineupOf(before), cand.id) : null, after: roleIn(lineupOf(after), cand.id) };

  // 같은 포지션 경쟁자 상위 2명
  out.competitors = keep.filter((p) => p.position === cand.position && p.id !== cand.id).sort((x, y) => y.ovr - x.ovr || (x.id < y.id ? -1 : 1)).slice(0, 2).map((p) => ({ player: p, diff: cand.ovr - p.ovr }));

  out.roster = { before: before.length, after: after.length, max: (rules.roster?.domestic ?? 0) + (rules.roster?.foreign ?? 0) + (rules.roster?.asia ?? 0), maxByOrigin: rules.roster?.[origin] ?? null, countByOrigin: { before: before.filter((p) => p.origin === origin).length, after: after.filter((p) => p.origin === origin).length } };

  // 다음 시즌 확정 지출: 계약이 다음 시즌까지 이어지는 선수(남은 기간 > 1, 오프시즌에는 이미 새 시즌 기준이라 > 1이 "그다음 시즌")와 이 계약(기간 > 1)
  const eokOf = (p) => (p.origin === 'foreign' ? (p.contract?.salaryUsd ?? 0) * (rules.transactions?.funds?.foreignUsdToEok ?? 0) : p.contract?.salaryEok ?? 0);
  const cont = after.filter((p) => (p.contract?.yearsLeft ?? 0) > 1);
  out.next = { eok: r2(cont.reduce((s, p) => s + eokOf(p), 0)), thisContractContinues: offer.years > 1, years: offer.years, domesticEok: r2(cont.filter((p) => p.origin === 'domestic').reduce((s, p) => s + p.contract.salaryEok, 0)) };
  out.salaryEok = r2(salaryEok);
  return out;
}
