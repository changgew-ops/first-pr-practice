// 여러 해를 이어서 진행하는 리그 시뮬레이션 (육성·시즌 중 갱신·시즌 종료 처리 포함)
//   node tools/run-league.mjs --years 20
//   옵션: --seed 1, --manager busan-kcc (그 구단 훈련을 자동 관리), --bot (그 구단 트레이드·재계약·FA도 자동 단장이 결정),
//         --no-inseason (시즌 중 능력치 갱신 끄기), --out 파일.json (시즌별 결과를 저장: 순위·플레이오프·득점 상위·은퇴·드래프트·이동)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { createManagerBot } from '../src/manager-bot.mjs';

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
const useBot = argIdx('bot') >= 0 && manager;
const outFile = str('out', null);
const log = [];

const rng = mulberry32(seed);
let league = createLeague(players, rules);
const titles = new Map(teamData.map((t) => [t.id, 0]));
const winPct = new Map(teamData.map((t) => [t.id, 0]));
const rows = [];
const avg = (list, fn) => list.reduce((s, p) => s + fn(p), 0) / list.length;

for (let y = 0; y < years; y++) {
  const season = league.season;
  const { league: next, report, result, totals, seasonPlayers } = playLeagueYear(league, teamData, rules, rng, { manager, inSeasonUpdates, policy: useBot ? createManagerBot(manager, rules) : null });
  titles.set(result.championId, titles.get(result.championId) + 1);
  for (const s of result.standings) winPct.set(s.id, winPct.get(s.id) + s.wins / rules.regularSeasonGames);
  const mgrRank = manager ? result.standings.findIndex((s) => s.id === manager) + 1 : null;
  const dom = next.players.filter((p) => p.origin === 'domestic');
  const payroll = teamData.map((t) => dom.filter((p) => p.teamId === t.id).reduce((s, p) => s + p.contract.salaryEok, 0));
  if (outFile) {
    const names = new Map(seasonPlayers.map((p) => [p.id, p]));
    const leaders = [...totals.entries()].filter(([id, t]) => names.has(id) && t.games >= 20)
      .map(([id, t]) => ({ name: names.get(id).name, team: names.get(id).teamId, games: t.games, ppg: +(t.points / t.games).toFixed(1), rpg: +(t.rebounds / t.games).toFixed(1), apg: +(t.assists / t.games).toFixed(1) }))
      .sort((a, b) => b.ppg - a.ppg).slice(0, 10);
    log.push({
      season,
      standings: result.standings.map((t, i) => ({ rank: i + 1, id: t.id, wins: t.wins, losses: t.losses, pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst })),
      playoffs: result.playoffs.series.map((x) => ({ round: x.round, higherId: x.higherId, lowerId: x.lowerId, winnerId: x.winnerId, wins: x.wins })),
      championId: result.championId,
      scoringLeaders: leaders,
      retired: report.retired.map((r) => ({ name: r.name, team: r.teamId, age: r.age, ovr: r.ovr })),
      drafted: report.drafted.map((d) => ({ name: d.name, team: d.teamId, pick: d.pick, ovr: d.ovr, potential: d.potential })),
      signings: report.signings.map((x) => ({ name: x.name, from: x.from ?? null, to: x.teamId })),
      trades: report.trades.filter((t) => t.executed !== false),
      avgOvr: +report.after.avgOvr.toFixed(2), avgAge: +report.after.avgAge.toFixed(2)
    });
  }
  rows.push({
    season, champion: nameOf.get(result.championId), mgrRank, avgOvr: report.after.avgOvr, avgAge: report.after.avgAge,
    retired: report.retired.length, drafted: report.drafted.length, expired: report.expired.filter((e) => !e.foreign).length,
    renewed: report.renewed.filter((r) => r.salaryEok != null).length, refused: report.refused.length,
    moves: report.signings.filter((x) => x.from && x.from !== x.teamId).length, fa: report.signings.length,
    comp: report.compensations.reduce((s, c) => s + c.cashEok, 0), trades: report.trades.filter((t) => t.executed !== false).length,
    offers: report.tradeOffers.length, payMin: Math.min(...payroll), payMax: Math.max(...payroll),
    over: payroll.filter((v) => v > rules.salaryCap.domesticEok).length
  });
  league = next;
}

console.log(`\n=== ${years}년 리그 (시드 ${seed}${manager ? `, 단장: ${nameOf.get(manager)}${useBot ? '(자동 단장)' : '(훈련만)'}` : ''}${inSeasonUpdates ? '' : ', 시즌 중 갱신 끔'}) ===`);
console.log('시즌   우승               평균OVR 나이  은퇴 만료 재계약 거절 FA영입(타팀) 보상금 트레이드  연봉합 최소~최대 캡초과' + (manager ? '  내 순위' : ''));
for (const r of rows) {
  console.log(`${r.season}  ${r.champion.padEnd(14, '　')} ${r.avgOvr.toFixed(1).padStart(6)} ${r.avgAge.toFixed(1).padStart(5)} ${String(r.retired).padStart(4)} ${String(r.expired).padStart(4)} ${String(r.renewed).padStart(6)} ${String(r.refused).padStart(4)} ${String(r.fa).padStart(4)}(${String(r.moves).padStart(2)}) ${r.comp.toFixed(1).padStart(6)} ${String(r.trades).padStart(5)}/${r.offers}   ${r.payMin.toFixed(0)}~${r.payMax.toFixed(0)} ${String(r.over).padStart(5)}${manager ? String(r.mgrRank).padStart(7) : ''}`);
}
console.log('\n구단별 우승 / 평균 승률');
for (const [id, n] of [...titles.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${nameOf.get(id).padEnd(14, '　')} 우승 ${String(n).padStart(2)}회  평균 승률 ${((winPct.get(id) / years) * 100).toFixed(0)}%`);
}
const all = league.players;
console.log(`\n최종: 평균 OVR ${avg(all, (p) => p.ovr).toFixed(1)}, 평균 나이 ${avg(all, (p) => p.age).toFixed(1)}, FA 풀 ${league.freeAgents.length}명`);

if (outFile) {
  const file = resolve(outFile);
  mkdirSync(dirname(file), { recursive: true });
  const ids = (list) => Object.fromEntries(list.map((t) => [t.id, t.name]));
  writeFileSync(file, JSON.stringify({ seed, years, startSeason: log[0].season, teams: ids(teamData), seasons: log }) + '\n');
  console.log(`\n→ ${file}`);
}
