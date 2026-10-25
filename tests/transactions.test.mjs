import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  softCapPenaltyEok, demandEok, valueOf, worthOf, strategyOf, hash01, payrollEok, domesticOf, hardLimitEok
} from '../src/valuation.mjs';
import { settleSeason, transferFunds, initialFunds } from '../src/funds.mjs';
import { asiaOf, asiaPayrollEok } from '../src/valuation.mjs';
import { validateTrade, executeTrade, aiEvaluate, generateOffers, proposeTrade, teamWorth } from '../src/trade.mjs';
import { offerScore, capAllows, compensationFor, compensationRule, yearsRange, runFreeAgency } from '../src/freeagency.mjs';
import { runOffseason, rookieSalary } from '../src/offseason.mjs';
import { createLeague } from '../src/league.mjs';
import { createManagerBot } from '../src/manager-bot.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { invariants } from './helpers.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');
const MGR = 'busan-kcc';
const standings = teamData.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));
const ranks = new Map(standings.map((s, i) => [s.id, i + 1]));
const winPct = new Map(standings.map((s) => [s.id, s.wins / 54]));
const ctx = { season: 2026, ranks, winPct, managerTeamId: MGR, teamCount: 10 };
const fresh = () => createLeague(players, rules);
const dom = (league, teamId) => domesticOf(league.players, teamId);

// ---------- 가치·캡·자금 ----------
test('소프트캡 기금: 초과 구간에 따라 비율이 오른다(규정 30/40/50%, 게임 값은 밸런스 조정으로 60/100/150%)', () => {
  const real = { ...rules, salaryCap: { ...rules.salaryCap, soft: { ...rules.salaryCap.soft, penaltyTiers: [[0.1, 0.3], [0.2, 0.4], [1000, 0.5]] } } };
  assert.equal(softCapPenaltyEok(29, real), 0);
  assert.equal(softCapPenaltyEok(30, real), 0);
  assert.equal(softCapPenaltyEok(31.5, real), 0.45); // 5% 초과 → 30%
  assert.equal(softCapPenaltyEok(34, real), 1.6); // 13.3% 초과 → 40%
  assert.equal(softCapPenaltyEok(38, real), 4); // 26.7% 초과 → 50%
  // 게임 값(data/league-rules.json): 같은 구간에서 규정보다 크다
  assert.equal(softCapPenaltyEok(30, rules), 0);
  for (const pay of [31.5, 34, 38]) assert.ok(softCapPenaltyEok(pay, rules) > softCapPenaltyEok(pay, real));
});

test('요구 연봉: 능력이 높을수록 오르고, 어린 유망주는 더 받고, 노장은 덜 받는다', () => {
  const mk = (ovr, age, potential = ovr) => ({ ovr, age, potential });
  assert.ok(demandEok(mk(75, 27)) > demandEok(mk(65, 27)));
  assert.ok(demandEok(mk(65, 21, 80)) > demandEok(mk(65, 27)));
  assert.ok(demandEok(mk(70, 35)) < demandEok(mk(70, 28)));
  assert.ok(demandEok(mk(99, 27)) <= 8);
});

test('거래 가치는 능력 차이를 지수로 키우고, 구단 성향이 평가를 바꾼다', () => {
  const star = { ovr: 75, potential: 75, age: 27 };
  const mid = { ovr: 62, potential: 62, age: 27 };
  assert.ok(worthOf(star, rules) > worthOf(mid, rules) * 2);
  assert.equal(strategyOf(1), 'contend');
  assert.equal(strategyOf(5), 'balanced');
  assert.equal(strategyOf(10), 'rebuild');
  const l = fresh();
  const young = { ...dom(l, MGR)[0], age: 22, ovr: 60, potential: 78, contract: { salaryEok: 1, yearsLeft: 3 } };
  const lg = { ...l, players: [...l.players, young] };
  const rebuild = new Map(ranks); rebuild.set(MGR, 10);
  const contend = new Map(ranks); contend.set(MGR, 1);
  assert.ok(teamWorth(young, MGR, lg, { ranks: rebuild, teamCount: 10 }, rules) > teamWorth(young, MGR, lg, { ranks: contend, teamCount: 10 }, rules));
});

