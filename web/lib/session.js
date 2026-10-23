// 게임 진행 상태(세션). 브라우저 API를 쓰지 않아 node에서도 테스트한다.
//
// 저장하는 상태(game)는 JSON이다:
//   { version, seed, managerId, gm: { name }, league(시즌 시작 시점), log: [지난 시즌 결과], stage, day, actions, poRounds, seasonEnd, decisions }
//   stage: 'regular'(day 0 = 시즌 시작 전) → 'playoffs' → 'offseason' → 다음 시즌 'regular'
//   actions: 시즌 중 단장의 조작 [{ day, type: 'lineup', starters, bench } | { day, type: 'focus', playerId, stat } | { day, type: 'trade', trade } | { day, type: 'program', playerId, program('dleague'|'abroad'|null), stat }]
// 시즌 진행 상태(하루 결과·박스스코어·플레이오프 진행 등)는 저장하지 않는다. 시드와 조작 기록으로 처음부터 다시 돌려 복원한다(결정적이다).
// 오프시즌도 같다: 지금까지 내린 결정(decisions)으로 같은 시드의 오프시즌을 다시 돌리고, 결정이 필요한 곳에서 멈춘다(pending).
import { createLeague } from '../../src/league.mjs';
import { beginSeason, settleYear } from '../../src/season-run.mjs';
import { runOffseasonWith } from '../../src/decisions.mjs';
import { createManagerBot } from '../../src/manager-bot.mjs';
import { mulberry32, hashString } from '../../src/rng.mjs';
import { initialFunds } from '../../src/funds.mjs';
import { summarizeSeason, attachOffseason, VERSION as GAME_VERSION } from './game.js';

export const VERSION = 2;

export class Session {
  constructor(data, game) {
    if (game.version !== VERSION) throw new Error('저장된 게임의 형식이 맞지 않습니다');
    this.data = data;
    this.state = game;
    this.run = null;
    this.dayResults = [];
    this.offseason = null;
    this.listeners = new Set();
    this.rebuild();
  }

  static create(data, { managerId, gmName, seed = Date.now() % 1e9 }) {
    if (!data.teams.some((t) => t.id === managerId)) throw new Error(`알 수 없는 구단: ${managerId}`);
    const base = createLeague(data.players, data.rules, { history: data.history, teamData: data.teams, labelStart: true });
    const game = {
      version: VERSION, seed, managerId, gm: { name: gmName?.trim() || '단장' },
      league: { ...base, funds: initialFunds(data.teams, data.rules) }, log: [],
      stage: 'regular', day: 0, actions: [], poRounds: 0, seasonEnd: null, decisions: {}
    };
    return new Session(data, game);
  }

  /** 상태가 바뀔 때마다 부른다(자동 저장·화면 갱신용). 해제 함수를 돌려준다 */
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  // ---------- 조회 ----------
  get game() { return this.state; }
  get stage() { return this.state.stage; }
  get day() { return this.state.day; }
  get totalDays() { return this.run?.totalDays ?? this.data.rules.regularSeasonGames; }
  get season() { return this.state.league.season; }
  get managerId() { return this.state.managerId; }
  get regularDone() { return Boolean(this.run?.regularDone); }
  get playoffs() { return this.run?.playoffs ?? null; }
  get pending() { return this.offseason && !this.offseason.done ? this.offseason : null; }

  /** 지금 시점의 선수들(시즌 중에는 능력치가 갱신·훈련된 값, 오프시즌에는 시즌 종료 직후 값) */
  get players() {
    if (this.state.stage === 'offseason') return this.pending?.payload?.league?.players ?? this.state.seasonEnd.league.players;
    return this.run ? this.run.players : this.state.league.players;
  }
  get funds() {
    const base = (this.state.stage === 'offseason' ? this.state.seasonEnd.league.funds : this.state.league.funds) ?? initialFunds(this.data.teams, this.data.rules);
    const pending = this.state.stage === 'regular' ? this.run?.pendingSeverance ?? 0 : 0; // 방출 해지 비용은 바로 자금에서 뺀 값으로 보여 준다
    return pending ? { ...base, [this.state.managerId]: Math.round((base[this.state.managerId] - pending) * 100) / 100 } : base;
  }

  /** 기존 선택자(web/lib/game.js)가 쓰는 모양: { …game, league: { …league, players, funds } } */
  get view() {
    const league = this.state.stage === 'offseason' ? this.state.seasonEnd.league : this.state.league;
    return { ...this.state, league: { ...league, players: this.players, funds: this.funds } };
  }

