// 리그 1년 진행: 정규리그(시즌 중 능력치 갱신·훈련 포함) → 플레이오프 → 시즌 종료 처리.
import { baseRosterOf } from './synergy.mjs';
import { runOffseason } from './offseason.mjs';
import { seedLegacy } from './legacy.mjs';
import { beginSeason, settleYear } from './season-run.mjs';
import { cardName, cardYearLabel } from './cards.mjs';
import { createFactory, rarityOf, POSITIONS } from './factory.mjs';
import { calcOvr, calcCost } from './rating.mjs';
import { mulberry32, hashString } from './rng.mjs';

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
    baseRoster: baseRosterOf(players), // 시너지에서 빼는 "시작 로스터 표식"(id → 시작 소속 구단). 세션은 저장하지 않고 data.players에서 다시 만든다
    nextId: 1,
    usedNames: startPlayers.map((p) => p.name)
  };
}

/**
 * 새 게임의 시즌 중 FA 시장을 채울 가상 무소속 선수. 실제 선수 자료에는 "시즌 중 무소속으로 남은 선수"를 가리는 근거가 없어(등록선수 화면에 없는 선수는 은퇴·군 복무·방출을 구분할 수 없다) 실존 선수를 넣지 않고,
 * 오프시즌의 신인급 보충(src/offseason.mjs)과 같은 방식으로 시드에서 만든 가상 선수(real:false)를 소수 둔다. rules.inSeason.fa.reserve = { perPosition, ovrs: [OVR 목표...] }. 규칙이 없으면 빈 배열.
 * 같은 시드·같은 규칙이면 같은 선수가 나온다. 반환 { freeAgents, usedNames }
 */
export function reserveFreeAgents(rules, seed, usedNames = []) {
  const cfg = rules.inSeason?.fa?.reserve;
  if (!cfg) return { freeAgents: [], usedNames };
  const rng = mulberry32((hashString(`reserve-fa:${seed}`) ^ 0x5fa) >>> 0);
  const names = new Set(usedNames);
  const f = createFactory(rng, rules, names);
  const freeAgents = [];
  let n = 1;
  for (const position of POSITIONS) {
    for (const target of cfg.ovrs.slice(0, cfg.perPosition)) {
      const stats = f.makeStats(position, target);
      const ovr = calcOvr(position, stats);
      freeAgents.push({
        id: `fa0-${String(n++).padStart(4, '0')}`, name: f.uniqueName('domestic'), real: false, virtual: true, position, age: f.randInt(22, 30), number: 0,
        rarity: rarityOf(ovr, ovr), stats, ovr, cost: calcCost(ovr), potential: ovr, origin: 'domestic', teamId: null,
        contract: { yearsLeft: 0 }, assets: { portrait: null, model: null }, ovrWas: ovr, statsWas: { ...stats }
      });
    }
  }
  return { freeAgents, usedNames: [...names] };
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
  const run = beginSeason(league, teamData, rules, rng, { manager, inSeasonUpdates, keepGames, cards });
  run.playDays();
  run.startPlayoffs();
  while (!run.playoffs.done) run.playoffRound();
  const finished = run.finish();
  const settled = settleYear(league, finished, teamData, rules);
  const { league: next, report } = runOffseason(settled.league, finished.result.standings, teamData, rules, rng, { manager, policy, cards });
  report.ledger = settled.ledger;
  return { league: next, report, result: finished.result, totals: finished.totals, splits: finished.splits, seasonPlayers: finished.seasonPlayers, startStats: finished.startStats };
}
