// 실제 선수 기록(KBL 기록실 엑셀 → data/stats/*.csv)으로 선수 풀을 만든다.
//  - 이전 시즌과 올해(진행 중) 기록을 합쳐 능력치를 계산한다 (신인은 올해 기록만).
//  - 엑셀에 없는 정보는 추정하거나 비워 둔다: 포지션(기록으로 추정), 국적(이름에 공백이 있으면 외국), 팀(승패로 후보만 계산), 나이(모름)
import { TOTAL_KEYS } from './stats.mjs';
import { inferPosition } from './position.mjs';
import { ratingsFromRows } from './stats-import.mjs';
import { calcOvr, calcCost } from './rating.mjs';

const baseName = (n) => n.replace(/\(\d+\)$/, '');
const hasDup = (n) => /\(\d+\)$/.test(n);

/** 등록선수 화면의 구분(d 국내, f 외국, a 아시아쿼터) → 게임의 origin */
export const originOf = (kind) => (kind === 'f' ? 'foreign' : kind === 'a' ? 'asia' : 'domestic');

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

/** 시트와 등록선수 화면의 표기가 다른 이름을 하나로 맞춘다. aliases: Map<시트 표기, 현재 표기> */
export const applyAliases = (rows, aliases) => rows.map((r) => (aliases.has(r.name) ? { ...r, name: aliases.get(r.name) } : r));

/** KBL 등록 포지션(G 가드 / F 포워드 / C 센터)을 5개 포지션으로 나눈다. 기록이 있으면 그 역할 추정으로 세분하고, 없으면 SG / SF로 둔다 */
export function positionFromRegistry(kbl, totals) {
  if (kbl === 'C') return 'C';
  const guess = totals ? inferPosition(totals) : null;
  if (kbl === 'G') return guess === 'PG' ? 'PG' : 'SG';
  return guess === 'PF' || guess === 'C' ? 'PF' : 'SF';
}

/** 생년월일(YYYY-MM-DD)로 기준일(YYYY-MM-DD)의 만 나이를 구한다 */
export function ageOn(birth, date) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** 드래프트 연도로 나이를 어림한다 (대졸 기준 드래프트 때 22세). 드래프트 연도가 없으면 null */
export const ageFromDraft = (draftYear, seasonYear = 2026) => (draftYear ? seasonYear - draftYear + 22 : null);

/**
 * 등록선수 화면의 항목을 선수 풀의 이름에 이어 준다. 같은 이름이 둘 이상이면(동명이인) 2025-26 소속(team2526)과
 * 팀 후보로 짝을 찾고, 그래도 안 되면 짝짓지 않고 notes에 남긴다. 반환: { map: Map<풀 이름, 항목>, extra: [풀에 없는 항목], notes }
 */
export function resolveRegistry(entries, pool, team2526 = new Map()) {
  const notes = [];
  const map = new Map();
  const extra = [];
  const variants = new Map();
  for (const p of pool) {
    const b = baseName(p.name);
    if (!variants.has(b)) variants.set(b, []);
    variants.get(b).push(p);
  }
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.name)) groups.set(e.name, []);
    groups.get(e.name).push(e);
  }
  for (const [name, list] of groups) {
    const vs = variants.get(name) ?? [];
    if (vs.length === 0) { extra.push(...list); continue; }
    if (vs.length === 1 && list.length === 1) { map.set(vs[0].name, list[0]); continue; }
    // 동명이인: 2025-26 소속이 같은 쪽 → 팀 후보에 들어 있는 쪽 순으로 짝짓는다
    const free = [...vs];
    const left = [];
    for (const e of list) {
      const hit = free.find((v) => team2526.get(v.name) === e.team)
        ?? free.find((v) => v.candidateTeams?.includes(e.team) && !free.some((o) => o !== v && o.candidateTeams?.includes(e.team)));
      if (hit) { map.set(hit.name, e); free.splice(free.indexOf(hit), 1); } else left.push(e);
    }
    for (const e of left) {
      if (free.length === 1 && vs.length === list.length) { map.set(free[0].name, e); free.length = 0; } else { extra.push(e); notes.push(`동명이인 ${name}(${e.team}): 풀의 어느 쪽인지 정하지 못해 기록 없는 선수로 둠`); }
    }
  }
  return { map, extra, notes };
}

/**
 * 선수 풀 만들기.
 *  teamMap: Map<이름, { team, age, position, number, origin }> — 사람이 team-map.csv에 적은 정정값(가장 우선)
 *  registry: Map<이름, { team, number, position(G/F/C), kind(d/f/a), draftYear }> — 등록선수 화면(현재 소속)
 */
