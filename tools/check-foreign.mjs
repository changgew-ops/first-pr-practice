// 역대 외국인 선수 파일(data/history/foreign/<시즌>.json) 검증.
//   node tools/check-foreign.mjs <시즌>        한 시즌 검증 (병렬 작업 때)
//   node tools/check-foreign.mjs               모든 시즌
//   node tools/check-foreign.mjs --teams <시즌>  그 시즌 구단 목록(franchiseId)을 보여 준다
// 오류: 형식, 구단이 그 시즌 구단과 다르거나 빠짐, 공식 기록(data/stats/official)에 외국인으로 있는 선수가 문서 표에 없음.
// 경고: 문서에는 있는데 공식 기록에 출전 기록이 없는 선수(경기 출전 없이 교체된 선수는 정상), 이벤트 파일의 외국인과 이름이 다름.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBirthsCsv } from '../src/real-players.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data/history/foreign');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const MARKS = ['mvp', 'draft1', 'renewed', 'contracted', 'nba', 'temp', 'fullReplaceInjury', 'traded', 'unknown'];
export const TYPES = ['장신', '단신', '제외'];
export const norm = (n) => n.replace(/[\s.·\-]/g, '');

export function loadContext() {
  const seasons = JSON.parse(read('data/history/seasons.json'));
  const births = parseBirthsCsv(read('data/players/births.csv'));
  const kind = new Map(births.map((b) => [b.playerNo, b.kind]));
  const fid = new Map();
  for (const s of seasons) for (const t of s.teams) fid.set(`${s.season}|${t.franchiseId}`, t.displayName);
  const events = JSON.parse(read('data/history/events.json'));
  return { seasons, kind, fid, events };
}

/** 공식 기록에서 그 시즌 외국인(외국·아시아쿼터 구분 제외) 정규시즌 출전 선수: Map(franchiseId → Map(정규화 이름 → 원래 이름)) */
export function officialForeign(season, ctx) {
  const file = `data/stats/official/${season}.csv`;
  if (!existsSync(join(ROOT, file))) return null;
  const franchise = new Map();
  for (const s of ctx.seasons) for (const t of s.teams) franchise.set(t.displayName.replace(/\s/g, ''), t.franchiseId);
  const out = new Map();
  for (const r of parseBirthsCsv(read(file))) {
    if (ctx.kind.get(r.playerNo) !== 'foreign') continue; // 아시아쿼터는 국내 선수 구분으로 들어 있다
    const id = franchise.get(r.team.replace(/\s/g, ''));
    if (!out.has(id)) out.set(id, new Map());
    out.get(id).set(norm(r.name), r.name);
  }
  return out;
}

