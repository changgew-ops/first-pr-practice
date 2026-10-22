// 한 시즌을 하루씩·라운드씩 진행하는 진행기. 화면(웹)이 쓰고, playLeagueYear도 이 위에서 돌아간다.
// 같은 시드·같은 조작(라인업·훈련 지정)이면 항상 같은 결과다 — 저장은 "조작 기록"만 하고 불러올 때 다시 돌려 복원한다.
import { buildLineup, validateLineup } from './lineup.mjs';
import { leagueBaseline } from './game.mjs';
import { createRegularSeason, createPlayoffs } from './season.mjs';
import { addBox } from './stats.mjs';
import { updateSkillsFromSeason } from './stats-rating.mjs';
import { trainPlayer, autoFocus } from './training.mjs';
import { seedLegacy, appendSeason, prestigeTable } from './legacy.mjs';
import { initialFunds, settleSeason } from './funds.mjs';
import { calcOvr, calcCost } from './rating.mjs';
import { STAT_KEYS } from './rating.mjs';

function withStats(p, stats) {
  const ovr = calcOvr(p.position, stats);
  // 시즌 중 갱신은 잠재력(POT)을 올리지 않는다. 운 좋은 시즌이 성장 한도를 계속 끌어올리는 것을 막는다.
  return { ...p, stats, ovr, cost: calcCost(ovr) };
}

/** 단장 구단의 직접 편성이 규칙에 맞는지. 반환: { ok, errors, totalCost } */
export function checkLineup(players, managerId, lineup, rules) {
  const byId = new Map(players.filter((p) => p.teamId === managerId).map((p) => [p.id, p]));
  const pick = (ids) => ids.map((id) => byId.get(id));
  if ([...lineup.starters, ...lineup.bench].some((id) => !byId.has(id))) return { ok: false, errors: ['우리 구단 선수가 아닌 선수가 있습니다'], totalCost: 0 };
  return validateLineup(pick(lineup.starters), pick(lineup.bench), rules);
}

/**
 * 시즌 시작. options: { manager, inSeasonUpdates = true, keepGames = false }
 * 반환 진행기: 정규리그 playDay()/playDays(n)/playRegular(), 라인업 setLineup(), 훈련 setFocus(),
 *   playoffs() 시작 → playoffRound(), finish()
 */
