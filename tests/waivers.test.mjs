import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waiversOn, priorRanks, claimOrder, newWaiver, waiverLeft, claimCheck, aiClaimPlan, resolveWaiver, claimedPlayer } from '../src/waivers.mjs';
import { releaseCheck } from '../src/contracts.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { getNews } from '../web/lib/news-view.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { demandEok, domesticOf, payrollEok } from '../src/valuation.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const base = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
const withWaivers = (over) => ({ ...base, rules: { ...rules, waivers: { ...rules.waivers, ...over } } });
const MY = 'busan-kcc';
const mk = (data, seed) => Session.create(data, { managerId: MY, gmName: 't', seed });
const mine = (s) => s.players.filter((p) => p.teamId === MY);
const finishYear = (s) => { while (!s.regularDone) s.advance(9); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); return s.endSeason(); };

// ---------- 순수 규칙 ----------
const dom = (id, team, over = {}) => ({ id, teamId: team, origin: 'domestic', position: 'PG', age: 26, ovr: 60, potential: 62, cost: 5, number: 1, contract: { salaryEok: 1, yearsLeft: 2 }, ...over });

test('웨이버 켜짐 여부와 규칙값: 규정에 없는 길이는 가정으로 표시돼 있다', () => {
  assert.equal(waiversOn(rules), true);
  assert.equal(waiversOn({}), false);
  assert.equal(waiversOn({ waivers: { enabled: false } }), false);
  assert.ok(rules.waivers.periodGames >= 1 && rules.waivers.reWaiverLockGames >= 1);
  assert.match(rules.waivers._note, /제101조/);
  assert.match(rules.waivers.periodNote, /가정/);
});

test('우선권(제101조 ①): 전 시즌 순위의 역순, 곧 승률이 낮았던 구단부터', () => {
  const legacy = { A: [{ winPct: 0.8 }], B: [{ winPct: 0.3 }], C: [{ winPct: 0.5 }, { winPct: 0.6 }], D: [] };
  const ranks = priorRanks(legacy, ['A', 'B', 'C', 'D']);
  assert.deepEqual([...ranks], [['A', 1], ['C', 2], ['D', 3], ['B', 4]]); // 마지막 시즌 승률, 기록이 없으면 0.5
  assert.deepEqual(claimOrder(ranks), ['B', 'D', 'C', 'A']);
  assert.deepEqual(claimOrder(priorRanks({}, ['x', 'y'])), ['y', 'x']); // 같으면 id 순위의 역순으로 결정적
});

test('공시 만들기: 계약은 그대로 두고 팀을 비우며, 경험치는 버린다', () => {
  const w = newWaiver({ ...dom('p1', 'A'), xp: { shooting: 3 } }, 'A', 7, rules);
  assert.equal(w.player.teamId, null);
  assert.deepEqual(w.player.contract, { salaryEok: 1, yearsLeft: 2 });
  assert.equal(w.player.xp, undefined);
  assert.equal(w.expires, 7 + rules.waivers.periodGames);
  assert.equal(waiverLeft(w, 8), rules.waivers.periodGames - 1);
  assert.equal(waiverLeft(w, 99), 0);
});

test('양수 판정: 국내 선수만, 정원 12명, 샐러리캡, 공시한 구단은 제외', () => {
  const w = newWaiver(dom('p1', 'A', { contract: { salaryEok: 2, yearsLeft: 2 } }), 'A', 5, rules);
  const roster = (n, salary = 1) => Array.from({ length: n }, (_, i) => dom(`b${i}`, 'B', { number: i + 1, contract: { salaryEok: salary, yearsLeft: 1 } }));
  const ok = (players, teamId = 'B', extra = {}) => claimCheck({ players, entry: w, teamId, rules, ...extra });
  assert.equal(ok(roster(11)).ok, true);
  assert.match(ok(roster(12)).reason, /12명/);
  assert.equal(ok(roster(12), 'B', { swapOut: roster(12)[0] }).ok, true, '내보내는 선수가 있으면 정원은 괜찮다');
  assert.match(ok(roster(11), 'A').reason, /공시한 구단/);
  assert.match(claimCheck({ players: roster(11), entry: { ...w, player: { ...w.player, origin: 'foreign' } }, teamId: 'B', rules }).reason, /국내/);
  const rich = roster(11, rules.salaryCap.domesticEok / 10); // 캡을 이미 넘는 구단
  assert.equal(ok(rich).ok, false, '소프트캡 구간은 AI·일반 구단이 할 수 없다');
  const over = claimCheck({ players: roster(11, rules.salaryCap.domesticEok / 10), entry: w, teamId: 'B', rules, isManager: true });
  assert.equal(over.ok, rules.salaryCap.domesticEok / 10 * 11 + 2 <= rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio), '단장은 하드 한도 안에서 소프트캡 초과를 직접 결정한다');
});

