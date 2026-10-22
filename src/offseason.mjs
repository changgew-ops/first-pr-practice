// 시즌 종료 처리. 순서:
//   1) 노화·성장 → 은퇴          (이전 게임의 "젊으면 성장·나이 들면 노쇠·확률 은퇴" 구조를 농구에 맞게 조정)
//   2) 트레이드 창               (계약이 끝나는 선수를 두고 AI 구단의 제안이 오고, 단장이 응답한다)
//   3) 재계약 협상               (선수는 제안 금액·구단 성적·충성도를 보고 수락한다. 못 한 선수는 FA로)
//   4) FA 시장                   (여러 라운드, AI 구단과 단장이 경쟁. 원소속 구단에 FA 보상)
//   5) 신인 드래프트
//   6) 로스터 확정               (인원 정리·보충)
// 단장(options.manager)의 결정은 options.policy 콜백으로 받고, 콜백이 없으면 AI와 같은 자동 규칙을 쓴다.
import { STAT_KEYS, calcOvr, calcCost } from './rating.mjs';
import { createFactory, FOREIGN_POSITIONS, POSITIONS, rarityOf, clamp } from './factory.mjs';
import {
  domesticOf, foreignOf, payrollEok, valueOf, demandEok, needBonus, hardLimitEok
} from './valuation.mjs';
import { offerScore, capAllows, preferredYears, runFreeAgency } from './freeagency.mjs';
import { generateOffers, validateTrade, executeTrade, proposeTrade } from './trade.mjs';
import { initialFunds } from './funds.mjs';

const PHYSICAL = ['athletic', 'stamina'];
const SKILLS = ['shooting', 'passing', 'defense', 'rebound'];

// ---------- 노화·성장 ----------
export function retireProbability(age, ovr, aging) {
  const base = aging.retirement.find(([minAge]) => age >= minAge)[1];
  const lowBoost = 1 + Math.max(0, aging.lowOvrRetireRef - ovr) / aging.lowOvrRetireDivisor;
  return Math.min(1, base * lowBoost);
}

function withRatings(p, stats, extra = {}) {
  const ovr = calcOvr(p.position, stats);
  const potential = p.age >= 27 ? ovr : Math.max(ovr, p.potential);
  return { ...p, ...extra, stats, ovr, cost: calcCost(ovr), potential, rarity: rarityOf(ovr, potential) };
}

/** 나이를 한 살 올리고 성장·노쇠를 적용한 새 선수 객체를 돌려준다 */
export function progressPlayer(p, rules, rng) {
  const a = rules.aging;
  const age = p.age + 1;
  const stats = { ...p.stats };
  const gap = Math.max(0, p.potential - p.ovr);
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  for (const k of STAT_KEYS) {
    let delta = 0;
    if (age <= a.growthMaxAge) {
      if (gap > 0) {
        const factor = age <= 22 ? 1 : a.lateGrowthFactor;
        const maxStep = clamp(1 + gap / a.growthGapDivisor, 1, a.growthMaxStep) * factor;
        delta = Math.round(rng() * maxStep);
      }
    } else if (age < a.physicalDeclineFrom) {
      delta = ri(-a.peakJitter, a.peakJitter);
    } else if (PHYSICAL.includes(k)) {
      delta = -(age >= a.lateDeclineFrom ? ri(1, 4) : ri(1, 2)); // 신체 능력이 먼저 떨어진다
    } else if (age >= a.lateDeclineFrom) {
      delta = -ri(0, 2);
    } else if (age >= a.skillDeclineFrom) {
      delta = -ri(0, 1);
    } else {
      delta = ri(-a.peakJitter, a.peakJitter);
    }
    stats[k] = clamp(stats[k] + delta, 20, rules.stats.max);
  }
  const next = withRatings({ ...p, age }, stats);
  delete next.xp; // 남은 훈련 경험치는 한 해가 지나면 사라진다
  return next;
}

