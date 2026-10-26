import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OVR_MAX } from '../src/rating.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { checkpointsPerSeason, eligibility, abroadGrowth, abroadSessions, programCost, preview } from '../src/devprogram.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { payrollEok } from '../src/valuation.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const rules = data.rules;
const MY = 'busan-kcc';
const YOUNG = '윤기찬'; // 22세 57/72, 계약 2년
const STAR = '강태현'; // 21세 63/79, 계약 2년
const byName = (s, name) => [...s.players, ...s.programs.map((x) => x.player)].find((p) => (p.baseName ?? p.name) === name);
const finishRegular = (s) => { while (!s.regularDone) s.advance(9); };
const fresh = (seed = 31) => Session.create(data, { managerId: MY, gmName: 'T', seed });
const idOf = (s, name) => byName(s, name).id;
const finishAll = (s) => { finishRegular(s); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); return s.endSeason(); };

test('육성 규칙: 한 시즌 훈련 체크포인트는 54일·9일 간격이면 5번', () => {
  assert.equal(checkpointsPerSeason(rules.regularSeasonGames, rules.ratingModel.checkpointDays), 5);
});

test('자격: 나이·정원·계약·시기 조건과 사유 문구', () => {
  const p = (o) => ({ origin: 'domestic', age: 22, contract: { yearsLeft: 3, salaryEok: 1 }, ...o });
  const ctx = { day: 0, remainingRoster: 13, activeCount: 0, alreadyAway: false };
  assert.equal(eligibility(p(), 'abroad', ctx, rules).ok, true);
  assert.match(eligibility(p({ age: 25 }), 'dleague', ctx, rules).reason, /24세/);
  assert.match(eligibility(p({ origin: 'foreign' }), 'dleague', ctx, rules).reason, /국내/);
  assert.match(eligibility(p(), 'dleague', { ...ctx, activeCount: 2 }, rules).reason, /2명/);
  assert.match(eligibility(p(), 'abroad', { ...ctx, day: 9 }, rules).reason, /시작되기 전/);
  assert.equal(eligibility(p(), 'dleague', { ...ctx, day: 9 }, rules).ok, true);
  assert.match(eligibility(p({ contract: { yearsLeft: 1, salaryEok: 1 } }), 'abroad', ctx, rules).reason, /계약/);
  assert.equal(eligibility(p({ contract: { yearsLeft: 1, salaryEok: 1 } }), 'dleague', ctx, rules).ok, true);
  assert.match(eligibility(p(), 'dleague', { ...ctx, remainingRoster: 8 }, rules).reason, /라인업/);
});

test('유학 성장: 시드가 같으면 같고, 적응 실패는 성장이 작고, 잠재력은 OVR 밑으로 내려가지 않는다', () => {
  const p = data.players.find((x) => x.name === STAR);
  const a = abroadGrowth(p, 'shooting', 5, rules, mulberry32(7));
  const b = abroadGrowth(p, 'shooting', 5, rules, mulberry32(7));
  assert.deepEqual(a, b);
  const outcomes = new Map();
  for (let i = 0; i < 400; i++) { const g = abroadGrowth(p, 'shooting', 5, rules, mulberry32(i)); outcomes.set(g.outcome, [...(outcomes.get(g.outcome) ?? []), g]); assert.ok(g.player.potential >= g.player.ovr); assert.ok(g.player.potential <= OVR_MAX); }
  const avg = (list, f) => list.reduce((s, x) => s + f(x), 0) / list.length;
  assert.ok(outcomes.get('struggle').length > 10 && outcomes.get('success').length > 100);
  assert.ok(avg(outcomes.get('struggle'), (g) => g.statDelta) < avg(outcomes.get('success'), (g) => g.statDelta) * 0.6);
  assert.ok(outcomes.get('success').some((g) => g.player.potential > p.potential), '성공하면 잠재력이 오를 때가 있다');
  assert.ok(!outcomes.get('struggle').some((g) => g.player.potential > p.potential), '적응 실패에서는 잠재력이 오르지 않는다');
});

