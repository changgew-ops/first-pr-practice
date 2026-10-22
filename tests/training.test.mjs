import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trainPlayer, autoFocus, ageMultiplier, potentialMultiplier, trainingThreshold } from '../src/training.mjs';
import { calcOvr } from '../src/rating.mjs';

const rules = JSON.parse(readFileSync(new URL('../data/league-rules.json', import.meta.url), 'utf8'));
const mk = (age, ovr, potential, shooting = 60) => {
  const stats = { shooting, passing: 60, defense: 60, rebound: 60, athletic: 60, stamina: 60 };
  const o = calcOvr('SG', stats);
  return { id: 'x', position: 'SG', age, stats, ovr: o, cost: 5, potential: Math.max(potential, o), xp: undefined };
};

test('어리고 잠재력 여유가 큰 선수가 더 빨리 늘고, 한계에 가깝거나 나이 든 선수는 거의 늘지 않는다', () => {
  const young = mk(20, 60, 80);
  const old = mk(33, 60, 60);
  let y = young, o = old;
  for (let i = 0; i < 6; i++) { y = trainPlayer(y, 'shooting', 8, rules); o = trainPlayer(o, 'shooting', 8, rules); }
  assert.ok(y.stats.shooting - young.stats.shooting >= 4, `young +${y.stats.shooting - young.stats.shooting}`);
  assert.ok(o.stats.shooting - old.stats.shooting <= 1, `old +${o.stats.shooting - old.stats.shooting}`);
});

test('훈련은 원본을 바꾸지 않고 OVR·코스트를 다시 계산하며 잠재력은 그대로다', () => {
  const p = mk(21, 60, 80);
  const before = JSON.stringify(p);
  const t = trainPlayer(p, 'shooting', 200, rules);
  assert.equal(JSON.stringify(p), before);
  assert.equal(t.ovr, calcOvr('SG', t.stats));
  assert.equal(t.potential, p.potential);
  assert.ok(t.stats.shooting > p.stats.shooting);
});

test('남은 경험치는 이월되고, 99를 넘지 않는다', () => {
  const p = mk(21, 60, 80);
  const once = trainPlayer(p, 'shooting', 1, rules);
  assert.ok(once.xp.shooting > 0);
  const capped = trainPlayer(mk(21, 60, 99, 98), 'shooting', 5000, rules);
  assert.equal(capped.stats.shooting, 99);
});

test('알 수 없는 능력치는 오류, 같은 입력이면 같은 결과', () => {
  assert.throws(() => trainPlayer(mk(21, 60, 80), 'dunk', 1, rules), /알 수 없는/);
  assert.deepEqual(trainPlayer(mk(22, 60, 75), 'passing', 12, rules), trainPlayer(mk(22, 60, 75), 'passing', 12, rules));
});

test('배율과 임계값이 의도대로 단조롭다', () => {
  const cfg = rules.training;
  assert.ok(ageMultiplier(20, cfg) > ageMultiplier(27, cfg));
  assert.ok(ageMultiplier(27, cfg) > ageMultiplier(34, cfg));
  assert.ok(potentialMultiplier({ potential: 80, ovr: 60 }, cfg) > potentialMultiplier({ potential: 62, ovr: 60 }, cfg));
  assert.ok(trainingThreshold(80, cfg) > trainingThreshold(50, cfg));
});

test('autoFocus: 포지션에서 중요하고 올릴 여지가 큰 능력치를 고른다', () => {
  const center = { position: 'C', stats: { shooting: 50, passing: 50, defense: 50, rebound: 50, athletic: 50, stamina: 50 } };
  assert.equal(autoFocus(center), 'rebound');
  const maxed = { position: 'C', stats: { shooting: 50, passing: 50, defense: 50, rebound: 99, athletic: 50, stamina: 50 } };
  assert.notEqual(autoFocus(maxed), 'rebound');
});
