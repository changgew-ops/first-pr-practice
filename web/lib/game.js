// 화면이 쓰는 게임 상태와 규칙 호출. 브라우저 API를 쓰지 않는 순수 모듈이라 node에서도 테스트한다.
// 상태(game)는 JSON으로 저장할 수 있다: { version, seed, managerId, league, log: [시즌 결과 …] }
import { createLeague, playLeagueYear } from '../../src/league.mjs';
import { compactRegular, compactPlayoffs, entryRows, liveRows } from '../../src/player-record.mjs';
import { createManagerBot } from '../../src/manager-bot.mjs';
import { mulberry32, hashString } from '../../src/rng.mjs';
import { prestigeTable } from '../../src/legacy.mjs';
import { buildLineup } from '../../src/lineup.mjs';
import { powerOfLineup, computeTeamMods, effectiveOf } from '../../src/effective.mjs';
import { coachingOn, staffOf } from '../../src/coaching.mjs';
import { initialFunds } from '../../src/funds.mjs';
import { domesticOf, foreignOf, asiaOf, payrollEok, hardLimitEok } from '../../src/valuation.mjs';
import { franchiseSummary } from '../../src/history-summary.mjs';
import { computeAwards } from '../../src/awards.mjs';
import { rulesFor, inflationIndex } from '../../src/economy.mjs';
import { chooseGoals, evaluateSeason, expectedRank, trustOf, lowStreakOf, rewardOf } from '../../src/goals.mjs';

export const VERSION = 1;
export const seasonLabel = (startYear) => `${startYear}-${String(startYear + 1).slice(2)}`;

export function newGame(data, managerId, seed = Date.now() % 1e9) {
  if (!data.teams.some((t) => t.id === managerId)) throw new Error(`알 수 없는 구단: ${managerId}`);
  const league = createLeague(data.players, data.rules, { history: data.history, teamData: data.teams });
  return { version: VERSION, seed, managerId, league: { ...league, funds: initialFunds(data.teams, data.rules) }, log: [] };
}

export const fundsOf = (game, data, teamId) => (game.league.funds ?? initialFunds(data.teams, data.rules))[teamId];
export const rosterOf = (game, teamId) => game.league.players.filter((p) => p.teamId === teamId);
export const playerById = (game, id) => game.league.players.find((p) => p.id === id);

/** 기본 전력: 스타팅 OVR 평균 70% + 벤치 OVR 평균 30%(src/effective.mjs와 같은 함수) */
export { powerOfLineup };

// 구단 → 유효 전력 표 캐시(같은 리그 상태·규칙이면 같은 결과라 다시 계산하지 않는다)
const tableMemo = new WeakMap();

/**
 * 로스터에서 자동으로 짠 편성으로 구한 모든 구단의 유효 전력 표: Map(구단 id → { lineup, baseOvr, edge, parts, tactic, fit, effective, pointsPerPower }).
 * 시즌 시작 전(새 게임 구단 고르기·프리뷰·오프시즌)에 쓴다. 컨디션은 모두 새것(중립), 전술은 추천 따르기, 감독·코치는 그 구단의 스태프(src/coaching.mjs).
 * 시즌 중에는 세션의 teamPower(엔진이 실제로 쓰는 편성·보정)를 쓴다.
 */
export function effectiveTable(game, data) {
  const key = game.league;
  const hit = tableMemo.get(key);
  if (hit && hit.rules === data.rules) return hit.table;
  const rules = data.rules;
  const teams = data.teams.map((t) => ({ id: t.id, lineup: buildLineup(rosterOf(game, t.id), rules, rules.simulation.benchWeight) }));
  const staff = coachingOn(rules) ? staffOf(game.league, data.teams, rules) : null;
  const { mods } = computeTeamMods(teams, { rules, staff, manager: game.managerId, tacticChoice: null, condition: false, cond: new Map(), meanIds: null });
  const table = new Map(teams.map((t) => [t.id, { lineup: t.lineup, ...effectiveOf(t.lineup, mods.get(t.id), rules) }]));
  tableMemo.set(key, { rules: data.rules, table });
  return table;
}

/** 시즌 시작 전·오프시즌의 구단 전력. power = 유효 전력(표시 기본값), baseOvr = 기본 OVR 전력 */
export function teamPower(game, data, teamId) {
  const e = effectiveTable(game, data).get(teamId);
  return { ...e, power: e.effective };
}

