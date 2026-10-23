// 아시아쿼터 선수의 일시교체·시즌대체·기타 사유 교체(외국인과 같은 구조). 규정에는 아시아쿼터 교체 조항이 없어서 사용자 지시("아쿼도 용병과 같이")를 따르는 게임용 가정이다(rules.inSeason.asia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foreignReplaceCheck, buildAsiaPool, buildForeignPool, asiaPriceEok } from '../src/inseason.mjs';
import { foreignGameThresholds } from '../src/injuries.mjs';
import { releaseCheck } from '../src/contracts.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { asiaOf, foreignOf } from '../src/valuation.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const teams = read('teams.json'), allPlayers = read('players.json');
const base = { rules, teams, players: allPlayers, history: loadHistory(), profiles: read('players/profiles.json'), cards };
const hot = { ...base, rules: { ...rules, injuries: { ...rules.injuries, perMinute: 0.03 } } }; // AI 교체가 많이 나오는 규칙
const warm = { ...base, rules: { ...rules, injuries: { ...rules.injuries, perMinute: 0.01 } } }; // 후보 풀이 금방 바닥나지 않는 규칙(우리 구단 교체 흐름 시험용)
const MY = allPlayers.find((p) => p.origin === 'asia').teamId; // 아시아쿼터 선수가 있는 구단

const ap = (id, team, eok, over = {}) => ({ id, teamId: team, origin: 'asia', position: 'SG', age: 26, ovr: 66, potential: 66, cost: 6, number: 3, contract: { salaryEok: eok, yearsLeft: 1 }, ...over });
const cand = (eok, over = {}) => ({ player: ap('c1', null, eok, over), eok });
const fcand = (usd) => ({ player: { id: 'fc', origin: 'foreign', ovr: 70 }, usd });

test('규칙값: inSeason.asia는 외국인 값을 옮긴 게임용 가정이고, _note가 규정이 아님을 밝힌다', () => {
  const a = rules.inSeason.asia, f = rules.inSeason.foreign;
  assert.match(a._note, /규정에 있는 내용이 아니다/);
  for (const k of ['temporaryMinWeeks', 'seasonMinWeeks', 'otherReasonLimit', 'contractYears']) assert.equal(a[k], f[k], k);
  assert.deepEqual(foreignGameThresholds(rules, 'asia'), foreignGameThresholds(rules));
  assert.deepEqual(foreignGameThresholds(rules, 'asia'), { temporary: 5, season: 18 });
});

test('아시아쿼터 교체 판정: 일시교체 2주·시즌대체 8주·기타 사유 2회, 연봉 상한·슬롯, 외국인과 섞이지 않는다', () => {
  const team = [ap('a1', 'A', 1.5)];
  const chk = (kind, injury, extra = {}) => foreignReplaceCheck({ players: team, teamId: 'A', outId: 'a1', candidate: cand(1.2), kind, injury, rules, ...extra });
  assert.match(chk('temp', null).reason, /부상/);
  assert.match(chk('temp', { total: 4, left: 3, temp: null }).reason, /2주/);
  assert.equal(chk('temp', { total: 5, left: 5, temp: null }).ok, true);
  assert.match(chk('season', { total: 17, left: 10, temp: null }).reason, /8주/);
  assert.equal(chk('season', { total: 18, left: 18, temp: null }).ok, true);
  assert.equal(chk('season', { total: 99, left: 99, temp: null }).ok, true);
  // 기타 사유: 외국인과 별개로 구단당 2회 — 아시아쿼터 쪽 횟수만 본다(규정이 아니라 게임용 가정이라는 문구가 붙는다)
  assert.equal(chk('other', null, { state: { otherCount: 1 } }).ok, true);
  const third = chk('other', null, { state: { otherCount: 2 } });
  assert.equal(third.ok, false); assert.match(third.reason, /2회/); assert.match(third.reason, /게임용 가정/);
  // 연봉 상한(아시아쿼터 연봉 범위의 상한)과 구단 슬롯
  const max = rules.asiaQuota.salaryEok[1];
  assert.match(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'a1', candidate: cand(max + 0.1), kind: 'other', rules }).reason, /연봉 상한/);
  assert.equal(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'a1', candidate: cand(max), kind: 'other', rules }).ok, true);
  const two = [ap('a1', 'A', 1.5), ap('a2', 'A', 1.5)];
  assert.match(foreignReplaceCheck({ players: two, teamId: 'A', outId: 'a1', candidate: cand(1.2), kind: 'other', rules }).reason, /구단당 1명/);
  assert.equal(foreignReplaceCheck({ players: two, teamId: 'A', outId: 'a1', candidate: cand(1.2), kind: 'other', rules, exclude: ['a2'] }).ok, true, '일시교체로 비운 선수는 슬롯에서 뺀다');
  // 외국인 후보로 아시아쿼터를 교체하거나 그 반대는 안 된다
  assert.match(foreignReplaceCheck({ players: team, teamId: 'A', outId: 'a1', candidate: fcand(300000), kind: 'other', rules }).reason, /같은 신분/);
  const f1 = { id: 'f1', teamId: 'A', origin: 'foreign', contract: { salaryUsd: 400000, yearsLeft: 1 } };
  assert.match(foreignReplaceCheck({ players: [f1], teamId: 'A', outId: 'f1', candidate: cand(1.2), kind: 'other', rules }).reason, /같은 신분/);
  // 일시교체로 들어온 선수는 다시 교체할 수 없다
  assert.match(foreignReplaceCheck({ players: [...team, ap('t1', 'A', 1.2, { temp: { forId: 'a1' } })], teamId: 'A', outId: 't1', candidate: cand(1.2), kind: 'other', rules }).reason, /일시교체로 들어온/);
});

