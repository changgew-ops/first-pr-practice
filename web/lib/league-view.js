// 리그 화면의 순수 계산(브라우저 API 없음): 선수·팀 기록 집계, 파생 지표, 정렬·필터, 부문별 상위.
// 기록 모양(totals): { gp, min(분), pts, reb, oreb, dreb, ast, stl, blk, fgm, fga, tpm, tpa, ftm, fta, to, pf }.
// 값이 없는 항목(게임 시뮬레이션은 턴오버·파울·공격/수비 리바운드를 만들지 않는다)은 null이고 화면에는 "-"로 나온다.

export const TOTAL_KEYS = ['gp', 'min', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'to', 'pf'];
const SUM_KEYS = TOTAL_KEYS.filter((k) => k !== 'gp');

const emptyTotals = () => Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));

/** 이름 앞의 시즌 카드 표기("26 허웅", "97초 정재근")를 뗀다. 반환: { base, label } */
export function splitCardName(name) {
  const m = /^(\d{2}초?) (.+)$/.exec(name ?? '');
  return m ? { base: m[2], label: m[1] } : { base: name ?? '', label: null };
}

// ---------- 열 정의 ----------
// kind: 'cnt'(경기당 평균/합계 토글), 'gp'(경기 수), 'min'(출전 시간), 'pct'(비율). calc: totals → 값
const ratio = (a, b) => (b > 0 && a != null && b != null ? a / b : null);
export const STAT_COLS = [
  { key: 'gp', label: '경기', title: '출전 경기 수', kind: 'gp', calc: (t) => t.gp },
  { key: 'min', label: '출전', title: '출전 시간(분)', kind: 'min', calc: (t) => t.min },
  { key: 'pts', label: '득점', title: '득점', kind: 'cnt', calc: (t) => t.pts, bar: true },
  { key: 'reb', label: '리바', title: '리바운드', kind: 'cnt', calc: (t) => t.reb, bar: true },
  { key: 'oreb', label: '공R', title: '공격 리바운드', kind: 'cnt', calc: (t) => t.oreb },
  { key: 'dreb', label: '수R', title: '수비 리바운드', kind: 'cnt', calc: (t) => t.dreb },
  { key: 'ast', label: '어시', title: '어시스트', kind: 'cnt', calc: (t) => t.ast, bar: true },
  { key: 'stl', label: '스틸', title: '스틸', kind: 'cnt', calc: (t) => t.stl, bar: true },
  { key: 'blk', label: '블록', title: '블록', kind: 'cnt', calc: (t) => t.blk, bar: true },
  { key: 'fg', label: 'FG%', title: '야투 성공률', kind: 'pct', calc: (t) => ratio(t.fgm, t.fga) },
  { key: 'tp', label: '3P%', title: '3점슛 성공률', kind: 'pct', calc: (t) => ratio(t.tpm, t.tpa) },
  { key: 'ft', label: 'FT%', title: '자유투 성공률', kind: 'pct', calc: (t) => ratio(t.ftm, t.fta) },
  { key: 'tpm', label: '3점', title: '3점슛 성공', kind: 'cnt', calc: (t) => t.tpm },
  { key: 'to', label: '턴오버', title: '턴오버', kind: 'cnt', calc: (t) => t.to },
  { key: 'pf', label: '파울', title: '개인 파울', kind: 'cnt', calc: (t) => t.pf }
];
export const COL = Object.fromEntries(STAT_COLS.map((c) => [c.key, c]));
/** 부문별 상위 카드 */
export const LEADER_COLS = ['pts', 'reb', 'ast', 'stl', 'blk'];
export const LEADER_TITLE = { pts: '득점', reb: '리바운드', ast: '어시스트', stl: '스틸', blk: '블록' };

/** 한 열의 값(숫자 또는 null). mode: 'avg'(경기당) | 'total'(합계) */
export function valueOf(rec, key, mode = 'avg') {
  const c = COL[key];
  const v = c.calc(rec);
  if (v == null) return null;
  if (c.kind === 'cnt') return mode === 'avg' ? (rec.gp > 0 ? v / rec.gp : null) : v;
  if (c.kind === 'min') return mode === 'avg' ? (rec.gp > 0 ? v / rec.gp : null) : v;
  return v;
}

