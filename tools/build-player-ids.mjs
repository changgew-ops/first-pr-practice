// 기록 시트(data/stats/<시즌>.csv)의 선수 이름 → KBL 선수번호. 같은 이름이 여럿인 선수는 시트의 경기수·득점·출전시간이
// KBL 공식 기록(data/stats/official/<시즌>.csv)의 어느 선수번호 합계와 같은지로 가른다. 결과: data/players/season-ids.csv
//   node tools/build-player-ids.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBirthsCsv } from '../src/real-players.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASONS = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];
const baseName = (n) => n.replace(/\(\d+\)$/, '');

/** 시트 이름 → 선수번호 CSV 텍스트를 만든다. read(경로)는 저장소 기준 상대 경로의 파일 내용을 돌려준다. 짝을 못 찾은 줄은 problems에 담는다 */
export function buildSeasonIds(read) {
  const lines = ['# 기록 시트의 이름(동명이인은 (1)(2) 번호 포함) → KBL 선수번호. tools/build-player-ids.mjs가 공식 기록과 대조해 만든다(손으로 고치지 않는다)', 'season,label,playerNo'];
  const problems = [];
  for (const season of SEASONS) {
    const official = parseBirthsCsv(read(`data/stats/official/${season}.csv`));
    const sums = new Map(); // playerNo → { name, gp, sec, pts }
    for (const r of official) {
      const o = sums.get(r.playerNo) ?? { name: r.name, gp: 0, sec: 0, pts: 0 };
      o.gp += Number(r.gp); o.sec += Number(r.sec); o.pts += Number(r.pts);
      sums.set(r.playerNo, o);
    }
    const text = read(`data/stats/${season}.csv`).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    const head = text.shift().split(',');
    const col = (n) => head.indexOf(n);
    const claimed = new Set();
    for (const l of text) {
      const c = l.split(',');
      const label = c[0];
      const [gp, min, pts] = [Number(c[col('games')]), Number(c[col('minutes')]), Number(c[col('pts')])];
      const hits = [...sums].filter(([no, o]) => o.name === baseName(label) && o.gp === gp && o.pts === pts && Math.abs(o.sec / 60 - min) < 0.2);
      if (hits.length !== 1 || claimed.has(hits[0]?.[0])) { problems.push(`${season} ${label}: 공식 기록과 짝이 ${hits.length}개`); continue; }
      claimed.add(hits[0][0]);
      lines.push(`${season},${label},${hits[0][0]}`);
    }
  }
  return { text: lines.join('\n') + '\n', problems, count: lines.length - 2 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { text, problems, count } = buildSeasonIds((p) => readFileSync(join(ROOT, p), 'utf8'));
  if (problems.length) { console.error(problems.join('\n')); console.error(`${problems.length}건 해결 못 함`); process.exit(1); }
  writeFileSync(join(ROOT, 'data/players/season-ids.csv'), text);
  console.log(`data/players/season-ids.csv: ${count}행`);
}