test('AI의 양수 판단: 저렴하고 가치가 높을 때만, 정원이 차면 가장 가치 낮은 선수와 바꾼다', () => {
  const cfg = rules.waivers.aiClaim;
  const star = dom('s1', 'A', { ovr: 75, potential: 75, contract: { salaryEok: 1, yearsLeft: 2 } });
  const w = (p) => newWaiver(p, 'A', 5, rules);
  const squad = (n, over = {}) => Array.from({ length: n }, (_, i) => dom(`b${i}`, 'B', { number: i + 1, ovr: 55 + i, potential: 55 + i, ...over }));
  const plan = (p, players, teamId = 'B', day = 6) => aiClaimPlan({ players, entry: w(p), teamId, rules, day });
  assert.deepEqual(plan(star, squad(11)), { swapOut: null }, '빈자리가 있으면 그냥 양수한다');
  const full = plan(star, squad(12));
  assert.equal(full.swapOut.id, 'b0', '가장 가치가 낮은 선수가 나간다');
  assert.equal(plan({ ...star, ovr: 56, potential: 56 }, squad(12)), null, '가치 차이가 minGain보다 작으면 양수하지 않는다');
  const pricey = { ...star, contract: { salaryEok: demandEok(star, rules) * cfg.maxSalaryRatio + 0.5, yearsLeft: 2 } };
  assert.equal(plan(pricey, squad(11)), null, '요구 연봉보다 훨씬 비싼 계약은 양수하지 않는다');
  assert.equal(plan(star, squad(12), 'A'), null, '공시한 구단은 제외');
  // 방금 웨이버로 영입한 선수는 내보내지 않는다(제101조 ②)
  const locked = squad(12).map((p, i) => (i === 0 ? { ...p, claimLockUntil: 99 } : p));
  assert.equal(plan(star, locked).swapOut.id, 'b1');
  assert.equal(aiClaimPlan({ players: squad(12), entry: w(star), teamId: 'B', rules: { ...rules, waivers: { ...rules.waivers, aiClaim: { ...cfg, allowSwap: false } } }, day: 6 }), null);
});

test('마감 결과: 우선권 순서대로 첫 구단이 얻고, 단장은 신청했을 때만 자기 차례에 검증받는다', () => {
  const star = dom('s1', 'A', { ovr: 78, potential: 78, contract: { salaryEok: 1, yearsLeft: 2 } });
  const mkTeam = (id) => Array.from({ length: 11 }, (_, i) => dom(`${id}${i}`, id, { number: i + 1, ovr: 55, potential: 55 }));
  const players = [...mkTeam('B'), ...mkTeam('C'), ...mkTeam(MY)];
  const entry = newWaiver(star, 'A', 5, rules);
  const order = ['B', MY, 'C', 'A'];
  const r1 = resolveWaiver({ players, entry, order, manager: MY, rules, day: 8 });
  assert.equal(r1.winner, 'B', '우선권이 가장 앞선 AI 구단');
  const r2 = resolveWaiver({ players, entry: { ...entry, mine: true }, order: [MY, 'B', 'C'], manager: MY, rules, day: 8 });
  assert.equal(r2.winner, MY);
  const r3 = resolveWaiver({ players, entry: { ...entry, mine: true }, order, manager: MY, rules, day: 8 });
  assert.equal(r3.winner, 'B');
  assert.match(r3.mineFailed, /우선권/);
  const full = [...players.filter((p) => p.teamId !== MY), ...Array.from({ length: 12 }, (_, i) => dom(`m${i}`, MY, { number: i + 1, ovr: 55, potential: 55 }))];
  const r4 = resolveWaiver({ players: full, entry: { ...entry, mine: true }, order: [MY, 'B'], manager: MY, rules, day: 8 });
  assert.equal(r4.winner, 'B');
  assert.match(r4.mineFailed, /12명/);
  const none = resolveWaiver({ players, entry: { ...entry, player: { ...star, ovr: 50, potential: 50 } }, order, manager: MY, rules, day: 8 });
  assert.equal(none.winner, null);
  assert.equal(claimedPlayer(entry, { teamId: 'B', number: 9, day: 8, rules }).claimLockUntil, 8 + rules.waivers.reWaiverLockGames);
});