test('hash01: 같은 입력이면 같은 값, [0,1) 범위', () => {
  assert.equal(hash01('a:2026'), hash01('a:2026'));
  assert.notEqual(hash01('a:2026'), hash01('b:2026'));
  for (const s of ['x', 'y', 'zzz', '한글']) { const v = hash01(s); assert.ok(v >= 0 && v < 1); }
});

test('시즌 정산: 수입 − 연봉 − 기금이 자금에 반영되고 구단마다 내역이 나온다', () => {
  const l = fresh();
  const funds = initialFunds(teamData, rules);
  const playoffs = { championId: standings[0].id, series: [
    { higherId: standings[2].id, lowerId: standings[5].id }, { higherId: standings[3].id, lowerId: standings[4].id },
    { higherId: standings[0].id, lowerId: standings[3].id }, { higherId: standings[1].id, lowerId: standings[2].id },
    { higherId: standings[0].id, lowerId: standings[1].id }] };
  const { funds: next, ledger } = settleSeason(funds, l.players, standings, playoffs, teamData, rules);
  for (const t of teamData) {
    const e = ledger[t.id];
    assert.ok(Math.abs(e.net - (e.revenue - e.payroll - e.penalty)) < 0.02, t.id);
    assert.ok(Math.abs(next[t.id] - (funds[t.id] + e.net)) < 0.02);
  }
  // 수입 = 입장·플레이오프 입장·중계권·스폰서·굿즈·플레이오프 상금(모델은 tests/revenue.test.mjs). 우승팀은 우승 상금을 받고 꼴찌보다 더 번다
  const champ = ledger[standings[0].id], last = ledger[standings.at(-1).id];
  const f = rules.transactions.funds;
  assert.ok(Math.abs(champ.revenue - Object.values(champ.parts).reduce((a, b) => a + b, 0)) < 0.02);
  assert.equal(champ.parts.playoffBonus, f.playoffBonus['우승']);
  assert.ok(champ.revenue > last.revenue);
});

test('구단 간 현금 이동은 합계가 변하지 않는다', () => {
  const funds = initialFunds(teamData, rules);
  const next = transferFunds(funds, 'seoul-sk', 'busan-kcc', 3.5);
  const total = (f) => Object.values(f).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total(next) - total(funds)) < 1e-9);
  assert.equal(next['busan-kcc'], funds['busan-kcc'] + 3.5);
});

// ---------- 트레이드 ----------
function swap(l, a, b, i = 0, j = 0) {
  return { teamA: a, teamB: b, giveA: [dom(l, a)[i].id], giveB: [dom(l, b)[j].id] };
}

test('트레이드 검증: 같은 구단, 외국 선수, 중복, 소속 오류를 막는다', () => {
  const l = fresh();
  const t = swap(l, MGR, 'seoul-sk');
  assert.equal(validateTrade(l, t, rules).ok, true);
  assert.equal(validateTrade(l, { ...t, teamB: MGR }, rules).ok, false);
  const foreign = l.players.find((p) => p.teamId === MGR && p.origin === 'foreign');
  const r = validateTrade(l, { ...t, giveA: [foreign.id] }, rules);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('외국')));
  assert.equal(validateTrade(l, { ...t, giveB: [t.giveA[0]] }, rules).ok, false);
  assert.equal(validateTrade(l, { teamA: MGR, teamB: 'seoul-sk', giveA: [], giveB: [t.giveB[0]] }, rules).ok, false);
});

