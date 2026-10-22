// 실제 시즌 기록(CSV) 읽기 → 능력치 산출.
// CSV 한 줄 = 선수 한 명의 "시즌 합계" 기록. 경기당 평균만 있으면 경기 수를 곱해 합계로 바꿔서 넣는다.
import { TOTAL_KEYS, emptyTotals } from './stats.mjs';
import { buildRatingModel, statRatings, shrinkRatings } from './stats-rating.mjs';
import { ARCHETYPE } from './factory.mjs';
import { STAT_KEYS, calcOvr } from './rating.mjs';

// CSV 컬럼 이름 → 합계 키
const COLUMN_ALIASES = {
  games: 'games', minutes: 'minutes', pts: 'points', points: 'points',
  reb: 'rebounds', rebounds: 'rebounds', ast: 'assists', assists: 'assists',
  stl: 'steals', steals: 'steals', blk: 'blocks', blocks: 'blocks',
  fgm: 'fgm', fga: 'fga', tpm: 'tpm', tpa: 'tpa', ftm: 'ftm', fta: 'fta'
};
const REQUIRED = ['games', 'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];

/** CSV 텍스트 → [{ name, totals }]. 필수 컬럼이 없으면 오류 */
export function parseStatsCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const colOf = {};
  header.forEach((h, i) => { if (COLUMN_ALIASES[h]) colOf[COLUMN_ALIASES[h]] = i; });
  const missing = REQUIRED.filter((k) => !(k in colOf));
  if (missing.length) throw new Error(`기록 CSV에 필요한 컬럼이 없습니다: ${missing.join(', ')}`);
  const nameCol = header.indexOf('name');
  if (nameCol < 0) throw new Error('기록 CSV에 name 컬럼이 없습니다');

  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const totals = emptyTotals();
    for (const k of TOTAL_KEYS) {
      const v = Number(cells[colOf[k]]);
      if (!Number.isFinite(v) || v < 0) throw new Error(`${i + 2}번째 줄 ${k} 값이 올바르지 않습니다: "${cells[colOf[k]]}"`);
      totals[k] = v;
    }
    return { name: cells[nameCol], totals };
  });
}

// 기록이 적은 선수의 기준점: 리그 평균에 포지션 특성(센터는 리바운드가 높은 편 등)을 더한 값
export function priorForPosition(position, model) {
  const offsets = ARCHETYPE[position] ?? ARCHETYPE.SF;
  return Object.fromEntries(STAT_KEYS.map((k) => [k, model.mean + offsets[k]]));
}

/**
 * 기록 행들로부터 선수별 능력치를 만든다.
 * rows: parseStatsCsv 결과, positions: Map<이름, 포지션>
 * 반환: Map<이름, { stats, ovr, minutes }>  (표본이 충분한 선수 기준으로 만든 리그 분포를 사용)
 */
export function ratingsFromRows(rows, positions, model) {
  const rm = buildRatingModel(rows.map((r) => r.totals), model);
  const out = new Map();
  for (const r of rows) {
    const raw = statRatings(r.totals, rm);
    if (!raw) continue;
    const position = positions.get(r.name) ?? 'SF';
    const stats = shrinkRatings(raw, r.totals.minutes, rm, priorForPosition(position, model));
    out.set(r.name, { stats, ovr: calcOvr(position, stats), minutes: r.totals.minutes });
  }
  return out;
}