// ---------- 세션 ----------
const bestDomestic = (s) => mine(s).filter((p) => p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr)[0];

test('세션: 방출은 공시로 시작하고, 다른 구단이 양수하면 남은 계약을 이어받아 해지 비용이 사라진다', () => {
  const s = mk(base, 'wv-a');
  s.advance(3);
  const v = bestDomestic(s);
  const chk = s.releaseCheck(v.id);
  assert.equal(chk.ok, true);
  assert.equal(chk.waiverGames, rules.waivers.periodGames);
  assert.equal(s.releasePlayer(v.id).ok, true);
  assert.ok(!s.players.some((p) => p.id === v.id) || s.players.find((p) => p.id === v.id).teamId !== MY, '방출한 선수는 우리 로스터에서 빠진다');
  const w = s.waivers.find((x) => x.player.id === v.id);
  assert.ok(w, '공시 목록에 나온다');
  assert.equal(w.left, rules.waivers.periodGames);
  assert.ok(!s.faMarket().some((m) => m.player.id === v.id), '공시 중에는 FA 시장에 나오지 않는다');
  s.advance(rules.waivers.periodGames);
  assert.ok(!s.waivers.some((x) => x.player.id === v.id), '공시기간이 끝나면 목록에서 사라진다');
  const claim = s.rosterLog.find((e) => e.type === 'claim' && e.playerId === v.id);
  assert.ok(claim, 'AI 구단이 양수한다(최고 선수는 저렴한 계약이라 늘 인기가 있다)');
  assert.equal(s.players.find((p) => p.id === v.id).teamId, claim.teamId);
  assert.deepEqual(s.players.find((p) => p.id === v.id).contract, v.contract, '계약을 그대로 이어받는다');
  const rel = s.contractLog.released.find((r) => r.playerId === v.id);
  assert.equal(rel.severance, 0);
  assert.equal(rel.claimedBy, claim.teamId);
  const wait = Math.round(v.contract.salaryEok * (claim.day - 3) / s.totalDays * 100) / 100; // 공시기간의 보수는 공시한 구단이 낸다
  assert.ok(Math.abs(rel.earned - Math.round((chk.cost.earned + wait) * 100) / 100) < 0.011, `earned ${rel.earned}`);
  const entry = finishYear(s);
  assert.equal(entry.ledger[MY].severance, 0);
});

test('세션: 아무도 양수하지 않으면 마감일에 FA 풀로 가고 해지 비용은 그대로 낸다', () => {
  const data = withWaivers({ aiClaim: { ...rules.waivers.aiClaim, minGain: 999 } });
  const s = mk(data, 'wv-b');
  s.advance(3);
  const v = bestDomestic(s);
  const chk = s.releaseCheck(v.id);
  assert.equal(s.releasePlayer(v.id).ok, true);
  s.advance(rules.waivers.periodGames);
  assert.ok(!s.waivers.length);
  const log = s.rosterLog.find((e) => e.type === 'waiver_fa' && e.playerId === v.id);
  assert.ok(log);
  assert.ok(s.faMarket().some((m) => m.player.id === v.id), '시장에 나온다');
  assert.equal(s.contractLog.released[0].severance, chk.cost.severance);
  const entry = finishYear(s);
  assert.equal(entry.ledger[MY].severance, chk.cost.severance);
  assert.ok(s.game.seasonEnd.league.freeAgents.some((p) => p.id === v.id));
});

test('웨이버를 끄면 방출은 곧바로 FA 풀로 가고, 규칙 키가 없는 것과 결과가 같다', () => {
  const off = withWaivers({ enabled: false });
  const none = { ...base, rules: Object.fromEntries(Object.entries(rules).filter(([k]) => k !== 'waivers')) };
  const run = (data) => {
    const s = mk(data, 'wv-c');
    s.advance(3);
    const v = bestDomestic(s);
    s.releasePlayer(v.id);
    assert.equal(s.waivers.length, 0);
    assert.ok(s.faMarket().some((m) => m.player.id === v.id), '바로 시장에 나온다');
    const entry = finishYear(s);
    return JSON.stringify({ ledger: entry.ledger[MY], standings: s.game.seasonEnd.standings.map((r) => [r.id, r.wins]), pool: s.game.seasonEnd.league.freeAgents.map((p) => p.id).sort() });
  };
  assert.equal(run(off), run(none));
  assert.equal(releaseCheck({ players: [], teamId: MY, playerId: 'x', rules: none.rules }).ok, false);
});