test('트레이드 검증: 오프시즌은 인원 범위, 시즌 중은 같은 인원·마감일을 지켜야 한다', () => {
  const l = fresh();
  const a = dom(l, MGR).slice(0, 2).map((p) => p.id);
  const b = dom(l, 'seoul-sk')[0].id;
  assert.equal(validateTrade(l, { teamA: MGR, teamB: 'seoul-sk', giveA: a, giveB: [b] }, rules).ok, true); // 2대1: 11명/13명
  const many = { teamA: MGR, teamB: 'seoul-sk', giveA: dom(l, MGR).slice(0, 5).map((p) => p.id), giveB: [b] };
  assert.equal(validateTrade(l, many, rules).ok, false); // 12−5+1 = 8명
  const season = validateTrade(l, swap(l, MGR, 'seoul-sk'), rules, { window: 'season', day: 10 });
  assert.equal(season.ok, true);
  assert.equal(validateTrade(l, swap(l, MGR, 'seoul-sk'), rules, { window: 'season', day: rules.transactions.trade.deadlineDay + 1 }).ok, false);
  assert.equal(validateTrade(l, { teamA: MGR, teamB: 'seoul-sk', giveA: a.slice(0, 2), giveB: [b] }, rules, { window: 'season', day: 5 }).ok, false);
});

test('트레이드 검증: 캡을 넘는 구단은 연봉이 늘어나는 거래를 할 수 없다', () => {
  const l = fresh();
  // SK를 캡 초과 상태로 만든다
  const sk = dom(l, 'seoul-sk');
  // SK의 연봉 합계를 캡보다 2억 높은 상태(한도 안)로 만든다
  const bump = rules.salaryCap.domesticEok + 2 - payrollEok(l.players, 'seoul-sk');
  const boosted = { ...l, players: l.players.map((p) => (p.id === sk[0].id ? { ...p, contract: { ...p.contract, salaryEok: p.contract.salaryEok + bump } } : p)) };
  assert.ok(payrollEok(boosted.players, 'seoul-sk') > rules.salaryCap.domesticEok);
  const cheap = [...sk].filter((p) => p.id !== sk[0].id).sort((a, b) => a.contract.salaryEok - b.contract.salaryEok)[0];
  const pricey = dom(boosted, MGR).sort((a, b) => b.contract.salaryEok - a.contract.salaryEok)[0];
  const bad = { teamA: 'seoul-sk', teamB: MGR, giveA: [cheap.id], giveB: [pricey.id] };
  assert.ok(pricey.contract.salaryEok > cheap.contract.salaryEok, '받는 연봉이 보내는 연봉보다 커야 시험이 성립한다');
  const r = validateTrade(boosted, bad, rules);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('캡을 넘는')));
});

test('executeTrade: 선수가 옮겨가고 등번호가 겹치지 않으며 원본은 그대로다', () => {
  const l = fresh();
  const before = JSON.stringify(l);
  const t = swap(l, MGR, 'seoul-sk');
  const next = executeTrade(l, t);
  assert.equal(JSON.stringify(l), before);
  assert.equal(next.players.find((p) => p.id === t.giveA[0]).teamId, 'seoul-sk');
  assert.equal(next.players.find((p) => p.id === t.giveB[0]).teamId, MGR);
  for (const id of [MGR, 'seoul-sk']) {
    const nums = next.players.filter((p) => p.teamId === id).map((p) => p.number);
    assert.equal(new Set(nums).size, nums.length);
  }
});

test('AI 평가: 공정한 교환은 받고 일방적으로 불리한 제안은 거절한다', () => {
  const l = fresh();
  const star = [...dom(l, MGR)].sort((a, b) => valueOf(b) - valueOf(a))[0];
  const scrub = [...dom(l, 'seoul-sk')].sort((a, b) => valueOf(a) - valueOf(b))[0];
  const bad = aiEvaluate('seoul-sk', [scrub], [[...dom(l, 'seoul-sk')].sort((a, b) => valueOf(b) - valueOf(a))[0]], l, ctx, rules);
  assert.equal(bad.accept, false);
  const good = aiEvaluate('seoul-sk', [star], [scrub], l, ctx, rules);
  assert.equal(good.accept, true);
});