test('아시아쿼터 후보 풀: 카드 시장의 kind a만, 외국인 풀과 겹치지 않고, 같은 시드는 같고, 요구 연봉은 범위 안', () => {
  const pls = allPlayers;
  const a = buildAsiaPool({ players: pls, cards, rules, season: 2026, seed: 5 });
  const b = buildAsiaPool({ players: pls, cards, rules, season: 2026, seed: 5 });
  const f = buildForeignPool({ players: pls, cards, rules, season: 2026, seed: 5 });
  assert.equal(a.length, rules.inSeason.asia.poolSize);
  assert.deepEqual(a.map((x) => x.player.id), b.map((x) => x.player.id));
  assert.ok(a.every((x) => x.player.origin === 'asia' && x.eok >= rules.asiaQuota.salaryEok[0] && x.eok <= rules.asiaQuota.salaryEok[1]));
  assert.ok(f.every((x) => x.player.origin === 'foreign'), '외국인 풀에 아시아쿼터 카드가 섞이지 않는다');
  const kbl = new Set(a.map((x) => x.player.kblId));
  assert.ok(!f.some((x) => kbl.has(x.player.kblId)));
  const present = new Set(pls.map((p) => p.kblId).filter(Boolean));
  assert.ok(a.every((x) => !present.has(x.player.kblId)), '이미 리그에 있는 선수는 후보가 아니다');
  assert.deepEqual(buildAsiaPool({ players: pls, cards: null, rules, season: 2026, seed: 5 }), []);
  // 가격: OVR이 높을수록 비싸다
  assert.equal(asiaPriceEok(rules.inSeason.asia.priceOvrLow, rules), rules.asiaQuota.salaryEok[0]);
  assert.equal(asiaPriceEok(rules.inSeason.asia.priceOvrHigh + 10, rules), rules.asiaQuota.salaryEok[1]);
  assert.ok(asiaPriceEok(68, rules) > asiaPriceEok(62, rules));
});

test('방출: 아시아쿼터 선수는 외국인처럼 방출할 수 없고, 교체 패널로 안내한다', () => {
  const asia = asiaOf(allPlayers, MY)[0];
  const r = releaseCheck({ players: allPlayers, teamId: MY, playerId: asia.id, phase: 'season', rules });
  assert.equal(r.ok, false);
  assert.match(r.reason, /교체/); assert.match(r.reason, /게임용 가정/);
});

