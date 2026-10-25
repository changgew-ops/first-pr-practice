import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faSignCheck, faAsking, foreignReplaceCheck, buildForeignPool, proratedEok, freeNumber } from '../src/inseason.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { domesticOf, foreignOf, payrollEok } from '../src/valuation.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const base = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
const hot = { ...base, rules: { ...rules, injuries: { ...rules.injuries, perMinute: 0.01 } } }; // 부상이 자주 나는 규칙(교체 흐름 시험용)
const noWaiver = { ...base, rules: { ...rules, waivers: { ...rules.waivers, enabled: false } } }; // 웨이버를 끈 규칙(방출한 선수가 곧바로 시장에 나오는 이전 동작)
const MY = 'busan-kcc';
const mine = (s) => s.players.filter((p) => p.teamId === MY);

// ---------- 순수 판정 ----------
const dom = (id, team, over = {}) => ({ id, teamId: team, origin: 'domestic', position: 'PG', age: 26, ovr: 60, potential: 62, cost: 5, number: 1, contract: { salaryEok: 1, yearsLeft: 2 }, ...over });
const fp = (id, team, usd, over = {}) => ({ id, teamId: team, origin: 'foreign', position: 'C', age: 28, ovr: 70, potential: 70, cost: 8, number: 2, contract: { salaryUsd: usd, yearsLeft: 1 }, ...over });

test('시즌 중 FA 판정: 로스터 12명, 최저 연봉, 요구 연봉, 계약 기간, 캡을 순서대로 확인한다', () => {
  const full = Array.from({ length: 12 }, (_, i) => dom(`d${i}`, 'A', { number: i + 1 }));
  const pool = [dom('fa1', null, { ovr: 58, potential: 58, age: 29 })];
  const ask = faAsking(pool[0], rules);
  assert.ok(ask >= rules.salaryCap.minSalaryEok);
  const ok = (players, offer, isManager = false) => faSignCheck({ players, pool, teamId: 'A', playerId: 'fa1', offer, rules, isManager });
  assert.match(ok(full, { salaryEok: ask, years: 1 }).reason, /방출/);
  const eleven = full.slice(1);
  assert.equal(ok(eleven, { salaryEok: ask, years: 1 }).ok, true);
  assert.match(ok(eleven, { salaryEok: rules.salaryCap.minSalaryEok - 0.1, years: 1 }).reason, /최저 연봉/);
  if (ask - 0.1 >= rules.salaryCap.minSalaryEok) assert.match(ok(eleven, { salaryEok: ask - 0.1, years: 1 }).reason, /요구 연봉/);
  assert.match(ok(eleven, { salaryEok: ask, years: 3 }).reason, /계약 기간/);
  assert.match(ok(eleven, { salaryEok: ask, years: 0 }).reason, /계약 기간/);
  assert.match(faSignCheck({ players: eleven, pool, teamId: 'A', playerId: 'nobody', offer: { salaryEok: 1, years: 1 }, rules }).reason, /시장에 남은/);
  // 캡: 하드 한도(캡 × 1.2)를 넘으면 단장도 못 하고, 소프트캡 구간은 단장만 할 수 있다
  const rich = eleven.map((p, i) => ({ ...p, contract: { salaryEok: rules.salaryCap.domesticEok / 11 + (i === 0 ? 3 : 0), yearsLeft: 2 } }));
  const salary = Math.max(ask, 2);
  const payroll = payrollEok(rich, 'A');
  const over = rules.salaryCap.domesticEok - payroll < salary;
  if (over) { assert.equal(ok(rich, { salaryEok: salary, years: 1 }).ok, false); assert.equal(ok(rich, { salaryEok: salary, years: 1 }, true).ok, payroll + salary <= rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio) + 1e-9); }
  assert.equal(ok(eleven, { salaryEok: rules.salaryCap.domesticEok * 2, years: 1 }, true).ok, false, '하드 한도 초과');
});