test('세션: 우리가 AI 구단이 공시한 선수를 양수 신청하면 마감 때 결과가 나오고, 영입 뒤 30일 안에는 방출할 수 없다', () => {
  const hot = withWaivers({ periodGames: 4, aiClaim: { ...rules.waivers.aiClaim, minGain: 999 } }); // 다른 AI 구단은 양수하지 않는 규칙: 우리 신청이 통과하는 경로를 시험한다
  hot.rules = { ...hot.rules, injuries: { ...hot.rules.injuries, perMinute: 0.02 }, inSeason: { ...hot.rules.inSeason, ai: { ...hot.rules.inSeason.ai, healthyBelow: 99, replaceInjuredAtGames: 3 } } };
  const s = mk(hot, 'wv-d');
  finishYear(s); s.autoOffseason(); // 첫 시즌에는 시장에 남은 FA가 없어 AI가 방출·영입을 하지 않는다
  let target = null;
  for (let d = 0; d < 40 && !target; d++) {
    s.advance(1);
    // 우리 로스터에 자리를 만든다(정원이 차 있으면 양수할 수 없다)
    const w = s.waivers.find((x) => x.fromTeamId !== MY && x.left >= 2 && x.player.contract.salaryEok <= 1.5);
    if (w) target = w;
  }
  assert.ok(target, '부상이 잦은 규칙에서는 AI 구단의 공시가 나온다');
  assert.match(s.waiverCheck(target.player.id).reason ?? '', /12명/); // 우리 로스터가 가득 차 있으면 신청할 수 없다
  const victim = mine(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr)[0];
  assert.equal(s.releasePlayer(victim.id).ok, true);
  const chk = s.waiverCheck(target.player.id);
  assert.equal(chk.ok, true, chk.reason);
  assert.equal(s.claimWaiver(target.player.id).ok, true);
  assert.ok(s.waivers.find((x) => x.player.id === target.player.id).mine);
  assert.equal(s.game.actions.at(-1).type, 'claim');
  // 저장·복원: 신청 기록이 그대로 다시 재생된다
  const back = restore(hot, serialize(s));
  assert.ok(back.waivers.find((x) => x.player.id === target.player.id)?.mine);
  assert.equal(s.cancelWaiverClaim(target.player.id).ok, true);
  assert.equal(s.claimWaiver(target.player.id).ok, true);
  let got = null;
  for (let d = 0; d < 6 && !got; d++) { s.advance(1); got = s.rosterLog.find((e) => e.playerId === target.player.id && ['claim', 'claim_fail', 'waiver_fa'].includes(e.type)); }
  assert.ok(got, '마감일에 결과가 기록된다');
  assert.equal(got.type, 'claim');
  assert.equal(got.teamId, MY);
  const me = s.players.find((p) => p.id === target.player.id);
  assert.equal(me.teamId, MY);
  assert.deepEqual(me.contract, target.player.contract);
  const rel = s.releaseCheck(me.id);
  assert.equal(rel.ok, false);
  assert.match(rel.reason, /웨이버로 영입한 선수/);
  s.advance(rules.waivers.reWaiverLockGames + 1);
  assert.equal(s.releaseCheck(me.id).ok, true, '금지 기간이 지나면 방출할 수 있다');
});

// 우선권에서 밀리면 양수 실패 기사와 기록이 남는다는 점은 위 '마감 결과' 단위 시험(r3, r4)이 다룬다

test('세션: 같은 시드·같은 조작이면 저장·복원 뒤에도 웨이버 결과가 같다', () => {
  const s = mk(base, 'wv-e');
  s.advance(3);
  const v = bestDomestic(s);
  s.releasePlayer(v.id);
  s.advance(2);
  const back = restore(base, serialize(s));
  assert.deepEqual(back.waivers.map((w) => [w.player.id, w.left]), s.waivers.map((w) => [w.player.id, w.left]));
  s.advance(4); back.advance(4);
  assert.deepEqual(back.rosterLog.filter((e) => ['waive', 'claim', 'waiver_fa'].includes(e.type)), s.rosterLog.filter((e) => ['waive', 'claim', 'waiver_fa'].includes(e.type)));
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId]).sort(), s.players.map((p) => [p.id, p.teamId]).sort());
});