export function formatValue(v, key, mode = 'avg') {
  if (v == null || Number.isNaN(v)) return '-';
  const c = COL[key];
  if (c.kind === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (c.kind === 'gp') return String(v);
  if (mode === 'avg') return v.toFixed(1);
  return c.kind === 'min' ? Math.round(v).toLocaleString('ko-KR') : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------- 집계: 게임에서 진행 중인 시즌 ----------
/**
 * 세션의 일별 결과(session.dayResults)에서 모든 선수·팀의 정규시즌 기록을 모은다.
 * 선수는 박스스코어 한 줄(id·name·minutes·points·…)을 더하고, 구단은 그 경기의 득점·실점과 선수 기록 합이다.
 * 반환: { players: [rec], teams: [rec] }
 */
export function aggregateGames(dayResults) {
  const pl = new Map();
  const tm = new Map();
  for (const d of dayResults) {
    for (const g of d.games) {
      for (const side of ['home', 'away']) {
        const teamId = side === 'home' ? g.homeId : g.awayId;
        const pts = side === 'home' ? g.homePts : g.awayPts;
        const opp = side === 'home' ? g.awayPts : g.homePts;
        let t = tm.get(teamId);
        if (!t) { t = { id: teamId, ...emptyTotals(), w: 0, l: 0, pa: 0, oreb: null, dreb: null, to: null, pf: null }; tm.set(teamId, t); }
        t.gp += 1; t.pa += opp;
        if (g.winnerId === teamId) t.w += 1; else t.l += 1;
        for (const line of g.box[side]) {
          if (!line.minutes) continue;
          let p = pl.get(line.id);
          if (!p) { p = { id: line.id, name: line.name, teamId, teams: new Map(), ...emptyTotals(), oreb: null, dreb: null, to: null, pf: null }; pl.set(line.id, p); }
          p.gp += 1; p.min += line.minutes; p.pts += line.points; p.reb += line.rebounds; p.ast += line.assists; p.stl += line.steals; p.blk += line.blocks;
          p.fgm += line.fgm; p.fga += line.fga; p.tpm += line.tpm; p.tpa += line.tpa; p.ftm += line.ftm; p.fta += line.fta;
          p.teams.set(teamId, (p.teams.get(teamId) ?? 0) + 1);
          p.name = line.name;
          t.min += line.minutes; t.pts += line.points; t.reb += line.rebounds; t.ast += line.assists; t.stl += line.steals; t.blk += line.blocks;
          t.fgm += line.fgm; t.fga += line.fga; t.tpm += line.tpm; t.tpa += line.tpa; t.ftm += line.ftm; t.fta += line.fta;
        }
      }
    }
  }
  const players = [...pl.values()].map((p) => finishPlayer(p, p.teams));
  return { players, teams: [...tm.values()] };
}

function finishPlayer(p, teamGames) {
  const teamIds = [...teamGames].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const { base, label } = splitCardName(p.name);
  return { ...p, teams: undefined, teamId: teamIds[0] ?? p.teamId, teamIds, name: base, card: label };
}

// ---------- 집계: 과거 시즌(공식 기록 JSON) ----------
/** data/history/stats/<시즌>.json 한 줄 → 객체(분 단위 출전 시간 포함) */
export function expandStatRow(fields, row) {
  const o = Object.fromEntries(fields.map((k, i) => [k, row[i]]));
  return { ...o, min: o.sec / 60 };
}

/**
 * 공식 기록 행(구단별 한 줄)을 선수별·구단별로 합친다. gts: 포함할 경기구분(['r'] 정규시즌, ['p', 'f'] 플레이오프).
 * standings: 그 시즌 순위표(정규시즌 구단 경기 수·승패는 이것이 정답). 없거나 플레이오프면 선수 기록의 승·패 최댓값으로 추정한다(teamsEstimated).
 * 반환: { players: [rec], teams: [rec], teamsEstimated }
 */
export function aggregateStats({ fields, rows }, gts = ['r'], standings = null) {
  const pl = new Map();
  const tm = new Map();
  const teamGames = new Map(); // 구단 → 선수 중 가장 많은 (승+패)
  for (const raw of rows) {
    const r = expandStatRow(fields, raw);
    if (!gts.includes(r.gt)) continue;
    const t = tm.get(r.teamId) ?? { id: r.teamId, ...emptyTotals(), w: 0, l: 0, pa: null };
    tm.set(r.teamId, t);
    const p = pl.get(r.playerNo) ?? { id: r.playerNo, name: r.name, teamId: r.teamId, ...emptyTotals(), stints: new Map() };
    pl.set(r.playerNo, p);
    p.stints.set(r.teamId, (p.stints.get(r.teamId) ?? 0) + r.sec);
    const part = { gp: r.gp, min: r.min, pts: r.pts, reb: r.reb, oreb: r.oreb, dreb: r.dreb, ast: r.ast, stl: r.stl, blk: r.blk, fgm: r.fgm, fga: r.fga, tpm: r.pm3, tpa: r.pa3, ftm: r.ftm, fta: r.fta, to: r.to, pf: r.pf };
    for (const k of SUM_KEYS) { p[k] += part[k]; t[k] += part[k]; }
    p.gp += r.gp;
    const g = r.w + r.l;
    if (g > (teamGames.get(r.teamId)?.g ?? 0)) teamGames.set(r.teamId, { g, w: r.w, l: r.l });
  }
  const useStandings = gts.length === 1 && gts[0] === 'r' && standings?.length;
  const st = new Map((standings ?? []).map((s) => [s.franchiseId, s]));
  for (const t of tm.values()) {
    const s = useStandings ? st.get(t.id) : null;
    if (s) { t.gp = s.wins + s.losses; t.w = s.wins; t.l = s.losses; if (s.pointsAgainst != null) t.pa = s.pointsAgainst; }
    else { const e = teamGames.get(t.id); t.gp = e?.g ?? 0; t.w = e?.w ?? 0; t.l = e?.l ?? 0; }
  }
  const players = [...pl.values()].map((p) => {
    const teamIds = [...p.stints].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return { ...p, stints: undefined, teamId: teamIds[0], teamIds };
  });
  return { players, teams: [...tm.values()], teamsEstimated: !useStandings };
}

// ---------- 정렬·필터·상위 ----------
/** 팀 순위용: 승률 → 승 → 득실 */
export const teamOrder = (a, b) => (b.w / Math.max(1, b.w + b.l)) - (a.w / Math.max(1, a.w + a.l)) || b.w - a.w || (b.pts - (b.pa ?? 0)) - (a.pts - (a.pa ?? 0));

/** 규정 출전 기준(게임용): 리그에서 가장 많이 뛴 구단 경기 수의 frac 이상 */
export const qualifyGames = (teams, frac = 0.5) => Math.ceil(Math.max(0, ...teams.map((t) => t.gp)) * frac);

export function filterPlayers(players, { q = '', team = 'all', minGames = 0 } = {}) {
  const needle = q.trim().toLowerCase();
  return players.filter((p) => p.gp >= minGames && (team === 'all' || p.teamIds?.includes(team) || p.teamId === team) && (!needle || p.name.toLowerCase().includes(needle)));
}

/** key: 열 키 또는 'name'·'team'. dir: -1 내림차순. 값이 없는 행은 항상 뒤 */
export function sortRecords(rows, key, dir = -1, { mode = 'avg', nameOf = (r) => r.name, teamNameOf = (r) => r.teamId } = {}) {
  const val = (r) => (key === 'name' ? nameOf(r) : key === 'team' ? teamNameOf(r) : key === 'w' || key === 'l' ? r[key] : key === 'pa' ? r.pa : key === 'diff' ? (r.pa == null ? null : r.pts - r.pa) : key === 'wpct' ? r.w / Math.max(1, r.w + r.l) : valueOf(r, key, mode));
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * dir || b.pts - a.pts;
  });
}