test('세션: 아시아쿼터 선수가 다치면 일시교체 → 복귀 때 떠나고, 외국인 횟수·후보 풀과 따로이며, 저장·복원해도 같다', () => {
  const s = Session.create(warm, { managerId: MY, gmName: 't', seed: 8 });
  assert.deepEqual(s.asiaThresholds, { temporary: 5, season: 18 });
  assert.ok(s.asiaMarket().length > 0);
  assert.ok(s.asiaMarket().every((c) => c.player.origin === 'asia'));
  assert.ok(s.foreignMarket().every((c) => c.player.origin === 'foreign'));
  const a0 = asiaOf(s.players, MY)[0];
  const m0 = s.asiaMarket()[0];
  assert.match(s.foreignCheck(a0.id, 'temp', m0.player.id).reason, /부상/);
  // 우리 아시아쿼터 선수가 일시교체 기준 이상으로 다치는 날까지 진행
  let inj = null;
  for (let d = 0; d < 54 && !inj; d++) {
    s.advance(1);
    inj = s.injuries.find((x) => x.teamId === MY && !x.temp && x.total >= s.asiaThresholds.temporary && asiaOf(s.players, MY).some((p) => p.id === x.playerId)) ?? null;
  }
  assert.ok(inj, '우리 아시아쿼터 선수의 2주 이상 부상');
  const c = s.asiaMarket().find((x) => s.foreignCheck(inj.playerId, 'temp', x.player.id).ok);
  assert.ok(c);
  if (inj.total < s.asiaThresholds.season) assert.match(s.foreignCheck(inj.playerId, 'season', c.player.id).reason, /8주/);
  else assert.equal(s.foreignCheck(inj.playerId, 'season', c.player.id).ok, true, '8주 이상이면 시즌대체도 가능');
  // 외국인 후보를 아시아쿼터 교체에 쓰면 거절
  const fc = s.foreignMarket()[0];
  assert.match(s.foreignCheck(inj.playerId, 'temp', fc.player.id).reason ?? '', /같은 신분|후보/);
  const before = s.players.filter((p) => p.teamId === MY).length;
  const r = s.replaceForeign(inj.playerId, 'temp', c.player.id);
  assert.equal(r.ok, true, r.errors?.[0]);
  assert.equal(s.players.filter((p) => p.teamId === MY).length, before + 1);
  const tempP = s.players.find((p) => p.id === c.player.id);
  assert.equal(tempP.origin, 'asia'); assert.equal(tempP.temp.forId, inj.playerId);
  assert.equal(tempP.contract.salaryEok, c.eok);
  assert.ok(!s.asiaMarket().some((x) => x.player.id === c.player.id));
  assert.deepEqual(s.otherReplacements, { used: 0, limit: 2 }, '외국인 횟수는 그대로');
  const log = s.rosterLog.find((e) => e.type === 'foreign' && e.playerId === c.player.id);
  assert.equal(log.asia, true); assert.equal(log.eok, c.eok); assert.equal(log.usd, undefined);
  // 저장·복원: 같은 상태
  const back = restore(warm, serialize(s));
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId, !!p.temp]).sort(), s.players.map((p) => [p.id, p.teamId, !!p.temp]).sort());
  assert.deepEqual(back.injuries, s.injuries);
  // 복귀 → 일시교체 선수는 팀을 떠난다
  s.advance(s.injuryOf(inj.playerId).left);
  assert.ok(!s.players.some((p) => p.id === c.player.id), '일시교체 선수는 떠났다');
  assert.ok(s.rosterLog.some((e) => e.type === 'foreign' && e.kind === 'tempEnd' && e.playerId === c.player.id && e.asia));
});

test('세션: 기타 사유 아시아쿼터 교체는 구단당 2회, 외국인 횟수와 따로 세고 아시아쿼터는 늘 1명이다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 't', seed: 8 });
  s.advance(20);
  const swap = () => {
    const out = asiaOf(s.players, MY).find((p) => !p.temp);
    const c = s.asiaMarket().find((x) => s.foreignCheck(out.id, 'other', x.player.id).ok);
    return c ? s.replaceForeign(out.id, 'other', c.player.id) : { ok: false, errors: ['후보 없음'] };
  };
  const o1 = swap(), o2 = swap();
  const o3 = s.replaceForeign(asiaOf(s.players, MY)[0].id, 'other', s.asiaMarket()[0].player.id); // 세 번째는 규칙(구단당 2회)에 막힌다
  assert.equal(o1.ok, true, o1.errors?.[0]); assert.equal(o2.ok, true, o2.errors?.[0]);
  assert.equal(o3.ok, false); assert.match(o3.errors[0], /2회/);
  assert.deepEqual(s.asiaOtherReplacements, { used: 2, limit: 2 });
  assert.deepEqual(s.otherReplacements, { used: 0, limit: 2 });
  assert.equal(asiaOf(s.players, MY).length, 1);
  // 외국인 교체는 아직 가능(횟수가 따로)
  const f = foreignOf(s.players, MY)[0];
  const fc = s.foreignMarket().find((x) => s.foreignCheck(f.id, 'other', x.player.id).ok);
  assert.ok(fc);
  // 시즌 끝: 정산 보정이 장부에 들어가고(유한한 값) 저장·복원해도 오프시즌까지 간다
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const entry = s.endSeason();
  assert.ok(Number.isFinite(entry.ledger[MY].payroll) && Number.isFinite(entry.ledger[MY].net));
  assert.equal(restore(base, serialize(s)).stage, 'offseason');
});

