// 화면이 쓰는 게임 상태와 규칙 호출. 브라우저 API를 쓰지 않는 순수 모듈이라 node에서도 테스트한다.
// 상태(game)는 JSON으로 저장할 수 있다: { version, seed, managerId, league, log: [시즌 결과 …] }
import { createLeague, playLeagueYear } from '../../src/league.mjs';
import { createManagerBot } from '../../src/manager-bot.mjs';
import { mulberry32, hashString } from '../../src/rng.mjs';
import { prestigeTable } from '../../src/legacy.mjs';
import { buildLineup, lineupCost } from '../../src/lineup.mjs';
import { initialFunds } from '../../src/funds.mjs';
import { domesticOf, foreignOf, asiaOf, payrollEok, hardLimitEok } from '../../src/valuation.mjs';
import { franchiseSummary } from '../../src/history-summary.mjs';

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

const line = (t) => [t.games, t.minutes, t.points, t.rebounds, t.assists, t.steals, t.blocks];
export const LINE_KEYS = ['games', 'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks'];

function summarizeYear(game, data, season, out) {
  const { result, report, totals, seasonPlayers } = out;
  const my = game.managerId;
  const names = new Map(seasonPlayers.map((p) => [p.id, p]));
  const lines = {};
  for (const [id, t] of totals) if (names.has(id)) lines[id] = line(t);
  const leaders = [...totals.entries()].filter(([id, t]) => names.has(id) && t.games >= 20)
    .map(([id, t]) => ({ id, name: names.get(id).name, teamId: names.get(id).teamId, games: t.games, ppg: t.points / t.games, rpg: t.rebounds / t.games, apg: t.assists / t.games, spg: t.steals / t.games, bpg: t.blocks / t.games }));
  // 경기 목록: 구단 일정은 하루 5경기라 순서로 경기일을 계산한다
  const myGames = [];
  result.games.forEach((g, i) => {
    if (g.homeId !== my && g.awayId !== my) return;
    const home = g.homeId === my;
    myGames.push({ day: Math.floor(i / (data.teams.length / 2)) + 1, home, oppId: home ? g.awayId : g.homeId, my: home ? g.homePts : g.awayPts, opp: home ? g.awayPts : g.homePts, win: g.winnerId === my, ot: g.overtimes });
  });
  const mine = (x) => x.teamId === my;
  const moved = report.progressed.map((p) => ({ ...p, delta: p.to - p.from }));
  const stage = (id) => stageOf(result.playoffs, id);
  return {
    season: seasonLabel(season), startYear: season,
    standings: result.standings.map((s, i) => ({ rank: i + 1, ...s })),
    series: result.playoffs.series.map((x) => ({ round: x.round, higherId: x.higherId, lowerId: x.lowerId, winnerId: x.winnerId, wins: x.wins, games: x.games.map((g) => [g.homeId === x.higherId ? g.homePts : g.awayPts, g.homeId === x.higherId ? g.awayPts : g.homePts]) })),
    championId: result.championId,
    stage: Object.fromEntries(data.teams.map((t) => [t.id, stage(t.id)])),
    leaders, lines, myGames,
    ledger: report.ledger, fundsAfter: out.league.funds,
    report: {
      before: report.before, after: report.after,
      retired: report.retired, drafted: report.drafted,
      progressed: { mine: moved.filter(mine).sort((a, b) => b.delta - a.delta), risers: [...moved].sort((a, b) => b.delta - a.delta).slice(0, 8), fallers: [...moved].sort((a, b) => a.delta - b.delta).slice(0, 8) },
      renewed: report.renewed, expired: report.expired, refused: report.refused,
      signings: report.signings, compensations: report.compensations,
      trades: report.trades.filter((t) => t.executed !== false), tradeOffers: report.tradeOffers,
      released: report.released, signed: report.signed, foreignReplaced: report.foreignReplaced, asiaReplaced: report.asiaReplaced
    },
    playerNames: Object.fromEntries([...names].map(([id, p]) => [id, p.name]))
  };
}

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

/** 선수의 게임 내 시즌별 기록 [{ season, teamId?, games, ppg, rpg, apg }] */
export function careerLines(game, playerId) {
  return game.log.filter((e) => e.lines[playerId]).map((e) => {
    const [g, min, pts, reb, ast, stl, blk] = e.lines[playerId];
    return { season: e.season, games: g, mpg: min / g, ppg: pts / g, rpg: reb / g, apg: ast / g, spg: stl / g, bpg: blk / g };
  });
}
