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
import { validateTrade, executeTrade, generateOffers, proposeTrade } from './trade.mjs';

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

  // 시즌 중 트레이드: AI 구단의 판단에 쓰는 상황(지금까지의 순위·승률·전통)
  const tradeContext = () => {
    const st = regular?.standings() ?? [];
    return {
      season: league.season, managerTeamId: manager, teamCount: teamData.length,
      ranks: new Map(st.map((s, i) => [s.id, i + 1])),
      winPct: new Map(st.map((s) => [s.id, s.wins / Math.max(1, s.wins + s.losses)])),
      prestige: new Map(Object.entries(prestigeTable(league.legacy, rules)).map(([id, v]) => [id, v.score]))
    };
  };
  // 트레이드가 성사되면 선수 소속·훈련 지정·직접 편성을 정리하고 팀 구성을 다시 만든다
  const applyTrade = (trade, nextPlayers) => {
    const gone = new Set((trade.teamA === manager ? trade.giveA : trade.teamB === manager ? trade.giveB : []));
    const came = (trade.teamA === manager ? trade.giveB : trade.teamB === manager ? trade.giveA : []);
    players = nextPlayers;
    for (const id of gone) focus.delete(id);
    for (const id of came) focus.set(id, autoFocus(players.find((p) => p.id === id)));
    if (lineup && [...lineup.starters, ...lineup.bench].some((id) => gone.has(id))) lineup = null;
    const built = buildTeams();
    regular.setTeams(built.teams, built.baseline);
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
  const tradeOpen = () => regular.day <= rules.transactions.trade.deadlineDay && !playoffs;

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
    /** 시즌 중 트레이드가 열려 있는지(마감일 전, 플레이오프 전) */
    get tradeOpen() { return tradeOpen(); },
    get tradeDeadline() { return rules.transactions.trade.deadlineDay; },
    tradeContext,
    /** 지금 AI 구단이 단장에게 보내는 시즌 중 트레이드 제안(같은 인원 교환만). rng는 호출하는 쪽이 정해 준다 */
    tradeOffers(offerRng) {
      if (!manager || !tradeOpen()) return [];
      return generateOffers({ ...league, players }, manager, tradeContext(), rules, offerRng, { window: 'season', day: regular.day });
    },
    /** 단장이 먼저 건 트레이드를 AI가 평가하고 받아들이면 실행한다. 반환: { executed, reason?, verdict? } */
    proposeTrade(trade) {
      if (!tradeOpen()) return { executed: false, reason: `트레이드 마감(${rules.transactions.trade.deadlineDay}일차)이 지났습니다` };
      const r = proposeTrade({ ...league, players }, trade, tradeContext(), rules, { window: 'season', day: regular.day });
      if (r.executed) applyTrade(trade, r.league.players);
      return { executed: r.executed, reason: r.reason ?? null, verdict: r.verdict ?? null };
    },
    /** AI의 제안을 받아들여 실행(검증만 하고 AI 평가는 이미 거친 제안). 반환: { ok, errors } */
    executeTrade(trade) {
      const check = validateTrade({ ...league, players }, trade, rules, { window: 'season', day: regular.day });
      if (!check.ok) return check;
      applyTrade(trade, executeTrade({ ...league, players }, trade).players);
      return { ok: true, errors: [] };
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
