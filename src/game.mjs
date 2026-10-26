import { normal, mulberry32, hashString } from './rng.mjs';

// 한 선수의 공격·수비 기여도 (능력치 → 점수)
const offense = (p) => 0.5 * p.stats.shooting + 0.25 * p.stats.passing + 0.25 * p.stats.athletic;
const defense = (p) => 0.5 * p.stats.defense + 0.3 * p.stats.rebound + 0.2 * p.stats.athletic;

// 출전 시간: 스타팅·벤치 각각 OVR이 높은 순서로 minutesStarters/minutesBench를 나눠 준다.
// 화면의 포지션 자리(PG·SG·SF·PF·C)나 목록 순서는 출전 시간에 영향이 없다.
const byOvr = (players) => players.map((p, i) => [p, i]).sort((a, b) => b[0].ovr - a[0].ovr || a[1] - b[1]).map(([p]) => p);
export function lineupMinutes(lineup, sim) {
  const minutes = new Map();
  byOvr(lineup.starters).forEach((p, i) => minutes.set(p.id, sim.minutesStarters[i] ?? 0));
  byOvr(lineup.bench).forEach((p, i) => minutes.set(p.id, sim.minutesBench[i] ?? 0));
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
function splitPoints(total, players, minutes, rng, sim = {}) {
  // usageExp: 공격 능력이 높을수록 슛을 더 많이 가져가는 정도(1이면 능력에 비례). usageNoise: 경기마다 흔들리는 폭
  // usageCap: 공격력이 이 값을 넘으면 넘은 만큼은 usageOver배만 쓴다(성장이 쌓인 장기 시즌에 에이스 득점이 끝없이 몰리지 않게)
  const exp = sim.usageExp ?? 1, noise = sim.usageNoise ?? 0.3, cap = sim.usageCap ?? Infinity, over = sim.usageOver ?? 0.3;
  const usage = (p) => { const o = offense(p); return exp === 1 ? o : ((o <= cap ? o : cap + over * (o - cap)) / 60) ** exp; };
  const weights = players.map((p) => Math.max(0.01, minutes.get(p.id) * usage(p) * (1 - noise + rng() * 2 * noise)));
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
function shotLine(p, pts, sim, rng, threeMul = 1) {
  const s = p.stats.shooting;
  const share3 = clamp(THREE_SHARE[p.position] * (0.6 + (s / 100) * 0.8) * threeMul, 0, 0.6); // threeMul: 전술의 3점 비중 배수(src/tactics.mjs)
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

// mods: 전술·감독 보정 { three, reb, toMul }(없으면 1) — 기록 열만 바꾸고 득점·출전 시간은 바꾸지 않는다
function boxScore(lineup, pts, sim, rng, mods = null) {
  const players = [...lineup.starters, ...lineup.bench];
  const minutes = lineupMinutes(lineup, sim);
  const scored = splitPoints(pts, players, minutes, rng, sim);
  const w = (fn) => players.map((p) => Math.max(0.01, minutes.get(p.id) * fn(p)));
  const tot = (mean, sd) => Math.max(0, Math.round(mean + sd * normal(rng)));
  const rebs = allocate(tot(sim.teamRebounds * (mods?.reb ?? 1), 4), w((p) => (p.stats.rebound / 50) ** (sim.reboundExp ?? 2.2)), rng);
  const asts = allocate(tot(sim.teamAssists, 3), w((p) => (p.stats.passing / 50) ** (sim.assistExp ?? 2.2)), rng);
  const stls = allocate(tot(sim.teamSteals, 2), w((p) => (p.stats.defense / 50) ** 1.5 * (p.stats.athletic / 50)), rng);
  const blks = allocate(tot(sim.teamBlocks, 1.6), w((p) => (p.stats.rebound / 50) ** 1.5 * (p.stats.defense / 50) ** 1.5), rng);
  const lines = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    minutes: minutes.get(p.id),
    points: scored[i],
    rebounds: rebs[i],
    assists: asts[i],
    steals: stls[i],
    blocks: blks[i],
    ...shotLine(p, scored[i], sim, rng, mods?.three ?? 1)
  }));
  return withTurnoversFouls(lines, players, sim, mods?.toMul ?? 1);
}