test('단장에게 오는 제안: 규칙에 맞고 AI가 이득을 보며 핵심 선수는 내놓지 않는다', () => {
  const l = fresh();
  const league = { ...l, players: l.players.map((p, i) => (i % 4 === 0 ? { ...p, contract: { ...p.contract, yearsLeft: 0 } } : p)) };
  let total = 0;
  for (let seed = 0; seed < 8; seed++) {
    const offers = generateOffers(league, MGR, ctx, rules, mulberry32(seed));
    assert.ok(offers.length <= rules.transactions.trade.maxOffers);
    for (const o of offers) {
      total++;
      assert.equal(validateTrade(league, o.trade, rules).ok, true, JSON.stringify(o.trade));
      assert.equal(aiEvaluate(o.teamId, o.get, o.give, league, ctx, rules).accept, true);
      const core = [...dom(league, o.teamId)].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, rules.transactions.trade.coreProtected).map((p) => p.id);
      for (const p of o.give) assert.ok(!core.includes(p.id), `${p.name}은 핵심 선수`);
      assert.ok(o.get.every((p) => p.teamId === MGR));
    }
  }
  assert.ok(total >= 10, `제안 ${total}건`);
  assert.deepEqual(generateOffers(league, MGR, ctx, rules, mulberry32(3)).map((o) => o.id), generateOffers(league, MGR, ctx, rules, mulberry32(3)).map((o) => o.id));
});

test('단장이 거는 트레이드: AI가 거절하면 실행되지 않고, 받아들이면 실행된다', () => {
  const l = fresh();
  const mine = [...dom(l, MGR)].sort((a, b) => valueOf(b) - valueOf(a));
  const theirs = [...dom(l, 'seoul-sk')].sort((a, b) => valueOf(b) - valueOf(a));
  const lowball = { teamA: MGR, teamB: 'seoul-sk', giveA: [mine.at(-1).id], giveB: [theirs[0].id] };
  const r1 = proposeTrade(l, lowball, ctx, rules);
  assert.equal(r1.executed, false);
  assert.equal(r1.league, l);
  const generous = { teamA: MGR, teamB: 'seoul-sk', giveA: [mine[0].id], giveB: [theirs.at(-1).id] };
  const r2 = proposeTrade(l, generous, ctx, rules);
  assert.equal(r2.executed, true);
  assert.equal(r2.league.players.find((p) => p.id === mine[0].id).teamId, 'seoul-sk');
});

// ---------- 계약 협상·FA ----------
test('offerScore: 제안이 높을수록 점수가 오르고, 요구액의 90% 미만은 항상 거절한다', () => {
  const l = fresh();
  const p = dom(l, 'seoul-sk')[0];
  const roster = dom(l, MGR);
  const d = demandEok(p);
  const low = offerScore(p, d * 0.85, MGR, roster, ctx, rules);
  const mid = offerScore(p, d * 1.0, MGR, roster, ctx, rules);
  const high = offerScore(p, d * 1.2, MGR, roster, ctx, rules);
  assert.ok(low.score < mid.score && mid.score < high.score);
  assert.equal(low.accept, false);
  assert.equal(high.accept, true);
});

test('offerScore: 성적이 좋은 구단·원소속 구단이 더 매력적이다', () => {
  const l = fresh();
  const p = { ...dom(l, 'seoul-sk')[0], prevTeamId: 'seoul-sk' };
  const d = demandEok(p);
  const roster = dom(l, 'seoul-sk');
  const winner = offerScore(p, d, 'seoul-samsung', roster, { ...ctx, winPct: new Map([['seoul-samsung', 0.8]]) }, rules);
  const loser = offerScore(p, d, 'seoul-samsung', roster, { ...ctx, winPct: new Map([['seoul-samsung', 0.2]]) }, rules);
  assert.ok(winner.score > loser.score);
  const loyal = offerScore(p, d, 'seoul-sk', roster, { ...ctx, winPct: new Map([['seoul-sk', 0.5]]) }, rules);
  const other = offerScore(p, d, 'seoul-samsung', roster, { ...ctx, winPct: new Map([['seoul-samsung', 0.5]]) }, rules);
  assert.ok(loyal.score > other.score);
});

