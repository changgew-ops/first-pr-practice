// 실제 선수 풀 만들기 / 게임 데이터에 적용하기
//   node tools/build-real-players.mjs            선수 풀(data/players/real-pool.json)과 팀 배정 템플릿(team-map.csv)을 만든다
//   node tools/build-real-players.mjs --apply    team-map.csv에 팀을 채운 선수만 data/rosters/<구단>.csv 와 data/stats/base.csv 로 내보낸다
// 입력: data/stats/2025-26.csv, (선택) data/stats/2026-27.csv, (선택) data/players/team-map.csv
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseStatsCsv } from '../src/stats-import.mjs';
import { mergeSeasons, buildPool } from '../src/real-players.mjs';
import { loadHistory } from '../src/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const rules = JSON.parse(read('data/league-rules.json'));
const teams = JSON.parse(read('data/teams.json'));
const teamIds = new Set(teams.map((t) => t.id));

const prev = parseStatsCsv(read('data/stats/2025-26.csv'));
const cur = existsSync(join(ROOT, 'data/stats/2026-27.csv')) ? parseStatsCsv(read('data/stats/2026-27.csv')) : [];
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

// 사람이 채운 팀 배정 (name,team,age,position,number,origin)
const mapPath = join(ROOT, 'data/players/team-map.csv');
const teamMap = new Map();
if (existsSync(mapPath)) {
  const lines = readFileSync(mapPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines.shift().split(',').map((h) => h.trim());
  for (const line of lines) {
    const c = line.split(',').map((x) => x.trim());
    const row = Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
    if (!row.name) continue;
    if (row.team && !teamIds.has(row.team)) throw new Error(`team-map.csv: 알 수 없는 구단 id "${row.team}" (${row.name})`);
    teamMap.set(row.name, {
      team: row.team || null, age: row.age ? Number(row.age) : null, position: row.position || null,
      number: row.number ? Number(row.number) : null, origin: row.origin || null
    });
  }
}

const pool = buildPool(merged, rules, { teamTotals, teamMap });
mkdirSync(join(ROOT, 'data/players'), { recursive: true });

if (!process.argv.includes('--apply')) {
  writeFileSync(join(ROOT, 'data/players/real-pool.json'), JSON.stringify(pool, null, 2) + '\n');
  // 팀 배정 템플릿: 출전 시간이 많은 선수부터, 이미 채운 값은 유지
  const header = 'name,team,age,position,number,origin,minutes,games,후보구단,포지션추정,국적추정';
  const lines = [header];
  for (const p of pool) {
    const given = teamMap.get(p.name) ?? {};
    const certain = p.candidateTeams?.length === 1 ? p.candidateTeams[0] : '';
    lines.push([
      p.name, given.team ?? certain, given.age ?? '', given.position ?? '', given.number ?? '', given.origin ?? '',
      p.minutes, p.games, (p.candidateTeams ?? []).length === teamIds.size ? '전체' : (p.candidateTeams ?? []).join('|'), p.position, p.origin
    ].join(','));
  }
  writeFileSync(mapPath, lines.join('\n') + '\n');
  const certain = pool.filter((p) => p.candidateTeams?.length === 1).length;
  console.log(`선수 ${pool.length}명 (25-26 ${pool.filter((p) => p.seasons['2025-26']).length}명, 26-27 신규 ${pool.filter((p) => !p.seasons['2025-26']).length}명)`);
  console.log(`팀이 승패만으로 하나로 정해진 선수 ${certain}명 → team-map.csv에 미리 채움. 나머지는 직접 채워야 함`);
  for (const n of notes) console.log('  ' + n);
  console.log('→ data/players/real-pool.json, data/players/team-map.csv');
} else {
  const assigned = pool.filter((p) => p.teamId && p.stats);
  mkdirSync(join(ROOT, 'data/rosters'), { recursive: true });
  const byTeam = new Map();
  for (const p of assigned) (byTeam.get(p.teamId) ?? byTeam.set(p.teamId, []).get(p.teamId)).push(p);
  const dropped = [];
  for (const [teamId, list] of byTeam) {
    const dom = list.filter((p) => p.origin === 'domestic').slice(0, rules.roster.domestic);
    const foreign = list.filter((p) => p.origin === 'foreign').slice(0, rules.roster.foreign);
    for (const p of list) if (!dom.includes(p) && !foreign.includes(p)) dropped.push(`${p.name}(${teamId})`);
    const rows = ['name,position,age,number,origin', ...[...dom, ...foreign].map((p) => [p.name, p.position, p.age ?? '', p.number ?? '', p.origin].join(','))];
    writeFileSync(join(ROOT, `data/rosters/${teamId}.csv`), rows.join('\n') + '\n');
  }
  // 합계 기록 CSV (generate가 이 이름으로 능력치를 만든다)
  const cols = ['games', 'minutes', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];
  const key = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks' };
  const statLines = ['name,' + cols.join(',')];
  for (const p of merged.filter((m) => assigned.some((a) => a.name === m.name))) {
    statLines.push([p.name, ...cols.map((c) => (c === 'minutes' ? p.totals.minutes.toFixed(2) : p.totals[key[c] ?? c]))].join(','));
  }
  writeFileSync(join(ROOT, 'data/stats/base.csv'), statLines.join('\n') + '\n');
  console.log(`팀이 채워진 선수 ${assigned.length}명 → data/rosters/*.csv (${byTeam.size}개 구단), data/stats/base.csv`);
  if (dropped.length) console.log(`로스터 인원(국내 ${rules.roster.domestic}, 외국 ${rules.roster.foreign})을 넘어 제외: ${dropped.join(', ')}`);
  console.log('이어서 npm run generate 를 실행하면 실제 이름과 기록 기반 능력치로 data/players.json 이 만들어진다.');
}
