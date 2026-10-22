// 구단 자금 장부: 시즌 수입 − 선수단 연봉 − 소프트캡 기금. FA 보상금도 여기서 오간다.
import { payrollEok, asiaPayrollEok, foreignPayrollUsd, softCapPenaltyEok } from './valuation.mjs';

export function initialFunds(teamData, rules) {
  return Object.fromEntries(teamData.map((t) => [t.id, rules.transactions.funds.start]));
}

// 플레이오프에서 어디까지 갔는지 → 보너스 키
function playoffStage(teamId, playoffs) {
  if (!playoffs) return null;
  if (playoffs.championId === teamId) return '우승';
  const final = playoffs.series.at(-1);
  if ([final.higherId, final.lowerId].includes(teamId)) return '결승';
  const semis = playoffs.series.slice(2, 4);
  if (semis.some((s) => [s.higherId, s.lowerId].includes(teamId))) return '4강';
  if (playoffs.series.slice(0, 2).some((s) => [s.higherId, s.lowerId].includes(teamId))) return '6강';
  return null;
}

/** 시즌 정산. 반환: { funds, ledger } (ledger = 구단별 수입·지출 내역) */
export function settleSeason(funds, players, standings, playoffs, teamData, rules, prestige = null) {
  const f = rules.transactions.funds;
  const next = { ...funds };
  const ledger = {};
  const games = rules.regularSeasonGames;
  for (const t of teamData) {
    const rec = standings.find((s) => s.id === t.id);
    const stage = playoffStage(t.id, playoffs);
    // 팬 기반: 전통 점수(0~1, 0.5가 중립)가 높은 구단은 기본 수입이 늘고 낮으면 준다
    const fanFactor = 1 + f.prestigeSpread * ((prestige?.[t.id]?.score ?? 0.5) - 0.5);
    const revenue = f.revenueBase * fanFactor + f.revenuePerWinPct * (rec.wins / games) + (stage ? f.playoffBonus[stage] : 0);
    const domestic = payrollEok(players, t.id);
    const payroll = domestic + asiaPayrollEok(players, t.id) + foreignPayrollUsd(players, t.id) * f.foreignUsdToEok;
    const penalty = softCapPenaltyEok(domestic, rules);
    const net = revenue - payroll - penalty;
    next[t.id] = Math.round((next[t.id] + net) * 100) / 100;
    ledger[t.id] = { revenue: Math.round(revenue * 100) / 100, payroll: Math.round(payroll * 100) / 100, penalty, net: Math.round(net * 100) / 100 };
  }
  return { funds: next, ledger };
}

/** 구단 사이 현금 이동 (보상금 등) */
export function transferFunds(funds, fromId, toId, amountEok) {
  const next = { ...funds };
  next[fromId] = Math.round((next[fromId] - amountEok) * 100) / 100;
  next[toId] = Math.round((next[toId] + amountEok) * 100) / 100;
  return next;
}