// ---------- 공용 보조 ----------
const EPS = 1e-9;
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * 시즌 종료 처리.
 * league: { season, players, freeAgents, nextId, usedNames, funds }
 * standings: 정규리그 최종 순위 (드래프트 순서·구단 성향용)
 * options.manager: 단장이 맡은 구단 id, options.policy: 단장의 의사결정 콜백 (아래 참고)
 *   policy.trade({ offers, league, ctx })                 → 수락할 제안 id 배열
 *   policy.proposals({ league, ctx })                     → 단장이 먼저 거는 트레이드 배열
 *   policy.resign({ expiring, league, ctx })              → { [선수id]: { salaryEok, years } | null(재계약 안 함) }
 *   policy.freeAgency({ round, pool, state, demandNow })  → [{ playerId, salaryEok, years }]
 *   policy.compensation({ player, options, state })       → { type: 'cash' } | { type: 'player', playerId }
 *   policy.draft({ available, team })                     → 지명할 신인 id
 * 반환: { league: 다음 시즌 상태, report }
 */
export function runOffseason(league, standings, teamData, rules, rng, options = {}) {
  const { manager = null, policy = null } = options;
  const off = rules.offseason;
  const usedNames = new Set(league.usedNames);
  const f = createFactory(rng, rules, usedNames);
  let nextId = league.nextId;
  const newId = () => `y${league.season + 1}-${String(nextId++).padStart(4, '0')}`;
  const ranks = new Map(standings.map((s, i) => [s.id, i + 1]));
  const winPct = new Map(standings.map((s) => [s.id, s.wins / Math.max(1, s.wins + s.losses)]));
  const ctx = { season: league.season, ranks, winPct, managerTeamId: manager, teamCount: teamData.length };
  let funds = league.funds ?? initialFunds(teamData, rules);
  const report = {
    season: league.season, retired: [], progressed: [], renewed: [], expired: [], refused: [], drafted: [], released: [],
    signed: [], foreignReplaced: [], trades: [], tradeOffers: [], signings: [], compensations: []
  };
  const avg = (list, fn) => (list.length ? list.reduce((s, p) => s + fn(p), 0) / list.length : 0);
  report.before = { avgOvr: avg(league.players, (p) => p.ovr), avgAge: avg(league.players, (p) => p.age) };

  // 1) 노화·성장 + 은퇴
  const progressAll = (list, label) => {
    const out = [];
    for (const old of list) {
      const p = progressPlayer(old, rules, rng);
      const quits = p.origin === 'foreign' ? p.age > rules.aging.foreignMaxAge : rng() < retireProbability(p.age, p.ovr, rules.aging);
      if (quits) {
        report.retired.push({ id: p.id, name: p.name, teamId: p.teamId, age: p.age, ovr: p.ovr, from: label });
        continue;
      }
      report.progressed.push({ id: p.id, name: p.name, teamId: p.teamId, age: p.age, from: old.ovr, to: p.ovr });
      out.push(p);
    }
    return out;
  };
  let players = progressAll(league.players, 'team').map((p) => ({ ...p, contract: { ...p.contract, yearsLeft: p.contract.yearsLeft - 1 } }));
  let pool = progressAll(league.freeAgents, 'fa');

  // 지난 시즌 국내 선수 보수 순위 (FA 보상 기준)
  const salaryRank = new Map([...players].filter((p) => p.origin === 'domestic')
    .sort((a, b) => b.contract.salaryEok - a.contract.salaryEok).map((p, i) => [p.id, i + 1]));

  // 2) 트레이드 창: 계약이 끝나는 선수를 노린 제안이 온다
  if (manager) {
    let work = { ...league, players };
    const offers = generateOffers(work, manager, ctx, rules, rng, { window: 'offseason' });
    report.tradeOffers = offers.map((o) => ({ id: o.id, teamId: o.teamId, give: o.give.map((p) => p.id), get: o.get.map((p) => p.id), expiringTarget: o.expiringTarget }));
    const accepted = new Set(policy?.trade ? policy.trade({ offers, league: work, ctx }) : []);
    for (const o of offers) {
      if (!accepted.has(o.id)) continue;
      if (!validateTrade(work, o.trade, rules, { window: 'offseason' }).ok) continue;
      work = executeTrade(work, o.trade);
      report.trades.push({ with: o.teamId, received: o.give.map((p) => p.id), sent: o.get.map((p) => p.id), source: 'offer' });
    }
    for (const t of policy?.proposals ? policy.proposals({ league: work, ctx }) : []) {
      const r = proposeTrade(work, t, ctx, rules, { window: 'offseason' });
      report.trades.push({ with: t.teamA === manager ? t.teamB : t.teamA, executed: r.executed, reason: r.reason ?? null, source: 'proposal', trade: t });
      work = r.league;
    }
    players = work.players;
  }

  // 3) 재계약 협상
  const kept = [];
  const rosterOf = (list, teamId) => list.filter((p) => p.teamId === teamId && p.origin === 'domestic');
  const toPool = (p, teamId) => {
    pool.push({ ...p, teamId: null, contract: { yearsLeft: 0 }, prevTeamId: teamId, prevSalaryEok: p.contract.salaryEok, prevRank: salaryRank.get(p.id) ?? 999 });
    report.expired.push({ id: p.id, name: p.name, teamId, ovr: p.ovr, foreign: p.origin === 'foreign' });
  };
  for (const team of teamData) {
    const mine = players.filter((p) => p.teamId === team.id);
    const staying = mine.filter((p) => p.contract.yearsLeft > 0);
    const expiring = mine.filter((p) => p.contract.yearsLeft <= 0);
    kept.push(...staying);
    let payroll = payrollEok(staying, team.id);
    const isManager = team.id === manager;
    const decisions = isManager && policy?.resign
      ? policy.resign({ expiring: expiring.filter((p) => p.origin === 'domestic'), league: { ...league, players }, ctx }) ?? {}
      : null;

    for (const p of expiring.filter((q) => q.origin === 'domestic').sort((a, b) => valueOf(b) - valueOf(a))) {
      let offer = null;
      if (decisions) {
        const d = decisions[p.id];
        if (d) offer = { salaryEok: d.salaryEok, years: d.years ?? preferredYears(p) };
      } else {
        const wantProb = clamp(off.renewBase + (p.ovr - 50) * off.renewPerOvr, off.renewMin, off.renewMax);
        if (rng() < wantProb) offer = { salaryEok: demandEok(p), years: f.randInt(off.contractYears[0], off.contractYears[1]) };
      }
      if (!offer) { toPool(p, team.id); continue; }
      if (!capAllows(payroll, offer.salaryEok, rules, { isManager })) { toPool(p, team.id); continue; }
      const verdict = offerScore(p, offer.salaryEok, team.id, rosterOf(kept, team.id), ctx, rules);
      if (!verdict.accept) {
        report.refused.push({ id: p.id, name: p.name, teamId: team.id, offerEok: offer.salaryEok, demandEok: verdict.demand });
        toPool(p, team.id);
        continue;
      }
      payroll += offer.salaryEok;
      kept.push({ ...p, contract: { salaryEok: offer.salaryEok, yearsLeft: offer.years } });
      report.renewed.push({ id: p.id, name: p.name, teamId: team.id, salaryEok: offer.salaryEok, years: offer.years });
    }
    for (const p of expiring.filter((q) => q.origin === 'foreign')) {
      if (rng() < off.foreignRenewProbability) {
        const years = f.randInt(1, 2);
        kept.push({ ...p, contract: { salaryUsd: p.contract.salaryUsd, yearsLeft: years } });
        report.renewed.push({ id: p.id, name: p.name, teamId: team.id, years });
      } else {
        report.expired.push({ id: p.id, name: p.name, teamId: team.id, ovr: p.ovr, foreign: true });
      }
    }
  }
  players = kept;

  // 4) FA 시장
  const market = runFreeAgency({ players, pool, funds }, teamData, ctx, rules, rng, policy);
  players = market.players; pool = market.pool; funds = market.funds;
  report.signings = market.signings; report.compensations = market.compensations;

  // 5) 신인 드래프트: 하위 팀부터 라운드마다 지명 (신인 계약은 캡 면제, 한도는 캡 × 1.2)
  const takenNumbers = (teamId) => new Set(players.filter((p) => p.teamId === teamId).map((p) => p.number));
  const freeNumber = (teamId) => {
    const used = takenNumbers(teamId);
    for (let i = 0; i < 300; i++) { const n = f.randInt(0, 45); if (!used.has(n)) return n; }
    throw new Error('등번호가 부족합니다');
  };
  const dr = off.draft;
  const prospects = [];
  for (let i = 0; i < dr.poolSize; i++) {
    const position = POSITIONS[i % POSITIONS.length];
    const age = f.randInt(dr.ageRange[0], dr.ageRange[1]);
    const target = clamp(dr.topOvr - i * dr.ovrDropPerPick + f.rand(-3, 3), 38, 66);
    const stats = f.makeStats(position, target);
    const ovr = calcOvr(position, stats);
    const potential = clamp(ovr + f.randInt(dr.potentialBonus[0], dr.potentialBonus[1]) + Math.round((dr.poolSize - i) * 0.15), ovr, rules.stats.max);
    prospects.push({
      id: newId(), name: f.uniqueName('domestic'), real: false, position, age, number: 0,
      rarity: rarityOf(ovr, potential), stats, ovr, cost: calcCost(ovr), potential, origin: 'domestic', teamId: null,
      contract: { yearsLeft: 0 }, assets: { portrait: null, model: null }
    });
  }
  const order = [...standings].reverse().map((s) => s.id);
  let pickNo = 0;
  for (let round = 0; round < dr.rounds; round++) {
    for (const teamId of order) {
      const mine = domesticOf(players, teamId);
      const salary = Math.max(off.rookieSalaryEok.min, round1(off.rookieSalaryEok.first - pickNo * off.rookieSalaryEok.dropPerPick));
      pickNo++;
      if (prospects.length === 0 || mine.length >= rules.roster.domestic + 2) continue;
      if (payrollEok(players, teamId) + salary > hardLimitEok(rules) + EPS) continue;
      let idx;
      if (teamId === manager && policy?.draft) {
        idx = prospects.findIndex((p) => p.id === policy.draft({ available: prospects, team: teamId }));
      }
      if (idx === undefined || idx < 0) {
        let bestScore = -Infinity;
        prospects.forEach((p, i) => {
          const score = p.potential * 0.6 + p.ovr * 0.4 + needBonus(mine, p.position);
          if (score > bestScore) { bestScore = score; idx = i; }
        });
      }
      const [pick] = prospects.splice(idx, 1);
      const signed = { ...pick, teamId, number: freeNumber(teamId), contract: { salaryEok: salary, yearsLeft: dr.rookieYears } };
      players.push(signed);
      report.drafted.push({ id: signed.id, name: signed.name, teamId, pick: pickNo, ovr: signed.ovr, potential: signed.potential, position: signed.position });
    }
  }
  pool.push(...prospects.map((p) => ({ ...p })));

  // 6) 로스터 확정: 국내 12명을 넘으면 방출, 모자라면 FA에서 영입 (포지션 균형 우선)
  const releaseOne = (teamId) => {
    const mine = domesticOf(players, teamId);
    const counts = Object.fromEntries(POSITIONS.map((pos) => [pos, mine.filter((p) => p.position === pos).length]));
    const target = [...mine.filter((p) => counts[p.position] > 1)].sort((a, b) => valueOf(a) - valueOf(b))[0];
    players.splice(players.indexOf(target), 1);
    pool.push({ ...target, teamId: null, contract: { yearsLeft: 0 } });
    report.released.push({ id: target.id, name: target.name, teamId });
  };
  const signOne = (teamId) => {
    const mine = domesticOf(players, teamId);
    const payroll = payrollEok(players, teamId);
    const price = (p) => round1(demandEok(p));
    const options = pool.filter((p) => p.origin === 'domestic' && capAllows(payroll, price(p), rules));
    let chosen;
    let salary;
    if (options.length) {
      chosen = options.reduce((b, p) => (valueOf(p) + needBonus(mine, p.position, 8) > valueOf(b) + needBonus(mine, b.position, 8) ? p : b));
      pool.splice(pool.indexOf(chosen), 1);
      salary = price(chosen);
    } else {
      // 캡 여유 안에서 영입할 FA가 없으면 최저 연봉(캡 면제)의 신인급 선수를 새로 만든다
      const position = [...POSITIONS].sort((a, b) => mine.filter((p) => p.position === a).length - mine.filter((p) => p.position === b).length)[0];
      const stats = f.makeStats(position, 46);
      const ovr = calcOvr(position, stats);
      chosen = {
        id: newId(), name: f.uniqueName('domestic'), real: false, position, age: f.randInt(21, 27), number: 0,
        rarity: rarityOf(ovr, ovr), stats, ovr, cost: calcCost(ovr), potential: ovr, origin: 'domestic', teamId: null,
        contract: { yearsLeft: 0 }, assets: { portrait: null, model: null }
      };
      salary = off.emergencySalaryEok;
    }
    const signed = { ...chosen, teamId, number: freeNumber(teamId), contract: { salaryEok: salary, yearsLeft: f.randInt(1, 2) } };
    for (const k of ['prevTeamId', 'prevSalaryEok', 'prevRank']) delete signed[k];
    players.push(signed);
    report.signed.push({ id: signed.id, name: signed.name, teamId, ovr: signed.ovr });
  };
  for (const team of teamData) {
    while (domesticOf(players, team.id).length > rules.roster.domestic) releaseOne(team.id);
    while (domesticOf(players, team.id).length < rules.roster.domestic) signOne(team.id);
  }

  // 외국 선수: 부족하면 새로 영입 (리그 외국 선수 평균 수준, 샐러리캡 안에서)
  const foreignAll = players.filter((p) => p.origin === 'foreign');
  const foreignMean = foreignAll.length ? avg(foreignAll, (p) => p.ovr) : 70;
  for (const team of teamData) {
    while (foreignOf(players, team.id).length < rules.roster.foreign) {
      const mine = foreignOf(players, team.id);
      const left = rules.salaryCap.foreignUsdTotal - mine.reduce((s, p) => s + p.contract.salaryUsd, 0);
      const slotsAfter = rules.roster.foreign - mine.length - 1;
      const maxHere = Math.min(rules.salaryCap.foreignUsdPerPlayer, left - slotsAfter * 200000);
      const usd = Math.floor(f.rand(Math.min(250000, maxHere), maxHere) / 10000) * 10000;
      const position = f.pick(FOREIGN_POSITIONS);
      const stats = f.makeStats(position, foreignMean + f.rand(-4, 6));
      const ovr = calcOvr(position, stats);
      const age = f.randInt(24, 33);
      const p = {
        id: newId(), name: f.uniqueName('foreign'), real: false, position, age, number: freeNumber(team.id),
        rarity: rarityOf(ovr, ovr), stats, ovr, cost: calcCost(ovr), potential: f.makePotential(age, ovr), origin: 'foreign',
        teamId: team.id, contract: { salaryUsd: usd, yearsLeft: f.randInt(1, 2) }, assets: { portrait: null, model: null }
      };
      players.push(p);
      report.foreignReplaced.push({ id: p.id, name: p.name, teamId: team.id, ovr: p.ovr });
    }
  }

  // FA 풀은 상위 일부만 유지 (국내 선수 위주). 이전 구단 정보는 새 시즌에 필요 없다
  pool = pool.filter((p) => p.origin === 'domestic').sort((a, b) => valueOf(b) - valueOf(a)).slice(0, off.freeAgentPoolMax)
    .map((p) => { const q = { ...p }; for (const k of ['prevTeamId', 'prevSalaryEok', 'prevRank']) delete q[k]; return q; });

  report.after = { avgOvr: avg(players, (p) => p.ovr), avgAge: avg(players, (p) => p.age) };
  return { league: { ...league, season: league.season + 1, players, freeAgents: pool, nextId, usedNames: [...usedNames], funds }, report };
}
