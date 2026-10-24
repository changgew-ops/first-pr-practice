import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTodo } from '../web/lib/todo.js';

const P = (id, name, yearsLeft = 3) => ({ id, name, contract: { yearsLeft } });
const roster = [P('a', '가'), P('b', '나', 1), P('c', '다'), P('d', '라', 0), P('e', '마'), P('f', '바')];
const base = { stage: 'regular', roster, starters: roster.slice(0, 5), rules: { conditionLow: 55, maxReview: 5 }, healthyMin: 4 };

test('데이터가 없으면 목록이 비어 있다', () => {
  const t = buildTodo({});
  assert.deepEqual(t.counts, { must: 0, review: 0, info: 0 });
  assert.equal(t.reviewMore, 0);
});

test('피로한 스타팅: 임계 아래만, 낮은 순, 쉬는 사람·부상자는 제외하고 3명까지 + 나머지는 한 줄', () => {
  const conds = { a: 30, b: 40, c: 45, d: 50, e: 52, f: 10 };
  const t = buildTodo({ ...base, cond: (id) => conds[id], injuries: [{ playerId: 'e', name: '마', left: 1 }] });
  const tired = t.reviewAll.filter((x) => x.kind === 'tired');
  assert.deepEqual(tired.map((x) => x.id), ['tired:a', 'tired:b', 'tired:c', 'tired:more']); // d(50)는 임계 55 미만이라 4번째 → "더 있음", e는 부상이라 제외, f는 스타팅이 아님
  assert.match(tired.at(-1).text, /1명 더/);
  assert.equal(tired[0].to, '#/lineup/a');
});

test('해소되면 사라진다: 컨디션이 오르면 항목이 없다', () => {
  const low = buildTodo({ ...base, cond: () => 40 });
  const ok = buildTodo({ ...base, cond: () => 90 });
  assert.ok(low.reviewAll.some((x) => x.kind === 'tired'));
  assert.ok(!ok.reviewAll.some((x) => x.kind === 'tired'));
});

test('주전 중상 알림과 스타팅 부상(2경기 이상): 한 선수는 한 번만 나온다', () => {
  const t = buildTodo({ ...base, injuries: [{ playerId: 'a', name: '가', left: 8, part: '무릎' }, { playerId: 'b', name: '나', left: 1 }, { playerId: 'f', name: '바', left: 6 }], alerts: [{ id: 1, kind: 'injury', playerId: 'a', text: 'x' }] });
  const inj = t.reviewAll.filter((x) => x.kind === 'injury');
  assert.deepEqual(inj.map((x) => x.id), ['injury:a']); // b는 1경기라 제외, f는 스타팅도 중상 알림도 아니라 제외
  assert.match(inj[0].text, /8경기 결장/);
});

test('필수: 건강한 선수 부족과 오프시즌 결정 대기', () => {
  const sh = buildTodo({ ...base, healthyMin: 6, injuries: [{ playerId: 'a', name: '가', left: 3 }] });
  assert.equal(sh.must.length, 1); assert.equal(sh.must[0].kind, 'shortage');
  assert.equal(buildTodo({ ...base, healthyMin: 5, injuries: [{ playerId: 'a', name: '가', left: 3 }] }).must.length, 0);
  const off = buildTodo({ stage: 'offseason', pendingLabel: '재계약 협상' });
  assert.equal(off.must[0].to, '#/offseason');
  // 알림과 계산이 겹쳐도 한 번만
  const both = buildTodo({ ...base, healthyMin: 6, injuries: [{ playerId: 'a', name: '가', left: 3 }], alerts: [{ id: 2, kind: 'shortage', text: '부족' }] });
  assert.equal(both.must.length, 1);
});

