// 과거 시즌(1997~2025-26)의 선수·구단 기록을 선택한 시즌만 불러온다(data/history/stats/<시즌>.json, tools/build-season-stats.mjs가 만든 생성물).
// 데이터 기준 경로는 web/lib/data.js와 같은 규칙: 페이지가 KBL_DATA_BASE를 정해 주면 그것, 아니면 ../data/
const BASE = globalThis.KBL_DATA_BASE ?? '../data/';
const cache = new Map();

/** 시즌 기록 JSON을 불러온다. 반환: Promise<{ season, fields, rows }>. 같은 시즌은 한 번만 받는다 */
export function loadSeasonStats(season) {
  if (!cache.has(season)) {
    cache.set(season, fetch(`${BASE}history/stats/${encodeURIComponent(season)}.json`).then((res) => {
      if (!res.ok) throw new Error(`${season} 기록을 불러오지 못했습니다 (${res.status})`);
      return res.json();
    }).catch((e) => { cache.delete(season); throw e; }));
  }
  return cache.get(season);
}
