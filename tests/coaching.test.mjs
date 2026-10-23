import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultTeamStaff, staffOf, candidatePool, staffIds, rotationEdge, tacMult, trainMul, devBonus, recoveryMul, buyoutEok, seasonCharge, extraCharge, rollStaff, teamPay, ROLES, basePay } from '../src/coaching.mjs';
import { rulesFor } from '../src/economy.mjs';
import { createLeague } from '../src/league.mjs';
import { beginSeason, settleYear } from '../src/season-run.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';

test('기본 스태프: 구단 id로 고정되고(같은 입력 같은 결과) 능력치·연봉이 범위 안이며 구단마다 다르다', () => {
  const a = defaultTeamStaff(MY, rules), b = defaultTeamStaff(MY, rules);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, defaultTeamStaff('wonju-db', rules));
  const c = rules.coaching;
  for (const t of teams) {
    const s = defaultTeamStaff(t.id, rules);
    for (const v of [s.head.tac, s.head.dev, s.head.rot, s.off.k, s.def.k, s.cond.k]) assert.ok(v >= c.skill.min && v <= c.skill.max, `${t.id} ${v}`);
    assert.ok(s.head.pay >= c.salary.head[0] && s.head.pay <= c.salary.head[1]);
    for (const r of ['off', 'def', 'cond']) assert.ok(s[r].pay >= c.salary.coach[0] && s[r].pay <= c.salary.coach[1]);
    assert.ok(s.head.yrs >= c.contractYears[0] && s.head.yrs <= c.contractYears[1]);
  }
  const pays = teams.map((t) => teamPay(defaultTeamStaff(t.id, rules), rules));
  const mean = pays.reduce((x, y) => x + y) / pays.length;
  assert.ok(Math.abs(mean - c.covered) < 0.4, `평균 인건비 ${mean.toFixed(2)} ≈ 기본 포함분 ${c.covered}`);
});

test('연봉은 능력치가 높을수록 비싸고, 물가가 곱해진다', () => {
  assert.ok(basePay('head', 80, rules) > basePay('head', 40, rules));
  assert.ok(basePay('off', 80, rules) > basePay('off', 40, rules));
  const s = defaultTeamStaff(MY, rules);
  const later = rulesFor(rules, 2036);
  assert.ok(teamPay(s, later) > teamPay(s, rules) * 1.2);
});

test('효과: 능력치 50은 중립이고 높을수록 이득, 꺼져 있으면 모두 중립이다', () => {
  const mid = { head: { tac: 50, dev: 50, rot: 50 }, off: { k: 50 }, def: { k: 50 }, cond: { k: 50 } };
  assert.equal(rotationEdge(mid.head, rules), 0);
  assert.equal(tacMult(mid.head, rules), 1);
  assert.equal(trainMul(mid, 'shooting', rules), 1);
  assert.equal(devBonus(mid, rules), 0);
  assert.equal(recoveryMul(mid, rules), 1);
  const star = { head: { tac: 90, dev: 90, rot: 90 }, off: { k: 90 }, def: { k: 90 }, cond: { k: 90 } };
  assert.ok(rotationEdge(star.head, rules) > 0 && rotationEdge(star.head, rules) <= rules.coaching.rotationEdge);
  assert.ok(tacMult(star.head, rules) > 1 && trainMul(star, 'defense', rules) > 1 && devBonus(star, rules) > 0 && recoveryMul(star, rules) > 1);
  // 훈련은 그 능력치를 맡은 코치가 정한다
  const mixed = { ...mid, off: { k: 90 }, def: { k: 10 } };
  assert.ok(trainMul(mixed, 'passing', rules) > 1 && trainMul(mixed, 'rebound', rules) < 1 && trainMul(mixed, 'stamina', rules) === 1);
  const off = { ...rules, coaching: { ...rules.coaching, enabled: false } };
  assert.equal(rotationEdge(star.head, off), 0); assert.equal(tacMult(star.head, off), 1); assert.equal(trainMul(star, 'shooting', off), 1); assert.equal(devBonus(star, off), 0); assert.equal(recoveryMul(star, off), 1);
});

