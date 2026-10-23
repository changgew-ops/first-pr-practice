// 구단 자금 장부: 시즌 수입(입장·중계권·모기업 스폰서·굿즈·플레이오프) − 선수단 연봉 − 소프트캡 기금. FA 보상금도 여기서 오간다.
// 수입 구성과 관중·입장권 모델은 rules.revenue(게임용 가정, 근거는 그 _note)에 있다. 관중은 경기마다 시드가 같으면 같게 나온다.
import { payrollEok, asiaPayrollEok, foreignPayrollUsd, softCapPenaltyEok } from './valuation.mjs';
import { hashString, mulberry32 } from './rng.mjs';
import { capacityOf } from './arenas.mjs';

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

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MAN = 0.0001; // 1만 원 = 0.0001억 원

/** 구단 인기 지수(1이 리그 평균): 전통 점수와 올해 승률에서 규칙으로 얻는다. 구단별 관중 수를 따로 정해 두지 않는다 */
export function popularity(prestigeScore, winPct, rules) {
  const g = rules.revenue.gate;
  return clamp(1 + g.prestigeSpread * (prestigeScore - g.prestigeCenter) + g.winPctSpread * (winPct - 0.5), g.minFactor, g.maxFactor);
}

/** 관중 한 명이 낸 평균 입장료(만 원): 좌석 등급별 가격대 안에서 인기가 높을수록 비싼 쪽, 유료 비율을 곱한다. priceMul: 플레이오프 가격 배수 */
export function ticketYieldMan(pop, rules, priceMul = 1) {
  const g = rules.revenue.gate;
  const t = clamp(0.5 + g.priceTilt * (pop - 1), 0.15, 0.85);
  const perHead = g.tiers.reduce((s, tier) => s + tier.share * (tier.priceMan[0] + (tier.priceMan[1] - tier.priceMan[0]) * t), 0);
  return perHead * g.paidRatio * priceMul;
}

/** 홈 경기 한 번의 관중: 같은 입력이면 같은 값. venue 수용 인원이 있으면 상한(매진). 반환 { attendance, demand, sellout } */
export function attendanceFor({ season, teamId, key, pop, oppPop = 1, weight = 1, capacity = null }, rules) {
  const g = rules.revenue.gate;
  const rng = mulberry32(hashString(`${season}:${teamId}:att:${key}`));
  const day = 1 + (rng() - 0.5) * 2 * g.dayJitter; // 요일·날씨 같은 경기별 변동
  const opp = 1 + g.oppSpread * (oppPop - 1);
  const demand = g.leagueAvgAttendance * pop * day * opp * weight;
  const attendance = Math.round(capacity != null ? Math.min(capacity, demand) : demand);
  return { attendance, demand: Math.round(demand), sellout: capacity != null && demand >= capacity };
}

/** 한 구단의 정규시즌 홈 경기 상대 목록(상대 구단을 번갈아 돌며 홈 경기 수를 채운다). 실제 일정이 아니라 관중 계산용 */
export function homeOpponents(teamId, teamData, rules) {
  const others = teamData.filter((t) => t.id !== teamId).map((t) => t.id);
  const n = Math.floor(rules.regularSeasonGames / 2);
  return Array.from({ length: n }, (_, i) => others[i % others.length]);
}

/** 플레이오프에서 이 구단이 홈으로 치른 경기: [{ round, key }] */
function playoffHomeGames(teamId, playoffs) {
  const out = [];
  for (const s of playoffs?.series ?? []) (s.games ?? []).forEach((g, i) => { if (g.homeId === teamId) out.push({ round: s.round, key: `${s.round}:${i}` }); });
  return out;
}

