// 홈의 "올 시즌 목표" 카드가 쓰는 읽기 전용 계산: 세션의 지금 상태에서 목표별 진행 상황을 만든다. 화면에 그리는 일은 views/goals-card.js.
import { describeGoal, goalProgress, trustTier } from '../../src/goals.mjs';
import { estimateRevenue } from '../../src/funds.mjs';
import { payrollEok, asiaPayrollEok, foreignPayrollUsd, softCapPenaltyEok } from '../../src/valuation.mjs';
import { prestigeOf } from './game.js';

const PO_ROUND_STAGE = { '6강': '6강', '4강': '4강', '챔피언결정전': '결승' };

/** 우리 팀이 플레이오프에서 도달한 단계('6강'|'4강'|'결승'|'우승'|null) */
function reachedStage(po, my) {
  if (!po) return null;
  if (po.done && po.result().championId === my) return '우승';
  let best = null;
  const order = ['6강', '4강', '결승'];
  for (const s of po.series) {
    if (s.higherId !== my && s.lowerId !== my) continue;
    const st = PO_ROUND_STAGE[s.round];
    if (st && (best == null || order.indexOf(st) > order.indexOf(best))) best = st;
  }
  return best;
}

/** 지금 시점의 목표 진행: { goals: [{ ...goal, title, unit, ratio, now, state }], live } — 시즌 도중에만 의미가 있다 */
export function liveGoals(ctx) {
  const { session, data, game } = ctx;
  const goals = session.goals;
  if (!goals) return null;
  const my = session.managerId;
  const rules = session.rules;
  const st = session.standings().find((r) => r.id === my);
  const players = session.players;
  const est = estimateRevenue(my, { teamData: data.teams, standings: session.standings(), prestige: prestigeOf(game, data), season: game.league.season, att: game.league.att ?? null }, rules);
  const domestic = payrollEok(players, my);
  const payroll = domestic + asiaPayrollEok(players, my) + foreignPayrollUsd(players, my) * rules.transactions.funds.foreignUsdToEok;
  const totals = session.run?.totals ?? new Map();
  const youth = players.filter((p) => p.teamId === my && p.age <= rules.goals.extra.youthMaxAge).reduce((s, p) => s + (totals.get(p.id)?.minutes ?? 0), 0);
  const po = session.playoffs;
  const live = {
    rank: st?.rank ?? 10, wins: st?.wins ?? 0, losses: st?.losses ?? 0, played: session.day, total: session.totalDays,
    regularDone: session.regularDone, stage: reachedStage(po, my), poStarted: Boolean(po), poDone: Boolean(po?.done), poAlive: session.playoffStatus() === 'alive',
    net: est.revenue - payroll - softCapPenaltyEok(domestic, rules), payrollRatio: domestic / rules.salaryCap.domesticEok, youthMinutes: youth
  };
  return { goals: goals.map((g) => ({ ...g, ...describeGoal(g), ...goalProgress(g, live) })), live };
}

export { trustTier };