test('영입 후보 풀: 시즌마다 고정, 이미 구단에 있는 사람은 빠진다', () => {
  const staff = staffOf({}, teams, rules);
  const a = candidatePool(2026, rules, staffIds(staff)), b = candidatePool(2026, rules, staffIds(staff));
  assert.deepEqual(a, b);
  assert.equal(a.head.length, rules.coaching.pool.heads);
  for (const r of ['off', 'def', 'cond']) assert.equal(a[r].length, rules.coaching.pool.coaches);
  assert.notDeepEqual(a.head.map((x) => x.id), candidatePool(2027, rules).head.map((x) => x.id));
  const ex = candidatePool(2026, rules, new Set([a.head[0].id]));
  assert.ok(!ex.head.some((x) => x.id === a.head[0].id));
});

test('인건비 정산: 합류한 날부터만 내고 해임 위약금은 남은 계약 전부, 기본 포함분을 넘는 몫만 자금에 반영한다', () => {
  const s = staffOf({}, teams, rules)[MY];
  const full = seasonCharge(s, {}, 0, 54, rules);
  assert.equal(full, teamPay(s, rules));
  const half = seasonCharge(s, { head: 27 }, 0, 54, rules);
  assert.ok(Math.abs(half - (full - s.head.pay / 2)) < 0.02);
  assert.ok(Math.abs(buyoutEok(s.head, rules) - s.head.pay * s.head.yrs) < 0.02);
  assert.equal(seasonCharge(s, {}, 2.5, 54, rules), Math.round((full + 2.5) * 100) / 100);
  assert.equal(extraCharge(rules.coaching.covered, rules), 0);
  assert.ok(extraCharge(rules.coaching.covered - 1, rules) < 0);
});

test('시즌 말 스태프: 계약이 줄고 끝나면 재계약, 우리 구단은 감독이 바뀌지 않고, AI는 하위권에서 가끔 교체한다(같은 입력 같은 결과)', () => {
  const staff = staffOf({}, teams, rules);
  const standings = teams.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));
  const a = rollStaff(staff, { standings, teams, teamData: teams, rules, season: 2026, manager: MY });
  const b = rollStaff(staff, { standings, teams, teamData: teams, rules, season: 2026, manager: MY });
  assert.deepEqual(a, b);
  for (const t of teams) for (const r of ROLES) assert.ok(a.staff[t.id][r].yrs >= 1);
  assert.ok(!a.moves.some((m) => m.teamId === MY));
  // 여러 해에 걸쳐 AI 교체가 최하위권에서만 일어난다
  let fired = 0, top = 0;
  for (let y = 0; y < 40; y++) {
    const st = teams.map((t, i) => ({ id: t.id, wins: 40 - ((i + y) % 10) * 3, losses: 14 + ((i + y) % 10) * 3 })).sort((p, q) => q.wins - p.wins);
    const r = rollStaff(staff, { standings: st, teamData: teams, rules, season: 2026 + y, manager: MY });
    for (const m of r.moves) { fired++; assert.ok(m.rank > teams.length - 4); if (m.rank <= 4) top++; }
  }
  assert.ok(fired > 3 && top === 0, `교체 ${fired}`);
});

test('엔진: 스태프가 없는 저장(league.staff 없음)도 열리고, 시즌을 마치면 다음 시즌 스태프가 league.staff로 이어진다', () => {
  const league = createLeague(players, rules, { teamData: teams });
  assert.equal(league.staff, undefined);
  const run = beginSeason(league, teams, rules, mulberry32(3), { manager: MY, seed: 3 });
  assert.deepEqual(run.staff[MY], defaultTeamStaff(MY, rules)); // 기본 스태프
  run.playDays(); run.startPlayoffs(); while (!run.playoffs.done) run.playoffRound();
  const fin = run.finish();
  const settled = settleYear(league, fin, teams, rules);
  assert.ok(settled.league.staff?.[MY]);
  for (const t of teams) assert.ok(typeof settled.ledger[t.id].staff === 'number');
  // 새 시즌은 그 스태프로 시작한다
  const next = beginSeason({ ...settled.league, season: league.season + 1 }, teams, rules, mulberry32(4), { manager: MY, seed: 4 });
  assert.deepEqual(next.staff[MY], settled.league.staff[MY]);
});

