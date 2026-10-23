import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tacticList, fitOf, leagueRefs, recommend, chooseAuto, tacticMods, BALANCED, metricOf } from '../src/tactics.mjs';
import { simulateGame, leagueBaseline } from '../src/game.mjs';
import { buildLineup } from '../src/lineup.mjs';
import { createLeague } from '../src/league.mjs';
import { beginSeason } from '../src/season-run.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';
const league = createLeague(players, rules, { teamData: teams });
const lineups = teams.map((t) => buildLineup(league.players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight));
const refs = leagueRefs(lineups, rules);

test('전술 목록: 균형이 있고 균형 말고는 구성 기준(metric)이 있다', () => {
  const list = tacticList(rules);
  assert.ok(list.length >= 4 && list.length <= 6);
  assert.equal(list[0].id, BALANCED);
  for (const t of list.slice(1)) assert.ok(t.metric?.weights && t.metric.spread > 0, t.id);
});

test('적합도: -1~1, 균형은 0, 리그 평균 기준이면 팀 평균이 0에 가깝다', () => {
  for (const l of lineups) for (const t of tacticList(rules)) {
    const f = fitOf(t.id, l, rules, refs);
    assert.ok(f >= -1 && f <= 1, `${t.id} ${f}`);
    if (t.id === BALANCED) assert.equal(f, 0);
  }
  for (const t of tacticList(rules).slice(1)) {
    const mean = lineups.reduce((s, l) => s + fitOf(t.id, l, rules, refs), 0) / lineups.length;
    assert.ok(Math.abs(mean) < 0.15, `${t.id} 평균 적합도 ${mean.toFixed(2)}`);
  }
  // 구성이 정말 다른 라인업이면 적합도가 정반대로 갈린다
  const fast = tacticList(rules).find((t) => t.id === 'fast');
  const hi = lineups.reduce((a, b) => (metricOf(fast, a, rules.simulation) >= metricOf(fast, b, rules.simulation) ? a : b));
  const lo = lineups.reduce((a, b) => (metricOf(fast, a, rules.simulation) <= metricOf(fast, b, rules.simulation) ? a : b));
  assert.ok(fitOf('fast', hi, rules, refs) > 0.3 && fitOf('fast', lo, rules, refs) < -0.3);
});

test('추천·자동 선택: 적합도 높은 순, minFit 이상이면 그 전술 아니면 균형, 어느 전술도 모든 팀의 1위가 아니다', () => {
  const picks = new Set();
  for (const l of lineups) {
    const rec = recommend(l, rules, refs);
    for (let i = 1; i < rec.length; i++) assert.ok(rec[i - 1].fit >= rec[i].fit);
    const auto = chooseAuto(l, rules, refs);
    const best = rec.find((r) => r.id !== BALANCED);
    assert.equal(auto, best.fit >= rules.tactics.minFit ? best.id : BALANCED);
    picks.add(auto);
  }
  assert.ok(picks.size >= 3, `자동 선택 ${[...picks]}`);
});

test('보정: 균형은 이득 0, 적합도 × edgeMax × 감독 배수, 꺼 두면 null', () => {
  const l = lineups[0];
  assert.equal(tacticMods(BALANCED, l, rules, 1, refs).edge, 0);
  const m = tacticMods('half', l, rules, 1, refs), m2 = tacticMods('half', l, rules, 1.4, refs);
  assert.ok(Math.abs(m.edge - Math.round(rules.tactics.edgeMax * m.fit * 100) / 100) < 0.011);
  assert.ok(Math.abs(m2.edge) >= Math.abs(m.edge));
  assert.equal(tacticMods('half', l, { ...rules, tactics: { ...rules.tactics, enabled: false } }, 1, refs), null);
});

test('경기: 중립 보정(없음·모두 1)이면 결과가 같고, 페이스는 득점을, 전술은 기록 열만 바꾼다', () => {
  const sim = rules.simulation, base = leagueBaseline(lineups, sim);
  const A = { id: 'a', lineup: lineups[0] }, B = { id: 'b', lineup: lineups[1] };
  const plain = simulateGame(A, B, base, sim, mulberry32(9));
  const neutral = { pace: 1, three: 1, reb: 1, to: 1, oppTo: 1, edge: 0 };
  assert.deepEqual(simulateGame({ ...A, mods: neutral }, { ...B, mods: neutral }, base, sim, mulberry32(9)), plain);
  const fast = simulateGame({ ...A, mods: { ...neutral, pace: 1.1 } }, { ...B, mods: { ...neutral, pace: 1.1 } }, base, sim, mulberry32(9));
  assert.ok(fast.homePts + fast.awayPts > plain.homePts + plain.awayPts);
  // 기록 열만 바뀌는 보정은 점수를 바꾸지 않는다
  const rec = simulateGame({ ...A, mods: { ...neutral, three: 1.3, reb: 1.2, to: 1.3 } }, B, base, sim, mulberry32(9));
  assert.equal(rec.homePts, plain.homePts); assert.equal(rec.awayPts, plain.awayPts);
  const sum = (box, k) => box.reduce((s, l) => s + l[k], 0);
  assert.ok(sum(rec.box.home, 'rebounds') >= sum(plain.box.home, 'rebounds') - 6);
  // 이득(edge)은 그 팀의 기대 득점을 올린다(여러 시드 평균)
  let gain = 0;
  for (let i = 0; i < 300; i++) { const r = simulateGame({ ...A, mods: { ...neutral, edge: 3 } }, B, base, sim, mulberry32(i)); const q = simulateGame(A, B, base, sim, mulberry32(i)); gain += r.homePts - q.homePts; }
  assert.ok(gain / 300 > 1.5, `평균 득점 증가 ${gain / 300}`);
});

test('진행기: 전술을 고르면 그 전술이 쓰이고(추천 따르기는 AI와 같은 방식), 모든 구단에 팀 보정이 붙는다', () => {
  const run = beginSeason(league, teams, rules, mulberry32(5), { manager: MY, seed: 5 });
  const info = run.tactics;
  assert.equal(info.choice, null);
  assert.equal(info.list.length, tacticList(rules).length);
  assert.equal(Object.keys(run.teamMods).length, teams.length);
  const pick = info.list.find((x) => x.id !== info.current && x.id !== BALANCED).id;
  assert.ok(run.setTactic(pick).ok);
  assert.equal(run.tactics.current, pick);
  assert.equal(run.teamMods[MY].tactic, pick);
  assert.equal(run.setTactic('nope').ok, false);
  assert.ok(run.setTactic(null).ok);
  assert.equal(run.tactics.choice, null);
});

test('세션: 전술 선택이 조작 기록으로 저장되고 복원해도 같은 시즌이 된다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 71 });
  s.advance(4);
  assert.ok(s.setTactic('half').ok);
  s.advance(6);
  assert.ok(s.setTactic('inside').ok);
  s.advance(5);
  const copy = restore(data, serialize(s));
  assert.equal(copy.tactics.choice, 'inside');
  assert.deepEqual(copy.standings().map((x) => `${x.id}:${x.wins}:${x.pointsFor}`), s.standings().map((x) => `${x.id}:${x.wins}:${x.pointsFor}`));
  assert.ok(s.game.actions.some((a) => a.type === 'tactic' && a.id === 'half'));
});