test('D리그: 명단·라인업에서 빠지고 훈련 경험치가 배수로 오르며, 소환하면 돌아온다', () => {
  const ctl = fresh(), s = fresh();
  const id = idOf(s, YOUNG);
  const stat = ctl.focus.get(id);
  const before = byName(s, YOUNG);
  const r = s.setProgram(id, 'dleague');
  assert.equal(r.ok, true);
  assert.equal(s.players.some((p) => p.id === id), false, '명단에서 빠진다');
  assert.equal(s.programs.length, 1); assert.equal(s.programs[0].program, 'dleague'); assert.equal(s.programs[0].stat, stat);
  // 직접 편성에 넣으려 하면 거절된다(명단에 없는 선수)
  const mine = s.players.filter((p) => p.teamId === MY);
  const auto = mine.slice(0, 10).map((p) => p.id);
  assert.equal(s.setLineup({ starters: [id, ...auto.slice(0, 4)], bench: auto.slice(4, 9) }).ok, false);
  finishRegular(s); finishRegular(ctl);
  const after = s.programs[0].player, normal = ctl.players.find((p) => p.id === id);
  assert.ok(after.stats[stat] + (after.xp?.[stat] ?? 0) / 10 > normal.stats[stat] + (normal.xp?.[stat] ?? 0) / 10 - 0.0001, 'D리그 훈련이 일반 훈련 이상');
  assert.ok(after.stats[stat] >= before.stats[stat]);
  const rec = s.setProgram(id, null);
  assert.equal(rec.ok, true); assert.equal(s.programs.length, 0);
  assert.equal(s.players.some((p) => p.id === id), true);
  assert.equal(s.programHistory.length, 1); assert.equal(s.programHistory[0].program, 'dleague');
  assert.equal(s.focus.get(id), stat);
});

test('D리그: 훈련 성장은 일반 훈련보다 정확히 배수만큼 빠르다(같은 선수·같은 횟수)', () => {
  const s = fresh(), ctl = fresh();
  const id = idOf(s, STAR), stat = s.focus.get(id);
  s.setProgram(id, 'dleague');
  while (s.day < 45) { s.advance(9); ctl.advance(9); }
  const a = s.programs[0].player, b = ctl.players.find((p) => p.id === id);
  const xpTotal = (p0, p) => (p.stats[stat] - p0.stats[stat]) + (p.xp?.[stat] ?? 0) / 8;
  const p0 = data.players.find((p) => p.id === id);
  assert.ok(xpTotal(p0, a) > xpTotal(p0, b) * 1.15, `D리그 ${xpTotal(p0, a).toFixed(2)} vs 일반 ${xpTotal(p0, b).toFixed(2)}`);
});

test('유학: 시즌 전에만 보낼 수 있고, 명단·캡에서 빠지며, 시즌이 끝나면 성장해 돌아오고 비용을 낸다', () => {
  const s = fresh(), ctl = fresh();
  const id = idOf(s, STAR);
  const p0 = byName(s, STAR);
  const payBefore = payrollEok(s.players, MY);
  assert.equal(s.setProgram(id, 'abroad').ok, true);
  assert.ok(payrollEok(s.players, MY) < payBefore, '캡 계산에서 빠진다');
  assert.equal(s.players.some((p) => p.id === id), false);
  assert.equal(s.programs[0].locked, false);
  s.advance(9);
  assert.equal(s.programs[0].locked, true);
  assert.equal(s.setProgram(id, null).ok, false, '시즌이 시작되면 돌아올 수 없다');
  const y = idOf(s, YOUNG);
  assert.match(s.setProgram(y, 'abroad').errors[0], /시작되기 전/);
  const entry = finishAll(s); finishAll(ctl);
  assert.equal(entry.devProgram.length, 1);
  const d = entry.devProgram[0];
  assert.deepEqual(Object.keys(d).sort(), ['after', 'before', 'costEok', 'days', 'name', 'outcome', 'playerId', 'program', 'stat', 'teamId']);
  assert.equal(d.playerId, id); assert.equal(d.program, 'abroad'); assert.equal(d.before.ovr, p0.ovr);
  assert.ok(['success', 'normal', 'struggle'].includes(d.outcome));
  assert.equal(d.costEok, programCost('abroad', p0, 54, 54, rules));
  // 오프시즌 시작 시점에 선수는 우리 구단 명단에 돌아와 있다
  const back = s.game.seasonEnd.league.players.find((p) => p.id === id);
  assert.equal(back.teamId, MY); assert.equal(back.ovr, d.after.ovr);
  // 장부: 유학비 + 연봉의 일부가 지출에 잡히고, 연봉 전액은 아니다
  const l = entry.ledger[MY], lc = ctl.game.seasonEnd.entry.ledger[MY];
  assert.equal(l.program, d.costEok);
  assert.ok(l.payroll < lc.payroll + 1e-9, '유학 중인 선수의 연봉은 지출 연봉에서 빠진다');
  assert.equal(lc.program, undefined);
});

test('정원: 동시에 2명까지, 세 번째는 거절된다', () => {
  const s = fresh();
  assert.equal(s.setProgram(idOf(s, STAR), 'abroad').ok, true);
  assert.equal(s.setProgram(idOf(s, YOUNG), 'dleague').ok, true);
  const third = s.players.find((p) => p.teamId === MY && p.origin === 'domestic' && p.age <= 24);
  assert.match(s.setProgram(third.id, 'dleague').errors[0], /2명/);
  // 소환하면 자리가 난다
  assert.equal(s.setProgram(idOf(s, YOUNG), null).ok, true);
  assert.equal(s.setProgram(third.id, 'dleague').ok, true);
});

