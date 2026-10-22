// 게임에 들어간 실제 선수(players.json의 kblId)의 KBL 공식 프로필과 시즌별 기록을 화면용 JSON으로 묶는다.
//   node tools/build-careers.mjs  →  data/players/careers.json
// 기록 줄: [시즌, 경기구분(r 정규시즌·p 플레이오프·f 챔피언결정전), 구단 id, GP, W, L, 출전초, PTS, REB, AST, STL, BLK, FGM, FGA, 3PM, 3PA, FTM, FTA, TO, PF]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBirthsCsv } from '../src/real-players.mjs';
import { FIELDS } from '../src/career.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export { FIELDS };
const TYPE = { regular: 'r', playoff: 'p', final: 'f' };

export function buildCareers({ players, births, seasons, official }) {
  const franchise = new Map();
  for (const s of seasons) for (const t of s.teams) franchise.set(t.displayName.replace(/\s/g, ''), t.franchiseId);
  const ids = new Set(players.map((p) => p.kblId).filter(Boolean));
  const out = {};
  for (const b of births) {
    if (!ids.has(b.playerNo)) continue;
    out[b.playerNo] = {
      profile: Object.fromEntries(Object.entries({
        nameEn: b.nameEn, birth: b.birth, position: b.position, heightCm: Number(b.heightCm) || null, weightKg: Number(b.weightKg) || null,
        number: b.number, school: b.school, profileSeason: b.profileSeason
      }).filter(([, v]) => v !== '' && v !== null)),
      rows: []
    };
  }
  for (const [season, rows] of official) {
    for (const r of rows) {
      if (!out[r.playerNo]) continue;
      const teamId = franchise.get(r.team.replace(/\s/g, ''));
      if (!teamId) throw new Error(`${season} ${r.name}: 알 수 없는 소속 "${r.team}"`);
      out[r.playerNo].rows.push([season, TYPE[r.gameType], teamId, ...[r.gp, r.w, r.l, r.sec, r.pts, r.reb, r.ast, r.stl, r.blk, r.fgm, r.fga, r.pm3, r.pa3, r.ftm, r.fta, r.to, r.pf].map(Number)]);
    }
  }
  return out;
}

export function loadInputs() {
  const files = readdirSync(join(ROOT, 'data/stats/official')).filter((f) => f.endsWith('.csv'));
  const official = files.map((f) => [f.replace('.csv', ''), parseBirthsCsv(read(`data/stats/official/${f}`))]).sort((a, b) => a[0].localeCompare(b[0]));
  return { players: JSON.parse(read('data/players.json')), births: parseBirthsCsv(read('data/players/births.csv')), seasons: JSON.parse(read('data/history/seasons.json')), official };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const careers = buildCareers(loadInputs());
  writeFileSync(join(ROOT, 'data/players/careers.json'), JSON.stringify(careers) + '\n');
  const rows = Object.values(careers).reduce((s, c) => s + c.rows.length, 0);
  console.log(`data/players/careers.json: ${Object.keys(careers).length}명, 기록 ${rows}줄`);
}
