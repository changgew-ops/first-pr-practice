import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcOvr } from '../src/rating.mjs';
import { rulesFor } from '../src/economy.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const baseRules = read('league-rules.json');
const rules = baseRules;
const teamData = read('teams.json');

// 리그 상태가 항상 지켜야 하는 규칙 (로스터 인원, 연봉 캡, 등번호, 포지션, 계약, 중복 없음)
export function invariants(league, label) {
  const rules = rulesFor(baseRules, league.season); // 그 시즌의 물가 반영 규칙(src/economy.mjs). 이미 맺은 계약은 예전 수준일 수 있어 하한은 원본 기준
  for (const team of teamData) {
    const roster = league.players.filter((p) => p.teamId === team.id);
    const dom = roster.filter((p) => p.origin === 'domestic');
    const foreign = roster.filter((p) => p.origin === 'foreign');
    const asia = roster.filter((p) => p.origin === 'asia');
    assert.equal(dom.length, rules.roster.domestic, `${label} ${team.name} 국내 ${dom.length}명`);
    assert.equal(foreign.length, rules.roster.foreign, `${label} ${team.name} 외국 ${foreign.length}명`);
    assert.ok(asia.length <= rules.roster.asia, `${label} ${team.name} 아시아쿼터 ${asia.length}명`);
    for (const p of asia) assert.ok(p.contract.salaryEok >= baseRules.asiaQuota.salaryEok[0] - 1e-9 && p.contract.salaryEok <= rules.asiaQuota.salaryEok[1] + 1e-9, `${label} ${p.name} 아시아쿼터 연봉 ${p.contract.salaryEok}`);
    // 소프트캡: 캡을 넘길 수 있지만 한도(캡 × 1.2)는 넘지 못한다
    const cap = dom.reduce((s, p) => s + p.contract.salaryEok, 0);
    assert.ok(cap <= rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio) + 1e-6, `${label} ${team.name} 국내 연봉 ${cap.toFixed(1)}`);
    const fcap = foreign.reduce((s, p) => s + p.contract.salaryUsd, 0);
    assert.ok(fcap <= rules.salaryCap.foreignUsdTotal, `${label} ${team.name} 외국 연봉 ${fcap}`);
    for (const p of foreign) assert.ok(p.contract.salaryUsd <= rules.salaryCap.foreignUsdPerPlayer);
    assert.equal(new Set(roster.map((p) => p.number)).size, roster.length, `${label} ${team.name} 등번호 중복`);
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) assert.ok(roster.some((p) => p.position === pos), `${label} ${team.name} ${pos} 없음`);
    for (const p of roster) assert.ok(p.contract.yearsLeft >= 1, `${label} ${p.name} 계약 ${p.contract.yearsLeft}`);
  }
  const all = [...league.players, ...league.freeAgents];
  assert.equal(new Set(all.map((p) => p.id)).size, all.length, `${label} id 중복`);
  assert.equal(new Set(league.players.map((p) => p.name)).size, league.players.length, `${label} 이름 중복`);
  for (const p of league.players) {
    assert.ok(p.ovr === calcOvr(p.position, p.stats), `${label} ${p.name} OVR 불일치`);
    for (const v of Object.values(p.stats)) assert.ok(v >= 20 && v <= 99);
  }
}
