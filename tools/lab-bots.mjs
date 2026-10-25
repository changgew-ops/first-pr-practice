// 전략 실험실의 봇과 실행기. 화면 없이 web/lib/session.js의 Session을 사람처럼 조작한다(조작 기록 방식 그대로).
// 쓰는 곳: tools/strategy-lab.mjs(비교 실험), tools/build-difficulty.mjs(팀 난이도). 엔진은 읽기 전용으로만 쓴다.
//
// 전략 = { name, season: { rest, tactic, staff, programs }, offseason: { value, priceMul, capMode, keepTop, draft } }
//   season.rest:    null | { below: 임계 컨디션, max: 최대 동시 휴식 수 }  (우리 주전이 임계 아래면 쉬게 한다)
//   season.tactic:  null(추천 따르기) | 'balanced'|'fast'|'half'|'press'|'inside' | 'worst'(매일 가장 안 맞는 전술) | 'best'(매일 가장 맞는 전술, 균형 포함)
//   season.staff:   true면 매 시즌 시작에 감독·코치 네 자리를 후보 중 최고로 바꾼다
//   season.programs:true면 어린 벤치 선수를 D리그로 보낸다
//   season.focus:   true면 상위 8명에게 가장 낮은 능력치를 훈련 집중으로 지정한다
//   offseason:      null이면 기본 자동 단장(createManagerBot)과 같다. 아니면 value(선수 가치 함수)·priceMul(가격 민감도 배수)·capMode('cap'|'over')·keepTop(재계약 상위 수)·draft('balanced'|'youth'|'vet')
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { createManagerBot } from '../src/manager-bot.mjs';
import { capAllows } from '../src/freeagency.mjs';
import { domesticOf, payrollEok, valueOf, demandEok, needBonus, hardLimitEok } from '../src/valuation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, 'data', p), 'utf8'));
const round1 = (v) => Math.round(v * 10) / 10;

