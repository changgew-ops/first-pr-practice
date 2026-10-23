// 오프시즌 결정 화면이 쓰는 순수 계산(브라우저 API 없음, node에서 테스트한다).
// 엔진(src/offseason.mjs·freeagency.mjs·trade.mjs)이 결정을 처리하는 방식과 같은 식으로 "미리 보기"를 계산한다.
import { prestigeTable } from '../../src/legacy.mjs';
import { offerScore, capAllows, preferredYears, compensationFor } from '../../src/freeagency.mjs';
import { teamWorth } from '../../src/trade.mjs';
import {
  domesticOf, foreignOf, asiaOf, payrollEok, asiaPayrollEok, hardLimitEok, softCapPenaltyEok, valueOf, demandEok, needBonus, POSITION_TARGET
} from '../../src/valuation.mjs';

export const round1 = (v) => Math.round(v * 10) / 10;

/** 단계 표시줄: [{ id, label }] */
export const STEPS = [
  { id: 'trade', label: '성장·트레이드' }, { id: 'resign', label: '재계약' },
  ...[1, 2, 3, 4, 5].map((r) => ({ id: `fa:${r}`, label: `FA ${r}라운드` })),
  { id: 'draft', label: '드래프트' }, { id: 'foreign', label: '외국인 영입' }
];

/** 지금 결정 키(pending.key·kind)와 지금까지의 결정으로 "현재 단계" id를 정한다. 보상 선택(comp)은 방금 제안한 FA 라운드에 속한다 */
export function currentStep(pending, decisions = {}) {
  if (pending.kind === 'trade') return 'trade';
  if (pending.kind === 'resign') return 'resign';
  if (pending.kind === 'draft') return 'draft';
  if (pending.kind === 'foreign') return 'foreign';
  if (pending.kind === 'freeAgency') return pending.key;
  const rounds = Object.keys(decisions).filter((k) => k.startsWith('fa:')).map((k) => Number(k.slice(3)));
  return `fa:${Math.max(1, ...rounds)}`;
}

/** 엔진이 오프시즌 시작에 만드는 ctx(순위·승률·전통 점수)를 시즌 종료 상태에서 다시 만든다 */
export function buildCtx(seasonEnd, teamCount, rules, managerId) {
  const standings = seasonEnd.standings;
  return {
    season: seasonEnd.league.season,
    ranks: new Map(standings.map((s, i) => [s.id, i + 1])),
    winPct: new Map(standings.map((s) => [s.id, s.wins / Math.max(1, s.wins + s.losses)])),
    prestige: new Map(Object.entries(prestigeTable(seasonEnd.league.legacy, rules)).map(([id, v]) => [id, v.score])),
    managerTeamId: managerId, teamCount
  };
}

/** 우리 구단 현황 */
export function teamSummary(players, funds, managerId, rules) {
  const payroll = payrollEok(players, managerId);
  const cap = rules.salaryCap.domesticEok;
  return {
    domesticCount: domesticOf(players, managerId).length, domesticMax: rules.roster.domestic,
    foreignCount: foreignOf(players, managerId).length, asiaCount: asiaOf(players, managerId).length,
    payroll, cap, hardLimit: hardLimitEok(rules), room: cap - payroll, penalty: softCapPenaltyEok(payroll, rules),
    asiaPayroll: asiaPayrollEok(players, managerId), funds: funds?.[managerId] ?? 0
  };
}

/** 포지션별 인원(우리 국내 선수) 대 목표 */
export function positionCounts(players, managerId) {
  const mine = domesticOf(players, managerId);
  return Object.entries(POSITION_TARGET).map(([pos, target]) => ({ pos, target, count: mine.filter((p) => p.position === pos).length }));
}

// ---------- 트레이드 ----------
const sumBy = (list, fn) => list.reduce((s, p) => s + fn(p), 0);
const label = (ratio) => (ratio >= 1.1 ? 'good' : ratio >= 0.95 ? 'even' : 'bad');

/** 받은 제안의 이득/손해 힌트: 우리 구단 관점의 가치(teamWorth)와 연봉·인원 변화 */
export function offerHint(offer, league, ctx, rules, managerId) {
  const incoming = sumBy(offer.give, (p) => teamWorth(p, managerId, league, ctx, rules));
  const outgoing = sumBy(offer.get, (p) => teamWorth(p, managerId, league, ctx, rules));
  const ratio = outgoing > 0 ? incoming / outgoing : Infinity;
  return {
    incoming, outgoing, ratio, tone: label(ratio),
    payrollDelta: round1(sumBy(offer.give, (p) => p.contract.salaryEok) - sumBy(offer.get, (p) => p.contract.salaryEok)),
    countDelta: offer.give.length - offer.get.length
  };
}

