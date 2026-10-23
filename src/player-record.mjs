// 선수 시즌 기록의 구단별 줄·승패·플레이오프. 실제 기록(KBL 공식 시즌 기록)과 같은 열(팀, 경기, 승-패, 출전, 득점, 리바, 어시, 스틸, 블록, FG%, 3P%, FT%)을
// 게임에서 진행한 시즌에도 채우려고, 경기마다 선수별 줄을 (구단, 승/패)로 나눠 쌓는다. 순수 함수.
import { TOTAL_KEYS } from './stats.mjs';
import { expandRow } from './career.mjs';

const NUM = TOTAL_KEYS.slice(1); // games 제외: minutes points rebounds assists steals blocks fgm fga tpm tpa ftm fta
const blank = () => ({ w: 0, l: 0, ...Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])) });

/** splits: Map<선수 id, Map<구단 id, 합계+승패>> 에 한 경기(simulateGame 결과)를 더한다 */
export function addGameToSplits(splits, g) {
  for (const [side, teamId] of [['home', g.homeId], ['away', g.awayId]]) {
    const win = g.winnerId === teamId;
    for (const line of g.box[side]) {
      if (!line.minutes) continue;
      let byTeam = splits.get(line.id);
      if (!byTeam) { byTeam = new Map(); splits.set(line.id, byTeam); }
      let t = byTeam.get(teamId);
      if (!t) { t = blank(); byTeam.set(teamId, t); }
      t.games += 1; if (win) t.w += 1; else t.l += 1;
      for (const k of NUM) t[k] += line[k] ?? 0;
    }
  }
}

/** 플레이오프 시리즈들의 모든 경기를 구분('p' 일반, 'f' 챔피언결정전)별 splits로 모은다 */
export function playoffSplits(series, finalName = '챔피언결정전') {
  const out = { p: new Map(), f: new Map() };
  for (const s of series) for (const g of s.games) addGameToSplits(out[s.round === finalName ? 'f' : 'p'], g);
  return out;
}

// 저장용 줄: [구단, 경기, 승, 패, 출전분, 득점, 리바, 어시, 스틸, 블록, 야투성공, 야투시도, 3점성공, 3점시도, 자유투성공, 자유투시도]
const pack = (teamId, t) => [teamId, t.games, t.w, t.l, ...NUM.map((k) => t[k])];

/** 정규리그 splits → { wl: {선수: [승, 패]}, split: {선수: [줄…]} (시즌 중 구단을 옮긴 선수만) } */
export function compactRegular(splits) {
  const wl = {}, split = {};
  for (const [id, byTeam] of splits) {
    let w = 0, l = 0;
    for (const t of byTeam.values()) { w += t.w; l += t.l; }
    wl[id] = [w, l];
    if (byTeam.size > 1) split[id] = [...byTeam].map(([teamId, t]) => pack(teamId, t));
  }
  return { wl, split };
}

/** 플레이오프 → { 선수: [['p'|'f', 구단, …]] } */
export function compactPlayoffs(series, finalName) {
  const sp = playoffSplits(series, finalName);
  const po = {};
  for (const type of ['p', 'f']) {
    for (const [id, byTeam] of sp[type]) for (const [teamId, t] of byTeam) (po[id] ??= []).push([type, ...pack(teamId, t)]);
  }
  return po;
}

const FIELDS = ['season', 'type', 'teamId', 'gp', 'w', 'l', 'sec', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'pm3', 'pa3', 'ftm', 'fta', 'to', 'pf'];
// 저장용 줄 → 실제 기록 줄과 같은 필드 + 경기당 평균·성공률(src/career.mjs expandRow). 턴오버·파울은 시뮬레이션이 만들지 않아 null
const toRow = (season, type, p) => {
  // p: [구단, 경기, 승, 패, 분, 득점, 리바, 어시, 스틸, 블록, fgm, fga, tpm, tpa, ftm, fta]
  const [teamId, gp, w, l, min, pts, reb, ast, stl, blk, fgm, fga, pm3, pa3, ftm, fta] = p;
  return expandRow([season, type, teamId, gp, w, l, min * 60, pts, reb, ast, stl, blk, fgm, fga, pm3, pa3, ftm, fta, 0, 0]);
};

/**
 * 게임에서 진행한 한 시즌(entry: summarizeSeason 결과)에서 선수의 기록 줄(실제 기록 줄과 같은 필드). 정규 'r', 플레이오프 'p'·'f'.
 * 이전 저장(승패·구단 분리·플레이오프가 없는 줄)은 승패를 null로 둔다.
 */
export function entryRows(entry, id) {
  const rows = [];
  const split = entry.split?.[id];
  if (split) for (const p of split) rows.push(toRow(entry.season, 'r', p));
  else if (entry.lines?.[id]) {
    const [g, min, pts, reb, ast, stl, blk, fgm = 0, fga = 0, tpm = 0, tpa = 0, ftm = 0, fta = 0, teamId = null] = entry.lines[id];
    const wl = entry.wl?.[id];
    rows.push(toRow(entry.season, 'r', [teamId, g, wl?.[0] ?? null, wl?.[1] ?? null, min, pts, reb, ast, stl, blk, fgm, fga, tpm, tpa, ftm, fta]));
  }
  for (const p of entry.po?.[id] ?? []) rows.push(toRow(entry.season, p[0], p.slice(1)));
  return rows.map((r) => ({ ...r, game: true }));
}

/** 진행 중인 시즌의 줄(run.splits 정규리그, playoffs.series 플레이오프) */
export function liveRows(season, splits, series, id, finalName) {
  const rows = [];
  const byTeam = splits?.get(id);
  if (byTeam) for (const [teamId, t] of byTeam) rows.push(toRow(season, 'r', pack(teamId, t)));
  if (series?.length) {
    const sp = playoffSplits(series, finalName);
    for (const type of ['p', 'f']) { const bt = sp[type].get(id); if (bt) for (const [teamId, t] of bt) rows.push(toRow(season, type, pack(teamId, t))); }
  }
  return rows.map((r) => ({ ...r, game: true, live: true }));
}

/** 줄들의 합계: 경기·시간·득점 등을 더하고, 승패는 모든 줄에 있을 때만(하나라도 없으면 null) */
export function sumRows(rows) {
  const keys = FIELDS.slice(3);
  const total = { season: '통산', type: rows[0]?.type ?? 'r', teamId: null };
  for (const k of keys) total[k] = rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  if (rows.some((r) => r.w == null || r.l == null)) { total.w = null; total.l = null; }
  const ratio = (a, b) => (b > 0 ? a / b : null);
  const g = total.gp;
  return { ...total, mpg: ratio(total.sec / 60, g), ppg: ratio(total.pts, g), rpg: ratio(total.reb, g), apg: ratio(total.ast, g), spg: ratio(total.stl, g), bpg: ratio(total.blk, g),
    fgPct: ratio(total.fgm, total.fga), tpPct: ratio(total.pm3, total.pa3), ftPct: ratio(total.ftm, total.fta) };
}
