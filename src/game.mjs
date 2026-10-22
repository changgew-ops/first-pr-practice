import { normal } from './rng.mjs';

// 한 선수의 공격·수비 기여도 (능력치 → 점수)
const offense = (p) => 0.5 * p.stats.shooting + 0.25 * p.stats.passing + 0.25 * p.stats.athletic;
const defense = (p) => 0.5 * p.stats.defense + 0.3 * p.stats.rebound + 0.2 * p.stats.athletic;

export function lineupMinutes(lineup, sim) {
  const minutes = new Map();
  lineup.starters.forEach((p, i) => minutes.set(p.id, sim.minutesStarters[i] ?? 0));
  lineup.bench.forEach((p, i) => minutes.set(p.id, sim.minutesBench[i] ?? 0));
  return minutes;
}

// 출전 시간으로 가중한 팀 공격력·수비력
export function teamRatings(lineup, sim) {
  const minutes = lineupMinutes(lineup, sim);
  const all = [...lineup.starters, ...lineup.bench];
  let off = 0;
  let def = 0;
  let total = 0;
  for (const p of all) {
    const m = minutes.get(p.id);
    off += offense(p) * m;
    def += defense(p) * m;
    total += m;
  }
  return { offense: off / total, defense: def / total };
}

// 리그 평균 공격력·수비력 (득점 기대값의 기준점)
export function leagueBaseline(lineups, sim) {
  const r = lineups.map((l) => teamRatings(l, sim));
  return {
    offense: r.reduce((s, x) => s + x.offense, 0) / r.length,
    defense: r.reduce((s, x) => s + x.defense, 0) / r.length
  };
}

function expectedPoints(att, def, baseline, sim, home) {
  return sim.basePoints
    + sim.ratingScale * (att.offense - baseline.offense)
    - sim.ratingScale * (def.defense - baseline.defense)
    + (home ? sim.homeAdvantage / 2 : -sim.homeAdvantage / 2);
}

// 득점을 선수별 출전 시간 × 공격 능력에 비례해 나눈다 (합계가 팀 득점과 정확히 일치)
function splitPoints(total, players, minutes, rng) {
  const weights = players.map((p) => Math.max(0.01, minutes.get(p.id) * offense(p) * (0.7 + rng() * 0.6)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const floor = raw.map(Math.floor);
  let left = total - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floor[i]++; left--; }
  return floor;
}

function boxScore(lineup, pts, sim, rng) {
  const players = [...lineup.starters, ...lineup.bench];
  const minutes = lineupMinutes(lineup, sim);
  const scored = splitPoints(pts, players, minutes, rng);
  return players.map((p, i) => ({ id: p.id, name: p.name, minutes: minutes.get(p.id), points: scored[i] }));
}

/**
 * 한 경기 시뮬레이션 (순수 함수: 같은 입력과 같은 rng 상태면 같은 결과).
 * home / away: { id, lineup: { starters, bench } }
 */
export function simulateGame(home, away, baseline, sim, rng) {
  const hr = teamRatings(home.lineup, sim);
  const ar = teamRatings(away.lineup, sim);
  const hExp = expectedPoints(hr, ar, baseline, sim, true);
  const aExp = expectedPoints(ar, hr, baseline, sim, false);

  let h = Math.max(40, Math.round(hExp + sim.pointsSd * normal(rng)));
  let a = Math.max(40, Math.round(aExp + sim.pointsSd * normal(rng)));
  let overtimes = 0;
  const otFactor = sim.overtimeMinutes / 40;
  while (h === a) {
    overtimes++;
    h += Math.max(2, Math.round(hExp * otFactor + sim.pointsSd * Math.sqrt(otFactor) * normal(rng)));
    a += Math.max(2, Math.round(aExp * otFactor + sim.pointsSd * Math.sqrt(otFactor) * normal(rng)));
  }
  return {
    homeId: home.id,
    awayId: away.id,
    homePts: h,
    awayPts: a,
    winnerId: h > a ? home.id : away.id,
    overtimes,
    box: { home: boxScore(home.lineup, h, sim, rng), away: boxScore(away.lineup, a, sim, rng) }
  };
}