test('capAllows: 캡 안은 허용, 캡 초과는 단장만, 최저 계약은 면제, 한도 초과는 불가', () => {
  const cap = rules.salaryCap.domesticEok;
  assert.equal(capAllows(cap - 2, 2, rules), true);
  assert.equal(capAllows(cap - 1, 3, rules), false);
  assert.equal(capAllows(cap - 1, 3, rules, { isManager: true }), true);
  assert.equal(capAllows(cap + 1, rules.salaryCap.soft.exemptContractEok, rules), true);
  assert.equal(capAllows(hardLimitEok(rules) - 1, 3, rules, { isManager: true }), false);
});

test('FA 보상: 전년 보수 순위별 규정(30위 이내 100% 또는 보상선수+25%, 31~40위 50%, 이후 없음)', () => {
  const mk = (prevRank, prevSalaryEok = 4) => ({ prevTeamId: 'x', prevRank, prevSalaryEok });
  const a = compensationFor(mk(10), rules);
  assert.equal(a.cashOnly, 4);
  assert.equal(a.withPlayerCash, 1);
  assert.equal(compensationFor(mk(35), rules).cashOnly, 2);
  assert.equal(compensationFor(mk(35), rules).withPlayerCash, null);
  assert.equal(compensationFor(mk(41), rules), null);
  assert.equal(compensationFor({ prevRank: 5 }, rules), null);
  assert.equal(rules.transactions.compensation.protectedPlayers, 4);
});

test('신인 보수: 1~4순위 0.8~1.2억, 5~10순위 0.5~0.8억, 2라운드 0.42~0.5억(보수 규정 제7조)', () => {
  const cfg = rules.offseason.rookieSalaryEok;
  const s = (i) => rookieSalary(i, cfg);
  assert.equal(s(0), 1.2);
  assert.equal(s(3), 0.8);
  for (let i = 0; i < 4; i++) assert.ok(s(i) >= 0.8 && s(i) <= 1.2);
  for (let i = 4; i < 10; i++) assert.ok(s(i) >= 0.5 && s(i) <= 0.8, `pick ${i + 1}: ${s(i)}`);
  for (let i = 10; i < 20; i++) assert.ok(s(i) >= 0.42 && s(i) <= 0.5, `pick ${i + 1}: ${s(i)}`);
  for (let i = 1; i < 20; i++) assert.ok(s(i) <= s(i - 1), '순번이 뒤일수록 보수가 같거나 낮다');
  assert.equal(s(25), 0.42);
  assert.equal(rules.salaryCap.minSalaryEok, 0.42);
});

// FA 시장 시험용 상태: 각 구단에서 선수 2명씩 FA로 내보낸다
function marketState() {
  const l = fresh();
  const pool = [];
  const keep = [];
  const rank = new Map([...l.players.filter((p) => p.origin === 'domestic')].sort((a, b) => b.contract.salaryEok - a.contract.salaryEok).map((p, i) => [p.id, i + 1]));
  for (const t of teamData) {
    const mine = dom(l, t.id).sort((a, b) => valueOf(b) - valueOf(a));
    const out = [mine[3], mine[7]];
    for (const p of l.players.filter((x) => x.teamId === t.id)) {
      if (out.includes(p)) pool.push({ ...p, teamId: null, contract: { yearsLeft: 0 }, prevTeamId: t.id, prevSalaryEok: p.contract.salaryEok, prevRank: rank.get(p.id) });
      else keep.push(p);
    }
  }
  return { players: keep, pool, funds: initialFunds(teamData, rules) };
}