/** 수입 계산(억 원). 반환: { parts: { gate, playoffGate, broadcast, sponsor, merch, playoffBonus }, revenue, attendance: {…} } */
export function revenueOf(teamId, ctx, rules) {
  const { team, teamData, rec, stage, playoffs, prestige, season = 0 } = ctx;
  const f = rules.transactions.funds, rv = rules.revenue;
  const score = prestige?.[teamId]?.score ?? 0.5;
  const winPct = rec.wins / Math.max(1, rec.wins + rec.losses);
  const pop = popularity(score, winPct, rules);
  const cap = capacityOf(team);
  const popOf = (id) => popularity(prestige?.[id]?.score ?? 0.5, 0.5, rules);
  const yieldMan = ticketYieldMan(pop, rules);
  let total = 0, sellouts = 0, gate = 0;
  const games = homeOpponents(teamId, teamData, rules);
  games.forEach((opp, i) => {
    const a = attendanceFor({ season, teamId, key: `r${i}`, pop, oppPop: popOf(opp), capacity: cap }, rules);
    total += a.attendance; if (a.sellout) sellouts++;
    gate += a.attendance * yieldMan * MAN;
  });
  let playoffGate = 0, poGames = 0, poPeople = 0;
  for (const g of playoffHomeGames(teamId, playoffs)) {
    const w = rv.gate.playoff[g.round === '챔피언결정전' ? '결승' : g.round] ?? rv.gate.playoff['6강'];
    const a = attendanceFor({ season, teamId, key: `p${g.key}`, pop, weight: w.attendance, capacity: cap }, rules);
    playoffGate += a.attendance * ticketYieldMan(pop, rules, w.price) * MAN;
    poPeople += a.attendance; poGames++; if (a.sellout) sellouts++;
  }
  const parts = {
    gate: round2(gate),
    playoffGate: round2(playoffGate),
    broadcast: round2(rv.broadcast.base + rv.broadcast.perWinPct * winPct),
    sponsor: round2(rv.sponsor.base * (1 + rv.sponsor.prestigeSpread * (score - rv.gate.prestigeCenter))),
    merch: round2(rv.merch.base * (1 + rv.merch.prestigeSpread * (pop - 1)) + (stage === '우승' ? rv.merch.titleBonus : 0)),
    playoffBonus: stage ? f.playoffBonus[stage] : 0
  };
  const revenue = round2(Object.values(parts).reduce((s, v) => s + v, 0));
  return {
    parts, revenue,
    attendance: {
      avg: Math.round(total / games.length), total, homeGames: games.length, sellouts, capacity: cap,
      occupancy: cap ? round2(total / games.length / cap) : null, yieldMan: round2(yieldMan), popularity: round2(pop),
      playoffGames: poGames, playoffAvg: poGames ? Math.round(poPeople / poGames) : null
    }
  };
}

/** 시즌 정산. 반환: { funds, ledger } (ledger = 구단별 수입·지출 내역: revenue, parts, attendance, payroll, penalty, net) */
export function settleSeason(funds, players, standings, playoffs, teamData, rules, prestige = null, season = 0) {
  const f = rules.transactions.funds;
  const next = { ...funds };
  const ledger = {};
  for (const t of teamData) {
    const rec = standings.find((s) => s.id === t.id);
    const stage = playoffStage(t.id, playoffs);
    const rev = revenueOf(t.id, { team: t, teamData, rec, stage, playoffs, prestige, season }, rules);
    const domestic = payrollEok(players, t.id);
    const payroll = domestic + asiaPayrollEok(players, t.id) + foreignPayrollUsd(players, t.id) * f.foreignUsdToEok;
    const penalty = softCapPenaltyEok(domestic, rules);
    const net = rev.revenue - payroll - penalty;
    next[t.id] = round2(next[t.id] + net);
    ledger[t.id] = { revenue: rev.revenue, parts: rev.parts, attendance: rev.attendance, payroll: round2(payroll), penalty, net: round2(net) };
  }
  return { funds: next, ledger };
}

/** 지금 상태로 본 이번 시즌 예상 수입(홈 화면용). wins·losses는 지금까지의 성적(없으면 5할), stage는 아직 모르면 null */
export function estimateRevenue(teamId, { teamData, standings, prestige, season, stage = null }, rules) {
  const rec = standings?.find((s) => s.id === teamId) ?? { wins: 0, losses: 0 };
  const played = rec.wins + rec.losses;
  const r = played >= 6 ? rec : { wins: 1, losses: 1 };
  return revenueOf(teamId, { team: teamData.find((t) => t.id === teamId), teamData, rec: r, stage, playoffs: null, prestige, season }, rules);
}

/** 구단 사이 현금 이동 (보상금 등) */
export function transferFunds(funds, fromId, toId, amountEok) {
  const next = { ...funds };
  next[fromId] = Math.round((next[fromId] - amountEok) * 100) / 100;
  next[toId] = Math.round((next[toId] + amountEok) * 100) / 100;
  return next;
}
