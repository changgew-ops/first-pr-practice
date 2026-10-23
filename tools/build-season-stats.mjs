// 공식 기록(data/stats/official/<시즌>.csv)을 리그 화면용 시즌별 JSON으로 묶는다 → data/history/stats/<시즌>.json (생성물)
//   node tools/build-season-stats.mjs
// 행 = 선수 한 명의 한 구단 기록(구단을 옮긴 선수는 구단마다 한 줄) × 경기구분(r 정규시즌·p 플레이오프·f 챔피언결정전).
// 진행 중인 시즌(2026-27)은 게임이 직접 집계하므로 만들지 않는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadInputs } from './build-careers.mjs';
import { franchiseLookup } from './build-cards.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT = '2026-27';
const GT = { regular: 'r', playoff: 'p', final: 'f' };
export const STAT_FIELDS = ['playerNo', 'name', 'teamId', 'gt', 'gp', 'w', 'l', 'sec', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'pm3', 'pa3', 'ftm', 'fta', 'to', 'pf'];
const NUM = STAT_FIELDS.slice(4);

/** 한 시즌의 공식 기록 행들 → { season, fields, rows } */
export function buildSeasonStats(season, list, franchiseOf) {
  const rows = list.map((r) => {
    const teamId = franchiseOf(r.team);
    if (!teamId) throw new Error(`${season} ${r.name}: 알 수 없는 소속 "${r.team}"`);
    if (!GT[r.gameType]) throw new Error(`${season} ${r.name}: 알 수 없는 경기구분 "${r.gameType}"`);
    return [r.playerNo, r.name, teamId, GT[r.gameType], ...NUM.map((k) => Number(r[k]))];
  });
  return { season, fields: STAT_FIELDS, rows };
}

export function buildAll() {
  const { seasons, official } = loadInputs();
  const franchiseOf = franchiseLookup(seasons);
  return official.filter(([s]) => s !== CURRENT).map(([season, list]) => buildSeasonStats(season, list, franchiseOf));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(ROOT, 'data/history/stats');
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const s of buildAll()) {
    const text = JSON.stringify({ _note: '생성물(npm run build:season-stats). 손으로 고치지 않는다. 행 = fields 순서, gt: r 정규시즌·p 플레이오프·f 챔피언결정전', ...s }) + '\n';
    writeFileSync(join(dir, `${s.season}.json`), text);
    bytes += Buffer.byteLength(text);
  }
  console.log(`data/history/stats: ${buildAll().length}개 시즌, 합계 ${(bytes / 1024).toFixed(0)}KB`);
}