/** 10개 구단 전력 순위(유효 전력 기준): [{ id, power, baseOvr, edge, rank }] */
export function powerRanking(game, data) {
  const rows = data.teams.map((t) => { const e = teamPower(game, data, t.id); return { id: t.id, power: e.power, baseOvr: e.baseOvr, edge: e.edge }; });
  rows.sort((a, b) => b.power - a.power);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function payrollInfo(game, data, teamId) {
  const players = game.league.players;
  const cap = data.rules.salaryCap.domesticEok;
  const domestic = payrollEok(players, teamId);
  return {
    domestic, cap, hardLimit: hardLimitEok(data.rules), over: Math.max(0, domestic - cap),
    asia: asiaOf(players, teamId).reduce((s, p) => s + p.contract.salaryEok, 0),
    foreignUsd: foreignOf(players, teamId).reduce((s, p) => s + p.contract.salaryUsd, 0),
    counts: { domestic: domesticOf(players, teamId).length, foreign: foreignOf(players, teamId).length, asia: asiaOf(players, teamId).length }
  };
}

export const prestigeOf = (game, data) => prestigeTable(game.league.legacy, data.rules);

// ---------- 시즌 진행 ----------
/** 한 시즌(정규리그 → 플레이오프 → 오프시즌)을 진행한다. 단장 결정은 아직 자동 단장이 대신한다. */
export function playYear(game, data) {
  const { rules, teams } = data;
  const season = game.league.season;
  const rng = mulberry32(hashString(`${game.seed}:${season}`)); // 시즌마다 시드가 정해져 저장 후 이어도 같은 결과
  const out = playLeagueYear(game.league, teams, rules, rng, {
    manager: game.managerId, keepGames: true, policy: createManagerBot(game.managerId, rules)
  });
  const entry = summarizeYear(game, data, season, out);
  const funds = bonusFunds(out.league.funds, entry); // 모기업 목표 보너스(src/goals.mjs): 신뢰도가 높으면 다음 시즌 예산에 더한다
  return { ...game, league: funds === out.league.funds ? out.league : { ...out.league, funds }, log: [...game.log, funds === out.league.funds ? entry : { ...entry, fundsAfter: funds }] };
}

// 선수 시즌 기록 한 줄: 앞 7칸은 예전부터(careerLines가 읽는다), 다음 7칸(야투·3점·자유투 성공/시도와 시즌 끝 소속)은 리그 화면의 전체 기록용, 마지막 2칸은 턴오버·파울. 이전 저장에는 뒤쪽 칸이 없다
const line = (t, teamId) => [t.games, t.minutes, t.points, t.rebounds, t.assists, t.steals, t.blocks, t.fgm ?? 0, t.fga ?? 0, t.tpm ?? 0, t.tpa ?? 0, t.ftm ?? 0, t.fta ?? 0, teamId ?? null, t.turnovers ?? null, t.fouls ?? null];
export const LINE_KEYS = ['games', 'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'teamId', 'turnovers', 'fouls'];

function summarizeYear(game, data, season, out) {
  const entry = summarizeSeason(game, data, season, { result: out.result, totals: out.totals, splits: out.splits, seasonPlayers: out.seasonPlayers }, out.report.ledger);
  return attachOffseason(entry, out.report, out.league.funds);
}

/** 이번 시즌 신인: 직전 오프시즌 드래프트 지명자(바로 앞 시즌 결과의 report.drafted). 기록이 없는 첫 시즌은 null(규칙의 나이 기준을 쓴다) */
function rookieIdsOf(game) {
  const drafted = game.log?.at(-1)?.report?.drafted;
  return drafted ? new Set(drafted.map((d) => d.id)) : null;
}

// ---------- 모기업 목표 ----------
const GOAL_CACHE = new WeakMap();
/**
 * 이번 시즌 모기업 목표(src/goals.mjs). game.league가 시즌 시작 상태일 때(시즌 중·플레이오프·시즌 종료 직후) 호출한다. 규칙에 goals가 없으면 [].
 * 직전 시즌 순위(없으면 실제 이력의 마지막 시즌)와 지금 전력 순위의 평균으로 난이도를 정한다. 같은 상태면 같은 목표(결정적).
 */
export function seasonGoals(game, data) {
  const hit = GOAL_CACHE.get(game.league);
  if (hit) return hit;
  const my = game.managerId, season = game.league.season;
  const rules = rulesFor(data.rules, season);
  if (!rules.goals) return [];
  const last = game.log?.at(-1);
  const prev = last ? last.standings.find((s) => s.id === my) : data.history?.seasons?.at(-1)?.teams?.find((t) => t.franchiseId === my);
  const power = powerRanking(game, data).find((r) => r.id === my)?.rank ?? 5;
  const roster = rosterOf(game, my);
  const goals = chooseGoals({
    expected: expectedRank(prev?.rank ?? null, power, data.teams.length),
    payrollRatio: payrollEok(game.league.players, my) / rules.salaryCap.domesticEok,
    hasYouth: roster.some((p) => p.age <= rules.goals.extra.youthMaxAge), season, teamId: my
  }, rules);
  GOAL_CACHE.set(game.league, goals);
  return goals;
}

/** 시즌 평가(entry.eval): 목표별 결과와 신뢰도 변화. 규칙에 goals가 없으면 null */
function seasonEval(game, data, finished, ledger, season) {
  const rules = rulesFor(data.rules, season);
  if (!rules.goals) return null;
  const my = game.managerId;
  const { result, totals, seasonPlayers } = finished;
  const i = result.standings.findIndex((s) => s.id === my);
  const row = result.standings[i];
  const youth = seasonPlayers.filter((p) => p.teamId === my && p.age <= rules.goals.extra.youthMaxAge).reduce((s, p) => s + (totals.get(p.id)?.minutes ?? 0), 0);
  const ev = evaluateSeason({
    goals: seasonGoals(game, data),
    actual: { rank: i + 1, wins: row.wins, losses: row.losses, stage: stageOf(result.playoffs, my), net: ledger?.[my]?.net ?? 0, payrollRatio: payrollEok(seasonPlayers, my) / rules.salaryCap.domesticEok, youthMinutes: youth },
    before: { trust: trustOf(game.log, rules), low: lowStreakOf(game.log) }
  }, rules);
  const bonus = rewardOf(ev, inflationIndex(season + 1, rules), rules);
  return bonus ? { ...ev, bonus } : ev;
}

/** 목표 보너스(entry.eval.bonus)를 우리 구단 자금에 더한 자금표. 보너스가 없으면 같은 객체를 돌려준다 */
export function bonusFunds(funds, entry) {
  const bonus = entry.eval?.bonus ?? 0;
  if (!bonus || !funds) return funds;
  return { ...funds, [entry.myTeamId]: Math.round((funds[entry.myTeamId] + bonus) * 100) / 100 };
}

function seasonAwards(game, data, finished) {
  const { result, totals, seasonPlayers } = finished;
  return computeAwards({
    players: seasonPlayers, totals, standings: result.standings, playoffs: { series: result.playoffs.series, championId: result.championId },
    finalName: data.rules.playoffs.rounds.at(-1).name, rookieIds: rookieIdsOf(game), rules: data.rules
  });
}

/** 시즌 결과(순위·플레이오프·리더·우리 팀 경기·장부)만 묶는다. 오프시즌 보고서는 attachOffseason으로 나중에 붙인다 */
/**
 * 시즌 중 변동 기록(run.rosterLog)의 저장용 요약(작게): 우리 구단 부상 전부와 리그의 5경기 이상 부상, 우리 구단 FA 영입, 모든 외국인 교체.
 * inj 행 = [선수 id, 구단, 날짜, 결장 경기, 종류, 부위, 이름], mv 행 = ['fa', null, 날짜, 구단, 이름, 연봉(억), 연수, OVR] | ['foreign', 교체 종류, 날짜, 구단, 이름, 나간 선수, 연봉($ — 아시아쿼터는 억 원), OVR, (아시아쿼터면 1)]
 * | ['wv', 'waive'|'claim'|'waiver_fa'|'claim_fail', 날짜, 구단, 이름, 공시한 구단, 연봉(억), OVR, 사유] (우리 구단이 얽힌 웨이버만)
 */
export function rosterSummary(log, my) {
  const inj = log.filter((e) => e.type === 'injury' && (e.games >= 5 || e.teamId === my)).map((e) => [e.playerId, e.teamId, e.day, e.games, e.kind, e.part, e.name]);
  const wvMine = (e) => (e.type === 'waive' && e.teamId === my) || (e.type === 'claim' && (e.teamId === my || e.fromTeamId === my)) || (e.type === 'waiver_fa' && e.teamId === my) || (e.type === 'claim_fail' && e.teamId === my);
  const mv = log.filter((e) => (e.type === 'fa' && e.teamId === my) || (e.type === 'foreign' && ['temp', 'season', 'other'].includes(e.kind)) || wvMine(e))
    .map((e) => (e.type === 'fa' ? ['fa', null, e.day, e.teamId, e.name, e.salaryEok, e.years, e.ovr]
      : e.type === 'foreign' ? ['foreign', e.kind, e.day, e.teamId, e.name, e.outName, e.asia ? e.eok : e.usd, e.ovr, ...(e.asia ? [1] : [])]
      : ['wv', e.type, e.day, e.teamId, e.name, e.fromTeamId ?? null, e.salaryEok ?? null, e.ovr ?? null, e.reason ?? null]));
  return inj.length || mv.length ? { inj, mv } : null;
}

export function summarizeSeason(game, data, season, finished, ledger) {
  const { result, totals, seasonPlayers, splits } = finished;
  const my = game.managerId;
  const names = new Map(seasonPlayers.map((p) => [p.id, p]));
  const lines = {};
  for (const [id, t] of totals) if (names.has(id)) lines[id] = line(t, names.get(id).teamId);
  const leaders = [...totals.entries()].filter(([id, t]) => names.has(id) && t.games >= 20)
    .map(([id, t]) => ({ id, name: names.get(id).name, teamId: names.get(id).teamId, games: t.games, ppg: t.points / t.games, rpg: t.rebounds / t.games, apg: t.assists / t.games, spg: t.steals / t.games, bpg: t.blocks / t.games }));
  // 저장 크기를 줄이려고 부문별 상위 10명(합집합)만 남긴다. 화면은 부문별 상위 7명만 보여 준다
  const topLeaders = new Set(['ppg', 'rpg', 'apg', 'spg', 'bpg'].flatMap((k) => [...leaders].sort((a, b) => b[k] - a[k]).slice(0, 10).map((l) => l.id)));
  const keptLeaders = leaders.filter((l) => topLeaders.has(l.id));
  // 경기 목록: 구단 일정은 하루 5경기라 순서로 경기일을 계산한다
  const myGames = [];
  result.games.forEach((g, i) => {
    if (g.homeId !== my && g.awayId !== my) return;
    const home = g.homeId === my;
    myGames.push({ day: Math.floor(i / (data.teams.length / 2)) + 1, home, oppId: home ? g.awayId : g.homeId, my: home ? g.homePts : g.awayPts, opp: home ? g.awayPts : g.homePts, win: g.winnerId === my, ot: g.overtimes });
  });
  const stage = (id) => stageOf(result.playoffs, id);
  return {
    season: seasonLabel(season), startYear: season, myTeamId: my,
    standings: result.standings.map((s, i) => ({ rank: i + 1, ...s })),
    series: result.playoffs.series.map((x) => ({ round: x.round, higherId: x.higherId, lowerId: x.lowerId, winnerId: x.winnerId, wins: x.wins, games: x.games.map((g) => [g.homeId === x.higherId ? g.homePts : g.awayPts, g.homeId === x.higherId ? g.awayPts : g.homePts]) })),
    championId: result.championId,
    stage: Object.fromEntries(data.teams.map((t) => [t.id, stage(t.id)])),
    leaders: keptLeaders, lines, myGames,
    ...(rosterSummary(finished.roster?.log ?? [], my) ? { roster: rosterSummary(finished.roster.log, my) } : {}), // 부상·시즌 중 영입·외국인 교체 요약(뉴스·선수 상세가 읽는다). 이전 저장에는 없다
    awards: seasonAwards(game, data, finished), // 시즌 어워드(선수 id만, src/awards.mjs). 이전 저장에는 없다
    ...(() => { const ev = seasonEval(game, data, finished, ledger, season); return ev ? { eval: ev } : {}; })(), // 모기업 목표 평가(src/goals.mjs). 이전 저장에는 없다
    // 선수 상세의 팀·승-패·플레이오프 열: 정규리그 승패(wl), 시즌 중 구단을 옮긴 선수의 구단별 줄(split), 플레이오프 줄(po). 이전 저장에는 없다
    ...(splits ? { ...compactRegular(splits), po: compactPlayoffs(result.playoffs.series, data.rules.playoffs.rounds.at(-1).name) } : {}),
    ledger,
    playerNames: Object.fromEntries([...names].map(([id, p]) => [id, p.name]))
  };
}

/** 오프시즌 보고서를 시즌 결과에 붙인다 (fundsAfter: 오프시즌까지 끝난 뒤 구단 자금) */
export function attachOffseason(entry, report, fundsAfter) {
  const moved = report.progressed.map((p) => ({ ...p, delta: p.to - p.from }));
  return {
    ...entry, fundsAfter,
    report: {
      before: report.before, after: report.after,
      retired: report.retired, drafted: report.drafted,
      progressed: { mine: moved.filter((x) => x.teamId === entry.myTeamId).sort((a, b) => b.delta - a.delta), risers: [...moved].sort((a, b) => b.delta - a.delta).slice(0, 8), fallers: [...moved].sort((a, b) => a.delta - b.delta).slice(0, 8) },
      renewed: report.renewed, expired: report.expired, refused: report.refused,
      signings: report.signings, compensations: report.compensations,
      trades: report.trades.filter((t) => t.executed !== false), tradeOffers: report.tradeOffers,
      released: report.released, signed: report.signed, foreignReplaced: report.foreignReplaced, asiaReplaced: report.asiaReplaced,
      waived: report.waived ?? [], extended: report.extended ?? [], extendRefused: report.extendRefused ?? [], // 방출(계약 해지)·연장 계약 결과
      breakthroughs: report.breakthroughs ?? [] // 깨달음(한 능력치가 크게 오른 선수)
    }
  };
}

// ---------- 저장 정리 ----------
/** 시즌 기록을 통째로 남기는 최근 시즌 수의 기본값(규칙 save.keepSeasonsDetail) */
export const DEFAULT_KEEP_SEASONS = 3;

/**
 * 오래된 시즌 결과에서 지금 화면이 읽지 않는 큰 필드를 버린다: 오프시즌 보고서(report)·우리 경기 목록(myGames)·육성 결과(devProgram)·방출/연장 기록(contracts).
 * 순위·플레이오프·선수별 시즌 줄(lines·wl·split·po)·재정(ledger)·이름(playerNames)은 남긴다(선수 기록 표·리그 기록·구단 역사·뉴스가 읽는다).
 * 득점 상위 목록(leaders)은 우리 팀 에이스 한 명만 남긴다(뉴스 결산이 쓴다). 줄에 소속이 없는 옛 저장은 leaders가 소속 대신이라 그대로 둔다.
 */
export function pruneEntry(entry) {
  const { report, myGames, devProgram, contracts, ...rest } = entry;
  const teamInLines = Object.values(entry.lines ?? {}).every((l) => l.length >= 14);
  if (!teamInLines) return rest;
  const ace = (entry.leaders ?? []).filter((l) => l.teamId === entry.myTeamId).sort((a, b) => b.ppg - a.ppg).slice(0, 1);
  return { ...rest, leaders: ace };
}

/** 로그에서 가장 최근 keep시즌은 그대로, 그보다 오래된 시즌은 pruneEntry로 줄인다(원본은 건드리지 않는다) */
export const pruneLog = (log, keep = DEFAULT_KEEP_SEASONS) => {
  const cut = log.length - Math.max(1, keep);
  return log.map((e, i) => (i < cut ? pruneEntry(e) : e));
};

/** 저장용 게임 상태: 로그의 오래된 시즌을 줄인 얕은 복사본. 시드·조작·결정·시즌 시작 리그는 그대로라 다시 돌린 결과(복원)는 같다 */
export const pruneGame = (game, keep = DEFAULT_KEEP_SEASONS) => ({ ...game, log: pruneLog(game.log ?? [], keep) });

/** 플레이오프에서 어디까지 갔는지: 우승·결승·4강·6강, 진출 못 했으면 null */
export function stageOf(playoffs, id) {
  const s = playoffs.series;
  const has = (list) => list.some((x) => x.higherId === id || x.lowerId === id);
  if (playoffs.championId === id) return '우승';
  if (has(s.slice(4))) return '결승';
  if (has(s.slice(2, 4))) return '4강';
  if (has(s.slice(0, 2))) return '6강';
  return null;
}

// ---------- 이력 ----------
/** 게임에서 진행한 시즌 결과를 실제 이력(seasons.json)과 같은 모양으로 바꾼다 */
export function logToHistory(entry) {
  const wins = (s) => Object.values(s.wins);
  const roundOf = (name) => entry.series.filter((x) => x.round === name);
  const seeds = {};
  entry.standings.slice(0, 6).forEach((s, i) => { seeds[s.id] = i + 1; });
  const ser = (x) => ({ a: x.higherId, winsA: x.wins[x.higherId], b: x.lowerId, winsB: x.wins[x.lowerId], winner: x.winnerId });
  const final = entry.series.at(-1);
  return {
    season: entry.season, startYear: entry.startYear, simulated: true,
    gamesPerTeam: entry.standings[0].wins + entry.standings[0].losses,
    teams: entry.standings.map((s) => ({ rank: s.rank, franchiseId: s.id, wins: s.wins, losses: s.losses, pct: s.wins / (s.wins + s.losses), pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst })),
    championId: entry.championId,
    playoffs: {
      seeds, championId: entry.championId, runnerUpId: final.winnerId === final.higherId ? final.lowerId : final.higherId,
      rounds: ['6강', '4강', '결승'].map((name, i) => ({ name, bestOf: [5, 5, 7][i], series: (name === '결승' ? [final] : roundOf(name)).map(ser) }))
    }
  };
}

/** 실제 이력 + 게임에서 진행한 시즌 */
export function fullHistory(game, data) {
  const seasons = [...data.history.seasons, ...(game?.log ?? []).map(logToHistory)];
  return { seasons, franchises: data.history.franchises, summary: franchiseSummary({ seasons, franchises: data.history.franchises }) };
}

/**
 * 선수 상세의 기록 줄(실제 기록 줄과 같은 필드: season, type, teamId, gp, w, l, sec, pts …). 게임에서 끝난 시즌 + 진행 중인 시즌(session을 주면).
 * 각 줄에 game: true. 이전 저장의 줄은 승패가 null.
 */
export function gameRecordRows(game, playerId, session = null) {
  const rows = (game?.log ?? []).flatMap((e) => entryRows(e, playerId));
  if (session && (session.stage === 'regular' && session.day > 0 || session.stage === 'playoffs')) {
    const run = session.run;
    if (run) {
      // 한 경기씩 진행 중인 시리즈의 지금까지의 경기도 기록에 넣는다(끝난 시리즈 + 진행 중 시리즈)
      const po = run.playoffs;
      const poSeries = po ? [...po.series, ...po.current.filter((x) => !x.winnerId && x.games.length)] : undefined;
      rows.push(...liveRows(`${seasonLabel(session.season)}`, run.splits, poSeries, playerId, session.data.rules.playoffs.rounds.at(-1).name));
    }
  }
  return rows;
}

/** 선수의 게임 내 시즌별 기록 [{ season, teamId?, games, ppg, rpg, apg }] */
export function careerLines(game, playerId) {
  return game.log.filter((e) => e.lines[playerId]).map((e) => {
    const [g, min, pts, reb, ast, stl, blk] = e.lines[playerId];
    return { season: e.season, games: g, mpg: min / g, ppg: pts / g, rpg: reb / g, apg: ast / g, spg: stl / g, bpg: blk / g };
  });
}

/**
 * 진행 중인 시즌을 이력(seasons.json)과 같은 모양으로 — 정규리그를 하루라도 치렀을 때만. 없으면 null.
 * 리그 화면이 "2026-27 (진행 중)"을 보여 줄 때 쓴다.
 */
export function liveSeason(session) {
  if (!session || session.stage === 'offseason') return null;
  if (session.stage === 'regular' && session.day === 0) return null;
  const st = session.standings();
  const po = session.playoffs;
  const names = new Map(session.players.map((p) => [p.id, p]));
  const leaders = [...(session.run?.totals ?? new Map()).entries()].filter(([id, t]) => names.has(id) && t.games >= Math.min(20, session.day / 2))
    .map(([id, t]) => ({ id, name: names.get(id).name, teamId: names.get(id).teamId, games: t.games, ppg: t.points / t.games, rpg: t.rebounds / t.games, apg: t.assists / t.games, spg: t.steals / t.games, bpg: t.blocks / t.games }));
  const roundDefs = session.data.rules.playoffs.rounds;
  const rounds = po ? roundDefs.map((def) => ({
    name: def.name === '챔피언결정전' ? '결승' : def.name, bestOf: def.bestOf, // 이력(seasons.json)은 마지막 라운드를 '결승'이라 부른다
    series: po.series.filter((x) => x.round === def.name).map((x) => ({ a: x.higherId, winsA: x.wins[x.higherId], b: x.lowerId, winsB: x.wins[x.lowerId], winner: x.winnerId }))
  })).filter((r) => r.series.length) : null;
  return {
    season: seasonLabel(session.season), live: true, simulated: true,
    teams: st.map((s) => ({ rank: s.rank, franchiseId: s.id, wins: s.wins, losses: s.losses, pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst })),
    championId: po?.done ? po.result().championId : null,
    playoffs: po && rounds?.length ? { seeds: Object.fromEntries([...po.seeds]), rounds, championId: po.done ? po.result().championId : null } : null,
    leaders
  };
}