test('정산: 방출 선수의 보수는 공시한 구단(공시기간까지)과 양수한 구단이 합쳐 한 시즌 연봉이 된다', () => {
  const calm = withWaivers({});
  calm.rules = { ...calm.rules, injuries: { ...calm.rules.injuries, enabled: false } };
  const s = mk(calm, 'wv-f');
  s.advance(3);
  const v = bestDomestic(s);
  s.releasePlayer(v.id);
  s.advance(9);
  const claim = s.rosterLog.find((e) => e.type === 'claim' && e.playerId === v.id);
  assert.ok(claim);
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const f = s.run.finish();
  const adj = f.roster.payAdj[claim.teamId] ?? 0;
  const rel = f.contracts.releaseLog[0];
  const swap = f.roster.log.find((e) => e.type === 'release' && e.teamId === claim.teamId && e.day === claim.day); // AI가 자리를 만들려고 내보낸 선수의 보수(일할)는 따로 더해진다
  const swapPay = swap ? Math.round(base.players.find((p) => p.id === swap.playerId).contract.salaryEok * claim.day / s.totalDays * 100) / 100 : 0;
  const total = rel.earned + (v.contract.salaryEok + adj - swapPay); // 양수한 구단은 시즌 말 명단 기준 연봉에서 합류 전 비율을 뺀다
  assert.ok(Math.abs(total - v.contract.salaryEok) < 0.021, `총 보수 ${total} vs 연봉 ${v.contract.salaryEok}`);
});

test('이전 저장: 웨이버 필드가 없는 시즌 기록(roster.mv)과 조작 기록도 그대로 열린다', () => {
  const s = mk(base, 'wv-g');
  const g = JSON.parse(serialize(s));
  assert.ok(!g.actions.some((a) => a.type === 'claim' || a.type === 'unclaim'));
  const back = restore(base, JSON.stringify(g));
  assert.deepEqual(back.waivers, []);
  assert.doesNotThrow(() => getNews(back, base));
});

test('뉴스: 웨이버 공시·양수 기사는 문단 2~4개, 하한 길이 이상, 요약이 첫 문단의 첫 문장이다', () => {
  const s = mk(base, 'wv-h');
  s.advance(3);
  const v = bestDomestic(s);
  s.releasePlayer(v.id);
  let items = getNews(s, base).items.filter((i) => i.kind === 'waiver_my');
  assert.ok(items.length >= 1, '공시 기사');
  s.advance(rules.waivers.periodGames + 1);
  items = getNews(s, base).items.filter((i) => i.kind === 'waiver_my');
  assert.ok(items.length >= 2, '결과 기사');
  for (const it of items) {
    assert.ok(it.paragraphs.length >= 2 && it.paragraphs.length <= 4, `문단 ${it.paragraphs.length}개`);
    assert.ok(it.body.length >= 160 && it.body.length <= 800, `${it.body.length}자: ${it.body}`);
    assert.ok(it.summary.length >= 10 && it.summary.length <= 160);
    assert.ok(it.paragraphs[0].startsWith(it.summary));
    assert.ok(it.comments.length >= 2 && it.comments.length <= 5, `댓글 ${it.comments.length}개`);
    assert.match(it.body, /제101조/);
  }
  // 끝난 시즌 요약으로도 같은 기사가 다시 만들어진다
  finishYear(s);
  assert.ok(getNews(s, base).items.some((i) => i.kind === 'waiver_my'));
  void domesticOf; void payrollEok;
});

test('아시아쿼터·외국인은 웨이버 대상이 아니다: 방출 불가 사유를 보여 준다(제공된 규정에 해당 조항 없음)', () => {
  const asiaTeam = base.players.find((p) => p.origin === 'asia').teamId;
  const s = Session.create(base, { managerId: asiaTeam, gmName: 't', seed: 'wv-i' });
  const mine = (ss) => ss.players.filter((p) => p.teamId === asiaTeam);
  const asia = mine(s).find((p) => p.origin === 'asia');
  const foreign = mine(s).find((p) => p.origin === 'foreign');
  assert.ok(asia && foreign);
  assert.equal(s.releaseCheck(asia.id).ok, false);
  assert.match(s.releaseCheck(asia.id).reason, /아시아쿼터/);
  assert.equal(s.releaseCheck(foreign.id).ok, false);
});