test('해임·영입: 후보만 가능하고 위약금은 정산에서 나가며, 같은 조작으로 복원하면 같은 결과다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 61 });
  const old = s.staff[MY].head;
  const cand = s.staffPool.head[0];
  assert.equal(s.staffCheck('head', 'nobody', 2).ok, false);
  assert.equal(s.staffCheck('head', cand.id, 9).ok, false);
  const chk = s.staffCheck('head', cand.id, 2);
  assert.ok(chk.ok && Math.abs(chk.buyout - old.pay * old.yrs) < 0.02);
  const fundsBefore = s.funds[MY];
  const r = s.replaceStaff('head', cand.id, 2);
  assert.ok(r.ok);
  assert.equal(s.staff[MY].head.id, cand.id);
  assert.ok(!s.staffPool.head.some((c) => c.id === cand.id)); // 영입한 후보는 풀에서 빠진다
  assert.equal(s.funds[MY], fundsBefore); // 위약금은 시즌 정산에서 낸다
  s.advance(6);
  assert.equal(s.staffCheck('head', s.staffPool.head[0].id, 1).ok, true);
  const copy = restore(data, serialize(s));
  assert.equal(copy.staff[MY].head.id, cand.id);
  assert.equal(copy.day, s.day);
  assert.deepEqual(copy.standings().map((x) => x.wins), s.standings().map((x) => x.wins));
  // 시즌을 끝내면 위약금이 장부(staff)에 반영된다
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const entry = s.endSeason();
  const ledger = entry.ledger?.[MY] ?? s.game.seasonEnd.entry.ledger?.[MY];
  assert.ok(ledger && ledger.staff > old.pay, `staff 정산 ${ledger?.staff}`);
});

test('꺼 두면 경기 결과가 이전과 같다: 세 기능이 모두 꺼진 규칙은 팀 보정이 붙지 않는다', () => {
  const off = { ...rules, coaching: { ...rules.coaching, enabled: false }, tactics: { ...rules.tactics, enabled: false }, condition: { ...rules.condition, enabled: false } };
  const league = createLeague(players, off, { teamData: teams });
  const run = beginSeason(league, teams, off, mulberry32(7), { manager: MY, seed: 7 });
  assert.equal(run.staff, null);
  assert.equal(run.tactics, null);
  assert.deepEqual(run.teamMods, {});
});

test('뉴스: AI 구단의 감독 교체가 기사로 나온다(문단 2~4개, 길이 하한 이상, 댓글 있음)', async () => {
  const { getNews } = await import('../web/lib/news-view.js');
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 91 });
  let found = null;
  for (let y = 0; y < 8 && !found; y++) {
    while (!s.regularDone) s.advance(9);
    s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
    s.endSeason(); s.autoOffseason();
    found = s.game.log.find((e) => e.staffMoves?.length);
  }
  assert.ok(found, '8시즌 안에 AI 감독 교체가 한 번은 있다');
  const items = getNews(s, data).items.filter((it) => it.kind === 'coach_change');
  assert.ok(items.length >= 1);
  for (const it of items) {
    assert.ok(it.paragraphs.length >= 2 && it.paragraphs.length <= 4, `문단 ${it.paragraphs.length}`);
    assert.ok(it.body.length >= 160 && it.body.length <= 800, `길이 ${it.body.length}`);
    assert.ok(it.comments.length >= 2 && it.comments.length <= 5);
    assert.ok(!/undefined|null|\{/.test(it.body + it.headline), it.body);
  }
});
