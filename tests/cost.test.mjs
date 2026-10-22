import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcCost, COST_MIN, COST_MAX } from '../src/rating.mjs';
import { validateLineup } from '../src/lineup.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teams = read('teams.json');
const players = read('players.json');

test('코스트는 OVR이 오를수록 줄지 않고 1~20 범위다', () => {
  let prev = 0;
  for (let ovr = 0; ovr <= 99; ovr++) {
    const c = calcCost(ovr);
    assert.ok(c >= COST_MIN && c <= COST_MAX, `ovr ${ovr}: ${c}`);
    assert.ok(c >= prev, `ovr ${ovr}에서 코스트가 감소`);
    prev = c;
  }
  assert.equal(calcCost(99), COST_MAX);
  assert.equal(calcCost(40), COST_MIN);
});

test('선수 데이터의 cost가 OVR 공식과 일치한다', () => {
  for (const p of players) assert.equal(p.cost, calcCost(p.ovr), p.id);
});

test('모든 구단이 코스트 제한 안에서 라인업을 만들 수 있다', () => {
  const { starters, bench, costCap } = rules.lineup;
  for (const team of teams) {
    const cheapest = players
      .filter((p) => p.teamId === team.id)
      .map((p) => p.cost)
      .sort((a, b) => a - b)
      .slice(0, starters + bench)
      .reduce((a, b) => a + b, 0);
    assert.ok(cheapest <= costCap, `${team.name}: 최소 ${cheapest} > ${costCap}`);
  }
});

test('코스트 제한이 강팀에는 실제로 선택을 요구한다', () => {
  const { starters, bench, costCap } = rules.lineup;
  const binding = teams.filter((team) => {
    const top = players
      .filter((p) => p.teamId === team.id)
      .map((p) => p.cost)
      .sort((a, b) => b - a)
      .slice(0, starters + bench)
      .reduce((a, b) => a + b, 0);
    return top > costCap;
  });
  assert.ok(binding.length >= 1, '제한이 어느 구단에도 걸리지 않습니다');
});

test('validateLineup: 정상, 인원 오류, 코스트 초과, 외국 선수 초과를 구분한다', () => {
  const mk = (id, cost, origin = 'domestic') => ({ id, cost, origin });
  const ok5 = [1, 2, 3, 4, 5].map((i) => mk(`s${i}`, 5));
  const ok5b = [1, 2, 3, 4, 5].map((i) => mk(`b${i}`, 5));
  assert.equal(validateLineup(ok5, ok5b, rules).ok, true);

  assert.equal(validateLineup(ok5.slice(0, 4), ok5b, rules).ok, false);

  // 합계 65는 제한과 같으므로 통과, 66은 초과
  const atCap = [1, 2, 3, 4, 5].map((i) => mk(`e${i}`, 8));
  const atCapResult = validateLineup(atCap, ok5b, rules);
  assert.equal(atCapResult.totalCost, 65);
  assert.equal(atCapResult.ok, true);

  const overCap = [mk('o1', 9), ...atCap.slice(1)];
  const overResult = validateLineup(overCap, ok5b, rules);
  assert.equal(overResult.totalCost, 66);
  assert.equal(overResult.ok, false);
  assert.ok(overResult.errors.some((e) => e.includes('코스트')));

  const three = [mk('f1', 3, 'foreign'), mk('f2', 3, 'foreign'), mk('f3', 3, 'foreign'), mk('d1', 3), mk('d2', 3)];
  const fr = validateLineup(three, ok5b, rules);
  assert.equal(fr.ok, false);
  assert.ok(fr.errors.some((e) => e.includes('외국')));

  const dup = [...ok5.slice(0, 4), ok5[0]];
  assert.equal(validateLineup(dup, ok5b, rules).ok, false);
});
