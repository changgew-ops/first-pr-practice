// 선수 기록 분포 점검: 시뮬레이션(30시즌 등)과 공식 기록(최근 시즌)의 선수별 경기당 기록 분포를 같은 방식으로 재서 표로 비교한다.
//   node tools/dist-check.mjs                 → 공식 기록 최근 5시즌 + 시뮬레이션 (시드 1·2, 각 12시즌, 정적 로스터) 비교
//   옵션: --seasons 12 --seeds 1,2 --official 2021-22,2022-23,... --league (선수 성장·경기 중 능력치 갱신까지 포함한 30시즌 진행으로 측정)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildLineup } from '../src/lineup.mjs';
import { leagueBaseline } from '../src/game.mjs';
import { playSeason } from '../src/season.mjs';
import { mulberry32 } from '../src/rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const arg = (name, fb) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fb; };

// 시즌 하나의 "선수 줄"(경기수, 분, 득점, 리바, 어시, 스틸, 블록, 팀)에서 지표를 만든다
function metrics(rows, games) {
  const q = rows.filter((r) => r.gp >= games * 0.5 && r.min / r.gp >= 10); // 규정: 팀 경기의 절반 이상, 경기당 10분 이상
  const per = (key) => q.map((r) => ({ ...r, v: r[key] / r.gp })).sort((a, b) => b.v - a.v);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const pts = per('pts');
  const teamIds = [...new Set(rows.map((r) => r.team))];
  const teamShare = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], teamPpg = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], teamMin = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let nTeams = 0;
  for (const t of teamIds) {
    const players = rows.filter((r) => r.team === t && r.gp >= games * 0.25).map((r) => ({ ppg: r.pts / r.gp, mpg: r.min / r.gp })).sort((a, b) => b.ppg - a.ppg);
    const sumPts = rows.filter((r) => r.team === t).reduce((s, r) => s + r.pts, 0);
    if (players.length < 8) continue;
    nTeams++;
    const tpg = sumPts / Math.max(...rows.filter((r) => r.team === t).map((r) => r.gp));
    for (let i = 0; i < 10; i++) { teamPpg[i] += players[i]?.ppg ?? 0; teamShare[i] += (players[i]?.ppg ?? 0) / tpg; }
    const byMin = [...players].sort((a, b) => b.mpg - a.mpg);
    for (let i = 0; i < 10; i++) teamMin[i] += byMin[i]?.mpg ?? 0;
  }
  const topN = (key, n) => mean(per(key).slice(0, n).map((x) => x.v));
  return {
    n: q.length,
    pts1: topN('pts', 1), pts5: topN('pts', 5), pts10: topN('pts', 10), pts30: topN('pts', 30),
    reb1: topN('reb', 1), reb5: topN('reb', 5), ast1: topN('ast', 1), ast5: topN('ast', 5), stl1: topN('stl', 1), blk1: topN('blk', 1),
    mpg1: mean(q.map((r) => r.min / r.gp).sort((a, b) => b - a).slice(0, 1)), mpg10: mean(q.map((r) => r.min / r.gp).sort((a, b) => b - a).slice(0, 10)),
    teamPpg: teamPpg.map((v) => v / nTeams), teamShare: teamShare.map((v) => v / nTeams), teamMin: teamMin.map((v) => v / nTeams)
  };
}

