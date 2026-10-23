// 화면이 쓰는 게임 상태와 규칙 호출. 브라우저 API를 쓰지 않는 순수 모듈이라 node에서도 테스트한다.
// 상태(game)는 JSON으로 저장할 수 있다: { version, seed, managerId, league, log: [시즌 결과 …] }
import { createLeague, playLeagueYear } from '../../src/league.mjs';
import { compactRegular, compactPlayoffs, entryRows, liveRows } from '../../src/player-record.mjs';
import { createManagerBot } from '../../src/manager-bot.mjs';
import { mulberry32, hashString } from '../../src/rng.mjs';
import { prestigeTable } from '../../src/legacy.mjs';
import { buildLineup, lineupCost } from '../../src/lineup.mjs';
import { initialFunds } from '../../src/funds.mjs';
import { domesticOf, foreignOf, asiaOf, payrollEok, hardLimitEok } from '../../src/valuation.mjs';
import { franchiseSummary } from '../../src/history-summary.mjs';
import { computeAwards } from '../../src/awards.mjs';

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

/** 구단별 자동 편성 라인업과 전력(스타팅 OVR 합 + 벤치 × 가중) */
export function teamPower(game, data, teamId) {
  const roster = rosterOf(game, teamId);
  const lineup = buildLineup(roster, data.rules, data.rules.simulation.benchWeight);
  const sum = (l) => l.reduce((s, p) => s + p.ovr, 0);
  return { lineup, power: sum(lineup.starters) / lineup.starters.length * 0.7 + sum(lineup.bench) / lineup.bench.length * 0.3, cost: lineupCost([...lineup.starters, ...lineup.bench]) };
}

/** 10개 구단 전력 순위: [{ id, power, rank }] */
export function powerRanking(game, data) {
  const rows = data.teams.map((t) => ({ id: t.id, power: teamPower(game, data, t.id).power }));
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
  return { ...game, league: out.league, log: [...game.log, summarizeYear(game, data, season, out)] };
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

function seasonAwards(game, data, finished) {
  const { result, totals, seasonPlayers } = finished;
  return computeAwards({
    players: seasonPlayers, totals, standings: result.standings, playoffs: { series: result.playoffs.series, championId: result.championId },
    finalName: data.rules.playoffs.rounds.at(-1).name, rookieIds: rookieIdsOf(game), rules: data.rules
  });
}

/** 시즌 결과(순위·플레이오프·리더·우리 팀 경기·장부)만 묶는다. 오프시즌 보고서는 attachOffseason으로 나중에 붙인다 */
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
    awards: seasonAwards(game, data, finished), // 시즌 어워드(선수 id만, src/awards.mjs). 이전 저장에는 없다
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
    if (run) rows.push(...liveRows(`${seasonLabel(session.season)}`, run.splits, run.playoffs?.series, playerId, session.data.rules.playoffs.rounds.at(-1).name));
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
