// 리그 1년 진행: 정규리그(시즌 중 능력치 갱신·훈련 포함) → 플레이오프 → 시즌 종료 처리.
import { buildLineup } from './lineup.mjs';
import { leagueBaseline } from './game.mjs';
import { playSeason } from './season.mjs';
import { addBox } from './stats.mjs';
import { updateSkillsFromSeason } from './stats-rating.mjs';
import { trainPlayer, autoFocus } from './training.mjs';
import { runOffseason } from './offseason.mjs';
import { seedLegacy, appendSeason, prestigeTable } from './legacy.mjs';
import { initialFunds, settleSeason } from './funds.mjs';
import { calcOvr, calcCost } from './rating.mjs';

export function createLeague(players, rules, { history = null, teamData = null } = {}) {
  return {
    ...(history && teamData ? { legacy: seedLegacy(history.seasons ?? history, teamData) } : {}),
    season: Number(String(rules.season).slice(0, 4)),
    players: players.map((p) => ({ ...p, stats: { ...p.stats }, contract: { ...p.contract } })),
    freeAgents: [],
    nextId: 1,
    usedNames: players.map((p) => p.name)
  };
}

function buildTeams(players, teamData, rules) {
  const teams = teamData.map((t) => ({
    id: t.id,
    name: t.name,
    lineup: buildLineup(players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight)
  }));
  return { teams, baseline: leagueBaseline(teams.map((t) => t.lineup), rules.simulation) };
}

function withStats(p, stats) {
  const ovr = calcOvr(p.position, stats);
  // 시즌 중 갱신은 잠재력(POT)을 올리지 않는다. 운 좋은 시즌이 성장 한도를 계속 끌어올리는 것을 막는다.
  return { ...p, stats, ovr, cost: calcCost(ovr) };
}

/**
 * 시즌 한 해를 진행하고 다음 시즌 상태를 돌려준다.
 * options.manager: 단장이 맡은 구단 id (훈련을 관리하고, 시즌 종료 때 트레이드·재계약·FA 결정을 내린다)
 * options.policy: 단장의 의사결정 콜백 (src/offseason.mjs 머리말 참고). 없으면 자동 규칙
 * options.inSeasonUpdates: 시즌 중 기록 기반 능력치 갱신 (기본 true)
 * options.keepGames: 정규리그 경기 결과를 result.games에 모두 보관 (화면의 경기 일정·결과용, 기본 false)
 */
export function playLeagueYear(league, teamData, rules, rng, options = {}) {
  const { manager = null, inSeasonUpdates = true, policy = null, keepGames = false } = options;
  let players = league.players;
  const start = new Map(players.map((p) => [p.id, { ...p.stats }])); // 시즌 시작 능력치
  const totals = new Map();
  const focus = new Map(manager ? players.filter((p) => p.teamId === manager).map((p) => [p.id, autoFocus(p)]) : []);
  const trainedStart = new Map();

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
      if (gain) { start.get(p.id)[focus.get(p.id)] += gain; trainedStart.set(p.id, (trainedStart.get(p.id) ?? 0) + gain); }
      return trained;
    });
  };

  const initial = buildTeams(players, teamData, rules);
  const result = playSeason(initial.teams, rules, initial.baseline, rng, {
    onGame: (g) => { addBox(totals, g.box.home); addBox(totals, g.box.away); },
    keepGames,
    checkpointEvery: rules.ratingModel.checkpointDays,
    onCheckpoint: () => {
      applyUpdates();
      applyTraining();
      return buildTeams(players, teamData, rules);
    }
  });

  applyUpdates(); // 시즌 전체 기록 반영
  const seasonPlayers = players; // 시즌 종료 처리(노화·은퇴·드래프트) 직전 상태
  // 시즌 정산(수입 − 연봉 − 소프트캡 기금) 후 시즌 종료 처리
  const legacy = league.legacy ? appendSeason(league.legacy, `${league.season}-${String(league.season + 1).slice(2)}`, result, rules) : undefined;
  const settled = settleSeason(league.funds ?? initialFunds(teamData, rules), seasonPlayers, result.standings, result.playoffs, teamData, rules, prestigeTable(league.legacy, rules)); // 수입은 이번 시즌 이전의 전통으로
  const { league: next, report } = runOffseason({ ...league, players, funds: settled.funds, ...(legacy ? { legacy } : {}) }, result.standings, teamData, rules, rng, { manager, policy });
  report.ledger = settled.ledger;
  return { league: next, report, result, totals, seasonPlayers, startStats: start };
}
