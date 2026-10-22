// 여러 해를 이어서 진행하는 리그 시뮬레이션 (육성·시즌 중 갱신·시즌 종료 처리 포함)
//   node tools/run-league.mjs --years 20
//   옵션: --seed 1, --manager busan-kcc (그 구단 훈련을 자동 관리), --no-inseason (시즌 중 능력치 갱신 끄기)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');
const nameOf = new Map(teamData.map((t) => [t.id, t.name]));

const argIdx = (name) => process.argv.indexOf(`--${name}`);
const num = (name, d) => (argIdx(name) >= 0 ? Number(process.argv[argIdx(name) + 1]) : d);
const str = (name, d) => (argIdx(name) >= 0 ? process.argv[argIdx(name) + 1] : d);
const years = num('years', 10);
const seed = num('seed', 1);
const manager = str('manager', null);
const inSeasonUpdates = argIdx('no-inseason') < 0;

const rng = mulberry32(seed);
let league = createLeague(players, rules);
const titles = new Map(teamData.map((t) => [t.id, 0]));
const winPct = new Map(teamData.map((t) => [t.id, 0]));
const rows = [];
const avg = (list, fn) => list.reduce((s, p) => s + fn(p), 0) / list.length;

for (let y = 0; y < years; y++) {
  const season = league.season;
  const { league: next, report, result } = playLeagueYear(league, teamData, rules, rng, { manager, inSeasonUpdates });
  titles.set(result.championId, titles.get(result.championId) + 1);
  for (const s of result.standings) winPct.set(s.id, winPct.get(s.id) + s.wins / rules.regularSeasonGames);
  const mgrRank = manager ? result.standings.findIndex((s) => s.id === manager) + 1 : null;
  rows.push({ season, champion: nameOf.get(result.championId), mgrRank, avgOvr: report.after.avgOvr, avgAge: report.after.avgAge, retired: report.retired.length, drafted: report.drafted.length, expired: report.expired.length });
  league = next;
}

console.log(`\n=== ${years}년 리그 (시드 ${seed}${manager ? `, 훈련 관리: ${nameOf.get(manager)}` : ''}${inSeasonUpdates ? '' : ', 시즌 중 갱신 끔'}) ===`);
console.log('시즌   우승               평균OVR  평균나이  은퇴  드래프트  계약만료' + (manager ? '  내 순위' : ''));
for (const r of rows) {
  console.log(`${r.season}  ${r.champion.padEnd(14, '　')} ${r.avgOvr.toFixed(1).padStart(6)} ${r.avgAge.toFixed(1).padStart(8)} ${String(r.retired).padStart(5)} ${String(r.drafted).padStart(8)} ${String(r.expired).padStart(8)}${manager ? String(r.mgrRank).padStart(7) : ''}`);
}
console.log('\n구단별 우승 / 평균 승률');
for (const [id, n] of [...titles.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${nameOf.get(id).padEnd(14, '　')} 우승 ${String(n).padStart(2)}회  평균 승률 ${((winPct.get(id) / years) * 100).toFixed(0)}%`);
}
const all = league.players;
console.log(`\n최종: 평균 OVR ${avg(all, (p) => p.ovr).toFixed(1)}, 평균 나이 ${avg(all, (p) => p.age).toFixed(1)}, FA 풀 ${league.freeAgents.length}명`);