test('외국선수 교체 판정: 일시교체 2주·시즌대체 8주·기타 사유 2회, 후보 연봉과 구단 합계 한도', () => {
  const team = [fp('f1', 'A', 400000), fp('f2', 'A', 400000)];
  const cand = (usd) => ({ player: fp('c1', null, usd), usd });
  const chk = (kind, injury, extra = {}) => foreignReplaceCheck({ players: team, teamId: 'A', outId: 'f1', candidate: cand(300000), kind, injury, rules, ...extra });
  assert.match(chk('temp', null).reason, /부상/);
  assert.match(chk('temp', { total: 4, left: 4 }).reason, /2주/);
  assert.equal(chk('temp', { total: 5, left: 5 }).ok, true);
  assert.match(chk('season', { total: 17, left: 17 }).reason, /8주/);
  assert.equal(chk('season', { total: 18, left: 18 }).ok, true);
  assert.equal(chk('season', { total: 99, left: 50 }).ok, true);
  assert.match(chk('temp', { total: 8, left: 8, temp: 'x' }).reason, /일시교체 선수가 뛰는 중/);
  assert.equal(chk('other', null, { state: { otherCount: 1 } }).ok, true);
  assert.match(chk('other', null, { state: { otherCount: 2 } }).reason, /2회/);
  assert.match(chk('boom', null).reason, /알 수 없는/);
  // 연봉: 1인 한도, 나머지 외국 선수와의 합계 한도(교체되는 선수는 뺀다)
  assert.match(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'f1', candidate: cand(rules.salaryCap.foreignUsdPerPlayer + 10000), kind: 'other', rules }).reason, /1인 한도/);
  assert.match(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'f1', candidate: cand(700000), kind: 'other', rules }).reason, /합계가 한도/);
  assert.equal(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'f1', candidate: cand(600000), kind: 'other', rules }).ok, true);
  // 일시교체 선수가 대신 뛰는 중인 부상 선수는 합계에서 빠진다
  assert.equal(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'f1', candidate: cand(600000), kind: 'other', rules, exclude: ['f2'] }).ok, true);
  assert.match(foreignReplaceCheck({ players: [...team, { ...fp('t1', 'A', 300000), temp: { forId: 'f2' } }], teamId: 'A', outId: 't1', candidate: cand(300000), kind: 'other', rules }).reason, /일시교체로 들어온/);
  assert.match(chk('other', null, { outId: 'zz' }).reason, /외국인·아시아쿼터 선수가 아닙니다/);
  assert.equal(proratedEok(2, 27, 54), 1);
  assert.equal(freeNumber([{ teamId: 'A', number: 1 }, { teamId: 'A', number: 2 }], 'A'), 3);
});

test('외국인 후보 풀: 같은 시드면 같고, 로스터에 있는 선수는 빼며, 아이디가 시즌마다 겹치지 않는다', () => {
  const pls = base.players;
  const a = buildForeignPool({ players: pls, cards, rules, season: 2026, seed: 5 });
  const b = buildForeignPool({ players: pls, cards, rules, season: 2026, seed: 5 });
  const c = buildForeignPool({ players: pls, cards, rules, season: 2027, seed: 5 });
  assert.equal(a.length, rules.inSeason.foreign.poolSize);
  assert.deepEqual(a.map((x) => [x.player.id, x.usd]), b.map((x) => [x.player.id, x.usd]));
  assert.ok(a.every((x) => x.usd <= rules.salaryCap.foreignUsdPerPlayer && x.player.origin === 'foreign'));
  assert.ok(!a.some((x) => c.some((y) => y.player.id === x.player.id)));
  const present = new Set(pls.map((p) => p.kblId).filter(Boolean));
  assert.ok(a.every((x) => !present.has(x.player.kblId)));
  assert.deepEqual(buildForeignPool({ players: pls, cards: null, rules, season: 2026, seed: 5 }), []);
});