test('세션: 부상이 잦은 시즌에서 AI 구단도 아시아쿼터를 교체하고, 아시아쿼터는 구단당 1명 이하·일시교체 선수는 시즌 끝에 남지 않는다', () => {
  const s = Session.create(hot, { managerId: MY, gmName: 't', seed: 4 });
  while (!s.regularDone) s.advance(9);
  const ai = s.rosterLog.filter((e) => e.type === 'foreign' && e.asia && e.teamId !== MY && ['temp', 'season'].includes(e.kind));
  assert.ok(ai.length >= 1, `AI 아시아쿼터 교체 ${ai.length}건`);
  for (const e of ai) assert.ok(e.eok <= rules.asiaQuota.salaryEok[1]);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  const end = s.game.seasonEnd.league;
  assert.ok(!end.players.some((p) => p.temp), '일시교체 선수는 시즌 끝에 떠난다');
  for (const t of teams) assert.ok(asiaOf(end.players, t.id).length <= rules.asiaQuota.max, `${t.name} 아시아쿼터`);
  assert.equal(new Set(end.players.map((p) => p.id)).size, end.players.length);
  s.autoOffseason();
  assert.ok(Number.isFinite(s.players.length));
});

test('아시아쿼터가 없는 구단: 교체 패널 대상이 없고 시즌은 정상으로 진행된다 / 옛 저장(아시아쿼터 로그 없음)도 열린다', () => {
  const none = teams.find((t) => !asiaOf(allPlayers, t.id).length);
  assert.ok(none, '아시아쿼터가 없는 구단이 있다');
  const s = Session.create(base, { managerId: none.id, gmName: 't', seed: 3 });
  assert.equal(asiaOf(s.players, none.id).length, 0);
  s.advance(10);
  assert.equal(s.asiaOtherReplacements.used, 0);
  const saved = JSON.parse(JSON.stringify(serialize(s)));
  assert.equal(restore(base, saved).day, s.day);
});

test('결정성: 같은 시드·같은 조작이면 아시아쿼터 교체 기록이 같다', () => {
  const run = () => {
    const s = Session.create(hot, { managerId: MY, gmName: 't', seed: 6 });
    while (!s.regularDone) s.advance(9);
    return s.rosterLog.filter((e) => e.type === 'foreign' && e.asia).map((e) => [e.kind, e.day, e.teamId, e.playerId, e.eok]);
  };
  assert.deepEqual(run(), run());
});

test('뉴스: 아시아쿼터 교체 기사는 "아시아쿼터 선수"로 쓰고 억 원 연봉·가정 문구를 담으며, 시즌 끝 저장 요약에서도 같다', async () => {
  const { getNews } = await import('../web/lib/news-view.js');
  const { rosterSummary } = await import('../web/lib/game.js');
  const s = Session.create(hot, { managerId: MY, gmName: 't', seed: 4 });
  while (!s.regularDone) s.advance(9);
  assert.ok(s.rosterLog.some((e) => e.type === 'foreign' && e.asia), '아시아쿼터 교체가 있었다');
  const items = getNews(s, { ...hot, teams }).items.filter((it) => /foreign_swap/.test(it.kind) && /아시아쿼터/.test(it.tags.join(' ')));
  assert.ok(items.length >= 1, '아시아쿼터 교체 기사');
  for (const it of items) {
    const text = `${it.headline} ${it.body}`;
    assert.match(text, /아시아쿼터/);
    assert.doesNotMatch(text, /외국인 선수/);
    assert.doesNotMatch(text, /만 달러/);
    assert.match(it.body, /억 원|게임은|규정은 따로 없/);
  }
  // 저장 요약(['foreign', …, 억, ovr, 1]) → 같은 기사 종류로 복원
  const summary = rosterSummary(s.rosterLog, MY);
  const row = summary.mv.find((m) => m[0] === 'foreign' && m[8] === 1);
  assert.ok(row, '아시아쿼터 교체 행에 표시가 붙는다');
  assert.equal(typeof row[6], 'number');
  assert.ok(row[6] <= rules.asiaQuota.salaryEok[1]);
});
