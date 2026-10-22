// 시즌 중 트레이드 화면의 순수 로직(브라우저 API 없음, node에서 테스트한다).
import { teamWorth, validateTrade } from '../../src/trade.mjs';
import { domesticOf, payrollEok, hardLimitEok } from '../../src/valuation.mjs';

/** 트레이드 창 상태: { open, headline, detail } */
export function windowStatus(session) {
  const deadline = session.tradeDeadline;
  if (session.stage === 'offseason') return { open: false, headline: '오프시즌입니다', detail: '시즌 중 트레이드는 정규리그 도중에만 가능합니다. 오프시즌의 트레이드 제안은 오프시즌 화면에서 받습니다.' };
  if (session.stage === 'playoffs') return { open: false, headline: '플레이오프 중입니다', detail: `트레이드는 정규리그 ${deadline}일차까지만 가능했습니다.` };
  if (!session.tradeOpen) return { open: false, headline: '트레이드가 마감되었습니다', detail: `마감은 정규리그 ${deadline}일차입니다(현재 ${session.day}일차). 다음 시즌 오프시즌에 다시 열립니다.` };
  const left = deadline - session.day;
  return {
    open: true,
    headline: session.day === 0 ? '시즌 시작 전 · 트레이드 가능' : `${session.day}일차 · 트레이드 가능`,
    detail: left > 0 ? `마감은 ${deadline}일차, 앞으로 ${left}경기일 남았습니다.` : `오늘이 마지막입니다. ${deadline}일차를 넘기면 마감됩니다.`
  };
}

/** 시즌 중 트레이드가 가능한 우리·상대 선수: 국내 선수만(외국·아시아쿼터 불가) */
export const tradablePlayers = (players, teamId) => domesticOf(players, teamId);

/** 선수 묶음의 연봉 합(억) */
export const salaryOf = (list) => list.reduce((s, p) => s + p.contract.salaryEok, 0);

/**
 * 우리 입장에서 본 제안의 가치 비교. incoming = 우리가 받는 선수, outgoing = 우리가 보내는 선수.
 * 반환: { incoming, outgoing, ratio, tone: 'good'|'even'|'bad', label }
 */
export function valueComparison(incomingPlayers, outgoingPlayers, managerId, league, ctx, rules) {
  const sum = (list) => list.reduce((s, p) => s + teamWorth(p, managerId, league, ctx, rules), 0);
  const incoming = sum(incomingPlayers);
  const outgoing = sum(outgoingPlayers);
  const ratio = outgoing > 0 ? incoming / outgoing : Infinity;
  const tone = ratio >= 1.1 ? 'good' : ratio >= 0.9 ? 'even' : 'bad';
  const label = { good: '우리에게 이득', even: '비슷한 거래', bad: '우리에게 손해' }[tone];
  return { incoming, outgoing, ratio, tone, label };
}

/** 거래 뒤 연봉(국내): { mine, theirs, over } — 소프트캡 초과 여부는 규칙 검사(validateTrade)가 따로 알려 준다 */
export function payrollAfter(players, trade, rules) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
  const a = payrollEok(players, trade.teamA) - salaryOf(out(trade.giveA)) + salaryOf(out(trade.giveB));
  const b = payrollEok(players, trade.teamB) - salaryOf(out(trade.giveB)) + salaryOf(out(trade.giveA));
  return { mine: a, theirs: b, cap: rules.salaryCap.domesticEok, hardLimit: hardLimitEok(rules), overCap: a > rules.salaryCap.domesticEok };
}

/** 제안 전에 규칙으로 미리 확인: 오류 문장 배열(없으면 빈 배열). 고르는 중이라 비어 있는 선택은 안내 문구를 돌려준다 */
export function precheck(league, trade, rules, day) {
  if (!trade.giveA.length && !trade.giveB.length) return { errors: [], idle: true };
  if (trade.giveA.length !== trade.giveB.length) return { errors: [`시즌 중에는 같은 인원끼리만 교환할 수 있습니다 (우리 ${trade.giveA.length}명 ↔ 상대 ${trade.giveB.length}명)`], idle: false };
  const r = validateTrade(league, trade, rules, { window: 'season', day });
  return { errors: r.errors, idle: false };
}

/** AI가 거절했을 때 보여 줄 문구. verdict = { margin, accept } (margin = AI가 받는 가치 ÷ AI가 보내는 가치) */
export function rejectionText(result, rules, teamName) {
  if (result.executed) return null;
  const need = rules.transactions.trade.acceptMargin;
  if (result.verdict && Number.isFinite(result.verdict.margin)) {
    const m = result.verdict.margin;
    return `${teamName}가 거절했습니다. 가치 비율 ${m.toFixed(2)} — ${need.toFixed(2)} 이상이어야 받아들입니다(핵심 선수를 내놓는 거래는 더 높게 요구).`;
  }
  return result.reason ?? '거래가 성사되지 않았습니다';
}

/** 구단의 국내 선수를 OVR 높은 순으로 */
export const byOvr = (list) => [...list].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name, 'ko'));
