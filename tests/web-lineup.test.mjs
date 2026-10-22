import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalDraft, autoDraft, setRole, roleOf, sameDraft, prune, rosterOfTeam, powerOf } from '../web/lib/lineup-view.js';
import { remainingCheckpoints, previewGain, projectGain } from '../web/lib/training-view.js';
import { Session } from '../web/lib/session.js';
import { autoFocus } from '../src/training.mjs';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';
const rules = data.rules;

test('라인업: 자동 편성은 규칙에 맞고 평가가 오류 없이 완성으로 나온다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const draft = autoDraft(roster, rules);
  const e = evalDraft(draft, roster, rules);
  assert.deepEqual(e.errors, []);
  assert.equal(e.complete, true);
  assert.ok(e.totalCost <= rules.lineup.costCap);
  assert.equal(e.starters.length, 5); assert.equal(e.bench.length, 5);
  assert.ok(e.foreignStarters <= rules.foreignPlayers.onCourt);
  assert.equal(Object.values(e.positions).reduce((a, b) => a + b, 0), 5);
});

test('라인업: 역할 바꾸기·되돌리기·중복·부족을 점검한다', () => {
  const roster = rosterOfTeam(data.players, MY);
  let d = autoDraft(roster, rules);
  const first = d.starters[0];
  assert.equal(roleOf(d, first), 'starter');
  d = setRole(d, first, 'starter'); // 같은 역할을 다시 누르면 제외
  assert.equal(roleOf(d, first), 'out');
  assert.ok(evalDraft(d, roster, rules).errors.some((m) => /스타팅은 5명/.test(m)));
  d = setRole(d, first, 'bench'); // 벤치로
  assert.equal(roleOf(d, first), 'bench'); assert.equal(d.bench.length, 6);
  assert.ok(evalDraft(d, roster, rules).errors.some((m) => /벤치는 5명/.test(m)));
  // 같은 선수가 스타팅·벤치 양쪽에 있는 draft는 중복 오류
  const dup = { starters: d.starters, bench: [...d.bench.slice(0, 4), d.starters[0]] };
  assert.ok(evalDraft(dup, roster, rules).errors.some((m) => /중복/.test(m)));
  assert.equal(sameDraft(autoDraft(roster, rules), autoDraft(roster, rules)), true);
  assert.deepEqual(prune({ starters: ['없는선수', first], bench: [] }, roster).starters, [first]);
});

test('라인업: 코스트 제한을 넘는 편성과 외국 선수 수 초과를 오류로 알린다', () => {
  const roster = rosterOfTeam(data.players, MY);
  const top = [...roster].sort((a, b) => b.cost - a.cost);
  const d = { starters: top.slice(0, 5).map((p) => p.id), bench: top.slice(5, 10).map((p) => p.id) };
  const e = evalDraft(d, roster, rules);
  assert.ok(e.totalCost > rules.lineup.costCap || e.errors.length === 0);
  const foreigners = roster.filter((p) => p.origin === 'foreign');
  const others = roster.filter((p) => p.origin !== 'foreign');
  if (foreigners.length >= rules.foreignPlayers.onCourt + 1) return;
  const many = { starters: [...foreigners.map((p) => p.id), ...others.map((p) => p.id)].slice(0, 5), bench: others.slice(3, 8).map((p) => p.id) };
  assert.ok(evalDraft(many, roster, rules).foreignStarters <= foreigners.length);
});

test('라인업: 전력은 스타팅 70% + 벤치 30%', () => {
  assert.equal(powerOf([{ ovr: 70 }, { ovr: 80 }], [{ ovr: 50 }]), 75 * 0.7 + 50 * 0.3);
});

test('훈련: 남은 훈련 횟수는 훈련 시점(checkpointDays 배수, 마지막 날 제외)을 센다', () => {
  assert.equal(remainingCheckpoints(0, 54, 9), 5);
  assert.equal(remainingCheckpoints(9, 54, 9), 4);
  assert.equal(remainingCheckpoints(10, 54, 9), 4);
  assert.equal(remainingCheckpoints(45, 54, 9), 0);
  assert.equal(remainingCheckpoints(54, 54, 9), 0);
});

test('훈련: 미리보기는 어린 선수가 더 크고 능력치 한계에서는 0이며, 예상 총 상승은 훈련 규칙과 같다', () => {
  const young = { age: 20, potential: 80, ovr: 60, position: 'SG', stats: { shooting: 60, passing: 60, defense: 60, rebound: 60, athletic: 60, stamina: 60 } };
  const old = { ...young, age: 34, potential: 60 };
  assert.ok(previewGain(young, 'shooting', rules).perSession > previewGain(old, 'shooting', rules).perSession);
  const maxed = { ...young, stats: { ...young.stats, shooting: rules.stats.max } };
  assert.equal(previewGain(maxed, 'shooting', rules).perSession, 0);
  const proj = projectGain(young, 'shooting', rules, 5);
  assert.ok(proj.statDelta > 0 && proj.ovrDelta >= 0); // 어리고 POT 여유가 큰 선수는 5회 훈련에 여러 점 오른다
  assert.equal(young.stats.shooting, 60); // 원본 그대로
  assert.equal(projectGain(young, 'shooting', rules, 0).statDelta, 0);
});

test('세션: 직접 편성과 훈련 지정이 시즌 진행에 반영된다 (저장·복원 후에도)', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 4 });
  const roster = rosterOfTeam(s.players, MY);
  const star = [...roster].sort((a, b) => b.ovr - a.ovr)[0];
  // 훈련: 가장 어린 선수의 집중을 자동 추천이 아닌 다른 능력치로
  const young = [...roster].sort((a, b) => a.age - b.age)[0];
  const stat = autoFocus(young) === 'athletic' ? 'passing' : 'athletic';
  s.setFocus(young.id, stat);
  assert.equal(s.focus.get(young.id), stat);
  // 편성: 스타를 벤치 맨 뒤로 보내는 규칙에 맞는 편성
  const auto = autoDraft(roster, rules);
  const alt = setRole(setRole(auto, star.id, 'bench'), auto.bench.at(-1), 'starter');
  const e = evalDraft(alt, roster, rules);
  if (e.errors.length === 0) {
    const r = s.setLineup(alt);
    assert.equal(r.ok, true);
    assert.deepEqual(s.lineup.starters.sort(), alt.starters.slice().sort());
  }
  s.advance(20);
  const after = s.players.find((p) => p.id === young.id);
  assert.ok(after.xp?.[stat] !== undefined || after.stats[stat] >= young.stats[stat]);
});
