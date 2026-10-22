// 시즌 종료 처리: 노화·성장 → 은퇴 → 계약 만료(재계약/FA) → 신인 드래프트 → 로스터 정리.
// 이전 게임(카드야구 매니지먼트)의 "젊으면 성장, 나이 들면 노쇠, 나이에 따른 확률 은퇴, 시즌 후 드래프트" 구조를
// 농구에 맞게 가져왔다. FA 시장(AI 간 경쟁)과 트레이드는 이적 단계에서 확장하고, 여기서는 단순한 자동 처리만 한다.
import { STAT_KEYS, calcOvr, calcCost } from './rating.mjs';
import { createFactory, FOREIGN_POSITIONS, POSITIONS, DOMESTIC_SLOTS, rarityOf, rawSalaryEok, clamp } from './factory.mjs';

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
const domesticOf = (players, teamId) => players.filter((p) => p.teamId === teamId && p.origin === 'domestic');
const foreignOf = (players, teamId) => players.filter((p) => p.teamId === teamId && p.origin === 'foreign');
const salaryTotal = (list) => list.reduce((s, p) => s + p.contract.salaryEok, 0);
const renewSalary = (ovr, off) => Math.floor(rawSalaryEok(ovr) * off.renewSalaryFactor * 10) / 10;
const EPS = 1e-9;

// 선수 가치: 현재 능력 + 성장 여지(젊을수록 크게) − 노쇠
function value(p) {
  const room = Math.max(0, p.potential - p.ovr);
  const youth = p.age <= 24 ? 0.5 : p.age <= 27 ? 0.25 : 0;
  return p.ovr + room * youth - Math.max(0, p.age - 31) * 0.8;
}

/**
 * 시즌 종료 처리.
 * league: { season, players, freeAgents, nextId, usedNames }
 * standings: 정규리그 최종 순위 (드래프트 순서용, 하위 팀부터 지명)
 * 반환: { league: 다음 시즌 상태, report }
 */
