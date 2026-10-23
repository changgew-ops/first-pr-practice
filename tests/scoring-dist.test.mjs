import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simSeasons } from '../tools/dist-check.mjs';
import { simulateGame, leagueBaseline } from '../src/game.mjs';
import { buildLineup } from '../src/lineup.mjs';
import { mulberry32 } from '../src/rng.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teamData = read('teams.json'), players = read('players.json');
const mean = (a) => a.reduce((x, y) => x + y) / a.length;

test('선수 기록 분포: 득점왕 20점대, 팀 득점 76점대, 승률 표준편차는 그대로(공식 기록 2021-22~2025-26 범위)', () => {
  const r = simSeasons({ rules, teamData, players, seeds: [1, 2], seasons: 6 });
  const m = (k) => mean(r.metrics.map((x) => x[k]));
  assert.ok(m('pts1') > 20 && m('pts1') < 27, `득점 1위 ${m('pts1').toFixed(1)}`); // 공식 22.1~25.4
  assert.ok(m('pts5') > 17.5 && m('pts5') < 23, `득점 Top5 ${m('pts5').toFixed(1)}`); // 공식 평균 20.7
  assert.ok(m('pts30') > 12.5 && m('pts30') < 16.5, `득점 Top30 ${m('pts30').toFixed(1)}`); // 공식 14.9
  assert.ok(m('reb1') > 11 && m('reb1') < 16, `리바운드 1위 ${m('reb1').toFixed(1)}`); // 공식 13.5
  assert.ok(m('ast1') > 5 && m('ast1') < 8, `어시스트 1위 ${m('ast1').toFixed(1)}`); // 공식 6.5
  assert.ok(m('mpg1') > 31 && m('mpg1') < 36, `최다 출전 ${m('mpg1').toFixed(1)}분`); // 공식 34.7
  assert.ok(mean(r.metrics.map((x) => x.teamShare[0])) > 0.2 && mean(r.metrics.map((x) => x.teamShare[0])) < 0.27, '팀 내 득점 1위 비중'); // 공식 23.3%
  assert.ok(r.teamPpg > 75 && r.teamPpg < 78, `팀 평균 득점 ${r.teamPpg.toFixed(2)}`);
  assert.ok(r.winSd > 0.09 && r.winSd < 0.14, `승률 표준편차 ${r.winSd.toFixed(3)}`); // 옛 값 0.114
});

test('득점 배분: 공격력이 높은 선수가 슛을 더 가져가고(usageExp), 합계는 팀 득점과 같고, 한도(usageCap)를 넘으면 증가가 둔해진다', () => {
  const mk = (id, shooting) => ({ id, name: id, position: 'SF', ovr: 70, stats: { shooting, passing: shooting, defense: 60, rebound: 60, athletic: shooting } }); // 공격력 = 슛·패스·운동능력이 모두 같은 값
  const lineup = (star) => ({ starters: [mk('a', star), mk('b', 60), mk('c', 60), mk('d', 60), mk('e', 60)], bench: [mk('f', 60), mk('g', 60), mk('h', 60), mk('i', 60), mk('j', 60), mk('k', 60), mk('l', 60)] });
  const share = (star) => {
    const sim = rules.simulation, home = lineup(star), away = lineup(60);
    const base = leagueBaseline([home, away], sim);
    const rng = mulberry32(7);
    let a = 0, total = 0;
    for (let i = 0; i < 300; i++) {
      const g = simulateGame({ id: 'H', lineup: home }, { id: 'A', lineup: away }, base, { ...sim, ratingScale: 0 }, rng);
      assert.equal(g.box.home.reduce((s, l) => s + l.points, 0), g.homePts);
      a += g.box.home.find((l) => l.id === 'a').points; total += g.homePts;
    }
    return a / total;
  };
  const s60 = share(60), s80 = share(80), s100 = share(100);
  assert.ok(s80 > s60 * 1.3, `공격력 80 ${s80.toFixed(3)} vs 60 ${s60.toFixed(3)}`);
  assert.ok(s100 - s80 < s80 - s60, `한도 위에서는 증가가 둔해진다 ${s60.toFixed(3)} ${s80.toFixed(3)} ${s100.toFixed(3)}`);
});
