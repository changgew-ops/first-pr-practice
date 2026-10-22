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
 * 정규리그 진행.
 * options.keepGames: 경기 결과를 모두 보관
 * options.onGame(result): 경기마다 호출 (기록 누적 등)
 * options.checkpointEvery: N일마다 onCheckpoint를 호출
 * options.onCheckpoint({ day, teams, baseline }): { teams, baseline }을 돌려주면 이후 경기부터 새 라인업·기준점으로 진행
 *   (시즌 중 능력치 갱신, 훈련 반영 등에 쓴다)
 */
export function playRegularSeason(teams, baseline, sim, rng, options = {}) {
  const { keepGames = false, onGame, checkpointEvery, onCheckpoint } = options;
  let current = teams;
  let base = baseline;
  let byId = new Map(current.map((t) => [t.id, t]));
  const records = new Map(teams.map((t) => [t.id, newRecord(t.id)]));
  const schedule = createSchedule(teams.map((t) => t.id));
  const games = [];
  schedule.forEach((day, dayIdx) => {
    for (const g of shuffle(day, rng)) {
      const r = simulateGame(byId.get(g.homeId), byId.get(g.awayId), base, sim, rng);
      const hr = records.get(r.homeId);
      const ar = records.get(r.awayId);
      hr.pointsFor += r.homePts; hr.pointsAgainst += r.awayPts;
      ar.pointsFor += r.awayPts; ar.pointsAgainst += r.homePts;
      if (r.winnerId === r.homeId) { hr.wins++; ar.losses++; } else { ar.wins++; hr.losses++; }
      if (keepGames) games.push(r);
      if (onGame) onGame(r);
    }
    const day1 = dayIdx + 1;
    if (checkpointEvery && onCheckpoint && day1 % checkpointEvery === 0 && day1 < schedule.length) {
      const next = onCheckpoint({ day: day1, teams: current, baseline: base });
      if (next?.teams) { current = next.teams; byId = new Map(current.map((t) => [t.id, t])); }
      if (next?.baseline) base = next.baseline;
    }
  });
  return { standings: rankStandings([...records.values()]), games, teams: current, baseline: base };
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
 */
export function playPlayoffs(rankedIds, teamsById, rules, baseline, sim, rng) {
  const { qualify, rounds, homePattern } = rules.playoffs;
  if (qualify !== 6) throw new Error('현재 대진표는 6팀 진출만 지원합니다');
  const seed = new Map(rankedIds.slice(0, qualify).map((id, i) => [id, i + 1]));
  const run = (round, a, b) => {
    const [hi, lo] = seed.get(a) < seed.get(b) ? [a, b] : [b, a];
    const s = playSeries(teamsById.get(hi), teamsById.get(lo), round.bestOf, homePattern[round.bestOf], baseline, sim, rng);
    return { round: round.name, ...s };
  };
  const ids = rankedIds.slice(0, qualify);
  const [r1, r2, r3] = rounds;

  const q36 = run(r1, ids[2], ids[5]);
  const q45 = run(r1, ids[3], ids[4]);
  const s14 = run(r2, ids[0], q45.winnerId);
  const s23 = run(r2, ids[1], q36.winnerId);
  const final = run(r3, s14.winnerId, s23.winnerId);
  return { series: [q36, q45, s14, s23, final], championId: final.winnerId, finalistIds: [final.higherId, final.lowerId] };
}

export function playSeason(teams, rules, baseline, rng, options) {
  const sim = rules.simulation;
  const regular = playRegularSeason(teams, baseline, sim, rng, options);
  // 시즌 중 라인업이 바뀌었다면 마지막 라인업·기준점으로 플레이오프를 치른다
  const finalById = new Map(regular.teams.map((t) => [t.id, t]));
  const playoffs = playPlayoffs(regular.standings.map((r) => r.id), finalById, rules, regular.baseline, sim, rng);
  return { standings: regular.standings, games: regular.games, playoffs, championId: playoffs.championId, teams: regular.teams, baseline: regular.baseline };
}