// LAB_RULES='{"simulation.usageExp":3.2,"salaryCap.maxOverRatio":0.15}' — 점 경로로 규칙 값을 덮어쓰고 실험한다(저장소의 data는 바꾸지 않는다)
function patchRules(rules) {
  const patch = process.env.LAB_RULES ? JSON.parse(process.env.LAB_RULES) : {};
  for (const [path, v] of Object.entries(patch)) {
    const keys = path.split('.');
    let o = rules;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = v;
  }
  return rules;
}
let BASE = null;
export function loadBase() {
  if (BASE) return BASE;
  const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
  BASE = { rules: patchRules(read('league-rules.json')), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
  return BASE;
}

// ---------- 오프시즌 결정 ----------
const VALUE = {
  linear: (p) => valueOf(p),
  star: (p) => ((Math.max(0, valueOf(p) - 45)) ** 2) / 12,               // 높은 선수에게 크게 가중(에이스 집중)
  youth: (p) => p.ovr * 0.35 + p.potential * 0.65 - Math.max(0, p.age - 27) * 1.0, // 나이가 어릴수록·잠재력이 클수록
  vet: (p) => p.ovr - Math.max(0, 24 - p.age) * 0.8 + (p.age >= 28 ? 1.0 : 0)       // 현재 OVR 위주, 어린 선수 할인
};
const DRAFT = {
  balanced: (p, mine) => p.potential * 0.6 + p.ovr * 0.4 + needBonus(mine, p.position),
  youth: (p, mine) => p.potential * 0.9 + p.ovr * 0.1 + needBonus(mine, p.position),
  vet: (p, mine) => p.ovr + needBonus(mine, p.position)
};

/** 오프시즌 결정 하나를 만든다. kind: trade|resign|freeAgency|compensation|draft|foreign, a: 엔진이 넘긴 상황 */
function decideOffseason(kind, a, my, rules, strat, bot) {
  const o = strat?.offseason;
  if (!o) {
    if (kind === 'trade') return { accept: bot.trade(a), proposals: [], release: [] };
    return bot[kind](a);
  }
  const fa = rules.transactions.freeAgency;
  const isMgr = o.capMode === 'over';
  const V = VALUE[o.value ?? 'linear'];
  const pw = fa.priceWeight * (o.priceMul ?? 1);
  const room = (payroll, salary) => (isMgr ? payroll + salary <= hardLimitEok(rules) + 1e-9 : capAllows(payroll, salary, rules));
  if (kind === 'trade') return { accept: bot.trade(a), proposals: [], release: [] };
  if (kind === 'compensation' || kind === 'foreign') return bot[kind](a);
  if (kind === 'draft') {
    const mine = a.roster ?? domesticOf([], a.team);
    if (a.round >= 3 && mine.length >= rules.roster.domestic) return 'pass';
    const f = DRAFT[o.draft ?? 'balanced'];
    return [...a.available].sort((x, y) => f(y, mine) - f(x, mine))[0]?.id;
  }
  if (kind === 'resign') {
    const mine = domesticOf(a.league.players, my);
    const rank = new Map([...mine].sort((x, y) => V(y) - V(x)).map((p, i) => [p.id, i + 1]));
    let payroll = payrollEok(mine.filter((p) => p.contract.yearsLeft > 0), my);
    const out = {};
    for (const p of [...a.expiring].sort((x, y) => V(y) - V(x))) {
      const salary = round1(demandEok(p, rules) * (isMgr ? 1.0 : 1.02));
      const keep = rank.get(p.id) <= (o.keepTop ?? 9) || (p.age <= 24 && p.potential >= p.ovr + 6 && o.value !== 'vet');
      if (keep && room(payroll, salary)) { out[p.id] = { salaryEok: salary, years: p.age <= 26 ? 3 : 2 }; payroll += salary; }
    }
    return out;
  }
  if (kind === 'freeAgency') {
    const roster = domesticOf(a.state.players, my);
    const slots = rules.roster.domestic - roster.length;
    if (slots <= 0) return [];
    const payroll = payrollEok(a.state.players, my);
    const cands = [];
    for (const p of a.pool) {
      if (p.origin !== 'domestic') continue;
      const salary = round1(a.demandNow(p) * 1.05);
      if (!room(payroll, salary)) continue;
      cands.push({ p, salary, u: V(p) + needBonus(roster, p.position) - pw * salary });
    }
    cands.sort((x, y) => y.u - x.u);
    const out = [];
    let pay = payroll;
    for (const c of cands) {
      if (out.length >= slots + 2) break;
      if (!room(pay, c.salary)) continue;
      out.push({ playerId: c.p.id, salaryEok: c.salary, years: c.p.age <= 26 ? 3 : 2 });
      pay += c.salary;
    }
    return out;
  }
  return bot[kind](a);
}

/** 오프시즌 전체를 전략에 따라 끝까지 진행한다 */
export function playOffseason(s, strat) {
  const my = s.managerId, bot = createManagerBot(my, s.rules);
  let guard = 0;
  while (s.pending && guard++ < 60) {
    const { key, kind, payload } = s.pending;
    const v = decideOffseason(kind, payload, my, s.rules, strat, bot);
    s.decide(key, v);
  }
  if (s.pending) throw new Error('오프시즌이 끝나지 않았습니다');
}

// ---------- 시즌 중 조작 ----------
function applyRest(s, rest) {
  const my = s.managerId;
  if (!rest) return;
  const lineup = s.lineupOf(my);
  if (!lineup) return;
  const cond = s.conditions;
  const healthy = s.players.filter((p) => p.teamId === my && !s.injuryOf?.(p.id)).length;
  const tired = lineup.starters.filter((p) => (cond.get(p.id) ?? 100) < rest.below).sort((a, b) => (cond.get(a.id) ?? 100) - (cond.get(b.id) ?? 100));
  const want = healthy >= 10 ? tired.slice(0, rest.max ?? 2).map((p) => p.id) : [];
  const cur = [...s.rest];
  if (want.length === cur.length && want.every((id) => cur.includes(id))) return;
  s.setRest(want);
}
function applyTactic(s, mode) {
  if (mode === undefined || mode === null) return;
  const t = s.tactics;
  if (!t) return;
  let id = mode;
  if (mode === 'worst') id = [...t.list].sort((a, b) => a.fit - b.fit)[0].id;
  else if (mode === 'best') id = [...t.list].sort((a, b) => b.fit - a.fit)[0].id;
  if (t.choice !== id) s.setTactic(id);
}
function applyStaff(s) {
  const pool = s.staffPool;
  if (!pool) return;
  for (const role of ['head', 'off', 'def', 'cond']) {
    const cand = pool[role]?.[0];
    if (!cand) continue;
    const cur = s.staff?.[s.managerId]?.[role];
    const skill = (x) => (role === 'head' ? (x.tac + x.dev + x.rot) / 3 : x.k);
    if (cur && skill(cand) <= skill(cur) + 1) continue;
    s.replaceStaff(role, cand.id, 3);
  }
}
const STATS6 = ['shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina'];
/** 훈련 집중: 상위 8명에게 가장 낮은 능력치를 집중 지정(초보가 가장 먼저 하는 조작) */
function applyFocus(s) {
  const my = s.managerId;
  const top = s.players.filter((p) => p.teamId === my && p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr).slice(0, 8);
  for (const p of top) {
    const stat = [...STATS6].sort((a, b) => p.stats[a] - p.stats[b])[0];
    s.setFocus(p.id, stat);
  }
}
function applyPrograms(s) {
  const my = s.managerId;
  const mine = s.players.filter((p) => p.teamId === my && p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr);
  const bench = mine.slice(9).filter((p) => p.age <= 22).sort((a, b) => b.potential - a.potential);
  let n = 0;
  for (const p of bench) {
    if (n >= 3) break;
    if (s.programCheck(p.id, 'dleague').ok && s.setProgram(p.id, 'dleague').ok) n++;
  }
}

/** 한 시즌을 끝까지(정규리그 → 플레이오프 → 시즌 종료) 진행하고 우리 구단 결과를 돌려준다. 오프시즌은 하지 않는다 */
export function playSeason(s, strat) {
  const ss = strat?.season ?? {};
  const my = s.managerId;
  if (ss.staff) applyStaff(s);
  if (ss.programs) applyPrograms(s);
  if (ss.focus) applyFocus(s);
  applyTactic(s, ss.tactic);
  while (!s.regularDone) {
    if (ss.rest) applyRest(s, ss.rest);
    if (ss.tactic === 'worst' || ss.tactic === 'best') applyTactic(s, ss.tactic);
    s.advance(1);
  }
  s.startPlayoffs();
  while (!s.playoffs.done) {
    if (ss.rest) applyRest(s, ss.rest);
    if (ss.tactic === 'worst' || ss.tactic === 'best') applyTactic(s, ss.tactic);
    if (s.myPlayoffSeries) s.playoffStep(); else s.playoffRound();
  }
  const myInj = (s.rosterLog ?? []).filter((x) => x.type === 'injury' && x.teamId === my);
  const injN = myInj.length, injG = myInj.reduce((a, x) => a + (x.games ?? 0), 0);
  const e = s.endSeason();
  const row = e.standings.find((x) => x.id === my);
  const led = e.ledger?.[my] ?? {};
  const endLeague = s.state.seasonEnd.league;
  const top12 = endLeague.players.filter((p) => p.teamId === my).sort((a, b) => b.ovr - a.ovr).slice(0, 12);
  const domPay = payrollEok(domesticOf(endLeague.players, my), my);
  return {
    season: e.season, rank: row.rank, wins: row.wins, losses: row.losses,
    po: e.stage?.[my] ?? null, champ: e.championId === my, stage: e.stage?.[my] ?? null, inj: injN, injGames: injG,
    net: led.net ?? null, revenue: led.revenue ?? null, payroll: led.payroll ?? null, penalty: led.penalty ?? 0, staffCost: led.staff ?? 0,
    funds: endLeague.funds?.[my] ?? null, domPay, cap: s.baseRules.salaryCap.domesticEok * (s.rules.econ?.index ?? 1),
    top12Ovr: top12.length ? top12.reduce((a, p) => a + p.ovr, 0) / top12.length : null,
    entry: e
  };
}

/** 리그 전체 지표(시즌 시작 시점 s.players 기준) */
export function leagueMetrics(s) {
  const players = s.players.filter((p) => p.teamId);
  const dom = players.filter((p) => p.origin === 'domestic');
  const cap = s.rules.salaryCap.domesticEok;
  const byTeam = new Map();
  for (const p of dom) { if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []); byTeam.get(p.teamId).push(p); }
  const ratios = [...byTeam.values()].map((arr) => payrollEok(arr, arr[0].teamId) / cap);
  const top = [...players].sort((a, b) => b.ovr - a.ovr);
  const funds = Object.values(s.funds);
  return {
    meanOvr: players.reduce((a, p) => a + p.ovr, 0) / players.length,
    top120Ovr: top.slice(0, 120).reduce((a, p) => a + p.ovr, 0) / 120,
    n80: players.filter((p) => p.ovr >= 80).length, n75: players.filter((p) => p.ovr >= 75).length,
    meanAge: players.reduce((a, p) => a + p.age, 0) / players.length,
    payrollCap: ratios.reduce((a, b) => a + b, 0) / ratios.length,
    fundsMean: funds.reduce((a, b) => a + b, 0) / funds.length, fundsMin: Math.min(...funds), negFunds: funds.filter((v) => v < 0).length
  };
}

/** 시즌 기록에서 가볍게 줄인 한 줄(원자료 용량 줄이기) */
export const slim = (r) => { const { entry, ...rest } = r; return rest; };

/** 전략 하나로 n시즌을 돌려 시즌별 기록을 돌려준다. opts.metrics가 true면 매 시즌 시작에 리그 지표도 담는다 */
export function runCareer({ teamId, seed, seasons = 1, strat = null, metrics = false, keepEntries = false }) {
  const base = loadBase();
  const s = Session.create(base, { managerId: teamId, gmName: 'LAB', seed });
  const out = [];
  for (let i = 0; i < seasons; i++) {
    const lm = metrics ? leagueMetrics(s) : null;
    const power = s.teamPower?.(teamId)?.power ?? null;
    const r = playSeason(s, strat);
    out.push({ ...(keepEntries ? r : slim(r)), power, league: lm });
    if (i < seasons - 1) playOffseason(s, strat);
  }
  return out;
}
