// 공식 기록(data/stats/official)의 선수 시즌 하나하나를 시즌 카드로 만든다 → data/cards/domestic.json, foreign.json
//   node tools/build-cards.mjs
// 국내 선수(domestic)는 신인 드래프트 후보로, 외국인·아시아쿼터(foreign)는 외국인 선수 영입 후보로 쓴다. 진행 중인 시즌(2026-27)은 지금 뛰는 선수라 카드로 만들지 않는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCards } from '../src/cards.mjs';
import { loadInputs } from './build-careers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT = '2026-27';

export function franchiseLookup(seasons) {
  const m = new Map();
  for (const s of seasons) for (const t of s.teams) m.set(t.displayName.replace(/\s/g, ''), t.franchiseId);
  return (team) => m.get(team.replace(/\s/g, ''));
}

export function buildAll() {
  const { births, seasons, official } = loadInputs();
  const rules = JSON.parse(readFileSync(join(ROOT, 'data/league-rules.json'), 'utf8'));
  const all = buildCards({ official, births, franchiseOf: franchiseLookup(seasons), rules }, { skip: [CURRENT] });
  const fields = all.fields;
  const kindAt = fields.indexOf('kind');
  return {
    domestic: { fields, rows: all.rows.filter((r) => r[kindAt] === 'domestic' || r[kindAt] === 'd') },
    foreign: { fields, rows: all.rows.filter((r) => r[kindAt] !== 'domestic' && r[kindAt] !== 'd') }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildAll();
  mkdirSync(join(ROOT, 'data/cards'), { recursive: true });
  for (const [k, v] of Object.entries(out)) {
    writeFileSync(join(ROOT, `data/cards/${k}.json`), JSON.stringify({ _note: '생성물(npm run build:cards). 손으로 고치지 않는다. 행 = fields 순서', fields: v.fields, rows: v.rows }) + '\n');
    console.log(`data/cards/${k}.json: ${v.rows.length}장`);
  }
}