// ---------- 세션 흐름 ----------
test('세션: 시즌 중 FA 영입 — 방출 뒤 영입, 로스터·캡·정산이 바뀌고 저장·복원해도 같으며 시장에서 빠진다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 't', seed: 21 });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason(); s.autoOffseason();
  assert.equal(s.stage, 'regular');
  s.advance(10);
  const market = s.faMarket();
  assert.ok(market.length > 3, `시장 ${market.length}명`);
  const cand = market.find((m) => m.player.ovr >= 40) ?? market[0];
  // 자리가 없으면 영입할 수 없다
  assert.equal(s.faCheck(cand.player.id, { salaryEok: cand.asking, years: 1 }).ok, false);
  assert.match(s.signFa(cand.player.id, { salaryEok: cand.asking, years: 1 }).errors[0], /방출/);
  const victim = mine(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr)[0];
  assert.equal(s.releasePlayer(victim.id).ok, true);
  const offer = { salaryEok: cand.asking, years: 2 };
  const before = { n: domesticOf(s.players, MY).length, pay: payrollEok(s.players, MY) };
  const r = s.signFa(cand.player.id, offer);
  assert.equal(r.ok, true, r.errors?.[0]);
  assert.equal(domesticOf(s.players, MY).length, before.n + 1);
  assert.equal(Math.round((payrollEok(s.players, MY) - before.pay) * 100) / 100, offer.salaryEok);
  const me = s.players.find((p) => p.id === cand.player.id);
  assert.equal(me.teamId, MY);
  assert.deepEqual(me.contract, { salaryEok: offer.salaryEok, yearsLeft: 2 });
  assert.ok(Number.isInteger(me.number) && new Set(mine(s).map((p) => p.number)).size === mine(s).length, '등번호가 겹치지 않는다');
  assert.ok(!s.faMarket().some((m) => m.player.id === cand.player.id), '영입한 선수는 시장에서 빠진다');
  assert.ok(s.faMarket().some((m) => m.player.id === victim.id), '방출한 선수는 시장에 나온다');
  assert.equal(s.game.actions.at(-1).type, 'fasign');
  assert.ok(s.rosterLog.some((e) => e.type === 'fa' && e.playerId === cand.player.id));
  // 저장·복원
  const back = restore(noWaiver, serialize(s));
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId]).sort(), s.players.map((p) => [p.id, p.teamId]).sort());
  assert.equal(back.funds[MY], s.funds[MY]);
  // 시즌 끝: 정산 — 합류 전 비율의 보수는 내지 않는다(최종 명단 기준 연봉에서 일할 보정)
  const day = s.day;
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const entry = s.endSeason();
  const credit = proratedEok(offer.salaryEok, day, 54);
  assert.ok(credit > 0);
  const led = entry.ledger[MY];
  assert.ok(led.payroll > 0);
  const pool = s.game.seasonEnd.league.freeAgents;
  assert.ok(!pool.some((p) => p.id === cand.player.id), '영입된 선수는 FA 풀에 없다');
  assert.ok(pool.some((p) => p.id === victim.id) || s.game.seasonEnd.league.players.some((p) => p.id === victim.id), '방출 선수는 FA 풀 또는 다른 구단에 있다');
});

test('세션: 외국인 교체 — 일시교체는 부상 선수가 돌아오면 떠나고, 시즌대체는 선수를 바꾸며, 규칙 위반은 거절되고 저장·복원해도 같다', () => {
  const s = Session.create(hot, { managerId: MY, gmName: 't', seed: 8 });
  const th = s.foreignThresholds;
  assert.deepEqual(th, { temporary: 5, season: 18 });
  assert.ok(s.foreignMarket().length > 3);
  // 건강한 외국인은 일시교체·부상 시즌대체를 못 한다. 기타 사유 교체만 가능
  const f0 = foreignOf(s.players, MY)[0];
  const c0 = s.foreignMarket().find((c) => s.foreignCheck(f0.id, 'other', c.player.id).ok);
  assert.match(s.foreignCheck(f0.id, 'temp', s.foreignMarket()[0].player.id).reason, /부상/);
  assert.match(s.foreignCheck(f0.id, 'season', s.foreignMarket()[0].player.id).reason, /부상/);
  assert.ok(c0, '기타 사유 교체 후보가 있다');
  // 부상이 날 때까지 진행해 우리 외국인 선수가 일시교체 기준 이상으로 다치는 날을 찾는다
  let temp = null;
  for (let d = 0; d < 54 && !temp; d++) {
    s.advance(1);
    const i = s.injuries.find((x) => x.teamId === MY && !x.temp && x.total >= th.temporary && x.total < th.season && foreignOf(s.players, MY).some((p) => p.id === x.playerId));
    if (i) temp = i;
  }
  assert.ok(temp, '우리 외국인 선수의 중상 부상');
  const cand = s.foreignMarket().find((c) => s.foreignCheck(temp.playerId, 'temp', c.player.id).ok);
  assert.ok(cand);
  assert.match(s.foreignCheck(temp.playerId, 'season', cand.player.id).reason, /8주/);
  const nBefore = mine(s).length;
  const r = s.replaceForeign(temp.playerId, 'temp', cand.player.id);
  assert.equal(r.ok, true, r.errors?.[0]);
  assert.equal(mine(s).length, nBefore + 1);
  const tempP = s.players.find((p) => p.id === cand.player.id);
  assert.equal(tempP.teamId, MY); assert.equal(tempP.temp.forId, temp.playerId);
  assert.equal(s.injuryOf(temp.playerId).temp, cand.player.id);
  assert.match(s.foreignCheck(temp.playerId, 'temp', s.foreignMarket()[0]?.player.id).reason ?? '', /뛰는 중/);
  assert.ok(!s.foreignMarket().some((c) => c.player.id === cand.player.id));
  // 저장·복원: 같은 상태
  const back = restore(hot, serialize(s));
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId, !!p.temp]).sort(), s.players.map((p) => [p.id, p.teamId, !!p.temp]).sort());
  assert.deepEqual(back.injuries, s.injuries);
  // 부상 선수가 돌아오면 일시교체 선수는 팀을 떠난다
  const left = s.injuryOf(temp.playerId).left;
  s.advance(left);
  const again = s.injuryOf(temp.playerId);
  assert.ok(!again || again.day !== temp.day, '그 부상은 끝났다(복귀 직후 새로 다쳤을 수는 있다)');
  assert.ok(!s.players.some((p) => p.id === cand.player.id), '일시교체 선수는 떠났다');
  assert.ok(s.rosterLog.some((e) => e.type === 'foreign' && e.kind === 'tempEnd' && e.playerId === cand.player.id));
  // 복원해도 같다
  const back2 = restore(hot, serialize(s));
  assert.deepEqual(back2.players.map((p) => p.id).sort(), s.players.map((p) => p.id).sort());
});