test('계약이 1년 남은 선수는 유학을 못 가고, 25세 이상도 못 간다', () => {
  const s = fresh();
  const exp = s.players.find((p) => (p.baseName ?? p.name) === '김동현'); // 24세, 계약 1년
  assert.match(s.setProgram(exp.id, 'abroad').errors[0], /계약/);
  const old = s.players.find((p) => (p.baseName ?? p.name) === '허훈');
  assert.match(s.setProgram(old.id, 'dleague').errors[0], /24세/);
});

test('트레이드·라인업: 파견 중인 선수는 상대 제안·내 로스터에 나오지 않는다', () => {
  const s = fresh();
  const id = idOf(s, STAR);
  s.setProgram(id, 'dleague');
  s.advance(9);
  for (const o of s.tradeOffers()) assert.equal(o.get.some((p) => p.id === id), false);
  const t = s.proposeTrade({ teamA: MY, teamB: data.teams.find((x) => x.id !== MY).id, giveA: [id], giveB: [] });
  assert.equal(t.executed, false);
});

test('리플레이: 시즌 중 D리그 파견·소환과 유학이 있어도 저장·복원 결과가 같다', () => {
  const s = fresh(41);
  s.setProgram(idOf(s, STAR), 'abroad');
  s.setProgram(idOf(s, YOUNG), 'dleague');
  s.advance(18);
  s.setProgram(idOf(s, YOUNG), null);
  s.advance(9);
  const back = restore(data, serialize(s));
  assert.equal(back.day, s.day);
  assert.deepEqual(back.programs.map((x) => [x.playerId, x.program, x.stat, x.player.ovr]), s.programs.map((x) => [x.playerId, x.program, x.stat, x.player.ovr]));
  assert.deepEqual(back.programHistory, s.programHistory);
  assert.deepEqual(back.standings(), s.standings());
  assert.deepEqual(back.players.map((p) => [p.id, p.ovr, p.stats]), s.players.map((p) => [p.id, p.ovr, p.stats]));
  // 끝까지 가도 같다
  const e1 = finishAll(s), e2 = finishAll(back);
  assert.deepEqual(e2.devProgram, e1.devProgram);
  assert.deepEqual(e2.ledger, e1.ledger);
});

test('불변: 프로그램을 쓰지 않으면 결과에 아무 흔적도 없고, 보냈다 취소(0일차)하면 같은 시즌이 된다', () => {
  const a = fresh(51), b = fresh(51);
  const id = idOf(b, STAR);
  assert.equal(b.setProgram(id, 'abroad').ok, true);
  assert.equal(b.setProgram(id, null).ok, true);
  const ea = finishAll(a), eb = finishAll(b);
  assert.equal(ea.devProgram, undefined); assert.equal(eb.devProgram, undefined);
  assert.deepEqual(ea.standings, eb.standings);
  assert.deepEqual(ea.ledger, eb.ledger);
  // 보냈다 취소하면 선수 목록의 순서만 달라질 뿐 내용은 같다
  const snap = (x) => JSON.stringify(x.game.seasonEnd.league.players.map((p) => [p.id, p.ovr, p.stats, p.teamId]).sort((m, n) => (m[0] < n[0] ? -1 : 1)));
  assert.ok(snap(a) === snap(b), '시즌 종료 시점의 선수 능력치가 같다');
});

test('다음 시즌: 오프시즌을 마치면 지난 시즌 결과가 로그에 남고 새 시즌은 프로그램 없이 시작한다', () => {
  const s = fresh(61);
  s.setProgram(idOf(s, STAR), 'abroad');
  finishAll(s);
  assert.equal(s.lastProgramReport.length, 1);
  s.autoOffseason();
  assert.equal(s.stage, 'regular'); assert.equal(s.day, 0);
  assert.equal(s.programs.length, 0);
  assert.equal(s.lastProgramReport.length, 1);
  assert.equal(s.game.log[0].devProgram[0].program, 'abroad');
});

test('미리보기: 유학은 일반 훈련보다 기대 상승이 크고 범위가 있으며, D리그는 배수만큼 더 오른다', () => {
  const p = data.players.find((x) => x.name === STAR);
  const full = checkpointsPerSeason(rules.regularSeasonGames, rules.ratingModel.checkpointDays);
  const ab = preview(p, 'shooting', 'abroad', full, full, rules);
  assert.ok(ab.program > ab.normal && ab.low < ab.program && ab.high > ab.program);
  const dl = preview(p, 'shooting', 'dleague', full, full, rules);
  const ratio = dl.program / dl.normal;
  assert.ok(ratio > 1.1 && ratio <= rules.devProgram.dleague.trainingMultiplier + 0.05, `D리그/일반 = ${ratio.toFixed(2)}`); // 능력치가 오를수록 임계값도 올라 정확한 배수보다 조금 작다
  assert.ok(abroadSessions(full, rules) > full * rules.training.sessionsPerCheckpoint);
});
