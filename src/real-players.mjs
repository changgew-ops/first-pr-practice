// 실제 선수 기록(KBL 기록실 엑셀 → data/stats/*.csv)으로 선수 풀을 만든다.
//  - 이전 시즌과 올해(진행 중) 기록을 합쳐 능력치를 계산한다 (신인은 올해 기록만).
//  - 엑셀에 없는 정보는 추정하거나 비워 둔다: 포지션(기록으로 추정), 국적(이름에 공백이 있으면 외국), 팀(승패로 후보만 계산), 나이(모름)
import { TOTAL_KEYS } from './stats.mjs';
import { inferPosition } from './position.mjs';
import { ratingsFromRows } from './stats-import.mjs';
import { calcOvr, calcCost } from './rating.mjs';

const baseName = (n) => n.replace(/\(\d+\)$/, '');
const hasDup = (n) => /\(\d+\)$/.test(n);

/** 이름에 공백이 있으면 외국 선수(아시아쿼터 포함)로 본다. 귀화 선수 등 예외는 team-map.csv의 origin으로 바로잡는다 */
export const guessOrigin = (name) => (/\s/.test(baseName(name)) ? 'foreign' : 'domestic');

// 같은 이름 선수를 두 시즌 사이에서 이어 줄 때 쓰는 "플레이 스타일" 벡터
function profile(t) {
  const k = 36 / Math.max(1, t.minutes);
  return [t.minutes / Math.max(1, t.games) / 10, (t.rebounds * k) / 10, (t.assists * k) / 5, t.tpa / Math.max(1, t.fga), t.fta / Math.max(1, t.fga)];
}
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

const addTotals = (a, b) => Object.fromEntries(TOTAL_KEYS.map((k) => [k, (a?.[k] ?? 0) + (b?.[k] ?? 0)]));

/**
 * 이전 시즌(prev)과 올해(cur) 행을 이어 붙인다. 반환: { players: [{ name, totals, prev, cur }], notes }
 * 이름이 같은 선수가 여럿이면 플레이 스타일이 가장 가까운 쌍끼리 잇고, 너무 다르면 다른 선수로 본다.
 */
export function mergeSeasons(prev, cur, { maxDistance = 0.9 } = {}) {
  const notes = [];
  const byBase = new Map();
  const push = (list, side) => {
    for (const r of list) {
      const b = baseName(r.name);
      if (!byBase.has(b)) byBase.set(b, { prev: [], cur: [] });
      byBase.get(b)[side].push(r);
    }
  };
  push(prev, 'prev');
  push(cur, 'cur');

  const players = [];
  for (const [base, g] of byBase) {
    // 가능한 모든 (prev, cur) 쌍을 거리순으로 정렬해 탐욕적으로 잇는다
    const pairs = [];
    g.prev.forEach((p, i) => g.cur.forEach((c, j) => pairs.push({ i, j, d: dist(profile(p.totals), profile(c.totals)) })));
    pairs.sort((a, b) => a.d - b.d);
    const usedP = new Set();
    const usedC = new Set();
    const matched = [];
    for (const m of pairs) {
      if (usedP.has(m.i) || usedC.has(m.j)) continue;
      if (m.d > maxDistance && (g.prev.length > 1 || g.cur.length > 1)) continue; // 동명이인 사이에서만 거리를 따진다
      usedP.add(m.i); usedC.add(m.j);
      matched.push(m);
    }
    const ambiguous = g.prev.length > 1 || g.cur.length > 1;
    for (const m of matched) {
      const p = g.prev[m.i];
      const c = g.cur[m.j];
      players.push({ name: p.name, totals: addTotals(p.totals, c.totals), prev: p, cur: c });
      if (ambiguous) notes.push(`동명이인 ${base}: 25-26 "${p.name}"과 26-27 "${c.name}"을 이음 (스타일 거리 ${m.d.toFixed(2)})`);
    }
    g.prev.forEach((p, i) => { if (!usedP.has(i)) players.push({ name: p.name, totals: addTotals(p.totals), prev: p, cur: null }); });
    g.cur.forEach((c, j) => {
      if (usedC.has(j)) return;
      // 올해만 있는 선수(신인 등). 같은 이름이 이미 쓰였으면 구분 표시를 붙인다
      const clash = players.some((x) => x.name === c.name);
      players.push({ name: clash ? `${baseName(c.name)}(신)` : c.name, totals: addTotals(c.totals), prev: null, cur: c });
    });
  }
  return { players, notes };
}

/** 팀 후보: 선수가 뛴 경기의 팀 승·패가 구단 시즌 합계(플레이오프 포함)를 넘지 않는 구단 */
export function candidateTeams(extra, teamTotals) {
  if (extra?.teamWins == null || extra?.teamLosses == null) return Object.keys(teamTotals);
  return Object.entries(teamTotals).filter(([, t]) => t.wins >= extra.teamWins && t.losses >= extra.teamLosses).map(([id]) => id);
}

/** 선수 풀 만들기. teamMap: Map<이름, { team, age, position, number, origin }> (사람이 채운 값) */
export function buildPool(merged, rules, { teamTotals = null, teamMap = new Map(), minRatingMinutes = 300 } = {}) {
  const rows = merged.map((p) => ({ name: p.name, totals: p.totals }));
  const positions = new Map(merged.map((p) => [p.name, teamMap.get(p.name)?.position ?? inferPosition(p.totals)]));
  const rated = ratingsFromRows(rows.filter((r) => r.totals.minutes >= minRatingMinutes), positions, rules.ratingModel);
  const rm = ratingsFromRows(rows, positions, rules.ratingModel); // 표본이 적은 선수도 신뢰도로 당긴 값
  return merged.map((p) => {
    const given = teamMap.get(p.name) ?? {};
    const r = rm.get(p.name);
    const position = positions.get(p.name);
    const cands = teamTotals && p.prev ? candidateTeams(p.prev.extra, teamTotals) : null;
    return {
      name: p.name,
      position,
      positionGiven: Boolean(given.position),
      origin: given.origin ?? guessOrigin(p.name),
      age: given.age ?? null,
      number: given.number ?? null,
      teamId: given.team ?? null,
      candidateTeams: cands,
      games: p.totals.games,
      minutes: Math.round(p.totals.minutes),
      seasons: { '2025-26': Boolean(p.prev), '2026-27': Boolean(p.cur) },
      stats: r?.stats ?? null,
      ovr: r ? calcOvr(position, r.stats) : null,
      cost: r ? calcCost(calcOvr(position, r.stats)) : null,
      ratedFromSample: rated.has(p.name)
    };
  }).sort((a, b) => b.minutes - a.minutes);
}
