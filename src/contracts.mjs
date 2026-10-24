// 계약 관리: 방출(계약 중도 해지)과 연장 계약. 순수 함수만 둔다(진행기·오프시즌 엔진·화면이 같이 쓴다).
//  - 방출: 자유계약선수 관리 규정 제5조 ②("계약이 중도 해지되면 구단은 계약기간 만료시까지의 보수를 지급한다")에 따라 남은 보수를 구단이 낸다.
//    국내 선수만 방출한다(외국인은 교체 규정, 아시아쿼터는 규정에 절차가 없다). 시즌 중 방출은 웨이버 공시를 거친다(src/waivers.mjs, 규약 제101조).
//  - 연장 계약: 계약이 남아 있어도 새 연봉·총 기간을 제안할 수 있다. 수락 여부는 재계약·FA와 같은 offerScore로 정하고
//    기간은 FA 계약기간 규정(관리 규정 제4조: 전년도 보수 30위 이내는 3~5년, 만 32세 이상 예외, 그 밖에는 5년 이하)을 따른다.
import { buildLineup } from './lineup.mjs';
import { offerScore, capAllows, yearsRange } from './freeagency.mjs';
import { domesticOf, payrollEok } from './valuation.mjs';

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 방출 비용(억 원). phase 'season': 이번 시즌 남은 일수 비율 + 이후 계약 연수(yearsLeft는 이번 시즌을 포함),
 * 'offseason': 남은 계약 연수(만료 처리 뒤의 yearsLeft)만큼. earned는 시즌 중 이미 뛴 만큼의 보수(평소 연봉 지출로 잡힌다).
 */
export function releaseCost(p, { phase = 'season', day = 0, totalDays = 54 } = {}) {
  const salary = p.contract?.salaryEok ?? 0;
  const years = Math.max(0, p.contract?.yearsLeft ?? 0);
  if (phase === 'offseason') return { severance: round2(salary * years), earned: 0, years, fraction: 0, salaryEok: salary };
  const left = Math.max(0, Math.min(1, (totalDays - day) / totalDays));
  return { severance: round2(salary * (left + Math.max(0, years - 1))), earned: round2(salary * (1 - left)), years, fraction: left, salaryEok: salary };
}

/** 라인업 엔트리를 채우는 데 필요한 국내 선수 최소 인원(엔트리 − 외국·아시아쿼터 선수 수) */
export function minDomestic(players, teamId, rules) {
  const others = players.filter((p) => p.teamId === teamId && p.origin !== 'domestic').length;
  return Math.max(0, rules.lineup.starters + rules.lineup.bench - others);
}

const NOT_DOMESTIC = {
  foreign: '외국인 선수는 방출할 수 없고 일시교체·시즌대체 규정(외국선수 관리규정)에 따라 교체합니다(로스터 화면의 교체 패널)',
  asia: '아시아쿼터 선수는 외국인 선수와 같이 방출할 수 없고 일시교체·시즌대체로만 바꿀 수 있습니다(로스터 화면의 교체 패널). 제공된 규정에는 아시아쿼터 교체 절차가 없어, 외국선수 관리규정의 구조를 그대로 옮긴 게임용 가정입니다'
};

/** 방출할 수 있는지: { ok, reason, warning }. phase 'season'이면 남는 선수로 라인업을 만들 수 있어야 한다 */
export function releaseCheck({ players, teamId, playerId, phase = 'season', rules }) {
  const p = players.find((x) => x.id === playerId);
  if (!p || p.teamId !== teamId) return { ok: false, reason: '우리 구단 선수가 아닙니다', warning: null };
  if (p.origin !== 'domestic') return { ok: false, reason: NOT_DOMESTIC[p.origin] ?? '방출할 수 없는 선수입니다', warning: null };
  const mine = players.filter((x) => x.teamId === teamId);
  const dom = mine.filter((x) => x.origin === 'domestic').length;
  const need = minDomestic(players, teamId, rules);
  if (phase === 'season') {
    if (dom - 1 < need) return { ok: false, reason: `방출하면 국내 선수가 ${dom - 1}명이 되어 라인업 엔트리 ${rules.lineup.starters + rules.lineup.bench}명을 채울 수 없습니다(국내 선수 최소 ${need}명)`, warning: null };
    try { buildLineup(mine.filter((x) => x.id !== playerId), rules, rules.simulation.benchWeight); } catch { return { ok: false, reason: '남는 선수로는 라인업을 만들 수 없습니다', warning: null }; }
    return { ok: true, reason: null, warning: null };
  }
  const warning = dom - 1 < rules.roster.domestic ? `국내 선수가 ${dom - 1}명이 됩니다. 오프시즌 마지막 로스터 확정 단계에서 FA 시장에서 남은 선수나 신인급으로 ${rules.roster.domestic}명까지 채웁니다.` : null;
  return { ok: true, reason: null, warning };
}

