// 시즌 시뮬레이션 실행/검증 도구
//   node tools/run-season.mjs                 → 1시즌 결과 출력
//   node tools/run-season.mjs --seasons 300   → 여러 시즌 통계(밸런스 점검)
//   옵션: --seed 123, --scale 0.9 (ratingScale 임시 변경), --sd 9 (득점 편차 임시 변경)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildLineup } from '../src/lineup.mjs';
import { leagueBaseline } from '../src/game.mjs';
import { playSeason } from '../src/season.mjs';
import { mulberry32 } from '../src/rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const rules = read('league-rules.json');
const teamData = read('teams.json');
const players = read('players.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
const seasons = arg('seasons', 1);
const seed = arg('seed', 1);
rules.simulation.ratingScale = arg('scale', rules.simulation.ratingScale);
rules.simulation.pointsSd = arg('sd', rules.simulation.pointsSd);

const teams = teamData.map((t) => ({
  id: t.id,
  name: t.name,
  lineup: buildLineup(players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight)
}));
const baseline = leagueBaseline(teams.map((t) => t.lineup), rules.simulation);
const nameOf = new Map(teams.map((t) => [t.id, t.name]));
const strength = new Map(teams.map((t) => [t.id, [...t.lineup.starters, ...t.lineup.bench].reduce((s, p) => s + p.ovr, 0) / 10]));

if (seasons === 1) {
  const rng = mulberry32(seed);
  const r = playSeason(teams, rules, baseline, rng);
  console.log(`\n=== ${rules.season} 정규리그 (${rules.regularSeasonGames}경기) ===`);
  r.standings.forEach((s, i) => {
    const diff = s.pointsFor - s.pointsAgainst;
    console.log(`${String(i + 1).padStart(2)}위 ${nameOf.get(s.id).padEnd(12, '　')} ${s.wins}승 ${s.losses}패  득실차 ${diff >= 0 ? '+' : ''}${diff}  (라인업 평균 OVR ${strength.get(s.id).toFixed(1)})`);
  });
  console.log('\n=== 플레이오프 ===');
  for (const s of r.playoffs.series) {
    console.log(`${s.round.padEnd(8, '　')} ${nameOf.get(s.higherId)} ${s.wins[s.higherId]} : ${s.wins[s.lowerId]} ${nameOf.get(s.lowerId)}  → ${nameOf.get(s.winnerId)}`);
  }
  console.log(`\n우승: ${nameOf.get(r.championId)}`);
} else {
  const stat = new Map(teams.map((t) => [t.id, { wins: 0, titles: 0, playoff: 0, pts: 0, games: 0, rankSum: 0 }]));
  let topSeedTitles = 0;
  let totalPts = 0;
  let totalGames = 0;
  let ot = 0;
  let closeGames = 0;
  for (let s = 0; s < seasons; s++) {
    const rng = mulberry32(seed * 100003 + s);
    const r = playSeason(teams, rules, baseline, rng, { keepGames: true });
    r.standings.forEach((rec, i) => {
      const st = stat.get(rec.id);
      st.wins += rec.wins;
      st.rankSum += i + 1;
      if (i < rules.playoffs.qualify) st.playoff++;
    });
    stat.get(r.championId).titles++;
    if (r.championId === r.standings[0].id) topSeedTitles++;
    for (const g of r.games) {
      totalPts += g.homePts + g.awayPts;
      totalGames++;
      if (g.overtimes > 0) ot++;
      if (Math.abs(g.homePts - g.awayPts) <= 5) closeGames++;
    }
  }
  console.log(`\n=== ${seasons}시즌 시뮬레이션 (시드 ${seed}) ===`);
  console.log('팀'.padEnd(14, '　'), '라인업OVR', '평균승', '승률', '평균순위', 'PO진출', '우승');
  const rows = [...stat.entries()].sort((a, b) => b[1].wins - a[1].wins);
  for (const [id, st] of rows) {
    const w = st.wins / seasons;
    console.log(
      nameOf.get(id).padEnd(14, '　'),
      strength.get(id).toFixed(1).padStart(8),
      w.toFixed(1).padStart(6),
      `${((w / rules.regularSeasonGames) * 100).toFixed(0)}%`.padStart(5),
      (st.rankSum / seasons).toFixed(1).padStart(8),
      `${((st.playoff / seasons) * 100).toFixed(0)}%`.padStart(6),
      `${((st.titles / seasons) * 100).toFixed(0)}%`.padStart(5)
    );
  }
  console.log(`\n경기당 합산 득점 ${(totalPts / totalGames).toFixed(1)} / 연장 ${((ot / totalGames) * 100).toFixed(1)}% / 5점차 이내 ${((closeGames / totalGames) * 100).toFixed(0)}%`);
  console.log(`정규리그 1위가 우승한 비율 ${((topSeedTitles / seasons) * 100).toFixed(0)}%`);
}
