// 리그 1년 진행: 정규리그(시즌 중 능력치 갱신·훈련 포함) → 플레이오프 → 시즌 종료 처리.
import { runOffseason } from './offseason.mjs';
import { seedLegacy } from './legacy.mjs';
import { beginSeason, settleYear } from './season-run.mjs';
import { cardName, cardYearLabel } from './cards.mjs';

/** labelStart: 시작 로스터의 실제 선수를 그 시즌 카드로 표기한다("허웅" → "26 허웅", 원래 이름은 baseName). 게임 화면용 */
export function createLeague(players, rules, { history = null, teamData = null, labelStart = false } = {}) {
  const startPlayers = labelStart
    ? players.map((p) => (p.real && !p.card ? { ...p, baseName: p.name, name: cardName(p.name, rules.season), card: { season: rules.season, label: cardYearLabel(rules.season), teamId: p.teamId } } : p))
    : players;
  return {
    ...(history && teamData ? { legacy: seedLegacy(history.seasons ?? history, teamData) } : {}),
    season: Number(String(rules.season).slice(0, 4)),
    // ovrWas·statsWas: OVR 변화 표시의 기준(시작 값). 오프시즌 성장·노화 때 노화 직전 값으로 다시 기록된다
    players: startPlayers.map((p) => ({ ...p, stats: { ...p.stats }, contract: { ...p.contract }, ovrWas: p.ovr, statsWas: { ...p.stats } })),
    freeAgents: [],
    nextId: 1,
    usedNames: startPlayers.map((p) => p.name)
  };
}

/**
 * 시즌 한 해를 진행하고 다음 시즌 상태를 돌려준다. (하루씩 진행하는 화면용은 season-run.mjs의 beginSeason)
 * options.manager: 단장이 맡은 구단 id (훈련을 관리하고, 시즌 종료 때 트레이드·재계약·FA 결정을 내린다)
 * options.cards: 시즌 카드({ domestic, foreign }, src/cards.mjs) — 신인 드래프트와 외국인 영입 후보로 섞인다
 * options.policy: 단장의 의사결정 콜백 (src/offseason.mjs 머리말 참고). 없으면 자동 규칙
 * options.inSeasonUpdates: 시즌 중 기록 기반 능력치 갱신 (기본 true)
 * options.keepGames: 정규리그 경기 결과를 result.games에 모두 보관 (화면의 경기 일정·결과용, 기본 false)
 */
export function playLeagueYear(league, teamData, rules, rng, options = {}) {
  const { manager = null, inSeasonUpdates = true, policy = null, keepGames = false, cards = null } = options;
  const run = beginSeason(league, teamData, rules, rng, { manager, inSeasonUpdates, keepGames });
  run.playDays();
  run.startPlayoffs();
  while (!run.playoffs.done) run.playoffRound();
  const finished = run.finish();
  const settled = settleYear(league, finished, teamData, rules);
  const { league: next, report } = runOffseason(settled.league, finished.result.standings, teamData, rules, rng, { manager, policy, cards });
  report.ledger = settled.ledger;
  return { league: next, report, result: finished.result, totals: finished.totals, splits: finished.splits, seasonPlayers: finished.seasonPlayers, startStats: finished.startStats };
}