/** 선수 계약을 보수(연봉) 순위로 매긴 순위표: Map<선수id, 순위>. 국내 선수만, 전체 리그 기준 */
export function salaryRanks(players) {
  return new Map([...players].filter((p) => p.origin === 'domestic').sort((a, b) => b.contract.salaryEok - a.contract.salaryEok).map((p, i) => [p.id, i + 1]));
}

/** 연장 계약 총 기간(남은 기간 포함)의 범위 [최소, 최대]. 이미 최대면 null. rank: 전체 국내 선수 중 보수 순위 */
export function extensionYears(p, rank, rules) {
  const [lo, hi] = yearsRange({ prevRank: rank, age: p.age }, rules);
  const min = Math.max(lo, (p.contract?.yearsLeft ?? 0) + 1);
  return min > hi ? null : [min, hi];
}

/**
 * 연장 제안 판정. offer: { salaryEok, years }, roster: 우리 국내 선수 전원(이 선수 포함), ctx: { season, winPct, prestige … }
 * 반환: { ok(수락 예상), status: 'ok'|'refuse'|'cap'|'years'|'invalid', range, verdict, reason }
 */
export function extensionCheck({ player, offer, roster, ctx, rules, rank, teamId }) {
  const range = extensionYears(player, rank, rules);
  if (player.origin !== 'domestic') return { ok: false, status: 'invalid', range, verdict: null, reason: '국내 선수만 연장 계약을 할 수 있습니다' };
  if (!range) return { ok: false, status: 'years', range, verdict: null, reason: '이미 최대 계약 기간이라 더 늘릴 수 없습니다' };
  if (!(offer.salaryEok > 0)) return { ok: false, status: 'invalid', range, verdict: null, reason: '연봉을 입력해 주세요' };
  if (!Number.isInteger(offer.years) || offer.years < range[0] || offer.years > range[1]) {
    return { ok: false, status: 'years', range, verdict: null, reason: `계약 기간은 총 ${range[0]}~${range[1]}년이어야 합니다(남은 ${player.contract.yearsLeft}년보다 길게${range[0] > player.contract.yearsLeft + 1 ? ', 전년도 보수 30위 이내 선수는 3년 이상' : ''})` };
  }
  const others = roster.filter((x) => x.id !== player.id);
  const payrollOthers = payrollEok(others, teamId);
  if (!capAllows(payrollOthers, offer.salaryEok, rules, { isManager: true })) return { ok: false, status: 'cap', range, verdict: null, reason: '새 연봉으로는 샐러리캡 한도(소프트캡 상한)를 넘습니다' };
  const verdict = offerScore(player, offer.salaryEok, teamId, others, ctx, rules);
  if (!verdict.accept) return { ok: false, status: 'refuse', range, verdict, reason: verdict.ratio < rules.transactions.freeAgency.minOfferRatio ? `요구액 ${verdict.demand.toFixed(1)}억의 ${Math.round(rules.transactions.freeAgency.minOfferRatio * 100)}% 미만이라 거절합니다` : `수락 점수 ${verdict.score.toFixed(2)}가 기준 ${rules.transactions.freeAgency.acceptScore}에 못 미칩니다` };
  return { ok: true, status: 'ok', range, verdict, reason: null };
}

/** 연장 계약을 선수에게 적용한 새 선수 객체 */
export const extendedPlayer = (p, offer) => ({ ...p, contract: { salaryEok: offer.salaryEok, yearsLeft: offer.years } });

/** 시즌 중 연장 때 정산 보정(억): 이미 지나간 비율만큼은 예전 연봉으로 냈다고 보고, 시즌 말 정산(새 연봉 × 한 시즌)을 맞춘다 */
export function extensionAdjust(oldSalary, newSalary, day, totalDays) {
  return round2((oldSalary - newSalary) * Math.max(0, Math.min(1, day / totalDays)));
}

/** 우리 국내 선수 목록(화면용 보조) */
export const myDomestic = (players, teamId) => domesticOf(players, teamId);