/** 부문별 상위 n명(규정 미달 제외). 반환: [{ rec, value }] */
export function leadersOf(players, key, n = 5, { mode = 'avg', minGames = 0 } = {}) {
  return sortRecords(players.filter((p) => p.gp >= minGames), key, -1, { mode }).slice(0, n).map((rec) => ({ rec, value: valueOf(rec, key, mode) })).filter((x) => x.value != null);
}

/** 열 전체에서 최댓값(막대 그래프의 100%) */
export function columnMax(rows, key, mode = 'avg') {
  let m = 0;
  for (const r of rows) { const v = valueOf(r, key, mode); if (v != null && v > m) m = v; }
  return m;
}

// ---------- 팀 기록 열 ----------
export const TEAM_COLS = [
  { key: 'gp', label: '경기', title: '경기 수' },
  { key: 'w', label: '승', title: '승' },
  { key: 'l', label: '패', title: '패' },
  { key: 'wpct', label: '승률', title: '승률' },
  { key: 'pts', label: '득점', title: '득점', stat: true, bar: true },
  { key: 'pa', label: '실점', title: '실점', special: true },
  { key: 'diff', label: '득실', title: '득점 - 실점', special: true },
  { key: 'fg', label: 'FG%', title: '야투 성공률', stat: true },
  { key: 'tp', label: '3P%', title: '3점슛 성공률', stat: true },
  { key: 'ft', label: 'FT%', title: '자유투 성공률', stat: true },
  { key: 'reb', label: '리바', title: '리바운드', stat: true, bar: true },
  { key: 'ast', label: '어시', title: '어시스트', stat: true, bar: true },
  { key: 'stl', label: '스틸', title: '스틸', stat: true },
  { key: 'blk', label: '블록', title: '블록', stat: true },
  { key: 'to', label: '턴오버', title: '턴오버', stat: true }
];

