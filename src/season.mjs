import { simulateGame } from './game.mjs';
import { shuffle } from './rng.mjs';

/**
 * 정규리그 일정: 10개 구단이 서로 6번씩 (홈 3, 원정 3) = 54경기.
 * 원형 대진(circle method)으로 한 바퀴(9일)를 만들고 6바퀴 반복하며 바퀴마다 홈/원정을 바꾼다.
 * 반환: 날짜별 경기 배열 [[{homeId, awayId}, ...], ...]
 */
export function createSchedule(teamIds, cycles = 6) {
  if (teamIds.length % 2 !== 0) throw new Error('구단 수는 짝수여야 합니다');
  const n = teamIds.length;
  const ring = [...teamIds];
  const oneCycle = [];
  for (let round = 0; round < n - 1; round++) {
    const day = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i];
      const b = ring[n - 1 - i];
      // 같은 바퀴 안에서 홈/원정이 고르게 퍼지도록 짝수·홀수 라운드에 번갈아 배치
      day.push((round + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    oneCycle.push(day);
    ring.splice(1, 0, ring.pop()); // 첫 팀은 고정하고 나머지를 한 칸 회전
  }
  const days = [];
  for (let c = 0; c < cycles; c++) {
    for (const day of oneCycle) {
      days.push(day.map(([home, away]) => (c % 2 === 0 ? { homeId: home, awayId: away } : { homeId: away, awayId: home })));
    }
  }
  return days;
}

function newRecord(id) {
  return { id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
}

// 순위: 승수 → 득실차 → 다득점 (실제 KBL 규정과 다른 단순화)
export function rankStandings(records) {
  return [...records].sort((a, b) => b.wins - a.wins
    || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst)
    || b.pointsFor - a.pointsFor
    || a.id.localeCompare(b.id));
}

/**
 * 정규리그를 하루씩 진행하는 진행기. playRegularSeason이 이 위에서 돌아간다(난수 쓰는 순서가 같아 결과도 같다).
 * options.keepGames: 경기 결과를 모두 보관
 * options.onGame(result): 경기마다 호출 (기록 누적 등)
 * options.checkpointEvery: N일마다 onCheckpoint를 호출
 * options.onCheckpoint({ day, teams, baseline }): { teams, baseline }을 돌려주면 이후 경기부터 새 라인업·기준점으로 진행
 *   (시즌 중 능력치 갱신, 훈련 반영 등에 쓴다)
 * 진행기: { schedule, day, done, playDay() → { day, games }, setTeams(teams, baseline?), standings(), finish() }
 */
export function createRegularSeason(teams, baseline, sim, rng, options = {}) {
  const { keepGames = false, onGame, checkpointEvery, onCheckpoint, exKey = null } = options; // exKey: 극단 득점 경기 판정용 시즌 키(없으면 판정 없음, src/game.mjs)
  let current = teams;
  let base = baseline;
  let byId = new Map(current.map((t) => [t.id, t]));
  const records = new Map(teams.map((t) => [t.id, newRecord(t.id)]));
  const schedule = createSchedule(teams.map((t) => t.id));
  const games = [];
  let dayIdx = 0;
  const setTeams = (next, nextBase) => {
    current = next; byId = new Map(current.map((t) => [t.id, t]));
    if (nextBase) base = nextBase;
  };
  return {
    schedule,
    get day() { return dayIdx; },
    get done() { return dayIdx >= schedule.length; },
    get teams() { return current; },
    get baseline() { return base; },
    setTeams,
    /** 다음 경기일 하나를 진행한다. 반환: { day(1부터), games: [경기 결과 …] } */
    playDay() {
      if (dayIdx >= schedule.length) throw new Error('정규리그가 끝났습니다');
      const played = [];
      for (const g of shuffle(schedule[dayIdx], rng)) {
        const r = simulateGame(byId.get(g.homeId), byId.get(g.awayId), base, sim, rng, exKey ? { key: `${exKey}:d${dayIdx + 1}:${g.homeId}`, playoff: false } : null);
        const hr = records.get(r.homeId);
        const ar = records.get(r.awayId);
        hr.pointsFor += r.homePts; hr.pointsAgainst += r.awayPts;
        ar.pointsFor += r.awayPts; ar.pointsAgainst += r.homePts;
        if (r.winnerId === r.homeId) { hr.wins++; ar.losses++; } else { ar.wins++; hr.losses++; }
        if (keepGames) games.push(r);
        if (onGame) onGame(r);
        played.push(r);
      }
      dayIdx++;
      if (checkpointEvery && onCheckpoint && dayIdx % checkpointEvery === 0 && dayIdx < schedule.length) {
        const next = onCheckpoint({ day: dayIdx, teams: current, baseline: base });
        if (next?.teams) setTeams(next.teams);
        if (next?.baseline) base = next.baseline;
      }
      return { day: dayIdx, games: played };
    },
    standings: () => rankStandings([...records.values()]),
    finish: () => ({ standings: rankStandings([...records.values()]), games, teams: current, baseline: base })
  };
}

export function playRegularSeason(teams, baseline, sim, rng, options = {}) {
  const season = createRegularSeason(teams, baseline, sim, rng, options);
  while (!season.done) season.playDay();
  return season.finish();
}

/** 시리즈: bestOf 전 (bestOf+1)/2 선승. 높은 시드가 홈 패턴(1=홈)에 따라 홈 경기를 가진다. */
export function playSeries(higher, lower, bestOf, pattern, baseline, sim, rng) {
  const need = Math.floor(bestOf / 2) + 1;
  const wins = { [higher.id]: 0, [lower.id]: 0 };
  const games = [];
  for (let i = 0; wins[higher.id] < need && wins[lower.id] < need; i++) {
    const higherHome = pattern[i % pattern.length] === 1;
    const home = higherHome ? higher : lower;
    const away = higherHome ? lower : higher;
    const r = simulateGame(home, away, baseline, sim, rng);
    wins[r.winnerId]++;
    games.push(r);
  }
  const winnerId = wins[higher.id] >= need ? higher.id : lower.id;
  return { higherId: higher.id, lowerId: lower.id, winnerId, wins, games };
}

/**
 * 플레이오프 (6팀 기준 대진)
 *  6강: 3위-6위, 4위-5위 / 4강: 1위-(4·5위 승자), 2위-(3·6위 승자) / 결승
 * 시드는 정규리그 순위. 시리즈마다 시드가 높은 팀이 홈 어드밴티지를 가진다.
 *
 * 진행기: 한 경기씩(playGame)·한 라운드씩(playRound)·끝까지 모두 같은 난수 순서로 진행한다 — 같은 시드에서 어느 방식으로 진행해도 결과가 같다.
 * 경기 순서는 라운드 안에서 시리즈 차례(앞 시리즈를 먼저 끝까지, 그다음 시리즈), 시리즈 안에서는 1차전부터다. 경기마다 팀 표(teamsById)와 기준점을 다시 읽으므로
 * 경기 사이에 편성·전술·컨디션 보정이 바뀌면 다음 경기부터 반영된다. baseline은 값 또는 () => 값.
 * { seeds, round(끝난 라운드 수), done, gamesPlayed(치른 경기 수), series(끝난 시리즈들),
 *   current(지금 라운드의 시리즈 상태들: 안 끝난 것 포함), peek()(다음 경기 정보), playGame(), playRound(), result() }
 */
export function createPlayoffs(rankedIds, teamsById, rules, baseline, sim, rng, options = {}) {
  const exKey = options.exKey ?? null;
  const { qualify, rounds, homePattern } = rules.playoffs;
  if (qualify !== 6) throw new Error('현재 대진표는 6팀 진출만 지원합니다');
  const baselineOf = typeof baseline === 'function' ? baseline : () => baseline;
  const seed = new Map(rankedIds.slice(0, qualify).map((id, i) => [id, i + 1]));
  const ids = rankedIds.slice(0, qualify);
  const series = []; // 끝난 시리즈(예전과 같은 모양: { round, higherId, lowerId, winnerId, wins, games })
  // 라운드마다 맞붙는 두 팀(앞 라운드가 끝나야 알 수 있다)
  const pairs = [
    () => [[ids[2], ids[5]], [ids[3], ids[4]]],
    () => [[ids[0], series[1].winnerId], [ids[1], series[0].winnerId]],
    () => [[series[2].winnerId, series[3].winnerId]]
  ];
  let played = 0; // 끝난 라운드 수
  let live = null; // 지금 라운드의 시리즈 상태
  let gamesPlayed = 0;
  const open = () => {
    if (live || played >= pairs.length) return;
    const round = rounds[played];
    live = pairs[played]().map(([a, b]) => {
      const [hi, lo] = seed.get(a) < seed.get(b) ? [a, b] : [b, a];
      return { round: round.name, higherId: hi, lowerId: lo, bestOf: round.bestOf, need: Math.floor(round.bestOf / 2) + 1, pattern: homePattern[round.bestOf], wins: { [hi]: 0, [lo]: 0 }, games: [], winnerId: null };
    });
  };
  const nextSeries = () => { open(); return live?.find((x) => !x.winnerId) ?? null; };
  const sides = (sr) => {
    const higherHome = sr.pattern[sr.games.length % sr.pattern.length] === 1;
    return higherHome ? [sr.higherId, sr.lowerId] : [sr.lowerId, sr.higherId];
  };
  return {
    seeds: seed,
    get round() { return played; },
    get done() { return played >= pairs.length; },
    get series() { return series; },
    get gamesPlayed() { return gamesPlayed; },
    /** 지금 라운드의 시리즈 상태들(끝난 것·진행 중·아직 안 한 것). 끝난 라운드 뒤에는 다음 라운드의 대진(모두 0-0) */
    get current() { open(); return live ? live.map((x) => ({ round: x.round, higherId: x.higherId, lowerId: x.lowerId, bestOf: x.bestOf, wins: { ...x.wins }, games: [...x.games], winnerId: x.winnerId })) : []; },
    /** 다음에 치를 경기: { roundIndex, seriesIndex, higherId, lowerId, homeId, awayId, n(시리즈의 몇 차전), round } 또는 null(끝남) */
    peek() {
      const sr = nextSeries();
      if (!sr) return null;
      const [homeId, awayId] = sides(sr);
      return { roundIndex: played, seriesIndex: live.indexOf(sr), round: sr.round, higherId: sr.higherId, lowerId: sr.lowerId, homeId, awayId, n: sr.games.length + 1 };
    },
    /** 한 경기를 치른다. 반환: { game, round, seriesIndex, n, seriesDone(그 시리즈가 끝났는지), roundDone(그 라운드가 끝났는지), series(시리즈 상태 복사본) } */
    playGame() {
      const sr = nextSeries();
      if (!sr) throw new Error('플레이오프가 끝났습니다');
      const [homeId, awayId] = sides(sr);
      const r = simulateGame(teamsById.get(homeId), teamsById.get(awayId), baselineOf(), sim, rng, exKey ? { key: `${exKey}:po${gamesPlayed + 1}:${homeId}`, playoff: true } : null);
      sr.wins[r.winnerId]++;
      sr.games.push(r);
      gamesPlayed++;
      const info = { game: r, round: sr.round, roundIndex: played, seriesIndex: live.indexOf(sr), n: sr.games.length, seriesDone: false, roundDone: false };
      if (sr.wins[sr.higherId] >= sr.need || sr.wins[sr.lowerId] >= sr.need) {
        sr.winnerId = sr.wins[sr.higherId] >= sr.need ? sr.higherId : sr.lowerId;
        series.push({ round: sr.round, higherId: sr.higherId, lowerId: sr.lowerId, winnerId: sr.winnerId, wins: sr.wins, games: sr.games });
        info.seriesDone = true;
        if (live.every((x) => x.winnerId)) { info.roundDone = true; live = null; played++; }
      }
      return info;
    },
    /** 지금 라운드의 남은 경기를 모두 치른다. 반환: 그 라운드의 시리즈들(끝난 것) */
    playRound() {
      if (played >= pairs.length) throw new Error('플레이오프가 끝났습니다');
      const target = played;
      while (played === target) this.playGame();
      return series.filter((x) => x.round === rounds[target].name);
    },
    result() {
      const final = series[4];
      return { series: [...series], championId: final?.winnerId ?? null, finalistIds: final ? [final.higherId, final.lowerId] : [] };
    }
  };
}

export function playPlayoffs(rankedIds, teamsById, rules, baseline, sim, rng) {
  const po = createPlayoffs(rankedIds, teamsById, rules, baseline, sim, rng);
  while (!po.done) po.playRound();
  return po.result();
}

export function playSeason(teams, rules, baseline, rng, options) {
  const sim = rules.simulation;
  const regular = playRegularSeason(teams, baseline, sim, rng, options);
  // 시즌 중 라인업이 바뀌었다면 마지막 라인업·기준점으로 플레이오프를 치른다
  const finalById = new Map(regular.teams.map((t) => [t.id, t]));
  const playoffs = playPlayoffs(regular.standings.map((r) => r.id), finalById, rules, regular.baseline, sim, rng);
  return { standings: regular.standings, games: regular.games, playoffs, championId: playoffs.championId, teams: regular.teams, baseline: regular.baseline };
}
