// 실제 선수 풀 만들기 / 게임 데이터에 적용하기
//   node tools/build-real-players.mjs            선수 풀(data/players/real-pool.json)과 정정용 team-map.csv를 만든다
//   node tools/build-real-players.mjs --apply    소속이 정해진 선수를 data/rosters/<구단>.csv 와 data/stats/base.csv 로 내보낸다
// 입력: data/stats/2025-26.csv, data/stats/2026-27.csv(선택), data/players/registry.csv(현재 소속), name-aliases.csv, team-2025-26.csv, team-map.csv(사람이 정정한 값)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseStatsCsv } from '../src/stats-import.mjs';
import { mergeSeasons, buildPool, applyAliases, resolveRegistry, statlessPlayers, pickRoster, parseBirthsCsv, matchBirth } from '../src/real-players.mjs';
import { loadHistory } from '../src/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = (p) => join(ROOT, p);
const read = (p) => readFileSync(path(p), 'utf8');
const rules = JSON.parse(read('data/league-rules.json'));
const teams = JSON.parse(read('data/teams.json'));
const teamIds = new Set(teams.map((t) => t.id));
const baseName = (n) => n.replace(/\(\d+\)$/, '');

// '#' 주석과 빈 줄을 건너뛰는 단순 CSV (쉼표가 든 값은 쓰지 않는다)
function readCsv(p) {
  if (!existsSync(path(p))) return [];
  const lines = read(p).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines.shift().split(',').map((h) => h.trim());
  return lines.map((l) => { const c = l.split(',').map((x) => x.trim()); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ''])); });
}
const checkTeam = (id, where) => { if (id && !teamIds.has(id)) throw new Error(`${where}: 알 수 없는 구단 id "${id}"`); return id || null; };

const aliases = new Map(readCsv('data/players/name-aliases.csv').map((r) => [r.from, r.to]));
// 기록 시트 이름 → KBL 선수번호 (tools/build-player-ids.mjs가 공식 기록과 대조해 만든다). 번호가 있으면 시즌 사이·등록선수 화면과 정확히 이어진다
const seasonIds = new Map(readCsv('data/players/season-ids.csv').map((r) => [`${r.season}|${r.label}`, r.playerNo]));
const withIds = (rows, season) => rows.map((r) => ({ ...r, kblId: seasonIds.get(`${season}|${r.name}`) ?? null }));
const prev = applyAliases(withIds(parseStatsCsv(read('data/stats/2025-26.csv')), '2025-26'), aliases);
const cur = existsSync(path('data/stats/2026-27.csv')) ? applyAliases(withIds(parseStatsCsv(read('data/stats/2026-27.csv')), '2026-27'), aliases) : [];
const { players: merged, notes } = mergeSeasons(prev, cur);

// 25-26 시트는 플레이오프까지 합산된 값이라, 구단 합계도 정규리그 + 플레이오프로 맞춘다
const history = loadHistory();
const s2526 = history.seasons.find((s) => s.season === '2025-26');
const teamTotals = Object.fromEntries(s2526.teams.map((t) => [t.franchiseId, { wins: t.wins, losses: t.losses }]));
for (const round of s2526.playoffs.rounds) {
  for (const s of round.series) {
    teamTotals[s.a].wins += s.winsA; teamTotals[s.a].losses += s.winsB;
    teamTotals[s.b].wins += s.winsB; teamTotals[s.b].losses += s.winsA;
  }
}

// 사람이 정정한 값 (비어 있지 않은 칸만 쓴다)
const teamMap = new Map();
for (const row of readCsv('data/players/team-map.csv')) {
  if (!row.name) continue;
  const m = {
    team: checkTeam(row.team, `team-map.csv (${row.name})`), age: row.age ? Number(row.age) : null, position: row.position || null,
    number: row.number ? Number(row.number) : null, origin: row.origin || null
  };
  if (Object.values(m).some((v) => v !== null)) teamMap.set(row.name, m);
}