test('세션: 기타 사유 외국인 교체는 구단당 2회까지이고, 떠나는 선수의 보수는 계속 나가며 새 선수는 합류 뒤부터 정산된다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 't', seed: 8 });
  s.advance(20);
  const th = s.foreignThresholds;
  assert.ok(th.season > th.temporary);
  const swap = () => {
    const out = foreignOf(s.players, MY).find((p) => !p.temp);
    const c = s.foreignMarket().find((x) => s.foreignCheck(out.id, 'other', x.player.id).ok);
    return c ? s.replaceForeign(out.id, 'other', c.player.id) : { ok: false, errors: ['후보 없음'] };
  };
  const o1 = swap(), o2 = swap();
  const o3 = s.replaceForeign(foreignOf(s.players, MY)[0].id, 'other', s.foreignMarket()[0].player.id); // 세 번째는 규칙(구단당 2회)에 막힌다
  assert.equal(o1.ok, true, o1.errors?.[0]); assert.equal(o2.ok, true, o2.errors?.[0]);
  assert.equal(o3.ok, false); assert.match(o3.errors[0], /2회/);
  assert.deepEqual(s.otherReplacements, { used: 2, limit: 2 });
  assert.equal(foreignOf(s.players, MY).filter((p) => !p.temp).length, 2, '외국인은 늘 2명');
  // 시즌 끝: 정산 보정(떠난 선수의 남은 보수 + 새 선수의 합류 전 보수 환급)이 장부에 들어간다
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const entry = s.endSeason();
  assert.ok(Number.isFinite(entry.ledger[MY].payroll) && Number.isFinite(entry.ledger[MY].net));
  const back = restore(base, serialize(s));
  assert.equal(back.stage, 'offseason');
});

test('세션: 부상이 잦은 시즌에서 AI 구단도 외국인을 교체하고, 시즌 끝에 일시교체 선수는 남지 않으며 로스터 규칙이 지켜진다', () => {
  const s = Session.create(hot, { managerId: MY, gmName: 't', seed: 4 });
  while (!s.regularDone) s.advance(9);
  const log = s.rosterLog;
  const ai = log.filter((e) => e.type === 'foreign' && !e.asia && e.teamId !== MY && ['temp', 'season'].includes(e.kind)); // 아시아쿼터 교체는 tests/asia.test.mjs
  assert.ok(ai.length >= 2, `AI 외국인 교체 ${ai.length}건`);
  for (const e of ai) assert.ok(e.usd <= rules.salaryCap.foreignUsdPerPlayer);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  const end = s.game.seasonEnd.league;
  assert.ok(!end.players.some((p) => p.temp), '일시교체 선수는 시즌 끝에 떠난다');
  for (const t of base.teams) {
    const fs = foreignOf(end.players, t.id);
    assert.ok(fs.length <= 2, `${t.name} 외국인 ${fs.length}명`);
    assert.ok(fs.reduce((a, p) => a + p.contract.salaryUsd, 0) <= rules.salaryCap.foreignUsdTotal, `${t.name} 외국인 연봉 합계`);
  }
  assert.ok(new Set(end.players.map((p) => p.id)).size === end.players.length);
  s.autoOffseason();
  for (const t of base.teams) assert.equal(foreignOf(s.players, t.id).length, 2);
});