/** 선택한 제안·내가 먼저 건 제안이 같은 선수를 쓰는지: 이미 쓰인 선수 id 집합 */
export function usedPlayerIds(offers, acceptedIds, proposals) {
  const used = new Set();
  for (const o of offers) if (acceptedIds.has(o.id)) { o.give.forEach((p) => used.add(p.id)); o.get.forEach((p) => used.add(p.id)); }
  for (const t of proposals) { t.giveA.forEach((id) => used.add(id)); t.giveB.forEach((id) => used.add(id)); }
  return used;
}

// ---------- 재계약 ----------
/**
 * 재계약 미리 보기. offers: { [선수id]: { salaryEok, years } } (고른 선수만).
 * 엔진처럼 가치 높은 선수부터 차례로: 캡 → 선수의 수락 여부(offerScore, 이미 재계약한 선수가 로스터에 들어간다).
 * 반환: Map(선수id → { status: 'none' | 'ok' | 'refuse' | 'cap', verdict }) 와 재계약 후 연봉 합계
 */
export function resignPlan(expiring, offers, players, ctx, rules, managerId) {
  const staying = players.filter((p) => p.teamId === managerId && p.contract.yearsLeft > 0);
  const kept = [...staying];
  let payroll = payrollEok(staying, managerId);
  const out = new Map();
  for (const p of [...expiring].sort((a, b) => valueOf(b) - valueOf(a))) {
    const o = offers[p.id];
    if (!o) { out.set(p.id, { status: 'none' }); continue; }
    if (!capAllows(payroll, o.salaryEok, rules, { isManager: true })) { out.set(p.id, { status: 'cap' }); continue; }
    const verdict = offerScore(p, o.salaryEok, managerId, domesticOf(kept, managerId), ctx, rules);
    if (!verdict.accept) { out.set(p.id, { status: 'refuse', verdict }); continue; }
    payroll += o.salaryEok;
    kept.push({ ...p, contract: { salaryEok: o.salaryEok, yearsLeft: o.years } });
    out.set(p.id, { status: 'ok', verdict });
  }
  return { byId: out, payroll };
}

/** 선수가 수락하는 가장 낮은 제안(0.1억 단위). 위로 요구액의 1.8배까지 찾고 없으면 null */
export function minAcceptSalary(p, teamId, roster, ctx, rules, round = 1, demand = demandEok(p)) {
  for (let s = Math.max(0.3, round1(demand * 0.85)); s <= demand * 1.8 + 1e-9; s = round1(s + 0.1)) {
    if (offerScore(p, s, teamId, roster, ctx, rules, round).accept) return s;
  }
  return null;
}

// ---------- FA ----------
/** 이번 라운드 제안 계획의 캡 검사(엔진처럼 가치 높은 선수부터, 모두 수락했다고 가정) */
export function faPlan(pool, offers, players, rules, managerId) {
  let payroll = payrollEok(players, managerId);
  let count = domesticOf(players, managerId).length;
  const byId = new Map();
  const picked = pool.filter((p) => offers[p.id]).sort((a, b) => valueOf(b) - valueOf(a));
  for (const p of picked) {
    const o = offers[p.id];
    if (count >= rules.roster.domestic) { byId.set(p.id, 'full'); continue; }
    if (!capAllows(payroll, o.salaryEok, rules, { isManager: true })) { byId.set(p.id, 'cap'); continue; }
    payroll += o.salaryEok; count++; byId.set(p.id, 'ok');
  }
  return { byId, payroll, count, penalty: softCapPenaltyEok(payroll, rules) };
}

/** FA 보상: 우리가 영입하면 원소속 구단에 내는 보상 문구용 값. 해당 없으면 null */
export const compensationText = (p, rules) => compensationFor(p, rules);

// ---------- 보상 선택 ----------
/** 보상선수로 내줄 수 있는 선수: 국내 선수 중 가치 상위 N명(보호선수)과 방금 영입한 선수를 뺀 나머지 */
export function compensationCandidates(players, signedId, managerId, rules) {
  const mine = domesticOf(players, managerId);
  const protectedIds = new Set([...mine].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, rules.transactions.compensation.protectedPlayers).map((p) => p.id));
  return { protectedIds, eligible: mine.filter((p) => !protectedIds.has(p.id) && p.id !== signedId).sort((a, b) => valueOf(a) - valueOf(b)) };
}

// ---------- 드래프트 ----------
/** 신인 목록을 점수순으로: 점수 = 잠재력 60% + 현재 40% + 포지션 필요도(엔진 AI와 같은 식). rank 1이 추천 */
export function draftRanking(available, roster) {
  return available.map((p) => {
    const need = needBonus(roster, p.position);
    return { p, need, score: p.potential * 0.6 + p.ovr * 0.4 + need };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
}

export { preferredYears, demandEok, valueOf };
