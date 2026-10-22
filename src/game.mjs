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

// 포지션별 3점 비중 (득점 중 3점슛 비율의 기준)
const THREE_SHARE = { PG: 0.32, SG: 0.4, SF: 0.3, PF: 0.18, C: 0.05 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 가중치에 비례해 이벤트 n개를 선수들에게 배분한다 (이벤트마다 한 명씩 뽑는 다항 추출)
function allocate(n, weights, rng) {
  const counts = new Array(weights.length).fill(0);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let r = rng() * total;
    let k = 0;
    while (k < weights.length - 1 && r >= weights[k]) { r -= weights[k]; k++; }
    counts[k]++;
  }
  return counts;
}

// 득점(pts)을 자유투·2점·3점으로 나누고 슈팅 능력에 맞는 성공률로 시도 수를 만든다.
// 항상 pts = ftm + 2×(fgm−tpm) + 3×tpm 이 성립한다.
function shotLine(p, pts, sim, rng) {
  const s = p.stats.shooting;
  const share3 = clamp(THREE_SHARE[p.position] * (0.6 + (s / 100) * 0.8), 0, 0.6);
  let m3 = Math.floor((pts * share3) / 3 + rng());
  let ftm = Math.round(pts * sim.freeThrowShare * (0.7 + rng() * 0.6));
  if (3 * m3 > pts) m3 = Math.floor(pts / 3);
  if (3 * m3 + ftm > pts) ftm = pts - 3 * m3;
  if ((pts - 3 * m3 - ftm) % 2 !== 0) ftm += 1;
  const m2 = (pts - 3 * m3 - ftm) / 2;

  const big = p.position === 'C' || p.position === 'PF';
  const p2 = clamp(0.43 + 0.0045 * (s - 50) + (big ? 0.04 : 0), 0.3, 0.7);
  const p3 = clamp(0.27 + 0.0035 * (s - 50), 0.15, 0.5);
  const pf = clamp(0.66 + 0.0045 * (s - 50), 0.45, 0.92);
  const jitter = () => 1 + 0.1 * normal(rng);
  const att = (made, prob) => (made === 0 ? 0 : Math.max(made, Math.round((made / prob) * jitter())));
  const fga2 = att(m2, p2);
  const tpa = att(m3, p3);
  return { fgm: m2 + m3, fga: fga2 + tpa, tpm: m3, tpa, ftm, fta: att(ftm, pf) };
}

function boxScore(lineup, pts, sim, rng) {
  const players = [...lineup.starters, ...lineup.bench];
  const minutes = lineupMinutes(lineup, sim);
  const scored = splitPoints(pts, players, minutes, rng);
  const w = (fn) => players.map((p) => Math.max(0.01, minutes.get(p.id) * fn(p)));
  const tot = (mean, sd) => Math.max(0, Math.round(mean + sd * normal(rng)));
  const rebs = allocate(tot(sim.teamRebounds, 4), w((p) => (p.stats.rebound / 50) ** 2.2), rng);
  const asts = allocate(tot(sim.teamAssists, 3), w((p) => (p.stats.passing / 50) ** 2.2), rng);
  const stls = allocate(tot(sim.teamSteals, 2), w((p) => (p.stats.defense / 50) ** 1.5 * (p.stats.athletic / 50)), rng);
  const blks = allocate(tot(sim.teamBlocks, 1.6), w((p) => (p.stats.rebound / 50) ** 1.5 * (p.stats.defense / 50) ** 1.5), rng);
  return players.map((p, i) => ({
    id: p.id,
    name: p.name,
    minutes: minutes.get(p.id),
    points: scored[i],
    rebounds: rebs[i],
    assists: asts[i],
    steals: stls[i],
    blocks: blks[i],
    ...shotLine(p, scored[i], sim, rng)
  }));
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
