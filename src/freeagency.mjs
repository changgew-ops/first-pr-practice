// 계약 협상과 FA 시장.
//  - 재계약: 선수는 요구 연봉 대비 제안 금액·구단 성적·충성도·기분을 보고 수락한다.
//  - FA 시장: 여러 라운드에 걸쳐 AI 구단과 단장이 제안을 내고, 선수는 가장 좋은 제안을 고른다.
//  - FA 보상: 원소속 구단의 전년 보수 순위에 따라 보상금(또는 보상선수)을 낸다 (KBL 2020년 정비 기준).
// 모든 난수는 주입받은 rng로 쓴다.
import { shuffle } from './rng.mjs';
import { executeTrade } from './trade.mjs';
import { transferFunds } from './funds.mjs';
import {
  domesticOf, payrollEok, hardLimitEok, demandEok, valueOf, needBonus, strategyOf, hash01
} from './valuation.mjs';

const round1 = (v) => Math.round(v * 10) / 10;

/** 선수의 계약 기간 선호: 어릴수록 길게, 노장은 짧게 */
export const preferredYears = (p) => (p.age <= 26 ? 3 : p.age <= 31 ? 2 : 1);

/** 선수가 어떤 제안을 얼마나 마음에 들어 하는지 */
export function offerScore(p, offerEok, teamId, roster, ctx, rules, round = 1) {
  const fa = rules.transactions.freeAgency;
  const demand = demandEok(p) * (1 - fa.demandDropPerRound * (round - 1));
  const ratio = offerEok / demand;
  const winPct = ctx.winPct.get(teamId) ?? 0.5;
  const ovrs = roster.filter((x) => x.id !== p.id).map((x) => x.ovr).sort((a, b) => b - a);
  const starter = p.ovr >= (ovrs[6] ?? 0); // 상위 7명 안이면 출전 기회가 넉넉하다
  const loyalty = teamId === p.prevTeamId || teamId === p.teamId ? fa.loyaltyBonus : 0;
  const mood = (hash01(`${p.id}:${ctx.season}`) - 0.5) * 2 * fa.moodRange;
  const prestige = ctx.prestige?.get(teamId) ?? 0.5; // 명문 구단 선호(전통 점수)
  const score = ratio + fa.successWeight * (winPct - 0.5) + fa.prestigeWeight * (prestige - 0.5) + (starter ? fa.starterBonus : 0) + loyalty + mood;
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

/** 원소속 구단 전년 보수 순위 → 보상 규정. 해당 없으면 null */
export function compensationFor(p, rules) {
  if (!p.prevTeamId || !p.prevRank) return null;
  const tier = rules.transactions.compensation.tiers.find((t) => p.prevRank <= t.maxRank);
  if (!tier) return null;
  const base = p.prevSalaryEok;
  return {
    tierMaxRank: tier.maxRank,
    cashOnly: round1(base * tier.cashOnlyRatio),
    withPlayerCash: tier.withPlayerCashRatio != null ? round1(base * tier.withPlayerCashRatio) : null
  };
}

const years = (p, rng) => Math.max(1, preferredYears(p) + (rng() < 0.2 ? 1 : 0));

/**
 * FA 시장 진행.
 * state: { players, pool, funds }, ctx: { season, ranks, winPct, managerTeamId }, policy(선택):
 *   policy.freeAgency({ round, pool, state }) → [{ playerId, salaryEok, years }]  (단장의 제안)
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
  const teamIds = teamData.map((t) => t.id);

  const usedNumber = (teamId) => new Set(players.filter((p) => p.teamId === teamId).map((p) => p.number));
  const freeNumber = (teamId, want) => {
    const used = usedNumber(teamId);
    if (!used.has(want)) return want;
    for (let n = 0; n <= 99; n++) if (!used.has(n)) return n;
    throw new Error('등번호가 부족합니다');
  };

  for (let round = 1; round <= fa.rounds; round++) {
    const demandNow = (p) => demandEok(p) * (1 - fa.demandDropPerRound * (round - 1));
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
        const comp = compensationFor(p, rules);
        const cost = comp ? comp.cashOnly : 0;
        const utility = valueOf(p) + needBonus(roster, p.position) - fa.priceWeight * salary - fa.compensationWeight * cost;
        cands.push({ p, salary, utility });
      }
      cands.sort((a, b) => b.utility - a.utility);
      for (const c of cands.slice(0, fa.offersPerTeamPerRound)) add(c.p.id, { teamId, salaryEok: c.salary, years: years(c.p, rng) });
    }

    // 단장의 제안
    if (policy?.freeAgency && ctx.managerTeamId) {
      const mine = policy.freeAgency({ round, pool, state: { players, funds }, demandNow }) ?? [];
      const poolIds = new Set(pool.map((p) => p.id));
      for (const o of mine) {
        if (poolIds.has(o.playerId)) add(o.playerId, { teamId: ctx.managerTeamId, salaryEok: o.salaryEok, years: o.years ?? 2, manager: true });
      }
    }

    // 선수는 가치가 높은 순서로 제안을 고른다
    const order = [...pool].sort((a, b) => valueOf(b) - valueOf(a));
    for (const p of order) {
      const offers = offersFor.get(p.id);
      if (!offers) continue;
      let best = null;
      for (const o of offers) {
        const roster = domesticOf(players, o.teamId);
        if (roster.length >= slotsMax) continue;
        if (!capAllows(payrollEok(players, o.teamId), o.salaryEok, rules, { isManager: Boolean(o.manager) })) continue;
        const r = offerScore(p, o.salaryEok, o.teamId, roster, ctx, rules, round);
        if (r.accept && (!best || r.score > best.score)) best = { ...o, score: r.score };
      }
      if (!best) continue;

      const comp = best.teamId !== p.prevTeamId ? compensationFor(p, rules) : null;
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
          .slice(0, rules.transactions.compensation.protectedPlayers).map((x) => x.id));
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
  }
  return { players, pool, funds, signings, compensations };
}