export function buildPool(merged, rules, { teamTotals = null, teamMap = new Map(), registry = new Map(), births = new Map(), asOf = '2026-10-01', minRatingMinutes = 300 } = {}) {
  const rows = merged.map((p) => ({ name: p.name, totals: p.totals }));
  const positionOf = (p) => teamMap.get(p.name)?.position
    ?? (registry.has(p.name) ? positionFromRegistry(registry.get(p.name).position, p.totals) : inferPosition(p.totals));
  const positions = new Map(merged.map((p) => [p.name, positionOf(p)]));
  const rated = ratingsFromRows(rows.filter((r) => r.totals.minutes >= minRatingMinutes), positions, rules.ratingModel);
  const rm = ratingsFromRows(rows, positions, rules.ratingModel); // 표본이 적은 선수도 신뢰도로 당긴 값
  return merged.map((p) => {
    const given = teamMap.get(p.name) ?? {};
    const reg = registry.get(p.name);
    const r = rm.get(p.name);
    const position = positions.get(p.name);
    const cands = teamTotals && p.prev ? candidateTeams(p.prev.extra, teamTotals) : null;
    return {
      name: p.name,
      position,
      positionGiven: Boolean(given.position),
      origin: given.origin ?? (reg ? originOf(reg.kind) : guessOrigin(p.name)),
      asiaQuota: reg?.kind === 'a',
      age: given.age ?? (births.has(p.name) ? ageOn(births.get(p.name), asOf) : null) ?? ageFromDraft(reg?.draftYear) ?? null,
      number: given.number ?? reg?.number ?? null,
      teamId: given.team ?? reg?.team ?? null,
      registered: Boolean(reg),
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

/** 기록이 없는 등록 선수(올해 한 경기도 못 뛴 선수 등). 능력치는 생성기가 이름을 시드로 채운다 */
export function statlessPlayers(entries, teamMap = new Map(), { births = new Map(), asOf = '2026-10-01' } = {}) {
  return entries.map((e) => {
    const given = teamMap.get(e.name) ?? {};
    return {
      name: e.name,
      position: given.position ?? positionFromRegistry(e.position, null),
      positionGiven: Boolean(given.position),
      origin: given.origin ?? originOf(e.kind),
      asiaQuota: e.kind === 'a',
      age: given.age ?? (births.has(e.name) ? ageOn(births.get(e.name), asOf) : null) ?? ageFromDraft(e.draftYear),
      number: given.number ?? e.number,
      teamId: given.team ?? e.team,
      registered: true,
      candidateTeams: null,
      games: 0, minutes: 0,
      seasons: { '2025-26': false, '2026-27': false },
      stats: null, ovr: null, cost: null, ratedFromSample: false
    };
  });
}

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

/**
 * 한 구단의 후보 선수들(출전 시간 순)에서 로스터를 고른다: 국내 domestic명 + 외국 foreign명 + 아시아쿼터 최대 asia명, 다섯 포지션이 모두 있어야 한다.
 * 1) 출전 시간이 많은 순으로 뽑고, 2) 비는 포지션은 후보 중 그 포지션 선수를 대신 넣고(포지션이 겹치는 선수 중 출전 시간이 가장 적은 사람과 교체),
 * 3) 후보에도 없으면 포지션이 가까운 겹치는 선수의 포지션을 바꾼다. 반환: { roster, dropped, swaps: [문장], relabeled: [{ name, from, to }] }
 */
export function pickRoster(list, { domestic = 12, foreign = 2, asia = 1 } = {}) {
  const roster = [
    ...list.filter((p) => p.origin === 'domestic').slice(0, domestic),
    ...list.filter((p) => p.origin === 'foreign').slice(0, foreign),
    ...list.filter((p) => p.origin === 'asia').slice(0, asia)
  ].map((p) => ({ ...p }));
  const swaps = [];
  const relabeled = [];
  const count = (pos) => roster.filter((p) => p.position === pos).length;
  const weakest = (pool, origin) => pool.filter((p) => p.origin === origin && count(p.position) >= 2).sort((a, b) => a.minutes - b.minutes)[0];
  for (const pos of POSITIONS) {
    if (count(pos) > 0) continue;
    const sub = list.filter((p) => p.position === pos && !roster.some((r) => r.name === p.name)).sort((a, b) => b.minutes - a.minutes)[0];
    const out = sub && weakest(roster, sub.origin);
    if (sub && out) {
      roster.splice(roster.findIndex((r) => r.name === out.name), 1, { ...sub });
      swaps.push(`${pos}: ${out.name} 대신 ${sub.name}`);
    }
  }
  for (const pos of POSITIONS) {
    if (count(pos) > 0) continue;
    const idx = POSITIONS.indexOf(pos);
    const from = roster.filter((p) => count(p.position) >= 2)
      .sort((a, b) => Math.abs(POSITIONS.indexOf(a.position) - idx) - Math.abs(POSITIONS.indexOf(b.position) - idx) || b.minutes - a.minutes)[0];
    if (from) { relabeled.push({ name: from.name, from: from.position, to: pos }); from.position = pos; }
  }
  const dropped = list.filter((p) => !roster.some((r) => r.name === p.name));
  return { roster, dropped, swaps, relabeled };
}