test('FA 시장: 로스터·캡 규칙을 지키고 보상금은 합계가 변하지 않으며 원소속 구단이 다시 영입하지 않는다', () => {
  const st = marketState();
  const res = runFreeAgency(st, teamData, { ...ctx, managerTeamId: null }, rules, mulberry32(4));
  assert.ok(res.signings.length >= 10, `계약 ${res.signings.length}건`);
  for (const t of teamData) {
    assert.ok(domesticOf(res.players, t.id).length <= rules.roster.domestic, t.id);
    assert.ok(payrollEok(res.players, t.id) <= rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio) + 1e-6, t.id);
    const nums = res.players.filter((p) => p.teamId === t.id).map((p) => p.number);
    assert.equal(new Set(nums).size, nums.length, `${t.id} 등번호`);
  }
  for (const s of res.signings) assert.notEqual(s.teamId, s.from, 'AI 구단이 자기가 놓아준 선수를 다시 영입');
  const total = (f) => Object.values(f).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total(res.funds) - total(st.funds)) < 1e-6, '보상금은 구단 사이를 오갈 뿐이다');
  assert.equal(new Set(res.signings.map((s) => s.id)).size, res.signings.length);
  for (const p of res.players) assert.ok(!('prevTeamId' in p), '계약한 선수에게 이전 구단 정보가 남음');
  assert.deepEqual(res.signings, runFreeAgency(marketState(), teamData, { ...ctx, managerTeamId: null }, rules, mulberry32(4)).signings);
});

test('FA 시장: 보상 규정에 따라 보상금이 지급된다', () => {
  const res = runFreeAgency(marketState(), teamData, { ...ctx, managerTeamId: null }, rules, mulberry32(4));
  const moved = res.signings.filter((s) => s.compensation);
  assert.ok(moved.length >= 1);
  for (const s of moved) {
    assert.equal(s.compensation.type, 'cash');
    assert.equal(s.compensation.to, s.teamId);
    assert.equal(s.compensation.from, s.from);
    assert.ok(s.compensation.cashEok > 0);
  }
});

test('FA 시장: 단장의 제안으로 계약하고, 보상선수 옵션은 보호선수를 제외한 선수만 보낸다', () => {
  const st = marketState();
  const target = [...st.pool].sort((a, b) => valueOf(b) - valueOf(a)).find((p) => p.prevTeamId !== MGR && compensationFor(p, rules)?.withPlayerCash != null);
  const myRoster = domesticOf(st.players, MGR).sort((a, b) => valueOf(b) - valueOf(a));
  const protectedTop = myRoster[0]; // 보호선수는 지명할 수 없다
  const allowed = myRoster.at(-1);
  const run = (choice) => runFreeAgency(st, teamData, ctx, rules, mulberry32(9), {
    freeAgency: ({ round }) => (round === 1 ? [{ playerId: target.id, salaryEok: demandEok(target) * 1.6, years: 3 }] : []),
    compensation: () => choice
  });
  const rejected = run({ type: 'player', playerId: protectedTop.id });
  const s1 = rejected.signings.find((s) => s.id === target.id);
  assert.equal(s1.teamId, MGR);
  assert.equal(s1.compensation.type, 'cash', '보호선수는 보상선수로 지명할 수 없어 현금으로 처리');
  const ok = run({ type: 'player', playerId: allowed.id });
  const s2 = ok.signings.find((s) => s.id === target.id);
  assert.equal(s2.compensation.type, 'player');
  assert.equal(ok.players.find((p) => p.id === allowed.id).teamId, target.prevTeamId);
  assert.ok(s2.compensation.cashEok < s1.compensation.cashEok);
});

// ---------- 시즌 종료 흐름 (단장) ----------
test('시즌 종료: 자동 단장이 있어도 규칙이 유지되고 보고서에 결정이 남는다', () => {
  const l = fresh();
  const bot = createManagerBot(MGR, rules);
  const { league, report } = runOffseason(l, standings, teamData, rules, mulberry32(5), { manager: MGR, policy: bot });
  invariants(league, 'bot');
  assert.ok(report.tradeOffers.length >= 1, '계약 만료 시점에 트레이드 제안이 온다');
  assert.ok(report.expired.length + report.renewed.length > 0);
  assert.equal(typeof league.funds[MGR], 'number');
});

test('시즌 종료: 단장 콜백이 없으면 단장 구단도 AI와 같은 규칙이고 트레이드 제안은 오지 않는다', () => {
  const { report } = runOffseason(fresh(), standings, teamData, rules, mulberry32(5));
  assert.equal(report.tradeOffers.length, 0);
  assert.equal(report.trades.length, 0);
});

