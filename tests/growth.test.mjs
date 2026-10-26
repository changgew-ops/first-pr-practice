import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { progressPlayer } from '../src/offseason.mjs';
import { cardPlayer, cardPotential, careerHighIndex, expandCard, cardOvr } from '../src/cards.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { fromLegacyOvr, OVR_MAX } from '../src/rating.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const clone = (o) => JSON.parse(JSON.stringify(o));

const sample = (over = {}) => ({ id: 'x', name: 't', age: 20, position: 'SF', origin: 'domestic', stats: { shooting: 55, passing: 55, defense: 55, rebound: 55, athletic: 55, stamina: 55 }, ovr: 55, potential: 70, rarity: 'common', cost: 3, contract: { yearsLeft: 2 }, ...over });
const meanGain = (p, rs, n = 400) => { let s = 0; for (let i = 0; i < n; i++) s += progressPlayer(p, rs, mulberry32(i + 1)).ovr - p.ovr; return s / n; };

test('카드 잠재력: 어린 카드는 여지를 받고, 커리어 하이가 높으면 그 근처까지 풀리며, 27세 이상은 OVR 그대로, 같은 카드는 늘 같다', () => {
  const pr = rules.cards.potential;
  const young = cards.domestic.find((c) => c.age != null && c.age <= 21 && cardOvr(c) < 60);
  assert.ok(young);
  const ovr = cardOvr(young);
  const pot = cardPotential(young, ovr, ovr, pr, young.age);
  assert.ok(pot >= ovr + pr.bonus[0][1] && pot <= ovr + pr.bonus[0][2], `포텐 ${pot} (OVR ${ovr})`);
  assert.equal(cardPotential(young, ovr, ovr, pr, young.age), pot, '같은 카드는 같은 잠재력');
  // 기준점(highGap)은 예전 OVR 눈금 기준이라 예전 눈금 80·79를 지금 눈금으로 옮긴 값과 견준다(src/rating.mjs)
  const high = fromLegacyOvr(80);
  assert.equal(cardPotential(young, ovr, high, pr, 20), high, '21세 이하는 커리어 하이까지');
  assert.ok(Math.abs(cardPotential(young, ovr, high, pr, 24) - fromLegacyOvr(79)) <= 1, '24세 이하는 커리어 하이 − 1(예전 눈금, 반올림 ±1)');
  assert.equal(cardPotential(young, ovr, high, pr, 28), ovr, '27세 이상은 잠재력이 OVR로 수렴');
  // 실제 카드 한 명: 어릴 때 카드의 포텐이 이후 커리어 하이를 넘지 않고 하이 근처다
  const highs = careerHighIndex(cards);
  const c = cards.domestic.find((x) => x.age != null && x.age <= 21 && highs.get(x.kblId) - cardOvr(x) >= 5);
  const p = cardPlayer(c, { id: 'c1', potentialRules: pr, careerHigh: highs.get(c.kblId) });
  assert.ok(p.potential >= highs.get(c.kblId) && p.potential <= OVR_MAX);
  // 규칙을 주지 않으면 이전처럼 포텐 = OVR
  assert.equal(cardPlayer(c, { id: 'c2' }).potential, cardPlayer(c, { id: 'c2' }).ovr);
});

test('성장: 나이가 어릴수록 크고, 출전 시간이 길수록 어린 선수가 더 크며, 나이 든 선수에게는 출전 보너스가 없다', () => {
  const noBt = clone(rules); noBt.aging.breakthrough = null;
  const y = meanGain(sample({ age: 19 }), noBt), mid = meanGain(sample({ age: 24, potential: 62 }), noBt);
  assert.ok(y > 2.5 && y > mid, `19세 ${y.toFixed(2)} / 24세 ${mid.toFixed(2)}`);
  const lots = meanGain(sample({ age: 20, lastGp: 54, lastMin: 54 * 30 }), noBt), none = meanGain(sample({ age: 20, lastGp: 54, lastMin: 54 * 2 }), noBt), unknown = meanGain(sample({ age: 20 }), noBt);
  assert.ok(lots > unknown && unknown > none, `많이 ${lots.toFixed(2)} / 기록 없음 ${unknown.toFixed(2)} / 거의 안 뜀 ${none.toFixed(2)}`);
  const oldA = meanGain(sample({ age: 33, potential: 55, lastGp: 54, lastMin: 54 * 30 }), noBt), oldB = meanGain(sample({ age: 33, potential: 55, lastGp: 54, lastMin: 54 * 2 }), noBt);
  assert.equal(oldA, oldB, '출전 경험 보너스는 playingTime.ageMax 이하에만');
  assert.ok(oldA < -1.5, `33세 ${oldA.toFixed(2)}`);
});

