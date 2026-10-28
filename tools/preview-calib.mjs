// 프리뷰 보정 점검: 시즌 시작 시점의 전력(기본 전력 vs 유효 전력)으로 프리뷰 확률을 만들고, 그 해 실제 결과(우승·플레이오프 진출)와 견준다.
// 사용: node tools/preview-calib.mjs [시드 수=8] [시즌 수=10]
import { readFileSync } from 'node:fs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { loadHistory } from '../src/history.mjs';
import { simulateOdds } from '../src/preview.mjs';
import { effectiveTable } from '../web/lib/game.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = JSON.parse(JSON.stringify(read('league-rules.json'))), teams = read('teams.json'), players = read('players.json');
for (const [k, v] of Object.entries(JSON.parse(process.env.PREVIEW_RULES ?? '{}'))) rules.preview[k] = v; // 후보 값 시험: PREVIEW_RULES='{"gameTemp":0.16}'
const seeds = Number(process.argv[2] ?? 8), years = Number(process.argv[3] ?? 10);
const data = { rules, teams, players };
const rows = { base: [], eff: [] };
for (let seed = 1; seed <= seeds; seed++) {
  const rng = mulberry32(seed * 7919); let league = createLeague(players, rules, { history: loadHistory(), teamData: teams });
  for (let y = 0; y < years; y++) {
    const table = effectiveTable({ league, managerId: null }, { ...data });
    const power = { base: {}, eff: {} };
    for (const [id, e] of table) { power.base[id] = e.baseOvr; power.eff[id] = e.effective; }
    const r = playLeagueYear(league, teams, rules, rng, {});
    const champ = r.result.championId, po = new Set(r.result.standings.slice(0, rules.playoffs.qualify).map((s) => s.id));
    for (const k of ['base', 'eff']) {
      const odds = simulateOdds(power[k], { games: rules.regularSeasonGames, playoffs: rules.playoffs, cfg: rules.preview, seedKey: `${seed}:${y}:${k}` });
      const ids = Object.keys(odds), fav = ids.sort((a, b) => odds[b].titleP - odds[a].titleP)[0];
      const top6 = Object.keys(odds).sort((a, b) => odds[b].playoffP - odds[a].playoffP).slice(0, rules.playoffs.qualify);
      rows[k].push({ favP: odds[fav].titleP, favWon: fav === champ ? 1 : 0, champP: odds[champ].titleP, poHit: top6.filter((id) => po.has(id)).length / rules.playoffs.qualify, ll: -Math.log(Math.max(0.005, odds[champ].titleP)) });
    }
    league = r.league;
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const k of ['base', 'eff']) {
  const r = rows[k];
  console.log(`${k === 'base' ? '기본 전력' : '유효 전력'} n=${r.length} · 1위 후보 우승 확률 평균 ${(mean(r.map((x) => x.favP)) * 100).toFixed(1)}% / 실제 우승 ${(mean(r.map((x) => x.favWon)) * 100).toFixed(1)}% · 6강 예측 적중 ${(mean(r.map((x) => x.poHit)) * 100).toFixed(1)}% · 우승팀에 준 확률 평균 ${(mean(r.map((x) => x.champP)) * 100).toFixed(1)}% · 로그 손실 ${mean(r.map((x) => x.ll)).toFixed(3)}`);
}