// 현재 소속(등록선수 화면)과 2025-26 소속
const entries = readCsv('data/players/registry.csv').map((r) => ({
  name: r.name, team: checkTeam(r.team, `registry.csv (${r.name})`), number: Number(r.number), position: r.position, kind: r.kind, draftYear: r.draftYear ? Number(r.draftYear) : null
}));
const team2526 = new Map(readCsv('data/players/team-2025-26.csv').map((r) => [aliases.get(r.name) ?? r.name, r.team]));

// 드래프트 참가 기록의 생년월일: 이름과 드래프트 연도가 등록선수 화면과 같은 선수에게만 쓴다
const births = new Map();
if (existsSync(path('data/history/drafts.json'))) {
  const drafts = JSON.parse(read('data/history/drafts.json'));
  for (const e of entries) {
    const hit = drafts.find((d) => d.draftYear === e.draftYear)?.picks.filter((p) => p.name === e.name && p.birth);
    if (hit?.length === 1) births.set(e.name, hit[0].birth);
  }
}

// 선수 프로필(생년월일 등): 드래프트 기록보다 우선한다
if (existsSync(path('data/players/profiles.json'))) {
  for (const pr of JSON.parse(read('data/players/profiles.json'))) if (pr.birth) births.set(pr.name, pr.birth);
}

// KBL 공식 프로필 생년월일(births.csv): 드래프트 기록·프로필보다 우선한다. 풀의 이름(동명이인 번호 포함)으로 넣는다
const birthsByName = new Map();
if (existsSync(path('data/players/births.csv'))) {
  for (const r of parseBirthsCsv(read('data/players/births.csv'))) birthsByName.set(r.name, [...(birthsByName.get(r.name) ?? []), r]);
}
const birthNotes = [];
let officialCount = 0;
const useOfficial = (poolName, e) => {
  const m = matchBirth(e, birthsByName);
  if (m.birth) { births.set(poolName, m.birth); officialCount++; } else if (m.why !== '후보 없음') birthNotes.push(`생년월일 ${poolName}(${e.team}): ${m.why}`);
};
// 등록선수 → KBL 선수번호 (같은 이름이 여럿이면 드래프트 연도·구단 계보로 가른다). 풀과 이을 때 먼저 쓴다
for (const e of entries) e.kblId = matchBirth(e, birthsByName).playerNo ?? null;
const pool0 = buildPool(merged, rules, { teamTotals, teamMap });
const { map: registry, extra, notes: regNotes } = resolveRegistry(entries, pool0, team2526);
for (const [poolName, e] of registry) useOfficial(poolName, e);
for (const e of extra) useOfficial(`${e.name}@${e.team}`, e); // 기록 없는 선수는 이름이 겹칠 수 있어 구단까지 붙인다
const all = [...buildPool(merged, rules, { teamTotals, teamMap, registry, births }), ...statlessPlayers(extra, teamMap, { births })]
  .sort((a, b) => b.minutes - a.minutes);
mkdirSync(path('data/players'), { recursive: true });

