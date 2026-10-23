// 한 시즌을 하루씩·라운드씩 진행하는 진행기. 화면(웹)이 쓰고, playLeagueYear도 이 위에서 돌아간다.
// 같은 시드·같은 조작(라인업·훈련 지정)이면 항상 같은 결과다 — 저장은 "조작 기록"만 하고 불러올 때 다시 돌려 복원한다.
import { rulesFor } from './economy.mjs';
import { buildLineup, validateLineup, buildLineupHealthy, substituteInjured } from './lineup.mjs';
import { rollInjury, foreignGameThresholds } from './injuries.mjs';
import { proratedEok, freeNumber, faAsking, faSignCheck, signedFa, buildForeignPool, foreignReplaceCheck, signedForeign, aiForeignChoice } from './inseason.mjs';
import { valueOf, needBonus, domesticOf } from './valuation.mjs';
import { leagueBaseline } from './game.mjs';
import { createRegularSeason, createPlayoffs } from './season.mjs';
import { addBox } from './stats.mjs';
import { addGameToSplits } from './player-record.mjs';
import { updateSkillsFromSeason } from './stats-rating.mjs';
import { trainPlayer, autoFocus } from './training.mjs';
import { seedLegacy, appendSeason, prestigeTable } from './legacy.mjs';
import { initialFunds, settleSeason } from './funds.mjs';
import { advanceMood } from './fans.mjs';
import { calcOvr, calcCost } from './rating.mjs';
import { STAT_KEYS } from './rating.mjs';
import { validateTrade, executeTrade, generateOffers, proposeTrade } from './trade.mjs';
import { mulberry32, hashString } from './rng.mjs';
import { eligibility, dleagueSessions, abroadGrowth, programCost, checkpointsPerSeason, PROGRAMS } from './devprogram.mjs';
import { releaseCheck, releaseCost, extensionCheck, extendedPlayer, extensionAdjust, salaryRanks, minDomestic } from './contracts.mjs';

const round2 = (v) => Math.round(v * 100) / 100;