function officialSeason(season) {
  const text = readFileSync(join(ROOT, 'data/stats/official', `${season}.csv`), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const head = text[0].split(',');
  const byPlayer = new Map();
  let games = 0;
  for (const line of text.slice(1)) {
    const c = line.split(','); const r = Object.fromEntries(head.map((h, i) => [h, c[i]]));
    if (r.gameType !== 'regular') continue;
    games = Math.max(games, Number(r.gp));
    const key = `${r.playerNo}`;
    const e = byPlayer.get(key) ?? { team: r.team, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, topGp: 0 };
    e.gp += Number(r.gp); e.min += Number(r.sec) / 60; e.pts += Number(r.pts); e.reb += Number(r.reb); e.ast += Number(r.ast); e.stl += Number(r.stl); e.blk += Number(r.blk);
    if (Number(r.gp) > e.topGp) { e.topGp = Number(r.gp); e.team = r.team; }
    byPlayer.set(key, e);
  }
  return metrics([...byPlayer.values()], games);
}

export function simSeasons({ rules, teamData, players, seeds, seasons, games = 54 }) {
  const teams = teamData.map((t) => ({ id: t.id, name: t.name, lineup: buildLineup(players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight) }));
  const baseline = leagueBaseline(teams.map((t) => t.lineup), rules.simulation);
  const out = [];
  let teamPts = 0, teamGames = 0, winSd = 0, winN = 0;
  for (const seed of seeds) for (let s = 0; s < seasons; s++) {
    const rng = mulberry32(seed * 100003 + s);
    const r = playSeason(teams, rules, baseline, rng, { keepGames: true });
    const totals = new Map(); // playerId → { team, gp, min, pts, ... }
    for (const g of r.games) for (const side of ['home', 'away']) {
      const team = side === 'home' ? g.homeId : g.awayId;
      for (const l of g.box[side]) {
        const e = totals.get(l.id) ?? { team, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
        e.gp += l.minutes > 0 ? 1 : 0; e.min += l.minutes; e.pts += l.points; e.reb += l.rebounds; e.ast += l.assists; e.stl += l.steals; e.blk += l.blocks;
        totals.set(l.id, e);
      }
      teamPts += side === 'home' ? g.homePts : g.awayPts; teamGames++;
    }
    const wp = r.standings.map((x) => x.wins / (x.wins + x.losses)); const m = wp.reduce((a, b) => a + b) / wp.length;
    winSd += Math.sqrt(wp.reduce((a, b) => a + (b - m) ** 2, 0) / wp.length); winN++;
    out.push(metrics([...totals.values()], games));
  }
  return { metrics: out, teamPpg: teamPts / teamGames, winSd: winSd / winN };
}

const avg = (list, f) => list.reduce((s, m) => s + f(m), 0) / list.length;
const avgArr = (list, key) => list[0][key].map((_, i) => avg(list, (m) => m[key][i]));
const f1 = (v) => v.toFixed(1);

export function table(label, list) {
  return { label, pts1: avg(list, (m) => m.pts1), pts5: avg(list, (m) => m.pts5), pts10: avg(list, (m) => m.pts10), pts30: avg(list, (m) => m.pts30), reb1: avg(list, (m) => m.reb1), ast1: avg(list, (m) => m.ast1), stl1: avg(list, (m) => m.stl1), blk1: avg(list, (m) => m.blk1), mpg1: avg(list, (m) => m.mpg1), mpg10: avg(list, (m) => m.mpg10), teamPpg: avgArr(list, 'teamPpg'), teamShare: avgArr(list, 'teamShare'), teamMin: avgArr(list, 'teamMin') };
}

export function print(rows) {
  console.log('구분'.padEnd(14), ['득점1위', '득점Top5', 'Top10', 'Top30', '리바1위', '어시1위', '스틸1위', '블록1위', '최다출전분', '출전Top10분'].join('\t'));
  for (const t of rows) console.log(t.label.padEnd(14), [t.pts1, t.pts5, t.pts10, t.pts30, t.reb1, t.ast1, t.stl1, t.blk1, t.mpg1, t.mpg10].map(f1).join('\t'));
  console.log('\n팀 내 득점 순위별 경기당 득점 / 팀 득점 비중(%) / 출전 시간 순위별 분');
  for (const t of rows) {
    console.log(t.label.padEnd(14), 'ppg', t.teamPpg.slice(0, 8).map(f1).join(' '), '| share', t.teamShare.slice(0, 5).map((v) => f1(v * 100)).join(' '), '| min', t.teamMin.slice(0, 10).map(f1).join(' '));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rules = read('league-rules.json'), teamData = read('teams.json'), players = read('players.json');
  for (const kv of (arg('set', '') || '').split(';').filter(Boolean)) { const [k, v] = kv.split('='); rules.simulation[k] = JSON.parse(v); } // 예: --set "usageExp=3;usageNoise=0.2"
  const official = (arg('official', '2021-22,2022-23,2023-24,2024-25,2025-26')).split(',');
  const offs = official.map(officialSeason);
  const seeds = arg('seeds', '1,2').split(',').map(Number), seasons = Number(arg('seasons', 12));
  const sim = simSeasons({ rules, teamData, players, seeds, seasons });
  print([table('공식 최근' + official.length, offs), table('시뮬 현재', sim.metrics)]);
  console.log(`\n시뮬 팀 평균 득점 ${sim.teamPpg.toFixed(2)}, 승률 표준편차 ${sim.winSd.toFixed(4)}`);
  offs.forEach((m, i) => console.log(official[i], '득점1위', f1(m.pts1), 'Top5', f1(m.pts5), '리바1위', f1(m.reb1), '어시1위', f1(m.ast1), '스틸1위', f1(m.stl1), '블록1위', f1(m.blk1), '최다분', f1(m.mpg1)));
}
