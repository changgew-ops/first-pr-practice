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

test('validateLineup: 정상, 인원 오류, 외국 선수 초과, 중복을 구분하고 코스트는 보지 않는다', () => {
  const mk = (id, cost, origin = 'domestic') => ({ id, cost, origin });
  const ok5 = [1, 2, 3, 4, 5].map((i) => mk(`s${i}`, 5));
  const ok5b = [1, 2, 3, 4, 5, 6, 7].map((i) => mk(`b${i}`, 5));
  assert.equal(validateLineup(ok5, ok5b, rules).ok, true);

  assert.equal(validateLineup(ok5.slice(0, 4), ok5b, rules).ok, false);

  // 코스트 합계 제한은 없다: 코스트가 아주 높은 선수들로만 짜도 통과한다
  const huge = [1, 2, 3, 4, 5].map((i) => mk(`h${i}`, 20));
  const hugeBench = [1, 2, 3, 4, 5, 6, 7].map((i) => mk(`hb${i}`, 20));
  const hugeResult = validateLineup(huge, hugeBench, rules);
  assert.equal(hugeResult.ok, true);
  assert.equal(rules.lineup.costCap, undefined);

  const three = [mk('f1', 3, 'foreign'), mk('f2', 3, 'foreign'), mk('f3', 3, 'foreign'), mk('d1', 3), mk('d2', 3)];
  const fr = validateLineup(three, ok5b, rules);
  assert.equal(fr.ok, false);
  assert.ok(fr.errors.some((e) => e.includes('외국')));

  const dup = [...ok5.slice(0, 4), ok5[0]];
  assert.equal(validateLineup(dup, ok5b, rules).ok, false);
});