// 턴오버·파울은 기록만 하는 열이라 능력치 갱신이 읽는 합계(src/stats.mjs TOTAL_KEYS)와 따로 쌓는다. 옛 박스스코어에는 없다
function addRecordOnly(totals, box) {
  for (const line of box) {
    const t = totals.get(line.id);
    if (!t || !line.minutes) continue;
    t.turnovers = (t.turnovers ?? 0) + (line.turnovers ?? 0);
    t.fouls = (t.fouls ?? 0) + (line.fouls ?? 0);
  }
}

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
  rules = rulesFor(rules, league.season); // 그 시즌의 물가 지수를 곱한 규칙(src/economy.mjs)
  const { manager = null, inSeasonUpdates = true, keepGames = false } = options;
  let players = league.players;
  const start = new Map(players.map((p) => [p.id, { ...p.stats }])); // 시즌 시작 능력치
  const totals = new Map();
  const splits = new Map(); // 선수 → 구단 → 기록+승패 (선수 상세의 팀·승-패 열, src/player-record.mjs)
  const focus = new Map(manager ? players.filter((p) => p.teamId === manager).map((p) => [p.id, autoFocus(p)]) : []);
  let lineup = null; // 단장의 직접 편성 { starters: [id], bench: [id] } (없으면 자동)
  // 육성 프로그램(D리그·유학) 중인 선수. 명단(players)에서 빠져 있다가 소환·시즌 종료에 돌아온다 (src/devprogram.mjs)
  const away = new Map(); // playerId → { program, stat, fromDay, player, before }
  const devDone = []; // 끝난 D리그 파견 기록
  // 계약 관리(src/contracts.mjs): 방출된 선수(FA 풀로 간다)·방출/연장 기록·정산 보정
  const released = [];
  const releaseLog = [];
  const extendLog = [];

  // 부상(src/injuries.mjs)과 시즌 중 선수단 변동(src/inseason.mjs: 시장에 남은 FA 영입, 외국선수 일시교체·시즌대체)
  const injuriesOn = Boolean(rules.injuries?.enabled);
  const injSeed = options.seed ?? (injuriesOn ? Math.floor(rng() * 2 ** 32) : 0); // 부상 난수의 시드. 경기 난수(rng)는 시드가 없을 때 한 번만 쓴다
  const injured = new Map(); // 선수 id → { playerId, name, teamId, day(다친 날), total(진단 결장 경기 수), left(남은 결장), kind, part, temp(일시교체 선수 id | null), handled(AI가 판단함) }
  const streak = new Map(); // 선수 id → 24분 이상 연속 출전 경기 수
  const rosterLog = []; // 시즌 중 변동 기록: { type: 'injury'|'return'|'fa'|'foreign'|'release', day, teamId, … }
  let faPool = [...(league.freeAgents ?? [])]; // 시장에 남은 선수(시즌 시작 때의 FA 풀 + 시즌 중 방출된 선수 − 영입된 선수)
  const payAdj = new Map(); // 구단 → 정산 보정(억 원, 양수면 추가 지출): 시즌 중 영입·교체로 생긴 일할 계산 차이
  const addAdj = (teamId, eok) => { if (eok) payAdj.set(teamId, round2((payAdj.get(teamId) ?? 0) + eok)); };
  const usedKblNew = []; // 시즌 중 새로 들어온 카드 선수의 kblId(다음 시즌 카드 중복 방지)
  const otherCount = new Map(); // 구단 → 기타 사유 교체 횟수
  const mgrReleased = new Set(); // 우리 구단이 이번 시즌 방출한 선수 id(AI가 곧바로 데려가지는 않는다)
  const foreignTaken = new Set(); // 시즌 중 외국인 후보 풀에서 이미 영입된 후보 id
  let foreignPoolCache = null;
  const foreignPool = () => (foreignPoolCache ??= buildForeignPool({ players: league.players, freeAgents: league.freeAgents ?? [], usedKbl: league.usedKbl ?? [], cards: options.cards ?? null, rules, season: league.season, seed: injSeed }));
  const usdToEok = (usd) => usd * rules.transactions.funds.foreignUsdToEok;
  let lineupSwaps = []; // 우리 구단의 직접 편성에서 부상 선수를 대신해 자동으로 들어간 선수들

  const applyUpdates = () => {
    if (!inSeasonUpdates) return;
    const updates = updateSkillsFromSeason(players, start, totals, rules.ratingModel);
    if (updates.size) players = players.map((p) => (updates.has(p.id) ? withStats(p, updates.get(p.id)) : p));
  };
  const applyTraining = () => {
    if (!manager) return;
    for (const [id, a] of away) { // D리그: 경험치 배수. 유학은 시즌 종료 때 한꺼번에 반영한다
      if (a.program === 'dleague') away.set(id, { ...a, player: trainPlayer(a.player, a.stat, dleagueSessions(rules), rules) });
    }
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
    const hurt = new Map([...injured].map(([id, i]) => [id, i.left])); // 결장 중인 선수 → 남은 경기
    const swaps = [];
    const teams = teamData.map((t) => {
      const roster = players.filter((p) => p.teamId === t.id);
      let built = null;
      if (t.id === manager && lineup) {
        const byId = new Map(roster.map((p) => [p.id, p]));
        const check = checkLineup(players, manager, lineup, rules);
        if (check.ok) {
          const mine = { starters: lineup.starters.map((id) => byId.get(id)), bench: lineup.bench.map((id) => byId.get(id)) };
          const sub = hurt.size ? substituteInjured(mine, roster, hurt, rules) : mine; // 부상 선수는 같은 자리에 건강한 선수가 대신 선다(편성 자체는 그대로 두어 복귀하면 돌아간다)
          if (sub) { built = { starters: sub.starters, bench: sub.bench }; swaps.push(...(sub.swaps ?? [])); }
        }
      }
      return { id: t.id, name: t.name, lineup: built ?? buildLineupHealthy(roster, rules, rules.simulation.benchWeight, hurt, rules.injuries?.minHealthy ?? 8) };
    });
    lineupSwaps = swaps;
    return { teams, baseline: leagueBaseline(teams.map((t) => t.lineup), rules.simulation) };
  };

  // 시즌 중 트레이드: AI 구단의 판단에 쓰는 상황(지금까지의 순위·승률·전통)
  const tradeContext = () => {
    const st = regular?.standings() ?? [];
    return {
      season: league.season, managerTeamId: manager, teamCount: teamData.length,
      ranks: new Map(st.map((s, i) => [s.id, i + 1])),
      winPct: new Map(st.map((s) => [s.id, s.wins / Math.max(1, s.wins + s.losses)])),
      prestige: new Map(Object.entries(prestigeTable(league.legacy, rules)).map(([id, v]) => [id, v.score])),
      fans: league.att?.mood ? new Map(Object.entries(league.att.mood)) : null // 팬 열기(src/fans.mjs)
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

  // D리그 한 번의 파견을 마감한 기록(보고서 항목). 소환하거나 시즌이 끝날 때 만든다
  const closeStint = (playerId, a) => {
    const days = regular.day - a.fromDay;
    return {
      playerId, name: a.player.name, teamId: manager, program: 'dleague', stat: a.stat, days,
      before: a.before, after: { ovr: a.player.ovr, potential: a.player.potential }, outcome: 'normal',
      costEok: programCost('dleague', a.player, days, regular.schedule.length, rules)
    };
  };

  // 구단별 최장 연패(팬 열기에 쓴다, src/fans.mjs). 경기 결과를 보관하지 않아도(keepGames 꺼짐) 센다
  const losing = new Map(), worstLosing = new Map();
  const trackStreaks = (g) => {
    for (const [id, win] of [[g.homeId, g.winnerId === g.homeId], [g.awayId, g.winnerId === g.awayId]]) {
      const n = win ? 0 : (losing.get(id) ?? 0) + 1;
      losing.set(id, n);
      if (n > (worstLosing.get(id) ?? 0)) worstLosing.set(id, n);
    }
  };

  const initial = buildTeams();
  const regular = createRegularSeason(initial.teams, initial.baseline, rules.simulation, rng, {
    keepGames,
    onGame: (g) => { addBox(totals, g.box.home); addBox(totals, g.box.away); addRecordOnly(totals, g.box.home); addRecordOnly(totals, g.box.away); addGameToSplits(splits, g); trackStreaks(g); },
    checkpointEvery: rules.ratingModel.checkpointDays,
    onCheckpoint: () => { applyUpdates(); applyTraining(); return buildTeams(); }
  });
  let playoffs = null;
  let finished = null;
  const tradeOpen = () => regular.day <= rules.transactions.trade.deadlineDay && !playoffs;

  // ---------- 부상과 시즌 중 선수단 변동 ----------
  const rebuildTeams = () => { const built = buildTeams(); regular.setTeams(built.teams, built.baseline); };
  const playerById = (id) => players.find((p) => p.id === id);
  const lineupHas = (id) => lineup && [...lineup.starters, ...lineup.bench].includes(id);
  const inactiveForeign = (teamId) => [...injured.values()].filter((i) => i.teamId === teamId && i.temp).map((i) => i.playerId); // 일시교체 선수가 대신 뛰는 부상 선수

  /** 일시교체 선수가 팀을 떠난다: 뛴 기간만큼의 보수를 정산 보정에 넣는다(최종 명단에 없으니 따로 더해 준다) */
  const dropTemp = (tempId, day) => {
    const t = playerById(tempId);
    if (!t) return;
    addAdj(t.teamId, proratedEok(usdToEok(t.contract.salaryUsd), Math.max(0, day - (t.temp?.day ?? 0)), regular.schedule.length));
    players = players.filter((p) => p.id !== tempId);
    focus.delete(tempId);
    if (lineupHas(tempId)) lineup = null;
    rosterLog.push({ type: 'foreign', kind: 'tempEnd', day, teamId: t.teamId, playerId: tempId, name: t.name, forId: t.temp?.forId ?? null });
  };
  const recover = (inj, day) => {
    injured.delete(inj.playerId);
    rosterLog.push({ type: 'return', day, teamId: inj.teamId, playerId: inj.playerId, name: inj.name });
    if (inj.temp) dropTemp(inj.temp, day);
  };

  /** 외국선수 교체 실행(판정은 호출하는 쪽이 이미 통과시켰다). 반환: 들어온 선수 */
  const doForeignReplace = (teamId, outId, kind, cand, day) => {
    const out = playerById(outId);
    const inj = injured.get(outId);
    foreignTaken.add(cand.player.id);
    if (cand.player.kblId) usedKblNew.push(cand.player.kblId);
    const number = freeNumber(players, teamId);
    let p;
    if (kind === 'temp') {
      p = signedForeign(cand, { teamId, number, years: 1, temp: outId, day });
      players = [...players, p];
      inj.temp = p.id;
    } else {
      p = signedForeign(cand, { teamId, number, years: rules.inSeason.foreign.contractYears });
      players = players.map((x) => (x.id === outId ? p : x));
      // 떠나는 선수의 이번 시즌 보수는 계속 나가고(정산은 최종 명단 기준이라 더해 준다), 들어온 선수는 합류한 뒤부터만 낸다
      addAdj(teamId, round2(usdToEok(out.contract.salaryUsd) - proratedEok(usdToEok(cand.usd), day, regular.schedule.length)));
      injured.delete(outId);
      focus.delete(outId);
      if (kind === 'other') otherCount.set(teamId, (otherCount.get(teamId) ?? 0) + 1);
      if (lineupHas(outId)) { // 직접 편성이면 같은 자리에 새 선수를 넣는다(규칙에 안 맞으면 자동 편성으로)
        const swap = (ids) => ids.map((id) => (id === outId ? p.id : id));
        lineup = { starters: swap(lineup.starters), bench: swap(lineup.bench) };
        if (!checkLineup(players, manager, lineup, rules).ok) lineup = null;
      }
    }
    if (teamId === manager) focus.set(p.id, autoFocus(p));
    rosterLog.push({ type: 'foreign', kind, day, teamId, outId, outName: out.name, playerId: p.id, name: p.name, ovr: p.ovr, usd: cand.usd });
    return p;
  };
  const foreignCheckFor = (teamId, outId, kind, cand) => foreignReplaceCheck({
    players, teamId, outId, candidate: cand, kind, injury: injured.get(outId) ?? null, state: { otherCount: otherCount.get(teamId) ?? 0 }, rules, exclude: inactiveForeign(teamId)
  });

  /** AI 구단: 외국인이 다치면 규정대로 일시교체(2주 이상)·시즌대체(8주 이상). 몸값이 후보 중 가장 좋은 선수를 고른다 */
  const aiForeign = (inj, day) => {
    const th = foreignGameThresholds(rules);
    const kind = inj.total >= th.season ? 'season' : inj.total >= th.temporary ? 'temp' : null;
    const out = playerById(inj.playerId);
    if (!kind || !out || out.origin !== 'foreign') return false;
    const healthy = players.filter((p) => p.teamId === inj.teamId && !injured.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    const floor = healthy[7]?.ovr ?? 0; // 후보가 로테이션(상위 8명)에 들어올 만해야 교체한다
    const pool = foreignPool().filter((c) => !foreignTaken.has(c.player.id) && c.player.ovr > floor);
    const choice = aiForeignChoice(pool, (c) => foreignCheckFor(inj.teamId, out.id, kind, c));
    if (!choice) return false;
    doForeignReplace(inj.teamId, out.id, kind, choice, day);
    return true;
  };

  /** AI 구단: 건강한 선수가 모자란 채 국내 선수가 중증으로 오래 빠지면 방출하고 시장에서 영입한다 */
  const aiDomestic = (inj, day) => {
    const cfg = rules.inSeason.ai;
    const out = playerById(inj.playerId);
    if (!out || out.origin !== 'domestic' || inj.left < cfg.replaceInjuredAtGames) return false;
    const roster = players.filter((p) => p.teamId === inj.teamId);
    if (roster.filter((p) => !injured.has(p.id)).length >= cfg.healthyBelow) return false;
    if (domesticOf(players, inj.teamId).length - 1 < minDomestic(players, inj.teamId, rules)) return false;
    // 영입할 선수가 있을 때만 방출한다(AI는 해지 비용을 내지 않는다: 오프시즌 AI 방출과 같은 단순화)
    const after = players.filter((p) => p.id !== out.id);
    const mine = domesticOf(after, inj.teamId);
    const fa = rules.transactions.freeAgency;
    let best = null;
    for (const c of faPool) {
      if (c.origin !== 'domestic' || c.id === out.id || mgrReleased.has(c.id)) continue;
      const asking = faAsking(c, rules);
      if (!faSignCheck({ players: after, pool: faPool, teamId: inj.teamId, playerId: c.id, offer: { salaryEok: asking, years: 1 }, rules }).ok) continue;
      const u = valueOf(c) + needBonus(mine, c.position) - fa.priceWeight * asking;
      if (!best || u > best.u) best = { c, asking, u };
    }
    if (!best) return false;
    const { xp, ...rest } = out;
    players = after;
    injured.delete(out.id);
    faPool.push({ ...rest, teamId: null, contract: { yearsLeft: 0 } });
    addAdj(inj.teamId, proratedEok(out.contract.salaryEok, day, regular.schedule.length)); // 이미 뛴 만큼의 보수는 정산에 더한다
    rosterLog.push({ type: 'release', day, teamId: inj.teamId, playerId: out.id, name: out.name });
    const signed = signedFa(best.c, { teamId: inj.teamId, number: freeNumber(players, inj.teamId), salaryEok: best.asking, years: 1 });
    players = [...players, signed];
    faPool = faPool.filter((x) => x.id !== best.c.id);
    addAdj(inj.teamId, -proratedEok(best.asking, day, regular.schedule.length));
    rosterLog.push({ type: 'fa', day, teamId: inj.teamId, playerId: signed.id, name: signed.name, ovr: signed.ovr, salaryEok: best.asking, years: 1 });
    return true;
  };

  /** 하루가 끝난 뒤: 결장 소화·복귀, 새 부상 판정(경기 난수와 따로), AI의 교체·영입. 반환: 선수단이 바뀌었는지 */
  const afterDay = (r) => {
    const day = r.day;
    let changed = false;
    for (const inj of [...injured.values()]) { // 이 날 결장한 선수는 한 경기를 쉬었다
      inj.left -= 1;
      if (inj.left <= 0) { recover(inj, day); changed = true; }
    }
    const byId = new Map(players.map((p) => [p.id, p]));
    const played = new Set();
    for (const g of r.games) {
      for (const [side, teamId] of [[g.box.home, g.homeId], [g.box.away, g.awayId]]) {
        for (const line of side) {
          if (!line.minutes) continue;
          const p = byId.get(line.id);
          if (!p) continue;
          if (line.minutes >= rules.injuries.fatigue.minutes) played.add(p.id);
          const hit = rollInjury(p, line.minutes, rules, `${injSeed}:${league.season}:${day}:${p.id}`, streak.get(p.id) ?? 0);
          if (!hit) continue;
          const inj = { playerId: p.id, name: p.name, teamId, day, total: hit.games, left: hit.games, kind: hit.kind, part: hit.part, temp: null, handled: false };
          injured.set(p.id, inj);
          rosterLog.push({ type: 'injury', day, teamId, playerId: p.id, name: p.name, origin: p.origin, games: hit.games, kind: hit.kind, part: hit.part });
          changed = true;
        }
      }
    }
    for (const id of [...streak.keys()]) if (!played.has(id)) streak.delete(id);
    for (const id of played) streak.set(id, (streak.get(id) ?? 0) + 1);
    for (const inj of [...injured.values()]) { // 새로 다친 선수: AI 구단은 바로 판단한다(우리 구단은 단장이 정한다)
      if (inj.handled || inj.teamId === manager) continue;
      inj.handled = true;
      const p = playerById(inj.playerId);
      if (!p) continue;
      if (p.origin === 'foreign') aiForeign(inj, day); else if (p.origin === 'domestic') aiDomestic(inj, day);
      changed = true;
    }
    return changed;
  };
  const playDayFull = () => {
    const r = regular.playDay();
    if (injuriesOn && afterDay(r)) rebuildTeams();
    return r;
  };


  const run = {
    get day() { return regular.day; },
    get totalDays() { return regular.schedule.length; },
    get regularDone() { return regular.done; },
    get players() { return players; },
    get focus() { return focus; },
    get lineup() { return lineup; },
    get playoffs() { return playoffs; },
    get totals() { return totals; },
    get splits() { return splits; },
    schedule: regular.schedule,
    standings: () => regular.standings(),
    playDay: () => playDayFull(),
    /** n일(또는 끝까지) 진행. 반환: 날짜별 결과 배열 */
    playDays(n = Infinity) {
      const out = [];
      while (!regular.done && out.length < n) out.push(playDayFull());
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
    /** 선수의 훈련 집중 능력치. 다음 훈련 시점부터 반영된다 (육성 프로그램 참가 중인 선수도 바꿀 수 있다) */
    setFocus(playerId, stat) {
      if (!STAT_KEYS.includes(stat)) throw new Error(`알 수 없는 능력치: ${stat}`);
      if (away.has(playerId)) { away.set(playerId, { ...away.get(playerId), stat }); return; }
      if (!focus.has(playerId)) throw new Error('훈련을 지정할 수 있는 우리 구단 선수가 아닙니다');
      focus.set(playerId, stat);
    },
    /** 육성 프로그램 참가 중인 선수: [{ playerId, player(지금 상태), program, stat, fromDay, before, locked }] */
    get programs() {
      return [...away].map(([playerId, a]) => ({ playerId, player: a.player, program: a.program, stat: a.stat, fromDay: a.fromDay, before: a.before, locked: a.program === 'abroad' && regular.day > 0 }));
    },
    /** 이번 시즌 이미 끝난 D리그 파견(소환한 것) 기록 */
    get programHistory() { return devDone.map((d) => ({ ...d })); },
    /** 이 선수를 지금 프로그램에 보낼 수 있는지: { ok, reason } */
    programCheck(playerId, program) {
      if (!manager) return { ok: false, reason: '단장 구단이 없습니다' };
      const p = players.find((x) => x.id === playerId && x.teamId === manager);
      if (regular.done || playoffs) return { ok: false, reason: '정규리그가 끝나 보낼 수 없습니다' };
      const mine = players.filter((x) => x.teamId === manager);
      const base = eligibility(p, program, { day: regular.day, remainingRoster: mine.length - 1, activeCount: away.size, alreadyAway: away.has(playerId) }, rules);
      if (!base.ok) return base;
      try { buildLineup(mine.filter((x) => x.id !== playerId), rules, rules.simulation.benchWeight); } catch { return { ok: false, reason: '남는 선수로는 코스트 제한 안에서 라인업을 만들 수 없습니다' }; }
      return base;
    },
    /**
     * 육성 프로그램 파견(program: 'dleague' | 'abroad') 또는 소환(program이 null). 반환: { ok, errors }
     * D리그는 정규리그 중 언제든 보내고 소환할 수 있다. 유학은 시즌 시작 전(0일차)에만 보내고 취소할 수 있으며, 시즌이 끝나야 돌아온다.
     */
    setProgram(playerId, program, stat = null) {
      if (!manager) throw new Error('단장 구단이 없습니다');
      if (stat && !STAT_KEYS.includes(stat)) throw new Error(`알 수 없는 능력치: ${stat}`);
      if (!program) {
        const a = away.get(playerId);
        if (!a) return { ok: false, errors: ['육성 프로그램에 참가 중인 선수가 아닙니다'] };
        if (a.program === 'abroad' && regular.day > 0) return { ok: false, errors: ['유학 중인 선수는 시즌이 끝날 때까지 돌아올 수 없습니다'] };
        if (a.program === 'dleague') devDone.push(closeStint(playerId, a));
        away.delete(playerId);
        players = [...players, a.player];
        focus.set(playerId, a.stat);
        const built = buildTeams();
        regular.setTeams(built.teams, built.baseline);
        return { ok: true, errors: [] };
      }
      if (!PROGRAMS.includes(program)) throw new Error(`알 수 없는 프로그램: ${program}`);
      const check = run.programCheck(playerId, program);
      if (!check.ok) return { ok: false, errors: [check.reason] };
      const p = players.find((x) => x.id === playerId);
      away.set(playerId, { program, stat: stat ?? focus.get(playerId) ?? autoFocus(p), fromDay: regular.day, player: p, before: { ovr: p.ovr, potential: p.potential } });
      players = players.filter((x) => x.id !== playerId);
      focus.delete(playerId);
      if (lineup && [...lineup.starters, ...lineup.bench].includes(playerId)) lineup = null;
      const built = buildTeams();
      regular.setTeams(built.teams, built.baseline);
      return { ok: true, errors: [] };
    },
    // ---------- 계약 관리: 방출과 연장 계약 (정규리그 중에만, 플레이오프가 시작되면 닫힌다) ----------
    /** 지금 이 선수를 방출할 수 있는지와 비용: { ok, reason, cost: { severance, earned, years, fraction, salaryEok } } */
    releaseCheck(playerId) {
      if (!manager) return { ok: false, reason: '단장 구단이 없습니다', cost: null };
      if (playoffs) return { ok: false, reason: '플레이오프가 시작된 뒤에는 방출할 수 없습니다(시즌이 끝나면 오프시즌 첫 단계에서 가능)', cost: null };
      const c = releaseCheck({ players, teamId: manager, playerId, phase: 'season', rules });
      const p = players.find((x) => x.id === playerId);
      return { ...c, cost: p ? releaseCost(p, { phase: 'season', day: regular.day, totalDays: regular.schedule.length }) : null };
    },
    /** 방출(계약 중도 해지): 남은 보수는 시즌 정산에서 지출로 빠지고, 선수는 FA 풀로 간다. 반환: { ok, errors, cost } */
    releasePlayer(playerId) {
      const c = run.releaseCheck(playerId);
      if (!c.ok) return { ok: false, errors: [c.reason], cost: c.cost };
      const p = players.find((x) => x.id === playerId);
      players = players.filter((x) => x.id !== playerId);
      focus.delete(playerId);
      if (lineup && [...lineup.starters, ...lineup.bench].includes(playerId)) lineup = null;
      const { xp, ...rest } = p; // 남은 훈련 경험치는 사라진다
      released.push({ ...rest, teamId: null, contract: { yearsLeft: 0 } });
      faPool.push({ ...rest, teamId: null, contract: { yearsLeft: 0 } }); // 시장에 나온다(다른 구단이 영입할 수 있다)
      injured.delete(playerId);
      mgrReleased.add(playerId);
      releaseLog.push({ playerId, name: p.name, day: regular.day, salaryEok: p.contract.salaryEok, yearsLeft: p.contract.yearsLeft, ovr: p.ovr, ...c.cost });
      const built = buildTeams();
      regular.setTeams(built.teams, built.baseline);
      return { ok: true, errors: [], cost: c.cost };
    },
    /** 연장 계약 미리 보기·판정. offer: { salaryEok, years(총 기간, 남은 기간 포함) } → extensionCheck 결과 */
    extendCheck(playerId, offer) {
      if (!manager) return { ok: false, status: 'invalid', reason: '단장 구단이 없습니다' };
      if (playoffs) return { ok: false, status: 'invalid', reason: '플레이오프가 시작된 뒤에는 연장할 수 없습니다(시즌이 끝나면 재계약 단계에서 가능)' };
      const p = players.find((x) => x.id === playerId && x.teamId === manager);
      if (!p) return { ok: false, status: 'invalid', reason: '우리 구단 선수가 아닙니다' };
      const ctx = tradeContext();
      return extensionCheck({ player: p, offer, roster: players.filter((x) => x.teamId === manager && x.origin === 'domestic'), ctx, rules, rank: salaryRanks(players).get(playerId), teamId: manager });
    },
    /** 연장 계약 적용(수락될 때만). 반환: { ok, errors, check } */
    extendContract(playerId, offer) {
      const check = run.extendCheck(playerId, offer);
      if (!check.ok) return { ok: false, errors: [check.reason], check };
      const p = players.find((x) => x.id === playerId);
      const next = extendedPlayer(p, offer);
      players = players.map((x) => (x.id === playerId ? next : x));
      extendLog.push({ playerId, name: p.name, day: regular.day, from: { salaryEok: p.contract.salaryEok, yearsLeft: p.contract.yearsLeft }, to: { salaryEok: offer.salaryEok, yearsLeft: offer.years },
        adj: extensionAdjust(p.contract.salaryEok, offer.salaryEok, regular.day, regular.schedule.length) });
      const built = buildTeams();
      regular.setTeams(built.teams, built.baseline);
      return { ok: true, errors: [], check };
    },
    /** 이번 시즌 방출·연장 기록 */
    get contractLog() { return { released: releaseLog.map((r) => ({ ...r })), extended: extendLog.map((r) => ({ ...r, from: { ...r.from }, to: { ...r.to } })) }; },
    /** 방출로 아직 정산 전인 해지 비용 합계(억) — 화면의 "지금 자금"에서 미리 뺀다 */
    get pendingSeverance() { return Math.round(releaseLog.reduce((s2, r) => s2 + r.severance, 0) * 100) / 100; },
    // ---------- 부상 ----------
    /** 지금 결장 중인 선수들(전 구단). [{ playerId, name, teamId, day, total, left, kind, part, temp }] */
    get injuries() { return [...injured.values()].map((i) => ({ ...i })); },
    injuryOf(playerId) { const i = injured.get(playerId); return i ? { ...i } : null; },
    /** 우리 구단의 직접 편성에서 부상 선수를 대신해 자동으로 들어간 선수: [{ out, in }] (선수 객체) */
    get lineupSwaps() { return lineupSwaps.map((x) => ({ ...x })); },
    /** 이번 시즌 변동 기록(부상·복귀·영입·교체·방출), 오래된 순 */
    get rosterLog() { return rosterLog.map((x) => ({ ...x })); },
    // ---------- 시즌 중 FA 영입 (시장에 남은 선수. 정규리그 중에만) ----------
    /** 시장에 남은 국내 선수와 요구 연봉: [{ player, asking }] (가치 높은 순) */
    faMarket() { return faPool.filter((p) => p.origin === 'domestic').sort((a, b) => valueOf(b) - valueOf(a) || a.id.localeCompare(b.id)).map((p) => ({ player: p, asking: faAsking(p, rules) })); },
    /** 영입 판정: { ok, reason, asking, range }. offer: { salaryEok, years(이번 시즌 포함) } */
    faCheck(playerId, offer) {
      if (!manager) return { ok: false, reason: '단장 구단이 없습니다', asking: null, range: null };
      if (playoffs || regular.done) return { ok: false, reason: '정규리그가 끝나 영입할 수 없습니다', asking: null, range: null };
      return faSignCheck({ players, pool: faPool, teamId: manager, playerId, offer, rules, isManager: true });
    },
    /** 영입 실행. 계약이 맺어지면 시즌 정산에서 합류한 뒤의 보수만 낸다. 반환: { ok, errors, player } */
    signFa(playerId, offer) {
      const c = run.faCheck(playerId, offer);
      if (!c.ok) return { ok: false, errors: [c.reason], player: null };
      const p = faPool.find((x) => x.id === playerId);
      const signed = signedFa(p, { teamId: manager, number: freeNumber(players, manager), salaryEok: offer.salaryEok, years: offer.years });
      players = [...players, signed];
      faPool = faPool.filter((x) => x.id !== playerId);
      focus.set(signed.id, autoFocus(signed));
      addAdj(manager, -proratedEok(offer.salaryEok, regular.day, regular.schedule.length));
      rosterLog.push({ type: 'fa', day: regular.day, teamId: manager, playerId: signed.id, name: signed.name, ovr: signed.ovr, salaryEok: offer.salaryEok, years: offer.years });
      rebuildTeams();
      return { ok: true, errors: [], player: signed };
    },
    // ---------- 외국선수 교체 (외국선수 관리규정 제8조) ----------
    /** 교체 후보(시즌 중 외국인 풀에서 아직 영입되지 않은 선수): [{ player, usd }] */
    foreignMarket() { return foreignPool().filter((c) => !foreignTaken.has(c.player.id)); },
    /** 교체 판정. kind: 'temp'(일시교체) | 'season'(부상 시즌대체) | 'other'(기타 사유 시즌대체) → { ok, reason } */
    foreignCheck(outId, kind, candId) {
      if (!manager) return { ok: false, reason: '단장 구단이 없습니다' };
      if (playoffs || regular.done) return { ok: false, reason: '정규리그가 끝나 교체할 수 없습니다' };
      const cand = run.foreignMarket().find((c) => c.player.id === candId);
      return foreignCheckFor(manager, outId, kind, cand);
    },
    /** 교체 실행. 반환: { ok, errors, player } */
    replaceForeign(outId, kind, candId) {
      const c = run.foreignCheck(outId, kind, candId);
      if (!c.ok) return { ok: false, errors: [c.reason], player: null };
      const cand = run.foreignMarket().find((x) => x.player.id === candId);
      const p = doForeignReplace(manager, outId, kind, cand, regular.day);
      rebuildTeams();
      return { ok: true, errors: [], player: p };
    },
    /** 이 시즌 우리 구단의 기타 사유 교체 횟수와 한도 */
    get otherReplacements() { return { used: otherCount.get(manager) ?? 0, limit: rules.inSeason.foreign.otherReasonLimit }; },
    /** 외국선수 교체 기준(경기 수) */
    get foreignThresholds() { return foreignGameThresholds(rules); },
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
      if (injuriesOn && injured.size) { // 정규리그 끝과 플레이오프 사이의 휴식 동안 회복한다. 플레이오프에서는 새 부상이 없다
        for (const inj of [...injured.values()]) { inj.left -= rules.injuries.playoffRecoveryGames; if (inj.left <= 0) recover(inj, regular.day); }
        rebuildTeams();
      }
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
      for (const inj of [...injured.values()]) if (inj.temp) dropTemp(inj.temp, regular.schedule.length); // 시즌이 끝나면 일시교체 선수는 떠난다
      injured.clear(); // 남은 결장은 오프시즌에 해소된다
      applyUpdates();
      // 육성 프로그램: D리그는 남은 파견을 마감하고, 유학은 선수별로 시드가 고정된 난수로 성장해 돌아온다
      const report = [...devDone];
      const returned = [];
      const abroadIds = [];
      for (const [id, a] of away) {
        if (a.program === 'dleague') { report.push(closeStint(id, a)); returned.push(a.player); continue; }
        const checkpoints = checkpointsPerSeason(regular.schedule.length, rules.ratingModel.checkpointDays);
        const g = abroadGrowth(a.player, a.stat, checkpoints, rules, mulberry32(hashString(`dev:${league.season}:${id}`)));
        returned.push(g.player); abroadIds.push(id);
        report.push({
          playerId: id, name: a.player.name, teamId: manager, program: 'abroad', stat: a.stat, days: regular.schedule.length,
          before: a.before, after: { ovr: g.player.ovr, potential: g.player.potential }, outcome: g.outcome,
          costEok: programCost('abroad', a.player, regular.schedule.length, regular.schedule.length, rules)
        });
      }
      const dev = { teamId: manager, report, totalCost: Math.round(report.reduce((s, r) => s + r.costEok, 0) * 100) / 100, abroadIds };
      const sum = (list, k) => Math.round(list.reduce((s2, r) => s2 + r[k], 0) * 100) / 100;
      const contracts = releaseLog.length || extendLog.length ? { teamId: manager, released: released.map((x) => ({ ...x })), releaseLog: releaseLog.map((r) => ({ ...r })), extendLog: extendLog.map((r) => ({ ...r })), severance: sum(releaseLog, 'severance'), earned: sum(releaseLog, 'earned'), adj: sum(extendLog, 'adj') } : null;
      finished = {
        result: { standings: reg.standings, games: reg.games, playoffs: po, championId: po.championId, teams: reg.teams, baseline: reg.baseline },
        totals, splits, seasonPlayers: returned.length ? [...players, ...returned] : players, startStats: start, dev, contracts, streaks: Object.fromEntries(worstLosing),
        roster: { pool: faPool, payAdj: Object.fromEntries(payAdj), usedKbl: usedKblNew, log: rosterLog }
      };
      return finished;
    }
  };
  return run;
}

/** 시즌 정산: 구단 전통 기록 추가 + 수입·연봉·기금 정산. 반환: 오프시즌 처리에 넘길 league와 구단별 장부 */
export function settleYear(league, finished, teamData, rules) {
  rules = rulesFor(rules, league.season);
  const { result } = finished;
  // 이번 시즌 경기 수·출전 시간을 선수에 찍어 둔다(오프시즌 성장의 출전 경험 보너스가 쓴다). 이전 저장·기록 없는 선수는 0
  const seasonPlayers = finished.seasonPlayers.map((p) => { const t = finished.totals?.get(p.id); return { ...p, lastGp: t?.games ?? 0, lastMin: Math.round((t?.minutes ?? 0) * 10) / 10 }; });
  const label = `${league.season}-${String(league.season + 1).slice(2)}`;
  const legacy = league.legacy ? appendSeason(league.legacy, label, result, rules) : undefined;
  // 유학 중이던 선수는 등록 명단 밖이라 캡·연봉 지출에서 빠지고, 대신 프로그램 비용(유학비 + 연봉의 일부)을 낸다
  const { dev } = finished;
  const payPlayers = dev?.abroadIds?.length ? seasonPlayers.filter((p) => !dev.abroadIds.includes(p.id)) : seasonPlayers;
  const settled = settleSeason(league.funds ?? initialFunds(teamData, rules), payPlayers, result.standings, result.playoffs, teamData, rules, prestigeTable(league.legacy, rules), league.season, league.att ?? null); // 수입은 이번 시즌 이전의 전통으로
  if (dev?.totalCost > 0) {
    const t = dev.teamId, l = settled.ledger[t], round2 = (v) => Math.round(v * 100) / 100;
    settled.funds[t] = round2(settled.funds[t] - dev.totalCost);
    settled.ledger[t] = { ...l, program: dev.totalCost, net: round2(l.net - dev.totalCost) };
  }
  // 계약 관리: 방출한 선수의 남은 보수(해지 비용)와 이미 뛴 만큼의 보수, 시즌 중 연장의 정산 보정을 장부에 넣고 방출된 선수는 FA 풀로 보낸다
  const { contracts } = finished;
  let freeAgents = league.freeAgents ?? [];
  if (contracts) {
    const t = contracts.teamId, l = settled.ledger[t], round2 = (v) => Math.round(v * 100) / 100;
    const extra = round2(contracts.severance + contracts.earned + contracts.adj);
    settled.funds[t] = round2(settled.funds[t] - extra);
    settled.ledger[t] = { ...l, payroll: round2(l.payroll + contracts.earned + contracts.adj), severance: contracts.severance, net: round2(l.net - extra) };
    freeAgents = [...freeAgents, ...contracts.released];
  }
  // 시즌 중 선수단 변동: 시장에 남은 선수(영입된 선수는 빠지고 방출된 선수는 들어가 있다), 일할 계산 차이, 새로 들어온 카드 선수
  const ins = finished.roster;
  let usedKbl = null;
  if (ins) {
    freeAgents = ins.pool;
    const round2b = (v) => Math.round(v * 100) / 100;
    for (const [t, adj] of Object.entries(ins.payAdj ?? {})) {
      const l = settled.ledger[t];
      if (!l) continue;
      settled.funds[t] = round2b(settled.funds[t] - adj);
      settled.ledger[t] = { ...l, payroll: round2b(l.payroll + adj), net: round2b(l.net - adj) };
    }
    if (ins.usedKbl?.length) usedKbl = [...new Set([...(league.usedKbl ?? []), ...ins.usedKbl])];
  }
  // 팬 열기: 이번 시즌 성적·스타·연패로 갱신(관중 상태에 얹어 저장한다, src/fans.mjs). 규칙이 없으면 건드리지 않는다
  const mood = advanceMood(league.att?.mood ?? null, { standings: result.standings, playoffs: result.playoffs, teamData, startPlayers: league.players, endPlayers: seasonPlayers, streaks: finished.streaks ?? {} }, rules);
  const att = mood ? { ...settled.att, mood } : settled.att;
  return { league: { ...league, players: seasonPlayers, freeAgents, ...(usedKbl ? { usedKbl } : {}), funds: settled.funds, att, ...(legacy ? { legacy } : {}) }, ledger: settled.ledger };
}