test('시즌 종료: 수락한 트레이드 제안이 실행되고, 재계약을 하지 않은 선수는 FA 풀로 간다', () => {
  const l = fresh();
  const league = { ...l, players: l.players.map((p) => (p.teamId === MGR && p.origin === 'domestic' ? { ...p, contract: { ...p.contract, yearsLeft: 1 } } : p)) };
  let accepted = [];
  const policy = {
    trade: ({ offers }) => { accepted = offers.slice(0, 1).map((o) => o.id); return accepted; },
    resign: () => ({}) // 아무도 재계약하지 않는다
  };
  const { report } = runOffseason(league, standings, teamData, rules, mulberry32(8), { manager: MGR, policy });
  if (report.tradeOffers.length) assert.equal(report.trades.filter((t) => t.source === 'offer').length, accepted.length);
  const mineExpired = report.expired.filter((e) => e.teamId === MGR && !e.foreign);
  assert.ok(mineExpired.length >= 8, `재계약 안 한 선수 ${mineExpired.length}명이 FA로 나가야 한다`);
});

test('시즌 종료: 요구액보다 한참 낮게 제안한 재계약은 선수가 거절한다', () => {
  const l = fresh();
  const league = { ...l, players: l.players.map((p) => (p.teamId === MGR && p.origin === 'domestic' ? { ...p, contract: { ...p.contract, yearsLeft: 1 } } : p)) };
  const policy = {
    resign: ({ expiring }) => Object.fromEntries(expiring.map((p) => [p.id, { salaryEok: Math.max(0.3, demandEok(p) * 0.5), years: 2 }]))
  };
  const { report } = runOffseason(league, standings, teamData, rules, mulberry32(8), { manager: MGR, policy });
  assert.ok(report.refused.filter((r) => r.teamId === MGR).length >= 5);
});

test('다음 시즌: 시즌 정산 후에도 구단 자금이 숫자로 유지된다', () => {
  let league = fresh();
  const rng = mulberry32(2);
  for (let y = 0; y < 3; y++) {
    const r = runOffseason(league, standings, teamData, rules, rng);
    league = { ...r.league, funds: Object.fromEntries(Object.entries(r.league.funds)) };
    invariants(league, `Y${y + 1}`);
    for (const v of Object.values(league.funds)) assert.ok(Number.isFinite(v));
  }
});

// ---------- 아시아쿼터 ----------
test('아시아쿼터: 국내 연봉 캡에는 안 들어가지만 구단 지출에는 들어간다', () => {
  const l = fresh();
  const team = teamData.find((t) => asiaOf(l.players, t.id).length === 1).id;
  const asiaPay = asiaPayrollEok(l.players, team);
  assert.ok(asiaPay > 0);
  assert.equal(payrollEok(l.players, team), dom(l, team).reduce((a, p) => a + p.contract.salaryEok, 0)); // 국내 선수만
  const funds = initialFunds(teamData, rules);
  const playoffs = { championId: standings[0].id, series: [
    { higherId: standings[2].id, lowerId: standings[5].id }, { higherId: standings[3].id, lowerId: standings[4].id },
    { higherId: standings[0].id, lowerId: standings[3].id }, { higherId: standings[1].id, lowerId: standings[2].id },
    { higherId: standings[0].id, lowerId: standings[1].id }] };
  const withAsia = settleSeason(funds, l.players, standings, playoffs, teamData, rules).ledger[team].payroll;
  const without = settleSeason(funds, l.players.filter((p) => !(p.teamId === team && p.origin === 'asia')), standings, playoffs, teamData, rules).ledger[team].payroll;
  assert.ok(Math.abs(withAsia - without - asiaPay) < 0.02);
});

test('아시아쿼터: 트레이드할 수 없다', () => {
  const l = fresh();
  const team = teamData.find((t) => t.id !== 'seoul-sk' && asiaOf(l.players, t.id).length === 1).id;
  const aq = asiaOf(l.players, team)[0];
  const r = validateTrade(l, { teamA: team, teamB: 'seoul-sk', giveA: [aq.id], giveB: [dom(l, 'seoul-sk')[0].id] }, rules);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('아시아쿼터')));
});