export function runOffseason(league, standings, teamData, rules, rng) {
  const off = rules.offseason;
  const usedNames = new Set(league.usedNames);
  const f = createFactory(rng, rules, usedNames);
  let nextId = league.nextId;
  const newId = () => `y${league.season + 1}-${String(nextId++).padStart(4, '0')}`;
  const report = { season: league.season, retired: [], progressed: [], renewed: [], expired: [], drafted: [], released: [], signed: [], foreignReplaced: [] };

  const avg = (list, fn) => (list.length ? list.reduce((s, p) => s + fn(p), 0) / list.length : 0);
  report.before = { avgOvr: avg(league.players, (p) => p.ovr), avgAge: avg(league.players, (p) => p.age) };

  // 1) 노화·성장 + 은퇴
  const keep = [];
  const progressAll = (list, rosterLabel) => {
    const out = [];
    for (const old of list) {
      const p = progressPlayer(old, rules, rng);
      const quits = p.origin === 'foreign'
        ? p.age > rules.aging.foreignMaxAge
        : rng() < retireProbability(p.age, p.ovr, rules.aging);
      if (quits) {
        report.retired.push({ id: p.id, name: p.name, teamId: p.teamId, age: p.age, ovr: p.ovr, from: rosterLabel });
        continue;
      }
      report.progressed.push({ id: p.id, name: p.name, teamId: p.teamId, age: p.age, from: old.ovr, to: p.ovr });
      out.push(p);
    }
    return out;
  };
  const active = progressAll(league.players, 'team');
  let pool = progressAll(league.freeAgents, 'fa');

  // 2) 계약 만료: 국내는 재계약 확률·샐러리캡을 보고 결정, 못 한 선수는 FA 풀로
  const byTeam = new Map(teamData.map((t) => [t.id, []]));
  for (const p of active) byTeam.get(p.teamId).push({ ...p, contract: { ...p.contract, yearsLeft: p.contract.yearsLeft - 1 } });

  const next = [];
  for (const team of teamData) {
    const roster = byTeam.get(team.id);
    const staying = roster.filter((p) => p.contract.yearsLeft > 0);
    const expiring = roster.filter((p) => p.contract.yearsLeft <= 0);
    let domesticSalary = salaryTotal(staying.filter((p) => p.origin === 'domestic'));
    for (const p of staying) next.push(p);

    for (const p of expiring.filter((q) => q.origin === 'domestic').sort((a, b) => b.ovr - a.ovr)) {
      const prob = clamp(off.renewBase + (p.ovr - 50) * off.renewPerOvr, off.renewMin, off.renewMax);
      const salary = renewSalary(p.ovr, off);
      if (rng() < prob && domesticSalary + salary <= rules.salaryCap.domesticEok + EPS) {
        domesticSalary += salary;
        const years = f.randInt(off.contractYears[0], off.contractYears[1]);
        next.push({ ...p, contract: { salaryEok: salary, yearsLeft: years } });
        report.renewed.push({ id: p.id, name: p.name, teamId: team.id, salaryEok: salary, years });
      } else {
        pool.push({ ...p, teamId: null, contract: { yearsLeft: 0 } });
        report.expired.push({ id: p.id, name: p.name, teamId: team.id, ovr: p.ovr });
      }
    }
    for (const p of expiring.filter((q) => q.origin === 'foreign')) {
      if (rng() < off.foreignRenewProbability) {
        const years = f.randInt(1, 2);
        next.push({ ...p, contract: { salaryUsd: p.contract.salaryUsd, yearsLeft: years } });
        report.renewed.push({ id: p.id, name: p.name, teamId: team.id, years });
      } else {
        report.expired.push({ id: p.id, name: p.name, teamId: team.id, ovr: p.ovr, foreign: true });
      }
    }
  }

  // 3) 신인 드래프트: 하위 팀부터 라운드마다 지명
  const nextYear = league.season + 1;
  const takenNumbers = (teamId) => new Set(next.filter((p) => p.teamId === teamId).map((p) => p.number));
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
  const targetCount = Object.fromEntries(POSITIONS.map((pos) => [pos, DOMESTIC_SLOTS.filter((x) => x === pos).length]));
  for (let round = 0; round < dr.rounds; round++) {
    for (const teamId of order) {
      const mine = next.filter((p) => p.teamId === teamId && p.origin === 'domestic');
      const room = rules.salaryCap.domesticEok - salaryTotal(mine);
      const salary = Math.max(off.rookieSalaryEok.min, Math.round((off.rookieSalaryEok.first - pickNo * off.rookieSalaryEok.dropPerPick) * 10) / 10);
      if (room + EPS < salary || prospects.length === 0) { pickNo++; continue; }
      const need = (pos) => { const c = mine.filter((p) => p.position === pos).length; return c === 0 ? 6 : c < targetCount[pos] ? 2 : 0; };
      let bestIdx = 0;
      let bestScore = -Infinity;
      prospects.forEach((p, i) => {
        const score = p.potential * 0.6 + p.ovr * 0.4 + need(p.position);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      });
      const [pick] = prospects.splice(bestIdx, 1);
      const signed = { ...pick, teamId, number: freeNumber(teamId), contract: { salaryEok: salary, yearsLeft: dr.rookieYears } };
      next.push(signed);
      report.drafted.push({ id: signed.id, name: signed.name, teamId, pick: pickNo + 1, ovr: signed.ovr, potential: signed.potential, position: signed.position });
      pickNo++;
    }
  }
  pool.push(...prospects); // 지명받지 못한 선수는 FA 풀로

  // 4) 로스터 정리: 국내 12명을 넘으면 방출, 모자라면 FA에서 영입 (포지션 균형 우선)
  const releaseOne = (teamId) => {
    const mine = next.filter((p) => p.teamId === teamId && p.origin === 'domestic');
    const counts = Object.fromEntries(POSITIONS.map((pos) => [pos, mine.filter((p) => p.position === pos).length]));
    const candidates = mine.filter((p) => counts[p.position] > 1);
    const target = [...candidates].sort((a, b) => value(a) - value(b))[0];
    next.splice(next.indexOf(target), 1);
    pool.push({ ...target, teamId: null, contract: { yearsLeft: 0 } });
    report.released.push({ id: target.id, name: target.name, teamId });
  };
  const signOne = (teamId) => {
    const mine = next.filter((p) => p.teamId === teamId && p.origin === 'domestic');
    const room = rules.salaryCap.domesticEok - salaryTotal(mine);
    const need = (pos) => { const c = mine.filter((p) => p.position === pos).length; return c === 0 ? 8 : c < targetCount[pos] ? 2 : 0; };
    const options = pool.filter((p) => p.origin === 'domestic' && renewSalary(p.ovr, off) <= room + EPS);
    let chosen;
    if (options.length) {
      chosen = options.reduce((b, p) => (value(p) + need(p.position) > value(b) + need(b.position) ? p : b));
      pool.splice(pool.indexOf(chosen), 1);
    } else {
      // 영입할 FA가 없으면 최저 연봉의 신인급 선수를 새로 만든다
      const position = [...POSITIONS].sort((a, b) => mine.filter((p) => p.position === a).length - mine.filter((p) => p.position === b).length)[0];
      const stats = f.makeStats(position, 46);
      const ovr = calcOvr(position, stats);
      chosen = {
        id: newId(), name: f.uniqueName('domestic'), real: false, position, age: f.randInt(21, 27), number: 0,
        rarity: rarityOf(ovr, ovr), stats, ovr, cost: calcCost(ovr), potential: ovr, origin: 'domestic', teamId: null,
        contract: { yearsLeft: 0 }, assets: { portrait: null, model: null }
      };
    }
    const salary = options.includes(chosen) ? renewSalary(chosen.ovr, off) : off.emergencySalaryEok;
    const signed = { ...chosen, teamId, number: freeNumber(teamId), contract: { salaryEok: salary, yearsLeft: f.randInt(1, 2) } };
    next.push(signed);
    report.signed.push({ id: signed.id, name: signed.name, teamId, ovr: signed.ovr });
  };
  for (const team of teamData) {
    while (domesticOf(next, team.id).length > rules.roster.domestic) releaseOne(team.id);
    while (domesticOf(next, team.id).length < rules.roster.domestic) signOne(team.id);
  }

  // 5) 외국 선수: 부족하면 새로 영입 (리그 외국 선수 평균 수준, 샐러리캡 안에서)
  const foreignAll = next.filter((p) => p.origin === 'foreign');
  const foreignMean = foreignAll.length ? avg(foreignAll, (p) => p.ovr) : 70;
  for (const team of teamData) {
    while (foreignOf(next, team.id).length < rules.roster.foreign) {
      const mine = foreignOf(next, team.id);
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
      next.push(p);
      report.foreignReplaced.push({ id: p.id, name: p.name, teamId: team.id, ovr: p.ovr });
    }
  }

  // 6) FA 풀은 상위 일부만 유지 (국내 선수 위주)
  pool = pool.filter((p) => p.origin === 'domestic').sort((a, b) => value(b) - value(a)).slice(0, off.freeAgentPoolMax);

  report.after = { avgOvr: avg(next, (p) => p.ovr), avgAge: avg(next, (p) => p.age) };
  const nextLeague = { ...league, season: nextYear, players: next, freeAgents: pool, nextId, usedNames: [...usedNames] };
  return { league: nextLeague, report };
}