export function validateSeason(doc, ctx, file = '') {
  const errors = [];
  const warnings = [];
  const e = (m) => errors.push(m);
  const w = (m) => warnings.push(m);
  const season = doc.season;
  const seasonRow = ctx.seasons.find((s) => s.season === season);
  const franchiseIds = seasonRow ? seasonRow.teams.map((t) => t.franchiseId) : season === '2026-27' ? [...new Set([...ctx.fid.keys()].map((k) => k.split('|')[1]))] : [];
  if (!franchiseIds.length) e(`알 수 없는 시즌 ${season}`);
  if (file && file !== `${season}.json`) e(`파일 이름 ${file} ≠ season ${season}`);
  if (!Array.isArray(doc.teams)) { e('teams 배열이 없음'); return { errors, warnings }; }

  const seen = new Set();
  const wiki = new Map(); // franchiseId → Map(정규화 이름 → player)
  for (const t of doc.teams) {
    if (!franchiseIds.includes(t.franchiseId)) e(`${t.team}: franchiseId ${t.franchiseId}는 ${season} 시즌 구단이 아님`);
    if (seen.has(t.franchiseId)) e(`${t.franchiseId} 구단이 두 번 나옴`);
    seen.add(t.franchiseId);
    if (!t.team) e(`${t.franchiseId}: team(문서 표기)이 없음`);
    if (!Array.isArray(t.players) || !t.players.length) { e(`${t.team}: 선수가 없음`); continue; }
    const m = new Map();
    for (const p of t.players) {
      const who = `${t.team} ${p.name}`;
      if (!p.name || typeof p.name !== 'string') { e(`${t.team}: 이름 없는 선수`); continue; }
      if (p.position != null && !/^[A-Z]{1,2}([\/,][A-Z]{1,2})*$/.test(p.position)) e(`${who}: 포지션 "${p.position}"`);
      if (p.heightCm != null && !(typeof p.heightCm === 'number' && p.heightCm >= 160 && p.heightCm <= 230)) e(`${who}: 키 ${p.heightCm}`);
      if (p.round != null && ![1, 2].includes(p.round)) e(`${who}: round ${p.round}`);
      if (p.type != null && !TYPES.includes(p.type)) e(`${who}: type ${p.type}`);
      if (p.nth != null && !(Number.isInteger(p.nth) && p.nth >= 1)) e(`${who}: nth ${p.nth}`);
      if (p.nationality != null && !(Array.isArray(p.nationality) && p.nationality.length && p.nationality.every((x) => typeof x === 'string' && x))) e(`${who}: nationality`);
      for (const k of p.marks ?? []) if (!MARKS.includes(k)) e(`${who}: 알 수 없는 표시 ${k}`);
      if (p.asiaQuota != null && typeof p.asiaQuota !== 'boolean') e(`${who}: asiaQuota`);
      if (p.inherited != null && !(Array.isArray(p.inherited) && p.inherited.every((k) => ['position', 'nationality', 'type'].includes(k)))) e(`${who}: inherited`);
      if (p.officialName != null && typeof p.officialName !== 'string') e(`${who}: officialName`);
      if (!p.asiaQuota) m.set(norm(p.officialName ?? p.name), p); // 공식 기록의 표기가 다르면 officialName에 적는다
    }
    wiki.set(t.franchiseId, m);
  }
  for (const id of franchiseIds) if (!seen.has(id)) e(`${id}(${ctx.fid.get(`${season}|${id}`)}) 구단이 빠짐`);

  // 공식 기록 대조
  const off = officialForeign(season, ctx);
  if (off) {
    for (const [id, players] of off) {
      const have = wiki.get(id) ?? new Map();
      for (const [key, name] of players) if (!have.has(key)) e(`${ctx.fid.get(`${season}|${id}`) ?? id}: 공식 기록에 외국인 "${name}"이(가) 있는데 문서 표에 없음 (표기가 다르면 officialName)`);
    }
    for (const [id, m] of wiki) {
      const officialNames = off.get(id) ?? new Map();
      for (const [key, p] of m) {
        if (officialNames.has(key)) continue;
        // 다른 구단 기록에는 있는데 이 구단에는 없다면(시즌 중 이적 표기 차이 등) 따로 알린다
        const elsewhere = [...off].find(([oid, pm]) => oid !== id && pm.has(key));
        w(`${ctx.fid.get(`${season}|${id}`) ?? id} ${p.name}: 공식 기록에 이 구단 출전 기록이 없음${elsewhere ? ` (공식 기록은 ${ctx.fid.get(`${season}|${elsewhere[0]}`)})` : ''}`);
      }
    }
  }
  // 이벤트 파일의 외국인(2021-22~)과 대조
  const ev = ctx.events.find((x) => x.season === season);
  if (ev) {
    for (const f of ev.foreign ?? []) {
      if (f.asiaQuota) continue;
      const has = [...(wiki.get(f.franchiseId)?.values() ?? [])].some((p) => norm(p.name) === norm(f.name) || norm(p.officialName ?? p.name) === norm(f.name));
      if (!has) w(`이벤트 파일의 외국인 ${f.franchiseId} ${f.name}이(가) 이 표에 없음`);
    }
  }
  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ctx = loadContext();
  const args = process.argv.slice(2);
  if (args[0] === '--teams') {
    const s = ctx.seasons.find((x) => x.season === args[1]);
    for (const t of s?.teams ?? []) console.log(`${t.franchiseId}\t${t.displayName}\t(최종 ${t.rank}위)`);
    process.exit(0);
  }
  const files = args.length ? args.map((s) => `${s}.json`) : readdirSync(DIR).filter((f) => /^\d{4}.*\.json$/.test(f));
  let bad = 0;
  for (const f of files.sort()) {
    if (!existsSync(join(DIR, f))) { console.error(`${f}: 파일 없음`); bad++; continue; }
    const doc = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    const { errors, warnings } = validateSeason(doc, ctx, f);
    const count = doc.teams?.reduce((s, t) => s + (t.players?.length ?? 0), 0);
    console.log(`${f}: 선수 ${count}명, 오류 ${errors.length}, 경고 ${warnings.length}`);
    for (const m of errors) console.log('  오류 ' + m);
    for (const m of warnings) console.log('  경고 ' + m);
    bad += errors.length;
  }
  process.exit(bad ? 1 : 0);
}