export function beginSeason(league, teamData, rules, rng, options = {}) {
  const { manager = null, inSeasonUpdates = true, keepGames = false } = options;
  let players = league.players;
  const start = new Map(players.map((p) => [p.id, { ...p.stats }])); // 시즌 시작 능력치
  const totals = new Map();
  const focus = new Map(manager ? players.filter((p) => p.teamId === manager).map((p) => [p.id, autoFocus(p)]) : []);
  let lineup = null; // 단장의 직접 편성 { starters: [id], bench: [id] } (없으면 자동)

  const applyUpdates = () => {
    if (!inSeasonUpdates) return;
    const updates = updateSkillsFromSeason(players, start, totals, rules.ratingModel);
    if (updates.size) players = players.map((p) => (updates.has(p.id) ? withStats(p, updates.get(p.id)) : p));
  };
  const applyTraining = () => {
    if (!manager) return;
    players = players.map((p) => {
      if (p.teamId !== manager || !focus.has(p.id)) return p;
      const trained = trainPlayer(p, focus.get(p.id), rules.training.sessionsPerCheckpoint, rules);
      // 훈련으로 오른 만큼은 시즌 시작 능력치에도 반영해, 시즌 중 갱신이 되돌리지 않게 한다
      const gain = trained.stats[focus.get(p.id)] - p.stats[focus.get(p.id)];
      if (gain) start.get(p.id)[focus.get(p.id)] += gain;
      return trained;
    });
  };
  const buildTeams = () => {
    const teams = teamData.map((t) => {
      const roster = players.filter((p) => p.teamId === t.id);
      let built = null;
      if (t.id === manager && lineup) {
        const byId = new Map(roster.map((p) => [p.id, p]));
        const check = checkLineup(players, manager, lineup, rules);
        if (check.ok) built = { starters: lineup.starters.map((id) => byId.get(id)), bench: lineup.bench.map((id) => byId.get(id)) };
      }
      return { id: t.id, name: t.name, lineup: built ?? buildLineup(roster, rules, rules.simulation.benchWeight) };
    });
    return { teams, baseline: leagueBaseline(teams.map((t) => t.lineup), rules.simulation) };
  };

  const initial = buildTeams();
  const regular = createRegularSeason(initial.teams, initial.baseline, rules.simulation, rng, {
    keepGames,
    onGame: (g) => { addBox(totals, g.box.home); addBox(totals, g.box.away); },
    checkpointEvery: rules.ratingModel.checkpointDays,
    onCheckpoint: () => { applyUpdates(); applyTraining(); return buildTeams(); }
  });
  let playoffs = null;
  let finished = null;

  const run = {
    get day() { return regular.day; },
    get totalDays() { return regular.schedule.length; },
    get regularDone() { return regular.done; },
    get players() { return players; },
    get focus() { return focus; },
    get lineup() { return lineup; },
    get playoffs() { return playoffs; },
    get totals() { return totals; },
    schedule: regular.schedule,
    standings: () => regular.standings(),
    playDay: () => regular.playDay(),
    /** n일(또는 끝까지) 진행. 반환: 날짜별 결과 배열 */
    playDays(n = Infinity) {
      const out = [];
      while (!regular.done && out.length < n) out.push(regular.playDay());
      return out;
    },
    /** 단장의 직접 편성. 규칙에 어긋나면 적용하지 않고 오류를 돌려준다. null이면 자동 편성으로 돌아간다 */
    setLineup(next) {
      if (!manager) throw new Error('단장 구단이 없습니다');
      if (next) {
        const check = checkLineup(players, manager, next, rules);
        if (!check.ok) return check;
      }
      lineup = next ? { starters: [...next.starters], bench: [...next.bench] } : null;
      const built = buildTeams();
      regular.setTeams(built.teams, built.baseline);
      return { ok: true, errors: [] };
    },
    /** 선수의 훈련 집중 능력치. 다음 훈련 시점부터 반영된다 */
    setFocus(playerId, stat) {
      if (!STAT_KEYS.includes(stat)) throw new Error(`알 수 없는 능력치: ${stat}`);
      if (!focus.has(playerId)) throw new Error('훈련을 지정할 수 있는 우리 구단 선수가 아닙니다');
      focus.set(playerId, stat);
    },
    /** 플레이오프 시작(정규리그가 끝나야 한다). 시즌 중 마지막 라인업·기준점으로 치른다 */
    startPlayoffs() {
      if (!regular.done) throw new Error('정규리그가 아직 끝나지 않았습니다');
      if (playoffs) return playoffs;
      const reg = regular.finish();
      playoffs = createPlayoffs(reg.standings.map((r) => r.id), new Map(reg.teams.map((t) => [t.id, t])), rules, reg.baseline, rules.simulation, rng);
      return playoffs;
    },
    playoffRound() { return run.startPlayoffs().playRound(); },
    /** 시즌 마무리: 시즌 전체 기록으로 능력치를 한 번 더 갱신하고 결과를 묶는다 */
    finish() {
      if (finished) return finished;
      if (!playoffs?.done) throw new Error('플레이오프가 끝나지 않았습니다');
      const reg = regular.finish();
      const po = playoffs.result();
      applyUpdates();
      finished = {
        result: { standings: reg.standings, games: reg.games, playoffs: po, championId: po.championId, teams: reg.teams, baseline: reg.baseline },
        totals, seasonPlayers: players, startStats: start
      };
      return finished;
    }
  };
  return run;
}

/** 시즌 정산: 구단 전통 기록 추가 + 수입·연봉·기금 정산. 반환: 오프시즌 처리에 넘길 league와 구단별 장부 */
export function settleYear(league, finished, teamData, rules) {
  const { result, seasonPlayers } = finished;
  const label = `${league.season}-${String(league.season + 1).slice(2)}`;
  const legacy = league.legacy ? appendSeason(league.legacy, label, result, rules) : undefined;
  const settled = settleSeason(league.funds ?? initialFunds(teamData, rules), seasonPlayers, result.standings, result.playoffs, teamData, rules, prestigeTable(league.legacy, rules)); // 수입은 이번 시즌 이전의 전통으로
  return { league: { ...league, players: seasonPlayers, funds: settled.funds, ...(legacy ? { legacy } : {}) }, ledger: settled.ledger };
}
