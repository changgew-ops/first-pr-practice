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

// ---------- 관중 상태: 구단별 팬 기반(fan)과 리그 전체 관중 규모(index) ----------
// 2023-24 KBL 집계(data/history/attendance-2023-24.json)에서 구단별 팬 기반의 출발값을 정하고(rules.revenue.gate.fanBase),
// 해마다 성적(승률·플레이오프)에 따라 ±하며 원래 값 쪽으로 서서히 돌아온다. 리그 전체 규모는 평균회귀 + 작은 무작위 변동이다.
// 상태는 league.att = { index, fan: { [구단 id]: 값 } }. 없으면(이전 저장) 출발값으로 만든다.
export function initialAttendance(teamData, rules) {
  const g = rules.revenue.gate;
  return { index: 1, fan: Object.fromEntries(teamData.map((t) => [t.id, g.fanBase?.[t.id] ?? g.fanBaseDefault])) };
}

/** 한 시즌이 끝난 뒤의 관중 상태: 구단별 팬 기반(승률·플레이오프 성적으로 ±, 출발값 쪽으로 복귀)과 리그 규모 */
export function advanceAttendance(att, { standings, playoffs, teamData, season }, rules) {
  const g = rules.revenue.gate, up = g.fanGrowth;
  const fan = {};
  for (const t of teamData) {
    const rec = standings.find((r) => r.id === t.id);
    const winPct = rec ? rec.wins / Math.max(1, rec.wins + rec.losses) : 0.5;
    const stage = playoffStage(t.id, playoffs);
    const growth = clamp(up.perWinPct * (winPct - 0.5) + (up.stage[stage ?? 'none'] ?? 0), -up.maxDown, up.maxUp);
    const anchor = g.fanBase?.[t.id] ?? g.fanBaseDefault;
    const next = att.fan[t.id] * (1 + growth) + g.fanReversion * (anchor - att.fan[t.id]);
    fan[t.id] = round2(clamp(next, anchor * g.fanMin, anchor * g.fanMax));
  }
  // 리그 전체 규모 = 완만한 장기 상승(attendanceTrend, 물가·시장 성장) × 흔들림. 흔들림은 평균회귀 + 작은 변동이고(같은 시즌 결과면 같은 값),
  // 변동폭은 과거 표에서 코로나·진행 중 시즌을 뺀 연간 변동의 표준편차 약 9%를 따랐다(rules.revenue._note). 상한 attendanceCap.
  const rv = rules.revenue;
  const trend = (y) => (1 + rv.attendanceTrend) ** (y - rv.startYear);
  const dev = att.index / trend(season);
  const noise = mulberry32(hashString(`att-league:${season}:${standings.map((r) => `${r.id}${r.wins}`).join(',')}`))();
  const devNext = clamp(dev + g.leagueReversion * (1 - dev) + (noise - 0.5) * 2 * g.leagueNoise, g.leagueMin, g.leagueMax);
  const index = Math.min(rv.attendanceCap, trend(season + 1) * devNext);
  return { index: Math.round(index * 1000) / 1000, fan };
}

/** 물가 지수: 시작 시즌(rules.revenue.startYear, 2026-27)이 1.0이고 해마다 inflation만큼 오른다. 시즌 연도에서 바로 계산하므로 결정적이다 */
export function priceIndex(season, rules) {
  const rv = rules.revenue;
  return (1 + rv.inflation) ** Math.max(0, season - rv.startYear);
}

/** 구단 인기 지수(그 해의 관중 규모 배수): 팬 기반 × 올해 승률 효과. 구단별 관중 수를 따로 정해 두지 않는다 */
export function popularity(fan, winPct, rules) {
  const g = rules.revenue.gate;
  return clamp(fan * (1 + g.inSeasonWin * (winPct - 0.5)), g.minFactor, g.maxFactor);
}

/** 관중 한 명이 낸 평균 입장료(만 원): 좌석 등급별 가격대와 비중, 유료 비율. priceMul: 플레이오프 가격 배수 */
export function ticketYieldMan(pop, rules, priceMul = 1) {
  const g = rules.revenue.gate;
  const t = clamp(0.5 + g.priceTilt * (pop - 1), 0.15, 0.85);
  const perHead = g.tiers.reduce((s, tier) => s + tier.share * (tier.priceMan[0] + (tier.priceMan[1] - tier.priceMan[0]) * t), 0);
  return perHead * g.paidRatio * priceMul;
}

