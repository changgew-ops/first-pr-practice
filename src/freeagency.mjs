// 계약 협상과 FA 시장.
//  - 재계약: 선수는 요구 연봉 대비 제안 금액·구단 성적·충성도·기분을 보고 수락한다.
//  - FA 시장: 여러 라운드에 걸쳐 AI 구단과 단장이 제안을 내고, 선수는 가장 좋은 제안을 고른다.
//  - FA 보상: 원소속 구단의 전년 보수 순위에 따라 보상금(또는 보상선수)을 낸다 (KBL 2020년 정비 기준).
// 모든 난수는 주입받은 rng로 쓴다.
import { shuffle } from './rng.mjs';
import { executeTrade } from './trade.mjs';
import { transferFunds } from './funds.mjs';
import { fanAppeal } from './fans.mjs';
import {
  domesticOf, payrollEok, hardLimitEok, demandEok, valueOf, needBonus, strategyOf, hash01
} from './valuation.mjs';

const round1 = (v) => Math.round(v * 10) / 10;

/** 선수의 계약 기간 선호: 어릴수록 길게, 노장은 짧게 */
export const preferredYears = (p) => (p.age <= 26 ? 3 : p.age <= 31 ? 2 : 1);

/** 선수가 어떤 제안을 얼마나 마음에 들어 하는지 */
export function offerScore(p, offerEok, teamId, roster, ctx, rules, round = 1) {
  const fa = rules.transactions.freeAgency;
  const demand = demandEok(p, rules) * (1 - fa.demandDropPerRound * (round - 1));
  const ratio = offerEok / demand;
  const winPct = ctx.winPct.get(teamId) ?? 0.5;
  const ovrs = roster.filter((x) => x.id !== p.id).map((x) => x.ovr).sort((a, b) => b - a);
  const starter = p.ovr >= (ovrs[6] ?? 0); // 상위 7명 안이면 출전 기회가 넉넉하다
  const loyalty = teamId === p.prevTeamId || teamId === p.teamId ? fa.loyaltyBonus : 0;
  const mood = (hash01(`${p.id}:${ctx.season}`) - 0.5) * 2 * fa.moodRange;
  const prestige = ctx.prestige?.get(teamId) ?? 0.5; // 명문 구단 선호(전통 점수)
  const fans = ctx.fans?.has(teamId) ? fanAppeal(ctx.fans.get(teamId), rules) : 0; // 팬 열기가 높은 구단은 선수가 조금 더 좋아한다(src/fans.mjs)
  const score = ratio + fa.successWeight * (winPct - 0.5) + fa.prestigeWeight * (prestige - 0.5) + (starter ? fa.starterBonus : 0) + loyalty + mood + fans;
  return { ratio, score, accept: ratio >= fa.minOfferRatio && score >= fa.acceptScore, demand };
}

/** 이 선수와 새 구단이 계약해도 캡 규칙에 맞는지. exempt는 최저·신인급 계약의 면제 */
export function capAllows(payroll, salaryEok, rules, { isManager = false } = {}) {
  const cap = rules.salaryCap.domesticEok;
  const after = payroll + salaryEok;
  if (after <= cap + 1e-9) return true;
  if (after > hardLimitEok(rules) + 1e-9) return false;
  if (salaryEok <= rules.salaryCap.soft.exemptContractEok + 1e-9) return true;
  return isManager; // 캡 초과 영입(소프트캡 기금 부담)은 단장이 직접 결정할 때만
}

/** 협상하는 해(새 시즌의 시작 연도)에 맞는 보상 규정: { tiers, protectedPlayers, exemptAge }. 기본은 현재 규정 */
export function compensationRule(rules, year = Infinity) {
  const c = rules.transactions.compensation;
  return year < (c.effectiveFromYear ?? 0) && c.legacy ? c.legacy : c;
}

/** 원소속 구단 전년 보수 순위 → 보상 규정(등급 A/B/C). 해당 없으면 null. year: 새 시즌 시작 연도 */
export function compensationFor(p, rules, year = Infinity) {
  if (!p.prevTeamId || !p.prevRank) return null;
  const rule = compensationRule(rules, year);
  if (rule.exemptAge != null && p.age >= rule.exemptAge) return null;
  const tier = rule.tiers.find((t) => p.prevRank <= t.maxRank);
  if (!tier) return null;
  const base = p.prevSalaryEok;
  return {
    grade: tier.grade ?? null,
    tierMaxRank: tier.maxRank,
    cashOnly: round1(base * tier.cashOnlyRatio),
    withPlayerCash: tier.withPlayerCashRatio != null ? round1(base * tier.withPlayerCashRatio) : null
  };
}

