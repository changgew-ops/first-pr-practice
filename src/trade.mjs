// 트레이드: 규칙 검증, AI 구단의 가치 판단, 단장에게 오는 제안 생성, 실행.
// 규칙은 게임용 단순화다. KBL 트레이드 세부 규정은 공식 확인 전이므로 league-rules.json의 transactions.trade로 조정한다.
import { shuffle } from './rng.mjs';
import { legacyOvr } from './rating.mjs';
import {
  domesticOf, payrollEok, hardLimitEok, worthOf, valueOf, strategyOf, demandEok, POSITION_TARGET
} from './valuation.mjs';

/**
 * trade = { teamA, teamB, giveA: [선수id], giveB: [선수id] }   (giveA = A가 B에게 보내는 선수)
 * options.window: 'offseason'(시즌 종료 후) | 'season'(시즌 중), options.day: 시즌 중 경기일
 */
export function validateTrade(league, trade, rules, { window = 'offseason', day = 0 } = {}) {
  const tr = rules.transactions.trade;
  const errors = [];
  const { teamA, teamB, giveA, giveB } = trade;
  const byId = new Map(league.players.map((p) => [p.id, p]));
  if (teamA === teamB) errors.push('같은 구단끼리는 거래할 수 없습니다');
  if (giveA.length === 0 || giveB.length === 0) errors.push('양쪽 모두 선수를 보내야 합니다');
  if (new Set([...giveA, ...giveB]).size !== giveA.length + giveB.length) errors.push('같은 선수가 중복되어 있습니다');

  const check = (ids, teamId) => ids.map((id) => {
    const p = byId.get(id);
    if (!p || p.teamId !== teamId) errors.push(`${id}는 ${teamId} 소속이 아닙니다`);
    else if (p.origin === 'foreign' && !rules.transactions.foreignTradable) errors.push(`${p.name}: 외국 선수는 트레이드할 수 없습니다`);
    else if (p.origin === 'asia' && !rules.transactions.asiaTradable) errors.push(`${p.name}: 아시아쿼터 선수는 트레이드할 수 없습니다`);
    return p;
  });
  const outA = check(giveA, teamA).filter(Boolean);
  const outB = check(giveB, teamB).filter(Boolean);
  if (errors.length) return { ok: false, errors };

  if (window === 'season') {
    if (day > tr.deadlineDay) errors.push(`트레이드 마감(${tr.deadlineDay}일차)이 지났습니다`);
    if (outA.length !== outB.length) errors.push('시즌 중에는 같은 인원끼리만 교환할 수 있습니다');
  }

  const salary = (list) => list.reduce((s, p) => s + p.contract.salaryEok, 0);
  const sides = [[teamA, outA, outB], [teamB, outB, outA]];
  for (const [teamId, out, inc] of sides) {
    const count = domesticOf(league.players, teamId).length - out.length + inc.length;
    if (window === 'offseason' && (count < tr.offseasonDomesticRange[0] || count > tr.offseasonDomesticRange[1])) {
      errors.push(`${teamId}: 거래 후 국내 선수 ${count}명 (허용 ${tr.offseasonDomesticRange.join('~')}명)`);
    }
    const after = payrollEok(league.players, teamId) - salary(out) + salary(inc);
    if (after > hardLimitEok(rules) + 1e-9) errors.push(`${teamId}: 거래 후 연봉 ${after.toFixed(1)}억이 한도를 넘습니다`);
    else if (after > rules.salaryCap.domesticEok + 1e-9 && salary(inc) > salary(out) + 1e-9) {
      errors.push(`${teamId}: 캡을 넘는 상태에서는 연봉이 늘어나는 거래를 할 수 없습니다`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 구단 관점에서 본 선수의 거래 가치. 같은 선수라도 구단마다 다르게 평가한다.
 *  - 성향: 리빌딩 구단은 젊은 선수를, 우승을 노리는 구단은 당장 강한 선수를 더 높게 본다
 *  - 계약이 끝나는 선수: 재계약할 캡 여유가 있는 구단은 가치 있게, 없는 구단은 곧 떠날 선수로 거의 가치 없게 본다
 *  - 포지션: 비어 있는 포지션은 더 높게, 이미 넘치는 포지션은 낮게 본다
 */
export function teamWorth(p, teamId, league, ctx, rules) {
  const tr = rules.transactions.trade;
  const roster = domesticOf(league.players, teamId);
  const strategy = strategyOf(ctx.ranks.get(teamId) ?? 5, ctx.teamCount ?? 10);
  let w = worthOf(p, rules);
  if (strategy === 'rebuild') w *= p.age <= 24 ? 1.35 : p.age >= 29 ? 0.65 : 1;
  else if (strategy === 'contend') w *= legacyOvr(p.ovr) >= 65 ? 1.15 : p.age <= 22 ? 0.85 : 1;
  if (p.contract.yearsLeft <= 0) {
    const staying = roster.filter((x) => x.contract.yearsLeft > 0 && x.id !== p.id);
    const canKeep = payrollEok(staying, teamId) + demandEok(p, rules) <= rules.salaryCap.domesticEok;
    w *= canKeep ? tr.expiringDiscount + 0.25 : tr.expiringDiscount - 0.25;
  }
  const have = roster.filter((x) => x.position === p.position && x.id !== p.id).length;
  if (have === 0 && roster.every((x) => x.id !== p.id)) w *= 1.3;
  else if (have > POSITION_TARGET[p.position]) w *= 0.8;
  return w;
}

const coreOf = (league, teamId, rules) => [...domesticOf(league.players, teamId)]
  .sort((a, b) => valueOf(b) - valueOf(a)).slice(0, rules.transactions.trade.coreProtected).map((p) => p.id);

/** AI 구단이 제안을 받아들이는지. giveToAi/getFromAi는 선수 객체 배열 */
export function aiEvaluate(aiTeamId, receives, sends, league, ctx, rules) {
  const tr = rules.transactions.trade;
  const inW = receives.reduce((s, p) => s + teamWorth(p, aiTeamId, league, ctx, rules), 0);
  const outW = sends.reduce((s, p) => s + teamWorth(p, aiTeamId, league, ctx, rules), 0);
  const core = new Set(coreOf(league, aiTeamId, rules));
  const givesCore = sends.some((p) => core.has(p.id));
  const need = givesCore ? tr.acceptMargin + 0.2 : tr.acceptMargin;
  return { accept: inW >= outW * need, inWorth: inW, outWorth: outW, margin: outW > 0 ? inW / outW : Infinity };
}

/** 트레이드 실행. 검증은 호출하는 쪽에서 한다. 반환: 새 league */
export function executeTrade(league, trade) {
  const moved = new Map();
  for (const id of trade.giveA) moved.set(id, trade.teamB);
  for (const id of trade.giveB) moved.set(id, trade.teamA);
  const numbers = new Map();
  const taken = (teamId) => numbers.get(teamId) ?? numbers.set(teamId, new Set(league.players
    .filter((p) => p.teamId === teamId && !moved.has(p.id)).map((p) => p.number))).get(teamId);
  const players = league.players.map((p) => {
    if (!moved.has(p.id)) return p;
    const to = moved.get(p.id);
    const used = taken(to);
    let number = p.number;
    if (used.has(number)) { number = 0; while (used.has(number)) number++; }
    used.add(number);
    return { ...p, teamId: to, number };
  });
  return { ...league, players };
}

/**
 * 단장(managerTeamId)에게 오는 트레이드 제안. AI 구단은 자기에게 이득이 되는(가치 합이 마진 이상) 제안만 한다.
 * 계약이 끝나가는 선수는 오프시즌 창에서 우선 노려진다. 반환: [{ id, teamId, give: AI가 보낼 선수, get: 단장이 보낼 선수, ... }]
 */
export function generateOffers(league, managerTeamId, ctx, rules, rng, { window = 'offseason', day = 0 } = {}) {
  const tr = rules.transactions.trade;
  const mine = domesticOf(league.players, managerTeamId);
  const offers = [];
  const aiTeams = shuffle([...new Set(league.players.map((p) => p.teamId))].filter((t) => t && t !== managerTeamId), rng);

  for (const aiId of aiTeams) {
    if (offers.length >= tr.maxOffers) break;
    const core = new Set(coreOf(league, aiId, rules));
    const aiRoster = domesticOf(league.players, aiId);
    // 노릴 선수: AI가 단장보다 더 높게 평가하는 선수 (거래가 양쪽에 이득이 될 여지가 있는 선수).
    // 계약이 끝나가는 선수는 오프시즌 창에서 가중해, 놓칠 선수를 두고 오는 제안을 만든다.
    const targets = mine
      .map((p) => {
        const aiW = teamWorth(p, aiId, league, ctx, rules);
        const myW = teamWorth(p, managerTeamId, league, ctx, rules);
        return { p, w: (aiW / myW) * Math.sqrt(aiW) * (p.contract.yearsLeft <= 0 && window === 'offseason' ? 1.5 : 1) };
      })
      .sort((a, b) => b.w - a.w).slice(0, 4);
    const target = targets[Math.floor(rng() * targets.length)]?.p;
    if (!target) continue;
    const want = teamWorth(target, aiId, league, ctx, rules) / tr.acceptMargin;
    // 제안의 절반은 단장에게도 이득이 되는 거래(구단마다 가치 판단이 달라서 생긴다), 나머지는 AI가 최대한 이득을 보려는 거래
    const pool = aiRoster.filter((p) => !core.has(p.id));
    const friendly = rng() < 0.5;
    const ratio = 0.7 + rng() * 0.3;
    const mgrOut = teamWorth(target, managerTeamId, league, ctx, rules);
    let best = null;
    const consider = (give) => {
      const w = give.reduce((s, p) => s + teamWorth(p, aiId, league, ctx, rules), 0);
      if (w > want + 1e-9) return;
      const score = friendly
        ? give.reduce((s, p) => s + teamWorth(p, managerTeamId, league, ctx, rules), 0) - mgrOut
        : -Math.abs(w - want * ratio);
      if (!best || score > best.score) best = { give, score };
    };
    for (let i = 0; i < pool.length; i++) {
      consider([pool[i]]);
      for (let j = i + 1; j < pool.length; j++) consider([pool[i], pool[j]]);
    }
    if (!best) continue;
    const trade = { teamA: aiId, teamB: managerTeamId, giveA: best.give.map((p) => p.id), giveB: [target.id] };
    if (!validateTrade(league, trade, rules, { window, day }).ok) continue;
    if (!aiEvaluate(aiId, [target], best.give, league, ctx, rules).accept) continue;
    offers.push({ id: `offer-${offers.length + 1}`, teamId: aiId, give: best.give, get: [target], trade, expiringTarget: target.contract.yearsLeft <= 0 });
  }
  return offers;
}

/** 단장이 먼저 제안한 트레이드를 AI가 평가하고, 받아들이면 실행한다 */
export function proposeTrade(league, trade, ctx, rules, options = {}) {
  const check = validateTrade(league, trade, rules, options);
  if (!check.ok) return { executed: false, reason: check.errors.join(' / '), league };
  const byId = new Map(league.players.map((p) => [p.id, p]));
  const ai = trade.teamA === ctx.managerTeamId ? trade.teamB : trade.teamA;
  const toAi = (trade.teamA === ctx.managerTeamId ? trade.giveA : trade.giveB).map((id) => byId.get(id));
  const fromAi = (trade.teamA === ctx.managerTeamId ? trade.giveB : trade.giveA).map((id) => byId.get(id));
  const verdict = aiEvaluate(ai, toAi, fromAi, league, ctx, rules);
  if (!verdict.accept) return { executed: false, reason: `${ai}가 거절했습니다 (가치 비율 ${verdict.margin.toFixed(2)})`, verdict, league };
  return { executed: true, verdict, league: executeTrade(league, trade) };
}