test('검토는 maxReview까지만, 중요도 순, 나머지는 reviewMore', () => {
  const conds = { a: 10, b: 11, c: 12, d: 13, e: 14 };
  const t = buildTodo({ ...base, rules: { conditionLow: 55, maxReview: 2 }, cond: (id) => conds[id], injuries: [{ playerId: 'a', name: '가', left: 9 }], alerts: [{ id: 1, kind: 'injury', playerId: 'a', text: 'x' }, { id: 3, kind: 'bubble', text: '경계' }] });
  assert.equal(t.review.length, 2);
  assert.equal(t.review[0].kind, 'injury'); // 부상(80+) > 피로(60+)
  assert.ok(t.reviewMore >= 3);
});

test('계약 만료 예정은 시즌 중 정규리그에만 한 줄 요약', () => {
  const t = buildTodo(base);
  const e = t.reviewAll.find((x) => x.kind === 'expiring');
  assert.ok(e); assert.match(e.text, /2명/); // 나(1년), 라(0년)
  assert.ok(!buildTodo({ ...base, stage: 'playoffs' }).reviewAll.some((x) => x.kind === 'expiring'));
});

test('웨이버 마감 임박만 보인다', () => {
  const t = buildTodo({ ...base, waivers: [{ player: { id: 'w1', name: '공시1' }, left: 1, mine: true }, { player: { id: 'w2', name: '공시2' }, left: 3, mine: false }] });
  assert.deepEqual(t.reviewAll.filter((x) => x.kind === 'waiver').map((x) => x.id), ['waiver:w1']);
});

test('참고: 업적·뉴스 개수 제한', () => {
  const t = buildTodo({ ...base, achievements: [1, 2, 3, 4].map((i) => ({ id: `x${i}`, name: `업적${i}` })), news: [1, 2, 3].map((i) => ({ headline: `뉴스${i}`, when: '10월' })) });
  assert.equal(t.info.filter((x) => x.kind === 'achievement').length, 3);
  assert.equal(t.info.filter((x) => x.kind === 'news').length, 2);
});

import { replacementCandidates } from '../web/lib/lineup-view.js';

test('교체 후보: 같은 포지션 우선, OVR 순, 부상자는 뒤로, 능력치·컨디션 차이', () => {
  const S = (shooting, passing = 50) => ({ shooting, passing, defense: 50, rebound: 50, athletic: 50, stamina: 50 });
  const P = (id, position, ovr, stats) => ({ id, position, ovr, stats });
  const sel = P('s', 'PG', 70, S(70));
  const roster = [sel, P('a', 'PG', 66, S(60, 80)), P('b', 'C', 75, S(40)), P('c', 'PG', 72, S(75)), P('d', 'PG', 80, S(80)), P('e', 'SG', 69, S(65))];
  const roles = { s: 'starter', a: 'out', b: 'out', c: 'bench', d: 'out', e: 'bench' };
  const cond = { s: 60, a: 90, b: 100, c: 80, d: 95, e: 70 };
  const r = replacementCandidates(roster, sel, { roleOf: (p) => roles[p.id], condOf: (id) => cond[id], hurt: new Set(['d']), n: 5 });
  assert.deepEqual(r.map((x) => x.player.id), ['c', 'a', 'b', 'e', 'd']); // 건강한 같은 PG(c 72, a 66) → 다른 포지션(b 75, e 69) → 결장 중인 d는 맨 뒤
  const a = r[1];
  assert.equal(a.diffs.shooting, -10); assert.equal(a.diffs.passing, 30); assert.equal(a.condDiff, 30); assert.equal(a.ovrDiff, -4);
  assert.equal(r[4].hurt, true);
  // 컨디션 기능이 없으면 차이는 null
  assert.equal(replacementCandidates(roster, sel, { roleOf: (p) => roles[p.id] })[0].condDiff, null);
  // 편성 밖 선수를 고르면 후보는 편성 안 선수만
  const out = replacementCandidates(roster, roster[1], { roleOf: (p) => roles[p.id] });
  assert.ok(out.every((x) => x.role !== 'out'));
});