/** FA 계약기간 범위 [최소, 최대]: 전년도 보수 30위 이내는 3~5년(만 32세 이상 예외), 나머지는 5년 이하 */
export function yearsRange(p, rules) {
  const c = rules.transactions.freeAgency.contract;
  if (!c) return [1, 4];
  const top = p.prevRank != null && p.prevRank <= c.topRank && p.age < c.minYearsExemptAge;
  return [top ? c.topMinYears : 1, c.maxYears];
}

const years = (p, rng, rules) => { const [lo, hi] = yearsRange(p, rules); return Math.max(lo, Math.min(hi, preferredYears(p) + (rng() < 0.2 ? 1 : 0))); };

/**
 * FA 시장 진행.
 * state: { players, pool, funds }, ctx: { season, ranks, winPct, managerTeamId }, policy(선택):
 *   policy.freeAgency({ round, pool, state, demandNow, lastResults }) → [{ playerId, salaryEok, years }]  (단장의 제안; lastResults: 지난 라운드 우리 제안의 결과)
 *   policy.compensation({ player, options, state }) → { type: 'cash' } | { type: 'player', playerId }
 * 반환: { players, pool, funds, signings, compensations }
 */
export function runFreeAgency(state, teamData, ctx, rules, rng, policy = null) {
  const fa = rules.transactions.freeAgency;
  const slotsMax = rules.roster.domestic;
  let players = [...state.players];
  let pool = [...state.pool];
  let funds = { ...state.funds };
  const signings = [];
  const compensations = [];
  const roundResults = new Map(); // 라운드 → 단장 제안 결과
  const offerResults = [];
  const teamIds = teamData.map((t) => t.id);

  const usedNumber = (teamId) => new Set(players.filter((p) => p.teamId === teamId).map((p) => p.number));
  const freeNumber = (teamId, want) => {
    const used = usedNumber(teamId);
    if (!used.has(want)) return want;
    for (let n = 0; n <= 99; n++) if (!used.has(n)) return n;
    throw new Error('등번호가 부족합니다');
  };

  for (let round = 1; round <= fa.rounds; round++) {
    const demandNow = (p) => demandEok(p, rules) * (1 - fa.demandDropPerRound * (round - 1));
    const offersFor = new Map(); // playerId → [{ teamId, salaryEok, years }]
    const add = (playerId, offer) => { (offersFor.get(playerId) ?? offersFor.set(playerId, []).get(playerId)).push(offer); };

    // AI 구단의 제안
    for (const teamId of shuffle(teamIds, rng)) {
      if (teamId === ctx.managerTeamId && policy?.freeAgency) continue; // 단장이 직접 운영
      const roster = domesticOf(players, teamId);
      const slots = slotsMax - roster.length;
      if (slots <= 0 || (funds[teamId] ?? 0) < fa.reserveFundsEok) continue;
      const payroll = payrollEok(players, teamId);
      const strat = strategyOf(ctx.ranks.get(teamId) ?? 5, teamIds.length);
      const premium = (strat === 'contend' ? fa.contenderPremium : 0) + (round - 1) * fa.aiRaisePerRound;
      const cands = [];
      for (const p of pool) {
        if (p.origin !== 'domestic' || p.prevTeamId === teamId) continue; // 자기가 놓아준 선수는 다시 잡지 않는다
        const salary = round1(demandNow(p) * (1 + premium));
        if (!capAllows(payroll, salary, rules)) continue;
        const comp = compensationFor(p, rules, ctx.season + 1);
        const cost = comp ? comp.cashOnly : 0;
        const utility = valueOf(p) + needBonus(roster, p.position) - fa.priceWeight * salary - fa.compensationWeight * cost;
        cands.push({ p, salary, utility });
      }
      cands.sort((a, b) => b.utility - a.utility);
      for (const c of cands.slice(0, fa.offersPerTeamPerRound)) add(c.p.id, { teamId, salaryEok: c.salary, years: years(c.p, rng, rules) });
    }

    // 단장의 제안
    const mgrOffers = []; // 결과 기록용: { o: 단장이 낸 제안, off: 시장에 들어간 제안 }
    const poolStart = new Map(pool.map((p) => [p.id, p]));
    if (policy?.freeAgency && ctx.managerTeamId) {
      const mine = policy.freeAgency({ round, pool, state: { players, funds }, demandNow, lastResults: roundResults.get(round - 1) ?? null }) ?? [];
      const poolById = new Map(pool.map((p) => [p.id, p]));
      for (const o of mine) {
        if (!poolById.has(o.playerId)) continue;
        const [lo, hi] = yearsRange(poolById.get(o.playerId), rules);
        const off = { teamId: ctx.managerTeamId, salaryEok: o.salaryEok, years: Math.max(lo, Math.min(hi, o.years ?? 2)), manager: true };
        add(o.playerId, off);
        mgrOffers.push({ o, off });
      }
    }

    // 선수는 가치가 높은 순서로 제안을 고른다
    const evalOf = new Map(); // 단장 제안의 평가(기록용): 제안 객체 → { why, score, ratio, demand }
    const signedNow = new Map(); // 이번 라운드에 계약한 선수 → { teamId, score, salaryEok, years }
    const order = [...pool].sort((a, b) => valueOf(b) - valueOf(a));
    for (const p of order) {
      const offers = offersFor.get(p.id);
      if (!offers) continue;
      let best = null;
      for (const o of offers) {
        const roster = domesticOf(players, o.teamId);
        if (roster.length >= slotsMax) { if (o.manager) evalOf.set(o, { why: 'roster' }); continue; }
        if (!capAllows(payrollEok(players, o.teamId), o.salaryEok, rules, { isManager: Boolean(o.manager) })) { if (o.manager) evalOf.set(o, { why: 'cap' }); continue; }
        const r = offerScore(p, o.salaryEok, o.teamId, roster, ctx, rules, round);
        if (o.manager) evalOf.set(o, { score: r.score, ratio: r.ratio, demand: r.demand, accept: r.accept });
        if (r.accept && (!best || r.score > best.score)) best = { ...o, score: r.score };
      }
      if (!best) continue;
      signedNow.set(p.id, { teamId: best.teamId, score: best.score, salaryEok: best.salaryEok, years: best.years });

      const comp = best.teamId !== p.prevTeamId ? compensationFor(p, rules, ctx.season + 1) : null;
      const signed = {
        ...p, teamId: best.teamId, number: freeNumber(best.teamId, p.number),
        contract: { salaryEok: best.salaryEok, yearsLeft: best.years }
      };
      const from = p.prevTeamId;
      delete signed.prevTeamId; delete signed.prevSalaryEok; delete signed.prevRank;
      players = [...players, signed];
      pool = pool.filter((x) => x.id !== p.id);

      let compInfo = null;
      if (comp && from) {
        let choice = { type: 'cash' };
        if (best.teamId === ctx.managerTeamId && policy?.compensation && comp.withPlayerCash != null) {
          choice = policy.compensation({ player: signed, options: comp, state: { players, funds } }) ?? choice;
        }
        const protectedIds = new Set([...domesticOf(players, best.teamId)].sort((a, b) => valueOf(b) - valueOf(a))
          .slice(0, compensationRule(rules, ctx.season + 1).protectedPlayers).map((x) => x.id));
        const target = choice.type === 'player' ? players.find((x) => x.id === choice.playerId) : null;
        if (choice.type === 'player' && target && target.teamId === best.teamId && target.origin === 'domestic'
          && !protectedIds.has(target.id) && target.id !== signed.id) {
          funds = transferFunds(funds, best.teamId, from, comp.withPlayerCash);
          players = executeTrade({ players }, { teamA: best.teamId, teamB: from, giveA: [target.id], giveB: [] }).players;
          compInfo = { from, to: best.teamId, type: 'player', cashEok: comp.withPlayerCash, playerId: target.id };
        } else {
          funds = transferFunds(funds, best.teamId, from, comp.cashOnly);
          compInfo = { from, to: best.teamId, type: 'cash', cashEok: comp.cashOnly };
        }
        compensations.push({ playerId: p.id, ...compInfo });
      }
      signings.push({
        id: p.id, name: p.name, teamId: best.teamId, from: from ?? null, salaryEok: best.salaryEok, years: best.years,
        round, manager: Boolean(best.manager), compensation: compInfo
      });
    }

    // 이번 라운드 단장 제안의 결과(왜 됐고 왜 안 됐는지). 계산은 기록뿐이고 결과에는 영향이 없다
    if (mgrOffers.length) {
      const list = mgrOffers.map(({ o, off }) => {
        const p = poolStart.get(o.playerId), ev = evalOf.get(off) ?? {}, won = signedNow.get(o.playerId);
        const base = { round, playerId: o.playerId, name: p.name, salaryEok: off.salaryEok, years: off.years, demandEok: round1(ev.demand ?? demandNow(p)) };
        if (won?.teamId === ctx.managerTeamId) return { ...base, status: 'accepted' };
        if (won) return { ...base, status: 'lost', teamId: won.teamId, theirSalaryEok: won.salaryEok, myScore: ev.score ?? null, theirScore: round1(won.score * 100) / 100 };
        if (ev.why) return { ...base, status: ev.why };
        if (ev.ratio < fa.minOfferRatio) return { ...base, status: 'low', ratio: Math.round(ev.ratio * 100) / 100, minRatio: fa.minOfferRatio, minSalaryEok: round1(ev.demand * fa.minOfferRatio + 0.05) };
        return { ...base, status: 'score', score: Math.round(ev.score * 100) / 100, need: fa.acceptScore };
      });
      roundResults.set(round, list);
      offerResults.push(...list);
    }
  }
  return { players, pool, funds, signings, compensations, offerResults };
}
