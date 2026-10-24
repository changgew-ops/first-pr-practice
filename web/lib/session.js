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
import { staffOf } from '../../src/coaching.mjs';
import { rulesFor } from '../../src/economy.mjs';
import { summarizeSeason, attachOffseason, pruneGame, seasonGoals, bonusFunds, seasonLabel, VERSION as GAME_VERSION } from './game.js';
import { trustOf } from '../../src/goals.mjs';
import { moodOf } from '../../src/fans.mjs';
import { newCodexKeys } from '../../src/codex.mjs';
import { newAchievements } from '../../src/achievements.mjs';
import { buildPreview } from '../../src/preview.mjs';
import { teamPower, powerOfLineup } from './game.js';
import { prestigeTable } from '../../src/legacy.mjs';

export const VERSION = 2;

const previewMemo = new Map(); // `${seed}:${시즌}` → 시즌 시작 전에 만든 프리뷰(화면을 여는 동안 유지)

export class Session {
  constructor(data, game) {
    if (game.version !== VERSION) throw new Error('저장된 게임의 형식이 맞지 않습니다');
    this.data = data;
    this.state = game;
    this.run = null;
    this.dayResults = [];
    this.offseason = null;
    this.listeners = new Set();
    this.fresh = []; // 방금 달성한 업적 id(화면이 토스트로 알리고 비운다)
    this.rebuild();
    this.syncMeta(false);
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
  emit() { this.syncMeta(true); for (const fn of this.listeners) fn(this); }

  // ---------- 조회 ----------
  get game() { return this.state; }
  get stage() { return this.state.stage; }
  get day() { return this.state.day; }
  get totalDays() { return this.run?.totalDays ?? this.data.rules.regularSeasonGames; }
  get season() { return this.state.league.season; }
  /** 원본 규칙(물가 반영 전) */
  get baseRules() { return this.data.baseRules ?? this.data.rules; }
  /** 지금 시즌의 규칙: 금액 상수에 물가 지수를 곱한 것(src/economy.mjs). 오프시즌에는 다음 시즌 규칙 */
  get rules() {
    const g = this.state;
    return rulesFor(this.baseRules, g.stage === 'offseason' && g.seasonEnd ? g.seasonEnd.league.season + 1 : g.league.season);
  }
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

  /**
   * 시즌 프리뷰(src/preview.mjs): 우승·플레이오프 확률, 기자단 예측, 예상 베스트5, 가상 배당.
   * 시즌 시작 전(0일차)의 전력으로 만들고, 시즌이 시작된 뒤에도 그 값을 보여 주도록 이 화면을 연 동안은 기억해 둔다
   * (저장했다가 다시 불러온 경우에는 불러온 시점의 로스터로 다시 계산한다). 반환: { …buildPreview, atStart(0일차에 계산했는가) }
   */
  preview() {
    const key = `${this.state.seed}:${this.season}`;
    const hit = previewMemo.get(key);
    const atStart = this.state.stage === 'regular' && this.state.day === 0;
    if (hit && !atStart) return { ...hit.pv, atStart: false };
    if (this.state.stage === 'offseason') return null;
    const data = this.data, rules = this.rules, view = this.view;
    const powers = Object.fromEntries(data.teams.map((t) => [t.id, teamPower(view, { ...data, rules }, t.id).power]));
    const sig = Object.values(powers).map((v) => v.toFixed(3)).join(',');
    if (hit && hit.sig === sig) return { ...hit.pv, atStart };
    const prestige = Object.fromEntries(Object.entries(prestigeTable(this.state.league.legacy, rules)).map(([id, v]) => [id, v.score]));
    const players = this.players.filter((p) => p.teamId).map((p) => ({ id: p.id, name: p.name, baseName: p.baseName ?? p.name, teamId: p.teamId, position: p.position, ovr: p.ovr, potential: p.potential, cost: p.cost, age: p.age, origin: p.origin }));
    const pv = buildPreview({
      season: seasonLabel(this.season), myId: this.managerId, teams: data.teams.map((t) => ({ id: t.id, name: t.name })), players, powers, prestige,
      games: rules.regularSeasonGames, playoffs: rules.playoffs, rules: rules.preview
    });
    previewMemo.set(key, { sig, pv });
    return { ...pv, atStart };
  }

  /**
   * 다음 경기에 실제로 쓰일 구단 편성(엔진의 값: 직접 편성·부상 대체·휴식·컨디션 반영). 시즌 중이 아니면 로스터에서 자동으로 짠 편성.
   * 화면의 "전력"은 모두 이 편성으로 계산한다.
   */
  lineupOf(teamId) {
    const live = this.run && (this.state.stage === 'regular' || this.state.stage === 'playoffs') ? this.run.lineupOf(teamId) : null;
    if (live) return live;
    return teamPower(this.view, { ...this.data, rules: this.rules }, teamId).lineup;
  }
  /** 구단 전력: 실제 출전 편성의 스타팅 OVR 평균 70% + 벤치 30%. 반환 { lineup, power } */
  teamPower(teamId) {
    const lineup = this.lineupOf(teamId);
    return { lineup, power: powerOfLineup(lineup) };
  }
  /** 10개 구단 전력 순위(실제 출전 편성 기준): [{ id, power, rank }] */
  powerRanking() {
    const rows = this.data.teams.map((t) => ({ id: t.id, power: this.teamPower(t.id).power }));
    rows.sort((a, b) => b.power - a.power);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
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
    if (settled.staffMoves?.length) entry.staffMoves = settled.staffMoves; // AI 구단의 감독 교체(뉴스가 읽는다)
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
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'lineup', starters: next?.starters ?? null, bench: next?.bench ?? null, ...this.#poMark() }); this.emit(); }
    return r;
  }
  setFocus(playerId, stat) {
    this.#need('regular', 'playoffs');
    this.run.setFocus(playerId, stat);
    this.state.actions.push({ day: this.state.day, type: 'focus', playerId, stat, ...this.#poMark() });
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
  // ---------- 웨이버: 공시 중인 선수를 양수 신청한다(마감 때 전 시즌 순위 역순 우선권으로 정해진다, src/waivers.mjs) ----------
  /** 공시 중인 선수들: [{ player, fromTeamId, day, expires, left, mine, check, priority }] */
  get waivers() { return this.state.stage === 'regular' && this.run ? this.run.waivers : []; }
  waiverCheck(playerId) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, reason: '지금은 양수할 수 없습니다' };
    return this.run.waiverCheck(playerId);
  }
  /** 양수 신청. 반환 { ok, errors } */
  claimWaiver(playerId) {
    this.#need('regular');
    const r = this.run.claimWaiver(playerId);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'claim', playerId }); this.emit(); }
    return r;
  }
  /** 양수 신청 취소 */
  cancelWaiverClaim(playerId) {
    this.#need('regular');
    const r = this.run.cancelWaiverClaim(playerId);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'unclaim', playerId }); this.emit(); }
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

  // ---------- 부상과 시즌 중 선수단 변동 ----------
  /** 지금 결장 중인 선수들(전 구단): [{ playerId, name, teamId, day, total, left, kind, part, temp }] */
  get injuries() { return this.run?.injuries ?? []; }
  /** 이 선수의 지금 부상(없으면 null) */
  injuryOf(playerId) { return this.run?.injuryOf(playerId) ?? null; }
  /** 우리 직접 편성에서 부상 선수를 대신해 자동으로 들어간 선수들 [{ out, in }] */
  get lineupSwaps() { return this.run?.lineupSwaps ?? []; }
  /** 이번 시즌의 변동 기록(부상·복귀·FA 영입·외국인 교체·방출) */
  get rosterLog() { return this.run?.rosterLog ?? []; }
  /** 시즌 중 FA 시장: [{ player, asking }] */
  faMarket() { return this.state.stage === 'regular' && this.run ? this.run.faMarket() : []; }
  faCheck(playerId, offer) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, reason: '지금은 영입할 수 없습니다', asking: null, range: null };
    return this.run.faCheck(playerId, offer);
  }
  /** 시즌 중 FA 영입. offer = { salaryEok, years(이번 시즌 포함) }. 반환 { ok, errors, player } */
  signFa(playerId, offer) {
    this.#need('regular');
    const r = this.run.signFa(playerId, offer);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'fasign', playerId, salaryEok: offer.salaryEok, years: offer.years }); this.emit(); }
    return r;
  }
  /** 외국선수 교체 후보 [{ player, usd }] */
  foreignMarket() { return this.state.stage === 'regular' && this.run ? this.run.foreignMarket() : []; }
  /** kind: 'temp'(일시교체) | 'season'(부상 시즌대체) | 'other'(기타 사유 시즌대체) */
  foreignCheck(outId, kind, candId) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, reason: '지금은 교체할 수 없습니다' };
    return this.run.foreignCheck(outId, kind, candId);
  }
  replaceForeign(outId, kind, candId) {
    this.#need('regular');
    const r = this.run.replaceForeign(outId, kind, candId);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'forrep', outId, kind, candId }); this.emit(); }
    return r;
  }
  get otherReplacements() { return this.run?.otherReplacements ?? { used: 0, limit: 2 }; }
  get foreignThresholds() { return this.run?.foreignThresholds ?? { temporary: 5, season: 18 }; }
  /** 아시아쿼터 교체 후보 [{ player, eok }] (외국인 풀과 따로, 규칙은 외국인과 같은 게임용 가정) */
  asiaMarket() { return this.state.stage === 'regular' && this.run ? this.run.asiaMarket() : []; }
  get asiaOtherReplacements() { return this.run?.asiaOtherReplacements ?? { used: 0, limit: 2 }; }
  get asiaThresholds() { return this.run?.asiaThresholds ?? { temporary: 5, season: 18 }; }

  // ---------- 감독·코치진, 전술·컨디션 (src/coaching.mjs, tactics.mjs, condition.mjs) ----------
  /** 구단별 스태프 { [구단 id]: { head, off, def, cond } }. 시즌 중에는 진행기의 값, 오프시즌에는 다음 시즌으로 넘어간 값. 기능이 꺼져 있으면 null */
  get staff() {
    if (this.run) return this.run.staff;
    const league = this.state.stage === 'offseason' ? this.state.seasonEnd?.league : this.state.league;
    return this.baseRules.coaching?.enabled ? staffOf(league ?? {}, this.data.teams, this.rules) : null;
  }
  /** 영입 후보 { head, off, def, cond } */
  get staffPool() { return this.run && this.state.stage === 'regular' ? this.run.staffPool() : null; }
  /** 해임·영입 미리 보기: { ok, reason, buyout, pay, from, to } */
  staffCheck(role, candId, years) {
    if (this.state.stage !== 'regular' || !this.run) return { ok: false, reason: this.state.stage === 'offseason' ? '시즌이 시작되면(오프시즌이 끝난 뒤) 바꿀 수 있습니다' : '지금은 바꿀 수 없습니다' };
    return this.run.staffCheck(role, candId, years);
  }
  /** 해임하고 영입한다(정규리그 중·시즌 시작 전). 반환 { ok, errors, check } */
  replaceStaff(role, candId, years) {
    this.#need('regular');
    const r = this.run.replaceStaff(role, candId, years);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'staff', role, candId, years }); this.emit(); }
    return r;
  }
  /** 우리 구단의 전술 { choice, current, refs, list: [{ id, name, desc, fit }] } (꺼져 있으면 null) */
  get tactics() { return this.run?.tactics ?? null; }
  /** 전술을 고른다(null이면 추천 따르기). 정규리그 중에만. 반환 { ok, errors } */
  setTactic(id) {
    this.#need('regular');
    const r = this.run.setTactic(id);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'tactic', id: id ?? null }); this.emit(); }
    return r;
  }
  /** 모든 선수의 컨디션 Map(선수 id → 0~100). 시즌 중이 아니면 빈 Map */
  get conditions() { return this.run?.conditions ?? new Map(); }
  /** 다음 경기에서 쉬게 한 우리 선수 id들 */
  get rest() { return this.run?.rest ?? []; }
  /** 다음 경기에서 쉴 선수를 지정한다(빈 배열이면 해제). 반환 { ok, errors } */
  setRest(ids) {
    this.#need('regular');
    const r = this.run.setRest(ids);
    if (r.ok) { this.state.actions.push({ day: this.state.day, type: 'rest', ids: [...ids] }); this.emit(); }
    return r;
  }
  /** 구단별 팀 보정 { [구단 id]: { tactic, fit, edge, parts: { coach, tactic, cond } } } */
  get teamMods() { return this.run?.teamMods ?? {}; }

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

  // ---------- 모기업 목표·팬 열기·도감·업적(상태는 game 필드로만 얹는다: codex·achievements) ----------
  /** 이번 시즌 모기업 목표(시즌 시작 상태에서 정해진다). 오프시즌 중에는 아직 다음 시즌 목표가 없어 null */
  get goals() {
    if (this.state.stage === 'offseason' || !this.baseRules.goals) return null;
    return seasonGoals(this.state, this.data);
  }
  /** 단장 신뢰도(지난 시즌 평가까지 반영) */
  get trust() { return this.baseRules.goals ? (this.lastEval?.trust ?? trustOf(this.state.log, this.baseRules)) : null; }
  /** 가장 최근에 끝난 시즌의 평가(entry.eval) */
  get lastEval() { return (this.state.stage === 'offseason' ? this.state.seasonEnd.entry : this.state.log.at(-1))?.eval ?? null; }
  /** 우리 구단의 팬 열기(0~100, src/fans.mjs). 규칙이 없으면 null */
  get fans() {
    const att = (this.state.stage === 'offseason' ? this.state.seasonEnd.league : this.state.league).att;
    return this.baseRules.fans ? moodOf(att, this.state.managerId, this.baseRules) : null;
  }
  /** 도감: 한 번이라도 우리 구단에 있었던 카드 키 목록 */
  get codex() { return this.state.codex ?? []; }
  /** 달성한 업적 { id: 시즌 } */
  get achievements() { return this.state.achievements ?? {}; }
  /** 방금 달성한 업적 id를 꺼내 간다 */
  takeFresh() { const out = this.fresh; this.fresh = []; return out; }

  /** (내부) 도감과 업적을 지금 상태에 맞춘다. announce가 true면 새 업적을 fresh에 쌓는다(불러오기 때는 조용히 따라잡는다) */
  syncMeta(announce) {
    const g = this.state, my = g.managerId;
    try {
      const add = newCodexKeys(g.codex, this.players, my);
      if (add.length) g.codex = [...(g.codex ?? []), ...add];
      const rules = this.baseRules;
      if (!rules.achievements) return;
      const roster = this.players.filter((p) => p.teamId === my);
      const first = this.data.history?.seasons?.at(-1)?.teams?.find((t) => t.franchiseId === my)?.rank ?? null;
      const ids = newAchievements(g.achievements, {
        log: g.log, my, roster, funds: this.funds[my], codexCount: (g.codex ?? []).length, mood: this.fans, trust: this.trust,
        startSeason: rules.season, firstPrevRank: first, rules
      });
      if (ids.length) {
        const when = seasonLabel(g.league.season);
        g.achievements = { ...(g.achievements ?? {}), ...Object.fromEntries(ids.map((id) => [id, when])) };
        if (announce) this.fresh.push(...ids);
      }
    } catch (e) { console.warn('도감·업적 갱신 실패:', e.message); }
  }

  /** (내부) 결정 기록으로 오프시즌을 다시 돌린다 */
  runOffseason() {
    const g = this.state, { rules, teams } = this.data;
    const rng = mulberry32(hashString(`${g.seed}:${g.league.season}:off`));
    const res = runOffseasonWith(g.seasonEnd.league, g.seasonEnd.standings, teams, rules, rng, {
      manager: g.managerId, decisions: g.decisions, fallback: createManagerBot(g.managerId, this.rules), cards: this.data.cards ?? null
    });
    this.offseason = res;
    if (res.done) this.completeOffseason(res);
  }

  completeOffseason(res) {
    const g = this.state;
    const funds = bonusFunds(res.league.funds, g.seasonEnd.entry); // 모기업 목표 보너스(신뢰도가 높을 때)를 다음 시즌 자금에 더한다
    const entry = attachOffseason(g.seasonEnd.entry, res.report, funds);
    g.log = [...g.log, entry];
    g.league = funds === res.league.funds ? res.league : { ...res.league, funds };
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
    const run = beginSeason(g.league, teams, rules, rng, { manager: g.managerId, keepGames: true, seed: g.seed, cards: this.data.cards ?? null });
    this.run = run;
    let ai = 0;
    const apply = (a) => {
      if (a.type === 'lineup') run.setLineup(a.starters ? { starters: a.starters, bench: a.bench } : null);
      else if (a.type === 'focus') run.setFocus(a.playerId, a.stat);
      else if (a.type === 'trade') run.executeTrade(a.trade);
      else if (a.type === 'program') run.setProgram(a.playerId, a.program, a.stat);
      else if (a.type === 'release') run.releasePlayer(a.playerId);
      else if (a.type === 'claim') run.claimWaiver(a.playerId);
      else if (a.type === 'unclaim') run.cancelWaiverClaim(a.playerId);
      else if (a.type === 'extend') run.extendContract(a.playerId, { salaryEok: a.salaryEok, years: a.years });
      else if (a.type === 'fasign') run.signFa(a.playerId, { salaryEok: a.salaryEok, years: a.years });
      else if (a.type === 'forrep') run.replaceForeign(a.outId, a.kind, a.candId);
      else if (a.type === 'tactic') run.setTactic(a.id);
      else if (a.type === 'rest') run.setRest(a.ids);
      else if (a.type === 'staff') run.replaceStaff(a.role, a.candId, a.years);
    };
    const due = () => {
      // po가 있는 조작은 플레이오프 중에 한 것이라 아래에서 라운드 수에 맞춰 적용한다(옛 저장에는 po가 없고, 그때는 예전처럼 정규리그 끝에 적용된다)
      while (ai < g.actions.length && g.actions[ai].po == null && g.actions[ai].day <= run.day) apply(g.actions[ai++]);
    };
    due();
    while (run.day < g.day) { due(); this.dayResults.push(run.playDay()); }
    due();
    if (g.stage === 'playoffs') {
      run.startPlayoffs();
      const poDue = (rounds) => { while (ai < g.actions.length && (g.actions[ai].po ?? 0) <= rounds) apply(g.actions[ai++]); };
      poDue(0);
      for (let i = 0; i < g.poRounds; i++) { run.playoffRound(); poDue(i + 1); }
    }
  }

  /** 플레이오프 중의 조작에 붙이는 표시: 지금까지 치른 라운드 수(복원할 때 그 시점에 다시 적용한다) */
  #poMark() { return this.state.stage === 'playoffs' ? { po: this.state.poRounds } : {}; }

  #need(...stages) {
    if (!stages.includes(this.state.stage)) throw new Error(`지금(${this.state.stage})은 할 수 없는 일입니다`);
  }
}

/**
 * 세션이 저장하는 JSON 문자열(저장 슬롯용). 로그(지난 시즌 결과)는 화면에 보여 주는 기록일 뿐 시즌을 다시 돌리는 데 쓰이지 않으므로(복원은 league·actions·decisions·시드),
 * 오래된 시즌은 화면이 읽는 요약만 남긴다(최근 rules.save.keepSeasonsDetail시즌은 전체. game.js pruneGame). 살아 있는 세션의 game은 줄이지 않는다.
 */
export const serialize = (session) => JSON.stringify(pruneGame(session.game, session.data?.rules?.save?.keepSeasonsDetail));
export const restore = (data, text) => new Session(data, JSON.parse(text));
