// 선수의 KBL 공식 시즌 기록(data/players/careers.json의 줄)을 화면에서 쓰기 좋은 값으로 바꾼다. 순수 함수.
// 줄 형식은 tools/build-careers.mjs가 만든다.
export const FIELDS = ['season', 'type', 'teamId', 'gp', 'w', 'l', 'sec', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'pm3', 'pa3', 'ftm', 'fta', 'to', 'pf'];
export const TYPE_LABEL = { r: '정규시즌', p: '플레이오프', f: '챔피언결정전' };

const ratio = (a, b) => (b > 0 ? a / b : null);

/** 줄 배열 → 객체 + 경기당 평균·성공률 */
export function expandRow(row) {
  const o = Object.fromEntries(FIELDS.map((k, i) => [k, row[i]]));
  return withRates(o);
}

function withRates(o) {
  const g = o.gp;
  return {
    ...o,
    mpg: ratio(o.sec / 60, g), ppg: ratio(o.pts, g), rpg: ratio(o.reb, g), apg: ratio(o.ast, g), spg: ratio(o.stl, g), bpg: ratio(o.blk, g), topg: ratio(o.to, g),
    fgPct: ratio(o.fgm, o.fga), tpPct: ratio(o.pm3, o.pa3), ftPct: ratio(o.ftm, o.fta)
  };
}

/** kinds에 든 경기구분(r·p·f)의 줄만 시즌 순서대로 */
export function careerRows(entry, kinds = ['r']) {
  return (entry?.rows ?? []).filter((r) => kinds.includes(r[1])).map(expandRow);
}

/** 여러 줄의 합계(통산): 경기·승패·시간·득점 등은 더하고 평균·성공률은 다시 계산한다 */
export function careerTotals(rows) {
  const sum = Object.fromEntries(FIELDS.slice(3).map((k) => [k, rows.reduce((s, r) => s + r[k], 0)]));
  return withRates({ season: '통산', type: rows[0]?.type ?? 'r', teamId: null, ...sum });
}