// 턴오버·파울: 기록만 하는 열이다(득점·출전 시간에 영향 없음). 경기 난수(rng)는 쓰지 않고, 이미 정해진 기록에서 뽑은 시드로 따로 굴려
// 같은 시드의 경기 결과(점수와 박스스코어의 다른 열)가 이 열을 넣기 전과 똑같다.
// 턴오버는 공을 많이 만지는 선수(득점·어시스트)에게, 패스 능력이 낮은 선수일수록 더 몰린다. 파울은 수비·리바운드 비중이 큰 선수가 많이 한다.
function withTurnoversFouls(lines, players, sim, toMul = 1) {
  if (sim.teamTurnovers == null || sim.teamFouls == null) return lines;
  const rng = mulberry32(hashString(lines.map((l) => `${l.id}:${l.points}:${l.rebounds}:${l.assists}:${l.steals}:${l.blocks}:${l.fga}:${l.fta}`).join('|')));
  // 선수마다 타고난 버릇(같은 선수는 늘 같은 값): 능력치가 같아도 턴오버·파울이 잦은 선수와 적은 선수가 있다
  const habit = (kind, id, sd) => Math.exp(sd * normal(mulberry32(hashString(`${kind}:${id}`))));
  const tot = (mean) => Math.max(0, Math.round(mean + 0.9 * Math.sqrt(mean) * normal(rng)));
  const w = (fn) => lines.map((l, i) => Math.max(0.01, l.minutes * fn(players[i], l)));
  const tos = allocate(tot(sim.teamTurnovers * toMul), w((p, l) => ((l.points + 1.3 * l.assists + 1) / Math.max(1, l.minutes) / 0.5) ** 1.6 * (60 / (p.stats.passing + 10)) ** 0.8 * habit('to', l.id, 0.35)), rng);
  const pfs = allocate(tot(sim.teamFouls), w((p, l) => (p.stats.defense / 50) ** 1.3 * (p.stats.rebound / 50) ** 0.9 * habit('pf', l.id, 0.2)), rng);
  return lines.map((l, i) => ({ ...l, turnovers: tos[i], fouls: pfs[i] }));
}

/**
 * 극단 득점 경기 판정(순수 함수): ex.key로 만든 별도 난수에서 뽑는다. 걸리면 { kind: 'shootout'|'defensive', shift(두 팀 합계에 더할 점수, 음수면 수비전) }.
 * sim.extreme = { enabled, prob, playoffMul, shift: [최소, 최대] }. 없거나 꺼져 있으면 null.
 */
export function extremeKind(ex, sim) {
  const cfg = sim.extreme;
  if (!cfg?.enabled) return null;
  const r = mulberry32(hashString(String(ex.key)));
  r(); // 비슷한 키의 첫 값이 닮지 않게 한 번 버린다
  const roll = r(), side = r(), amt = r();
  const p = cfg.prob * (ex.playoff ? cfg.playoffMul : 1);
  if (roll >= p) return null;
  const [lo, hi] = cfg.shift;
  const size = Math.round(lo + (hi - lo) * amt);
  return side < 0.5 ? { kind: 'shootout', shift: size } : { kind: 'defensive', shift: -size };
}

/**
 * 한 경기 시뮬레이션 (순수 함수: 같은 입력과 같은 rng 상태면 같은 결과).
 * home / away: { id, lineup: { starters, bench }, mods? }
 * ex(선택): { key, playoff } — 극단 득점 경기 판정(key에서 만든 별도 난수). 걸리지 않은 경기는 ex가 없을 때와 똑같다.
 *   걸리면 평소처럼 한 번 치러 경기 난수(rng)를 똑같이 쓴 뒤(뒤따르는 경기가 달라지지 않게), 별도 난수로 두 팀 기대 득점 합계를
 *   sim.extreme.shift만큼 올리거나('shootout') 내려('defensive') 다시 치른 결과를 돌려준다. 결과에 ex 필드가 붙는다.
 * mods(전술·감독·컨디션, src/tactics.mjs·coaching.mjs·condition.mjs): { edge(그 팀 기대 득점에 더하는 점수), pace(두 팀 평균이 기대 득점에 곱해짐),
 *   three·reb·to·oppTo(박스스코어 기록 열 배수) }. 없거나 모두 중립이면 결과가 mods를 넣기 전과 똑같다(난수를 더 쓰지 않는다).
 */
export function simulateGame(home, away, baseline, sim, rng, ex = null) {
  const exKind = ex ? extremeKind(ex, sim) : null;
  const base = playOnce(home, away, baseline, sim, rng, 0); // 극단 경기라도 경기 난수는 평소 경기와 똑같이 쓴다(뒤따르는 경기의 결과가 달라지지 않게)
  if (!exKind) return base;
  // 걸린 경기만 key에서 만든 별도 난수로 다시 치른다(두 팀 기대 득점 합계를 이동)
  return { ...playOnce(home, away, baseline, sim, mulberry32(hashString(`${ex.key}:game`)), exKind.shift), ex: exKind.kind };
}

function playOnce(home, away, baseline, sim, rng, shift) {
  const hr = teamRatings(home.lineup, sim);
  const ar = teamRatings(away.lineup, sim);
  const hm = home.mods ?? null, am = away.mods ?? null;
  const pace = hm || am ? ((hm?.pace ?? 1) + (am?.pace ?? 1)) / 2 : 1;
  let hExp = expectedPoints(hr, ar, baseline, sim, true) * pace + (hm?.edge ?? 0);
  let aExp = expectedPoints(ar, hr, baseline, sim, false) * pace + (am?.edge ?? 0);
  if (shift) { hExp += shift / 2; aExp += shift / 2; }

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
    box: {
      home: boxScore(home.lineup, h, sim, rng, hm || am ? { three: hm?.three, reb: hm?.reb, toMul: (hm?.to ?? 1) * (am?.oppTo ?? 1) } : null),
      away: boxScore(away.lineup, a, sim, rng, hm || am ? { three: am?.three, reb: am?.reb, toMul: (am?.to ?? 1) * (hm?.oppTo ?? 1) } : null)
    }
  };
}
