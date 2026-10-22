import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAT_KEYS, calcOvr, POSITION_WEIGHTS } from '../src/rating.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teams = read('teams.json');
const players = read('players.json');

test('포지션 가중치 합계는 1이다', () => {
  for (const [pos, w] of Object.entries(POSITION_WEIGHTS)) {
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${pos}: ${sum}`);
  }
});

test('구단은 10개이고 id가 겹치지 않는다', () => {
  assert.equal(teams.length, rules.teams);
  assert.equal(new Set(teams.map((t) => t.id)).size, teams.length);
});

test('선수 id가 겹치지 않고 모든 선수가 존재하는 구단에 속한다', () => {
  assert.equal(new Set(players.map((p) => p.id)).size, players.length);
  const ids = new Set(teams.map((t) => t.id));
  for (const p of players) assert.ok(ids.has(p.teamId), p.id);
});

for (const team of teams) {
  const roster = players.filter((p) => p.teamId === team.id);
  const domestic = roster.filter((p) => p.origin === 'domestic');
  const foreign = roster.filter((p) => p.origin === 'foreign');
  const asia = roster.filter((p) => p.origin === 'asia');

  test(`${team.name}: 국내 ${rules.roster.domestic}명, 외국 ${rules.roster.foreign}명, 아시아쿼터 ${rules.roster.asia}명 이하`, () => {
    assert.equal(domestic.length, rules.roster.domestic);
    assert.equal(foreign.length, rules.roster.foreign);
    assert.ok(asia.length <= rules.roster.asia);
    for (const p of asia) assert.ok(p.nationality, `${p.name} 국적`);
  });

  test(`${team.name}: 국내 선수 연봉 합계가 캡 이내`, () => {
    const total = domestic.reduce((a, p) => a + p.contract.salaryEok, 0);
    assert.ok(total <= rules.salaryCap.domesticEok, `총 ${total.toFixed(1)}억`);
  });

  test(`${team.name}: 외국 선수 연봉이 총액·1인 상한 이내`, () => {
    const total = foreign.reduce((a, p) => a + p.contract.salaryUsd, 0);
    assert.ok(total <= rules.salaryCap.foreignUsdTotal, `총 $${total}`);
    for (const p of foreign) assert.ok(p.contract.salaryUsd <= rules.salaryCap.foreignUsdPerPlayer, p.name);
  });

  test(`${team.name}: 등번호와 이름이 겹치지 않는다`, () => {
    assert.equal(new Set(roster.map((p) => p.number)).size, roster.length);
    assert.equal(new Set(roster.map((p) => p.name)).size, roster.length);
  });

  test(`${team.name}: 5개 포지션이 모두 있다`, () => {
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
      assert.ok(roster.some((p) => p.position === pos), pos);
    }
  });
}

test('능력치 범위, OVR 일치, 잠재력 >= OVR', () => {
  for (const p of players) {
    for (const k of STAT_KEYS) {
      assert.ok(p.stats[k] >= rules.stats.min && p.stats[k] <= rules.stats.max, `${p.id} ${k}`);
    }
    assert.equal(p.ovr, calcOvr(p.position, p.stats), p.id);
    assert.ok(p.potential >= p.ovr && p.potential <= rules.stats.max, p.id);
  }
});
