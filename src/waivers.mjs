// 웨이버(공시) 절차의 규칙. 순수 함수만 둔다(진행기 src/season-run.mjs가 부른다).
//  - 규약 제101조 ①: 공시기간 중 여러 구단이 양수 신청하면 전 시즌 정규 경기 순위의 역순으로 계약 우선권을 갖는다.
//  - 규약 제101조 ②: 웨이버 선수를 영입한 구단은 영입일로부터 30일 이내에 그 선수를 웨이버 조치할 수 없다(rules.waivers.reWaiverLockGames로 환산).
//  - 공시기간 길이·AI의 양수 판단은 규정에 없어 게임용 가정이다(data/league-rules.json `waivers`, _note).
// 웨이버 상태 하나(entry) = { player(방출 당시 계약을 그대로 가진 선수), fromTeamId, day(공시한 날), expires(마감 경기일), mine(우리 구단이 양수 신청함) }
import { domesticOf, payrollEok, valueOf, needBonus, demandEok } from './valuation.mjs';
import { capAllows } from './freeagency.mjs';

export const waiversOn = (rules) => Boolean(rules.waivers?.enabled);

/** 직전 시즌 정규 순위: 전통 기록(legacy)의 마지막 시즌 승률 내림차순(같으면 구단 id). Map<구단 id, 순위> */
export function priorRanks(legacy, teamIds) {
  const wp = (id) => {
    const list = legacy?.[id];
    return list?.length ? list[list.length - 1].winPct : 0.5;
  };
  return new Map([...teamIds].sort((a, b) => wp(b) - wp(a) || a.localeCompare(b)).map((id, i) => [id, i + 1]));
}

/** 양수 우선권 순서(제101조 ①): 전 시즌 순위의 역순, 곧 성적이 나빴던 구단부터 */
export const claimOrder = (ranks) => [...ranks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);

/** 새 웨이버 공시. 선수 객체의 계약(salaryEok·yearsLeft)은 양수한 구단이 그대로 이어받는다 */
export function newWaiver(player, fromTeamId, day, rules) {
  const { xp, ...rest } = player; // 남은 훈련 경험치는 사라진다(방출과 같다)
  return { player: { ...rest, teamId: null }, fromTeamId, day, expires: day + rules.waivers.periodGames, mine: false };
}

/** 공시 중 선수의 남은 경기일 */
export const waiverLeft = (entry, day) => Math.max(0, entry.expires - day);

/** 단장(사람)이나 일반 구단이 이 공시 선수를 양수할 수 있는지 — 정원·캡. swapOut이 있으면 그 선수가 나간다고 보고 따진다 */
export function claimCheck({ players, entry, teamId, rules, isManager = false, swapOut = null }) {
  const p = entry.player;
  if (p.origin !== 'domestic') return { ok: false, reason: '국내 선수만 양수할 수 있습니다' };
  if (teamId === entry.fromTeamId) return { ok: false, reason: '공시한 구단은 같은 선수를 다시 양수할 수 없습니다(게임용 단순화)' };
  const mine = domesticOf(players, teamId).filter((x) => x.id !== swapOut?.id);
  if (mine.length >= rules.roster.domestic) return { ok: false, reason: `국내 선수가 이미 ${rules.roster.domestic}명입니다. 먼저 한 명을 방출하거나 트레이드로 정리하세요` };
  const payroll = mine.reduce((s, x) => s + x.contract.salaryEok, 0);
  if (!capAllows(payroll, p.contract.salaryEok, rules, { isManager })) return { ok: false, reason: `양수하면 연봉 총액이 샐러리캡 한도(소프트캡 상한)를 넘습니다(계약 연봉 ${p.contract.salaryEok.toFixed(1)}억을 이어받습니다)` };
  return { ok: true, reason: null };
}

/**
 * AI 구단의 양수 판단: { swapOut } 또는 null. 구단 국내 선수 중 가치가 가장 낮은 선수(worst)와 비교해
 * (가치 + 포지션 필요 보너스)가 minGain 이상 높고, 계약 연봉이 요구 연봉의 maxSalaryRatio배 이하일 때만 양수한다.
 * 정원이 찼으면 worst를 내보내는 조건으로(allowSwap) 양수하고, 재웨이버 금지 기간 중인 선수는 내보내지 않는다.
 */
export function aiClaimPlan({ players, entry, teamId, rules, day }) {
  const cfg = rules.waivers.aiClaim;
  const p = entry.player;
  if (p.origin !== 'domestic' || teamId === entry.fromTeamId) return null;
  if (p.contract.salaryEok > demandEok(p, rules) * cfg.maxSalaryRatio + 1e-9) return null;
  const roster = domesticOf(players, teamId);
  const candidates = roster.filter((x) => !(x.claimLockUntil > day));
  const worst = [...candidates].sort((a, b) => valueOf(a) - valueOf(b) || a.id.localeCompare(b.id))[0] ?? null;
  const others = worst ? roster.filter((x) => x.id !== worst.id) : roster;
  const gain = valueOf(p) + needBonus(others, p.position) - (worst ? valueOf(worst) : 0);
  if (gain < cfg.minGain) return null;
  const full = roster.length >= rules.roster.domestic;
  if (!full) return claimCheck({ players, entry, teamId, rules }).ok ? { swapOut: null } : null;
  if (!cfg.allowSwap || !worst) return null;
  return claimCheck({ players, entry, teamId, rules, swapOut: worst }).ok ? { swapOut: worst } : null;
}

/**
 * 마감된 공시의 결과: { winner(구단 id | null), swapOut, mineFailed(우리가 신청했지만 못 얻은 이유 | null) }.
 * order: 양수 우선권 순서(claimOrder). 단장이 신청했으면(entry.mine) 우선권 차례에 검증해 통과하면 그 구단이 얻는다.
 */
export function resolveWaiver({ players, entry, order, manager, rules, day }) {
  let mineFailed = null;
  for (const teamId of order) {
    if (teamId === manager) {
      if (!entry.mine) continue;
      const c = claimCheck({ players, entry, teamId, rules, isManager: true });
      if (c.ok) return { winner: teamId, swapOut: null, mineFailed: null };
      mineFailed = c.reason;
      continue;
    }
    const plan = aiClaimPlan({ players, entry, teamId, rules, day });
    if (plan) return { winner: teamId, swapOut: plan.swapOut, mineFailed: entry.mine && !mineFailed ? '우선권이 앞선 구단이 먼저 양수했습니다' : mineFailed };
  }
  return { winner: null, swapOut: null, mineFailed };
}

/** 양수한 선수: 이어받은 계약 그대로 새 구단·등번호, 영입일로부터 재웨이버 금지 기간(제101조 ②) */
export function claimedPlayer(entry, { teamId, number, day, rules }) {
  return { ...entry.player, teamId, number, claimLockUntil: day + rules.waivers.reWaiverLockGames };
}