  /** 정규리그 순위(진행 중이면 지금까지). [{ rank, id, wins, losses, pointsFor, pointsAgainst }] */
  standings() {
    if (this.state.stage === 'offseason') return this.state.seasonEnd.standings.map((s, i) => ({ rank: i + 1, ...s }));
    return this.run.standings().map((s, i) => ({ rank: i + 1, ...s }));
  }

  /** 우리 구단의 다음 경기: { day(몇 일차), home, oppId } 또는 null(정규리그 종료) */
  nextGame() {
    if (!this.run || this.run.regularDone) return null;
    const g = this.run.schedule[this.state.day].find((x) => x.homeId === this.managerId || x.awayId === this.managerId);
    return { day: this.state.day + 1, home: g.homeId === this.managerId, oppId: g.homeId === this.managerId ? g.awayId : g.homeId };
  }

  /** 지금까지 우리 구단 경기 [{ day, home, oppId, my, opp, win, ot, game(박스스코어 포함 원본) }] */
  myGames() {
    const my = this.managerId;
    const out = [];
    for (const d of this.dayResults) for (const g of d.games) {
      if (g.homeId !== my && g.awayId !== my) continue;
      const home = g.homeId === my;
      out.push({ day: d.day, home, oppId: home ? g.awayId : g.homeId, my: home ? g.homePts : g.awayPts, opp: home ? g.awayPts : g.homePts, win: g.winnerId === my, ot: g.overtimes, game: g });
    }
    return out;
  }

  /** 우리 구단 라인업(직접 편성이 있으면 그것, 없으면 null=자동) */
  get lineup() { return this.run?.lineup ?? null; }
  /** 우리 선수들의 훈련 지정 Map(playerId → 능력치) */
  get focus() { return this.run?.focus ?? new Map(); }
  /** 육성 프로그램(D리그·유학) 참가 중인 우리 선수: [{ playerId, player, program, stat, fromDay, before, locked }]. 이 선수들은 players(명단)에 없다 */
  get programs() { return this.run?.programs ?? []; }
  /** 이번 시즌 소환으로 끝난 D리그 파견 기록(보고서 항목과 같은 모양) */
  get programHistory() { return this.run?.programHistory ?? []; }
  /** 지난 시즌 육성 프로그램 결과 [{ playerId, name, program, before, after, … }] (시즌 종료 후·다음 시즌 초) */
  get lastProgramReport() { return (this.state.stage === 'offseason' ? this.state.seasonEnd.entry : this.state.log.at(-1))?.devProgram ?? []; }
  programCheck(playerId, program) { return this.run && this.state.stage === 'regular' ? this.run.programCheck(playerId, program) : { ok: false, reason: '지금은 보낼 수 없습니다' }; }

  // ---------- 시즌 진행 ----------
  /** 정규리그를 n일 진행(기본 1일). 반환: 날짜별 결과 배열 */
  advance(n = 1) {
    this.#need('regular');
    const out = this.run.playDays(n);
    this.dayResults.push(...out);
    this.state.day = this.run.day;
    this.emit();
    return out;
  }
  /** 우리 구단의 다음 경기가 있는 날까지(없으면 시즌 끝까지) — 지금은 매일 경기가 있어 1일과 같다 */
  advanceToDay(day) { return this.advance(Math.max(0, day - this.state.day)); }

  startPlayoffs() {
    this.#need('regular');
    if (!this.run.regularDone) throw new Error('정규리그가 아직 끝나지 않았습니다');
    this.run.startPlayoffs();
    this.state.stage = 'playoffs'; this.state.poRounds = 0;
    this.emit();
  }
  /** 플레이오프를 한 라운드 진행. 반환: 그 라운드의 시리즈들 */
  playoffRound() {
    this.#need('playoffs');
    const out = this.run.playoffRound();
    this.state.poRounds = this.run.playoffs.round;
    this.emit();
    return out;
  }
  /** 우리 구단의 플레이오프 진행 상태: 'out' | 'alive' | 'champion' | 'notQualified' */
  playoffStatus() {
    const po = this.run?.playoffs;
    if (!po) return null;
    const my = this.managerId;
    if (!po.seeds.has(my)) return 'notQualified';
    if (po.done) return po.result().championId === my ? 'champion' : 'out';
    const last = po.series.filter((s) => s.round === po.series.at(-1)?.round);
    if (po.round === 0) return 'alive';
    const playedMine = po.series.filter((s) => s.higherId === my || s.lowerId === my).at(-1);
    return playedMine && playedMine.winnerId !== my ? 'out' : (last ? 'alive' : 'alive');
  }