if (!process.argv.includes('--apply')) {
  writeFileSync(path('data/players/real-pool.json'), JSON.stringify(all, null, 2) + '\n');
  // 정정용 표: 채운 칸만 효과가 있다. 나머지 열은 참고용
  const header = 'name,team,age,position,number,origin,등록팀,25-26팀,minutes,games,포지션,국적';
  const lines = [header];
  for (const p of all) {
    const g = teamMap.get(p.name) ?? {};
    lines.push([p.name, g.team ?? '', g.age ?? '', g.position ?? '', g.number ?? '', g.origin ?? '', registry.get(p.name)?.team ?? (p.noStats ? p.teamId : ''), team2526.get(p.name) ?? '', p.minutes, p.games, p.position, p.origin].join(','));
  }
  writeFileSync(path('data/players/team-map.csv'), lines.join('\n') + '\n');

  const reg = all.filter((p) => p.registered);
  const moved = reg.filter((p) => team2526.get(p.name) && team2526.get(p.name) !== p.teamId);
  console.log(`기록 선수 ${all.length - extra.length}명 (25-26 ${all.filter((p) => p.seasons['2025-26']).length}명, 26-27 신규 ${all.filter((p) => p.stats && !p.seasons['2025-26']).length}명), 등록선수 ${entries.length}명`);
  console.log(`현재 소속이 정해진 선수 ${reg.length}명 (그중 기록 없는 선수 ${extra.length}명), 소속 없음 ${all.length - reg.length}명(등록선수 목록에 없음 → 게임에 넣지 않음)`);
  console.log(`2025-26 → 현재 소속이 바뀐 선수 ${moved.length}명`);
  const unplaced = all.filter((p) => !p.registered && p.minutes >= 600).map((p) => `${p.name}(${p.minutes}분)`);
  if (unplaced.length) console.log(`등록선수에 없지만 출전 600분 이상: ${unplaced.join(', ')}`);
  for (const n of [...notes, ...regNotes, ...birthNotes]) console.log('  ' + n);
  console.log(`공식 생년월일 ${officialCount}명 반영 (등록선수 ${entries.length}명 중)`);
  console.log('→ data/players/real-pool.json, data/players/team-map.csv');
} else {
  const assigned = all.filter((p) => p.teamId && teamIds.has(p.teamId));
  // 동명이인이 없으면 (1) 같은 꼬리표를 떼고 부른다
  const baseCount = new Map();
  for (const p of assigned) baseCount.set(baseName(p.name), (baseCount.get(baseName(p.name)) ?? 0) + 1);
  const display = (p) => (baseCount.get(baseName(p.name)) === 1 ? baseName(p.name) : p.name);
  mkdirSync(path('data/rosters'), { recursive: true });
  // 국적(현재 시즌 외국인 선수·아시아쿼터 계약 이벤트에서)
  const nationalityOf = new Map();
  if (existsSync(path('data/history/events.json'))) {
    const ev = JSON.parse(read('data/history/events.json')).find((e) => e.season === '2026-27');
    for (const fo of ev?.foreign ?? []) nationalityOf.set(aliases.get(fo.name) ?? fo.name, fo.nationality[0]);
  }
  const byTeam = new Map();
  for (const p of assigned) (byTeam.get(p.teamId) ?? byTeam.set(p.teamId, []).get(p.teamId)).push(p);
  const dropped = [];
  const adjusted = [];
  for (const [teamId, list] of byTeam) {
    const { roster, dropped: out, swaps, relabeled } = pickRoster(list, rules.roster);
    for (const p of out) dropped.push(`${display(p)}(${teamId})`);
    for (const t of swaps) adjusted.push(`${teamId} 포지션 보충 ${t}`);
    for (const r of relabeled) adjusted.push(`${teamId} ${r.name}: ${r.from} → ${r.to} (포지션이 비어서 바꿈)`);
    const rows = ['name,position,age,number,origin,nationality,kblId', ...roster.map((p) => [display(p), p.position, p.age ?? '', p.number ?? '', p.origin, nationalityOf.get(p.name) ?? '', p.kblId ?? ''].join(','))];
    writeFileSync(path(`data/rosters/${teamId}.csv`), rows.join('\n') + '\n');
  }
  // 합계 기록 CSV (generate가 이 이름으로 능력치를 만든다). 기록 없는 선수는 줄이 없어 가상 능력치가 된다
  const cols = ['games', 'minutes', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];
  const key = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks' };
  const withStats = new Set(assigned.filter((p) => p.stats).map((p) => p.name));
  const statLines = ['name,' + cols.join(',')];
  for (const m of merged.filter((m) => withStats.has(m.name))) {
    const p = assigned.find((a) => a.name === m.name);
    statLines.push([display(p), ...cols.map((c) => (c === 'minutes' ? m.totals.minutes.toFixed(2) : m.totals[key[c] ?? c]))].join(','));
  }
  writeFileSync(path('data/stats/base.csv'), statLines.join('\n') + '\n');
  console.log(`소속이 정해진 선수 ${assigned.length}명(기록 있음 ${withStats.size}명) → data/rosters/*.csv (${byTeam.size}개 구단), data/stats/base.csv`);
  for (const a of adjusted) console.log('  ' + a);
  if (dropped.length) console.log(`로스터 인원(국내 ${rules.roster.domestic}, 외국 ${rules.roster.foreign})을 넘어 제외: ${dropped.join(', ')}`);
  console.log('이어서 npm run generate 를 실행하면 실제 이름과 기록 기반 능력치로 data/players.json 이 만들어진다.');
}
