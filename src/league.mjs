// 리그 1년 진행: 정규리그(시즌 중 능력치 갱신·훈련 포함) → 플레이오프 → 시즌 종료 처리.
import { runOffseason } from './offseason.mjs';
import { seedLegacy } from './legacy.mjs';
import { beginSeason, settleYear } from './season-run.mjs';

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

/**
 * 시즌 한 해를 진행하고 다음 시즌 상태를 돌려준다. (하루씩 진행하는 화면용은 season-run.mjs의 beginSeason)
 * options.manager: 단장이 맡은 구단 id (훈련을 관리하고, 시즌 종료 때 트레이드·재계약·FA 결정을 내린다)
 * options.policy: 단장의 의사결정 콜백 (src/offseason.mjs 머리말 참고). 없으면 자동 규칙
 * options.inSeasonUpdates: 시즌 중 기록 기반 능력치 갱신 (기본 true)
 * options.keepGames: 정규리그 경기 결과를 result.games에 모두 보관 (화면의 경기 일정·결과용, 기본 false)
 */
export function playLeagueYear(league, teamData, rules, rng, options = {}) {
  const { manager = null, inSeasonUpdates = true, policy = null, keepGames = false } = options;
  const run = beginSeason(league, teamData, rules, rng, { manager, inSeasonUpdates, keepGames });
  run.playDays();
  run.startPlayoffs();
  while (!run.playoffs.done) run.playoffRound();
  const finished = run.finish();
  const settled = settleYear(league, finished, teamData, rules);
  const { league: next, report } = runOffseason(settled.league, finished.result.standings, teamData, rules, rng, { manager, policy });
  report.ledger = settled.ledger;
  return { league: next, report, result: finished.result, totals: finished.totals, seasonPlayers: finished.seasonPlayers, startStats: finished.startStats };
}