/** 팀 기록의 값(숫자 또는 null) */
export function teamValue(t, key, mode = 'avg') {
  if (key === 'gp') return t.gp;
  if (key === 'w' || key === 'l') return t[key];
  if (key === 'wpct') return t.w + t.l > 0 ? t.w / (t.w + t.l) : null;
  if (key === 'pa') return t.pa == null ? null : mode === 'avg' ? t.pa / Math.max(1, t.gp) : t.pa;
  if (key === 'diff') return t.pa == null ? null : mode === 'avg' ? (t.pts - t.pa) / Math.max(1, t.gp) : t.pts - t.pa;
  return valueOf(t, key, mode);
}
export function formatTeamValue(v, key, mode = 'avg') {
  if (v == null || Number.isNaN(v)) return '-';
  if (key === 'gp' || key === 'w' || key === 'l') return String(v);
  if (key === 'wpct') return v.toFixed(3);
  if (key === 'diff') return `${v > 0 ? '+' : ''}${mode === 'avg' ? v.toFixed(1) : Math.round(v)}`;
  if (key === 'pa') return mode === 'avg' ? v.toFixed(1) : String(Math.round(v));
  return formatValue(v, key, mode);
}

// ---------- 집계: 게임에서 이미 끝난 시즌(저장된 선수 줄) ----------
/**
 * 게임 로그의 시즌 결과(entry.lines: 선수별 한 줄, entry.standings: 순위표)에서 기록을 모은다.
 * 줄의 앞 7칸(경기·출전·득점·리바·어시·스틸·블록)은 모든 저장에 있고, 뒤 7칸(야투·3점·자유투 성공/시도, 시즌 끝 소속)은 새 저장에만 있다 — 없으면 null.
 * 구단 기록: 득점·실점·승패는 순위표(정확), 나머지는 선수 줄의 합(시즌 중 이적한 선수는 시즌 끝 소속에 합산되어 조금 어긋날 수 있다).
 */
export function aggregateLines(entry) {
  const leaderTeam = new Map((entry.leaders ?? []).map((l) => [l.id, l.teamId]));
  const players = Object.entries(entry.lines ?? {}).map(([id, l]) => {
    const full = l.length >= 14;
    const { base, label } = splitCardName(entry.playerNames?.[id] ?? id);
    const teamId = (full ? l[13] : null) ?? leaderTeam.get(id) ?? null;
    return {
      id, name: base, card: label, teamId, teamIds: teamId ? [teamId] : [],
      gp: l[0], min: l[1], pts: l[2], reb: l[3], oreb: null, dreb: null, ast: l[4], stl: l[5], blk: l[6],
      fgm: full ? l[7] : null, fga: full ? l[8] : null, tpm: full ? l[9] : null, tpa: full ? l[10] : null, ftm: full ? l[11] : null, fta: full ? l[12] : null, to: null, pf: null
    };
  });
  const teams = (entry.standings ?? []).map((s) => {
    const mine = players.filter((p) => p.teamId === s.id);
    const sum = (k) => (mine.length && mine.every((p) => p[k] != null) ? mine.reduce((a, p) => a + p[k], 0) : null);
    return {
      id: s.id, gp: s.wins + s.losses, w: s.wins, l: s.losses, pts: s.pointsFor ?? sum('pts'), pa: s.pointsAgainst ?? null,
      min: sum('min'), reb: sum('reb'), oreb: null, dreb: null, ast: sum('ast'), stl: sum('stl'), blk: sum('blk'),
      fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta'), to: null, pf: null
    };
  });
  return { players, teams, teamsEstimated: false };
}

/** 이 열에 값이 하나라도 있는가(오래된 시즌은 턴오버·파울이 모두 0으로 기록된 경우가 있어 0만 있으면 없는 것으로 본다) */
export function hasData(rows, key) {
  return rows.some((r) => { const v = valueOf(r, key, 'total'); return v != null && v !== 0; });
}