  /** 시즌 마무리 → 오프시즌 시작. 반환: 시즌 결과 항목 */
  endSeason() {
    this.#need('playoffs');
    if (!this.run.playoffs.done) throw new Error('플레이오프가 아직 끝나지 않았습니다');
    const fin = this.run.finish();
    const settled = settleYear(this.state.league, fin, this.data.teams, this.data.rules);
    const entry = summarizeSeason(this.state, this.data, this.state.league.season, fin, settled.ledger);
    if (fin.dev?.report.length) entry.devProgram = fin.dev.report; // 육성 프로그램 결과(뉴스·결산이 읽는다)
    if (fin.contracts) entry.contracts = { released: fin.contracts.releaseLog, extended: fin.contracts.extendLog, severance: fin.contracts.severance }; // 방출·연장 기록
    this.state.seasonEnd = { league: settled.league, standings: fin.result.standings, entry };
    this.state.stage = 'offseason'; this.state.decisions = {};
    this.runOffseason();
    this.emit();
    return entry;
  }

  // ---------- 단장의 조작 ----------
  /** 직접 편성(없애려면 null). 규칙에 맞지 않으면 { ok: false, errors } */
  setLineup(next) {
    this.#need('regular', 'playoffs');
    const r = this.run.setLineup(next);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'lineup', starters: next?.starters ?? null, bench: next?.bench ?? null }); this.emit(); }
    return r;
  }
  setFocus(playerId, stat) {
    this.#need('regular', 'playoffs');
    this.run.setFocus(playerId, stat);
    this.state.actions.push({ day: this.state.day, type: 'focus', playerId, stat });
    this.emit();
  }
  /** 육성 프로그램 파견('dleague' | 'abroad') 또는 소환(program이 null). 규칙에 맞지 않으면 { ok: false, errors } */
  setProgram(playerId, program, stat = null) {
    this.#need('regular');
    const r = this.run.setProgram(playerId, program, stat);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'program', playerId, program: program ?? null, stat }); this.emit(); }
    return r;
  }

  // ---------- 계약 관리: 방출과 연장 계약 (정규리그 중. 플레이오프가 시작되면 닫힌다) ----------
  /** 이 선수를 지금 방출할 수 있는지와 비용: { ok, reason, cost: { severance, earned, years, fraction, salaryEok } } */
  releaseCheck(playerId) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, reason: this.state.stage === 'offseason' ? '오프시즌에는 첫 단계(트레이드 화면)의 방출 구역에서 방출합니다' : '지금은 방출할 수 없습니다', cost: null };
    return this.run.releaseCheck(playerId);
  }
  /** 방출(계약 중도 해지). 규칙에 어긋나면 { ok: false, errors } */
  releasePlayer(playerId) {
    this.#need('regular');
    const r = this.run.releasePlayer(playerId);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'release', playerId }); this.emit(); }
    return r;
  }
  /** 연장 계약 미리 보기: offer = { salaryEok, years(총 기간) } → { ok, status, range, verdict, reason } */
  extendCheck(playerId, offer) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, status: 'invalid', reason: this.state.stage === 'offseason' ? '오프시즌에는 재계약 단계의 "연장 계약" 구역에서 합니다' : '지금은 연장할 수 없습니다' };
    return this.run.extendCheck(playerId, offer);
  }
  /** 연장 계약 제안. 수락되어야만 적용된다. 반환 { ok, errors, check } */
  extendContract(playerId, offer) {
    this.#need('regular');
    const r = this.run.extendContract(playerId, offer);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'extend', playerId, salaryEok: offer.salaryEok, years: offer.years }); this.emit(); }
    return r;
  }
  /** 이번 시즌 방출·연장 기록 */
  get contractLog() { return this.run?.contractLog ?? { released: [], extended: [] }; }

  // ---------- 시즌 중 트레이드 ----------
  /** 시즌 중 트레이드 창이 열려 있는지(정규리그 마감일 전) */
  get tradeOpen() { return Boolean(this.run?.tradeOpen) && this.state.stage === 'regular'; }
  get tradeDeadline() { return this.data.rules.transactions.trade.deadlineDay; }
  /** AI 구단이 지금 보내는 제안들(같은 날·같은 로스터면 항상 같다) */
  tradeOffers() {
    if (!this.tradeOpen) return [];
    const rng = mulberry32(hashString(`${this.state.seed}:${this.state.league.season}:offers:${this.state.day}:${this.state.actions.length}`));
    return this.run.tradeOffers(rng);
  }
  /** 우리가 먼저 거는 트레이드({ teamA, teamB, giveA, giveB }): AI가 받아들이면 바로 실행된다. 반환 { executed, reason, verdict } */
  proposeTrade(trade) {
    this.#need('regular');
    const r = this.run.proposeTrade(trade);
    if (r.executed) { this.state.actions.push({ day: this.state.day, type: 'trade', trade }); this.emit(); }
    return r;
  }
  /** AI의 제안(tradeOffers의 한 항목의 trade)을 받아들인다. 반환 { ok, errors } */
  acceptOffer(trade) {
    this.#need('regular');
    const r = this.run.executeTrade(trade);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'trade', trade }); this.emit(); }
    return r;
  }

  // ---------- 오프시즌 ----------
  /** 결정을 하나 내린다(key는 pending.key). 다 끝나면 다음 시즌이 시작된다 */
  decide(key, value) {
    this.#need('offseason');
    if (!this.pending || this.pending.key !== key) throw new Error(`지금 필요한 결정은 ${this.pending?.key ?? '없음'}입니다`);
    this.state.decisions = { ...this.state.decisions, [key]: value };
    this.runOffseason();
    this.emit();
  }
  /** 남은 오프시즌 결정을 자동 단장에게 맡긴다 */
  autoOffseason() {
    this.#need('offseason');
    this.state.decisions = { ...this.state.decisions, auto: true };
    this.runOffseason();
    this.emit();
  }

  /** (내부) 결정 기록으로 오프시즌을 다시 돌린다 */
  runOffseason() {
    const g = this.state, { rules, teams } = this.data;
    const rng = mulberry32(hashString(`${g.seed}:${g.league.season}:off`));
    const res = runOffseasonWith(g.seasonEnd.league, g.seasonEnd.standings, teams, rules, rng, {
      manager: g.managerId, decisions: g.decisions, fallback: createManagerBot(g.managerId, rules), cards: this.data.cards ?? null
    });
    this.offseason = res;
    if (res.done) this.completeOffseason(res);
  }

  completeOffseason(res) {
    const g = this.state;
    const entry = attachOffseason(g.seasonEnd.entry, res.report, res.league.funds);
    g.log = [...g.log, entry];
    g.league = res.league;
    g.stage = 'regular'; g.day = 0; g.actions = []; g.poRounds = 0; g.seasonEnd = null; g.decisions = {};
    this.offseason = null;
    this.rebuild();
  }

  /** 오프시즌 중 한 시점에서 (시즌 종료 직후 → 성장·은퇴가 반영된 상태)의 선수 변화: { progressed, retired } */
  offseasonChanges() {
    const p = this.pending?.payload?.league;
    if (!p) return null;
    const before = new Map(this.state.seasonEnd.league.players.map((x) => [x.id, x]));
    const after = new Map(p.players.map((x) => [x.id, x]));
    const progressed = [], retired = [];
    for (const [id, old] of before) {
      const now = after.get(id);
      if (!now) retired.push({ id, name: old.name, teamId: old.teamId, age: old.age + 1, ovr: old.ovr, origin: old.origin });
      else progressed.push({ id, name: now.name, teamId: now.teamId, age: now.age, from: old.ovr, to: now.ovr, delta: now.ovr - old.ovr });
    }
    return { progressed, retired };
  }

  // ---------- 복원 ----------
  rebuild() {
    const g = this.state, { rules, teams } = this.data;
    this.dayResults = [];
    if (g.stage === 'offseason') { this.run = null; this.runOffseason(); return; }
    const rng = mulberry32(hashString(`${g.seed}:${g.league.season}`));
    const run = beginSeason(g.league, teams, rules, rng, { manager: g.managerId, keepGames: true });
    this.run = run;
    let ai = 0;
    const due = () => {
      while (ai < g.actions.length && g.actions[ai].day <= run.day) {
        const a = g.actions[ai++];
        if (a.type === 'lineup') run.setLineup(a.starters ? { starters: a.starters, bench: a.bench } : null);
        else if (a.type === 'focus') run.setFocus(a.playerId, a.stat);
        else if (a.type === 'trade') run.executeTrade(a.trade);
        else if (a.type === 'program') run.setProgram(a.playerId, a.program, a.stat);
        else if (a.type === 'release') run.releasePlayer(a.playerId);
        else if (a.type === 'extend') run.extendContract(a.playerId, { salaryEok: a.salaryEok, years: a.years });
      }
    };
    due();
    while (run.day < g.day) { due(); this.dayResults.push(run.playDay()); }
    due();
    if (g.stage === 'playoffs') { run.startPlayoffs(); for (let i = 0; i < g.poRounds; i++) run.playoffRound(); }
  }

  #need(...stages) {
    if (!stages.includes(this.state.stage)) throw new Error(`지금(${this.state.stage})은 할 수 없는 일입니다`);
  }
}

/** 세션이 저장하는 JSON 문자열(저장 슬롯용) */
export const serialize = (session) => JSON.stringify(session.game);
export const restore = (data, text) => new Session(data, JSON.parse(text));