/** 홈 경기 한 번의 관중: 같은 입력이면 같은 값. venue 수용 인원이 있으면 상한(매진). 반환 { attendance, demand, sellout } */
export function attendanceFor({ season, teamId, key, pop, oppPop = 1, weight = 1, capacity = null, scale = 1 }, rules) {
  const g = rules.revenue.gate;
  const rng = mulberry32(hashString(`${season}:${teamId}:att:${key}`));
  const day = 1 + (rng() - 0.5) * 2 * g.dayJitter; // 요일·날씨 같은 경기별 변동
  const opp = 1 + g.oppSpread * (oppPop - 1);
  const demand = g.leagueAvgAttendance * scale * pop * day * opp * weight;
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

/** 수입 계산(억 원). ctx.att: 관중 상태(없으면 출발값). 반환: { parts: { gate, playoffGate, broadcast, sponsor, merch, playoffBonus }, revenue, attendance: {…} } */
export function revenueOf(teamId, ctx, rules) {
  const { team, teamData, rec, stage, playoffs, prestige, season = 0 } = ctx;
  const att = ctx.att ?? initialAttendance(teamData, rules);
  const f = rules.transactions.funds, rv = rules.revenue;
  const score = prestige?.[teamId]?.score ?? 0.5;
  const winPct = rec.wins / Math.max(1, rec.wins + rec.losses);
  const pop = popularity(att.fan[teamId] ?? 1, winPct, rules);
  const cap = capacityOf(team);
  const meanFan = Object.values(att.fan).reduce((s, v) => s + v, 0) / Math.max(1, Object.keys(att.fan).length);
  const popOf = (id) => (att.fan[id] ?? 1) / meanFan;
  const pi = priceIndex(season, rules); // 물가: 객단가·중계권·스폰서·굿즈에 곱한다
  const yieldMan = ticketYieldMan(pop, rules) * pi;
  let total = 0, sellouts = 0, gate = 0;
  const games = homeOpponents(teamId, teamData, rules);
  games.forEach((opp, i) => {
    const a = attendanceFor({ season, teamId, key: `r${i}`, pop, oppPop: popOf(opp), capacity: cap, scale: att.index }, rules);
    total += a.attendance; if (a.sellout) sellouts++;
    gate += a.attendance * yieldMan * MAN;
  });
  let playoffGate = 0, poGames = 0, poPeople = 0;
  for (const g of playoffHomeGames(teamId, playoffs)) {
    const w = rv.gate.playoff[g.round === '챔피언결정전' ? '결승' : g.round] ?? rv.gate.playoff['6강'];
    const a = attendanceFor({ season, teamId, key: `p${g.key}`, pop, weight: w.attendance, capacity: cap, scale: att.index }, rules);
    playoffGate += a.attendance * ticketYieldMan(pop, rules, w.price) * pi * MAN;
    poPeople += a.attendance; poGames++; if (a.sellout) sellouts++;
  }
  const parts = {
    gate: round2(gate),
    playoffGate: round2(playoffGate),
    broadcast: round2((rv.broadcast.base + rv.broadcast.perWinPct * winPct) * pi),
    sponsor: round2(rv.sponsor.base * (1 + rv.sponsor.prestigeSpread * (score - rv.gate.prestigeCenter)) * pi),
    merch: round2((rv.merch.base * (1 + rv.merch.prestigeSpread * (pop - 1)) + (stage === '우승' ? rv.merch.titleBonus : 0)) * pi),
    playoffBonus: stage ? f.playoffBonus[stage] : 0
  };
  const revenue = round2(Object.values(parts).reduce((s, v) => s + v, 0));
  return {
    parts, revenue,
    attendance: {
      avg: Math.round(total / games.length), total, homeGames: games.length, sellouts, capacity: cap,
      occupancy: cap ? round2(total / games.length / cap) : null, yieldMan: round2(yieldMan), priceIndex: round2(pi), popularity: round2(pop), fan: round2(att.fan[teamId] ?? 1), leagueIndex: round2(att.index),
      playoffGames: poGames, playoffAvg: poGames ? Math.round(poPeople / poGames) : null
    }
  };
}

/** 시즌 정산. 반환: { funds, ledger, att } (ledger = 구단별 수입·지출 내역: revenue, parts, attendance, payroll, penalty, net. att = 다음 시즌 관중 상태) */
export function settleSeason(funds, players, standings, playoffs, teamData, rules, prestige = null, season = 0, att = null) {
  const f = rules.transactions.funds;
  const next = { ...funds };
  const ledger = {};
  const state = att ?? initialAttendance(teamData, rules);
  for (const t of teamData) {
    const rec = standings.find((s) => s.id === t.id);
    const stage = playoffStage(t.id, playoffs);
    const rev = revenueOf(t.id, { team: t, teamData, rec, stage, playoffs, prestige, season, att: state }, rules);
    const domestic = payrollEok(players, t.id);
    const payroll = domestic + asiaPayrollEok(players, t.id) + foreignPayrollUsd(players, t.id) * f.foreignUsdToEok;
    const penalty = softCapPenaltyEok(domestic, rules);
    const net = rev.revenue - payroll - penalty;
    next[t.id] = round2(next[t.id] + net);
    ledger[t.id] = { revenue: rev.revenue, parts: rev.parts, attendance: rev.attendance, payroll: round2(payroll), penalty, net: round2(net) };
  }
  return { funds: next, ledger, att: advanceAttendance(state, { standings, playoffs, teamData, season }, rules) };
}

/** 지금 상태로 본 이번 시즌 예상 수입(홈 화면용). wins·losses는 지금까지의 성적(없으면 5할), stage는 아직 모르면 null */
export function estimateRevenue(teamId, { teamData, standings, prestige, season, stage = null, att = null }, rules) {
  const rec = standings?.find((s) => s.id === teamId) ?? { wins: 0, losses: 0 };
  const played = rec.wins + rec.losses;
  const r = played >= 6 ? rec : { wins: 1, losses: 1 };
  return revenueOf(teamId, { team: teamData.find((t) => t.id === teamId), teamData, rec: r, stage, playoffs: null, prestige, season, att }, rules);
}

/** 구단 사이 현금 이동 (보상금 등) */
export function transferFunds(funds, fromId, toId, amountEok) {
  const next = { ...funds };
  next[fromId] = Math.round((next[fromId] - amountEok) * 100) / 100;
  next[toId] = Math.round((next[toId] + amountEok) * 100) / 100;
  return next;
}