test('깨달음: 확률 0이면 없고 1이면 항상, 능력치 하나가 gain만큼 오르며 보고서 모양이 맞다', () => {
  const never = clone(rules); never.aging.breakthrough.young = never.aging.breakthrough.prime = never.aging.breakthrough.old = 0;
  const always = clone(rules); always.aging.breakthrough.young = always.aging.breakthrough.prime = always.aging.breakthrough.old = 1;
  for (let i = 0; i < 50; i++) assert.equal(progressPlayer(sample({ age: 22 }), never, mulberry32(i)).breakthrough, undefined);
  const [lo, hi] = rules.aging.breakthrough.gain;
  for (let i = 0; i < 50; i++) {
    const next = progressPlayer(sample({ age: 22, potential: 55 }), always, mulberry32(i));
    assert.equal(next.breakthrough.length, 1);
    const b = next.breakthrough[0];
    assert.ok(['shooting', 'passing', 'defense', 'rebound', 'athletic'].includes(b.stat));
    assert.ok(b.to - b.from >= Math.min(lo, 99 - b.from) && b.to - b.from <= hi);
    assert.equal(next.stats[b.stat], b.to);
  }
  // 나이 상한 밖은 없음
  assert.equal(progressPlayer(sample({ age: rules.aging.breakthrough.maxAge, potential: 55 }), always, mulberry32(1)).breakthrough, undefined);
});

test('연간 곡선과 보고서: 나이별 평균 OVR 변화가 목표 범위, 깨달음 기록·출전 기록이 리그 진행에 남는다', () => {
  const bucket = (a) => (a <= 22 ? 'young' : a <= 25 ? 'mid' : a <= 28 ? 'prime' : a <= 31 ? 'vet' : 'old');
  const acc = {}; let btTotal = 0, btShape = true, stamped = 0;
  const years = 8, start = [];
  for (let seed = 1; seed <= 3; seed++) {
    const rng = mulberry32(seed * 31); let league = createLeague(players, rules); let prev = new Map(league.players.filter((p) => p.origin === 'domestic').map((p) => [p.id, p]));
    for (let y = 0; y < years; y++) {
      const { league: next, report } = playLeagueYear(league, teams, rules, rng, { cards });
      btTotal += report.breakthroughs.length;
      for (const b of report.breakthroughs) btShape &&= ['id', 'name', 'teamId', 'stat', 'from', 'to'].every((k) => k in b) && b.to > b.from;
      for (const p of next.players) { assert.equal(p.breakthrough, undefined, '깨달음 표시는 보고서로 옮긴 뒤 지운다'); if (p.lastGp === rules.regularSeasonGames && p.lastMin > 0) stamped++; }
      const cur = new Map(next.players.filter((p) => p.origin === 'domestic').map((p) => [p.id, p]));
      for (const [id, p] of cur) { const q = prev.get(id); if (q) (acc[bucket(q.age)] ??= []).push(p.ovr - q.ovr); }
      if (y === 0) start.push(next.players.filter((p) => p.origin === 'domestic').reduce((s, p) => s + p.ovr, 0) / 150);
      prev = cur; league = next;
    }
  }
  const m = (k) => acc[k].reduce((a, b) => a + b, 0) / acc[k].length;
  assert.ok(m('young') > 2.4 && m('young') < 6, `~22세 ${m('young').toFixed(2)}`);
  assert.ok(m('mid') > 0.8 && m('mid') < 3.2, `23~25세 ${m('mid').toFixed(2)}`);
  assert.ok(m('prime') > -0.7 && m('prime') < 1.2, `26~28세 ${m('prime').toFixed(2)}`);
  assert.ok(m('vet') < -0.5 && m('vet') > -2.5, `29~31세 ${m('vet').toFixed(2)}`);
  assert.ok(m('old') < -1.3 && m('old') > -4, `32세~ ${m('old').toFixed(2)}`);
  assert.ok(btTotal / (3 * years) > 3 && btTotal / (3 * years) < 40, `연간 깨달음 ${(btTotal / (3 * years)).toFixed(1)}`);
  assert.ok(btShape);
  assert.ok(stamped > 30, '정규리그 전 경기를 뛴 선수에게 출전 기록이 찍힌다');
});

test('이전 저장: 출전 기록(lastGp·lastMin)이 없는 선수도 성장하고 오류가 없다', () => {
  const p = sample({ age: 21 });
  assert.equal(p.lastGp, undefined);
  const next = progressPlayer(p, rules, mulberry32(3));
  assert.ok(next.age === 22 && Number.isFinite(next.ovr));
});