test('아시아쿼터: 시즌 종료 처리 후에도 구단당 최대 1명, 연봉 범위·국적 유지, 빈 구단은 새로 영입, FA 풀에는 안 나온다', () => {
  let l = fresh();
  const rng = mulberry32(21);
  let signedNew = 0;
  for (let y = 0; y < 8; y++) {
    const r = runOffseason(l, standings, teamData, rules, rng);
    l = r.league;
    invariants(l, `AQ Y${y + 1}`);
    signedNew += r.report.asiaReplaced.length;
    for (const p of r.report.asiaReplaced) assert.ok(l.players.find((x) => x.id === p.id)?.nationality, p.name);
    assert.ok(l.freeAgents.every((p) => p.origin !== 'asia'));
  }
  assert.ok(signedNew >= 3, `8년 동안 새 아시아쿼터 영입 ${signedNew}명`);
  const filled = teamData.filter((t) => asiaOf(l.players, t.id).length === 1).length;
  assert.ok(filled >= 7, `아시아쿼터가 있는 구단 ${filled}개`);
});

test('FA 보상 등급: 2027-28부터는 A(100% 또는 보상선수+25%)·B(50%), 그 전 규정은 A(200% 또는 +50%)·B(100%)·C(50%)에 만 35세 이상 면제', () => {
  const mk = (prevRank, age = 28, prevSalaryEok = 4) => ({ prevTeamId: 'x', prevRank, prevSalaryEok, age });
  // 현재 규정(게임의 모든 오프시즌)
  assert.equal(rules.transactions.compensation.effectiveFromYear, 2027);
  const a = compensationFor(mk(10), rules, 2027);
  assert.deepEqual([a.grade, a.cashOnly, a.withPlayerCash], ['A', 4, 1]);
  assert.deepEqual([compensationFor(mk(35), rules, 2027).grade, compensationFor(mk(35), rules, 2027).cashOnly], ['B', 2]);
  assert.equal(compensationFor(mk(45), rules, 2027), null);
  assert.equal(compensationRule(rules, 2030).protectedPlayers, 4);
  // 그 이전 규정(나무위키·다음 카페 서술)
  const old = compensationFor(mk(10), rules, 2026);
  assert.deepEqual([old.grade, old.cashOnly, old.withPlayerCash], ['A', 8, 2]);
  assert.deepEqual([compensationFor(mk(35), rules, 2026).grade, compensationFor(mk(35), rules, 2026).cashOnly], ['B', 4]);
  assert.deepEqual([compensationFor(mk(45), rules, 2026).grade, compensationFor(mk(45), rules, 2026).cashOnly], ['C', 2]);
  assert.equal(compensationFor(mk(55), rules, 2026), null);
  assert.equal(compensationFor(mk(5, 35), rules, 2026), null, '만 35세 이상은 보상 없음');
  assert.ok(compensationFor(mk(5, 34), rules, 2026));
});

test('FA 계약기간: 전년도 보수 30위 이내는 3~5년(만 32세 이상 예외), 나머지는 5년 이하', () => {
  const p = (prevRank, age) => ({ prevRank, age });
  assert.deepEqual(yearsRange(p(10, 27), rules), [3, 5]);
  assert.deepEqual(yearsRange(p(30, 31), rules), [3, 5]);
  assert.deepEqual(yearsRange(p(10, 32), rules), [1, 5]);
  assert.deepEqual(yearsRange(p(31, 25), rules), [1, 5]);
});

test('FA 시장: 상위 30위 FA와의 계약은 3년 이상이고 모든 FA 계약은 5년 이하', () => {
  const state = marketState();
  const res = runFreeAgency(state, teamData, { ...ctx, managerTeamId: null }, rules, mulberry32(3));
  assert.ok(res.signings.length > 0);
  const prev = new Map(state.pool.map((p) => [p.id, p]));
  for (const s of res.signings) {
    const p = prev.get(s.id);
    const [lo, hi] = yearsRange(p, rules);
    assert.ok(s.years >= lo && s.years <= hi, `${s.name} ${s.years}년 (범위 ${lo}~${hi})`);
  }
});
