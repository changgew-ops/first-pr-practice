import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { releaseCost, releaseCheck, minDomestic, extensionYears, extensionCheck, extensionAdjust, salaryRanks } from '../src/contracts.mjs';
import { domesticOf, payrollEok } from '../src/valuation.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const { rules } = data;
const MY = 'busan-kcc';
const mk = (seed) => Session.create(data, { managerId: MY, gmName: 'T', seed });
const mine = (s) => s.players.filter((p) => p.teamId === MY);
const toOffseason = (s) => { while (!s.regularDone) s.advance(9); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); return s.endSeason(); };
const baseName = (p) => p.baseName ?? p.name;

test('방출 비용: 시즌 중은 남은 일수 비율 + 이후 연수, 오프시즌은 남은 연수 전체', () => {
  const p = { contract: { salaryEok: 3, yearsLeft: 3 } };
  const mid = releaseCost(p, { phase: 'season', day: 27, totalDays: 54 });
  assert.equal(mid.severance, 3 * (0.5 + 2)); assert.equal(mid.earned, 1.5);
  assert.equal(mid.severance + mid.earned, 3 * 3); // 연봉 × 남은 시즌 수 전체가 결국 나간다
  const start = releaseCost(p, { phase: 'season', day: 0, totalDays: 54 });
  assert.equal(start.severance, 9); assert.equal(start.earned, 0);
  const last = releaseCost({ contract: { salaryEok: 2, yearsLeft: 1 } }, { phase: 'season', day: 54, totalDays: 54 });
  assert.equal(last.severance, 0);
  assert.equal(releaseCost({ contract: { salaryEok: 3, yearsLeft: 2 } }, { phase: 'offseason' }).severance, 6);
});

test('방출 조건: 외국인·아시아쿼터는 불가, 라인업 엔트리를 못 채우면 시즌 중 거절, 오프시즌은 경고', () => {
  const s = mk(5);
  const players = s.players;
  const foreign = players.find((p) => p.teamId === MY && p.origin === 'foreign');
  assert.equal(releaseCheck({ players, teamId: MY, playerId: foreign.id, rules }).ok, false);
  assert.match(releaseCheck({ players, teamId: MY, playerId: foreign.id, rules }).reason, /외국인/);
  const dom = domesticOf(players, MY);
  const need = minDomestic(players, MY, rules);
  assert.equal(need, rules.lineup.starters + rules.lineup.bench - players.filter((p) => p.teamId === MY && p.origin !== 'domestic').length);
  // 최소 인원까지는 되고 그 아래는 거절된다
  let left = [...players];
  let n = dom.length;
  while (n > need) {
    const victim = domesticOf(left, MY).sort((a, b) => a.ovr - b.ovr)[0];
    const c = releaseCheck({ players: left, teamId: MY, playerId: victim.id, rules });
    assert.equal(c.ok, true, c.reason);
    left = left.filter((p) => p.id !== victim.id); n--;
  }
  const last = releaseCheck({ players: left, teamId: MY, playerId: domesticOf(left, MY)[0].id, rules });
  assert.equal(last.ok, false); assert.match(last.reason, /엔트리/);
  const off = releaseCheck({ players: left, teamId: MY, playerId: domesticOf(left, MY)[0].id, phase: 'offseason', rules });
  assert.equal(off.ok, true); assert.ok(off.warning);
  assert.equal(releaseCheck({ players, teamId: MY, playerId: 'nobody', rules }).ok, false);
});

test('세션: 시즌 중 방출 — 로스터·캡·자금이 바로 바뀌고 편성이 보정되며, 저장·복원해도 같고, 선수는 FA 풀로 간다', () => {
  const s = mk(11);
  s.advance(9);
  const victim = mine(s).filter((p) => p.origin === 'domestic' && p.contract.yearsLeft >= 2).sort((a, b) => b.contract.salaryEok - a.contract.salaryEok)[0];
  const before = { n: mine(s).length, pay: payrollEok(s.players, MY), funds: s.funds[MY] };
  // 직접 편성에 들어 있는 선수를 방출하면 자동 편성으로 돌아간다
  const dom = mine(s).filter((p) => p.origin === 'domestic' || p.origin === 'foreign').sort((a, b) => b.ovr - a.ovr);
  const chk = s.releaseCheck(victim.id);
  assert.equal(chk.ok, true, chk.reason);
  assert.ok(chk.cost.severance > 0 && chk.cost.fraction > 0 && chk.cost.fraction < 1);
  const r = s.releasePlayer(victim.id);
  assert.equal(r.ok, true);
  assert.equal(mine(s).length, before.n - 1);
  assert.ok(!s.players.some((p) => p.id === victim.id));
  assert.equal(Math.round((before.pay - payrollEok(s.players, MY)) * 100) / 100, victim.contract.salaryEok); // 연봉은 캡에서 바로 빠진다
  assert.equal(s.funds[MY], Math.round((before.funds - chk.cost.severance) * 100) / 100);       // 해지 비용은 바로 자금에서 빠진다
  assert.equal(s.lineup, null);
  assert.equal(s.game.actions.at(-1).type, 'release');
  // 경기를 계속 진행해도 방출된 선수는 뛰지 않는다
  const out = s.advance(3);
  assert.ok(out.every((d) => d.games.every((g) => ![...g.box.home, ...g.box.away].some((l) => l.id === victim.id && l.minutes > 0))));
  void dom;
  // 저장·복원: 같은 상태
  const back = restore(data, serialize(s));
  assert.equal(back.day, s.day);
  assert.deepEqual(back.players.map((p) => p.id).sort(), s.players.map((p) => p.id).sort());
  assert.equal(back.funds[MY], s.funds[MY]);
  assert.deepEqual(back.contractLog.released.map((x) => x.playerId), [victim.id]);
  // 시즌 끝: 해지 비용이 정산에 들어가고 선수는 FA 풀(원소속 보상 없음)에 있다
  const entry = toOffseason(s);
  const led = entry.ledger[MY];
  assert.equal(led.severance, chk.cost.severance);
  const pool = s.game.seasonEnd.league.freeAgents;
  const released = pool.find((p) => p.id === victim.id);
  assert.ok(released); assert.equal(released.teamId, null); assert.equal(released.prevTeamId, undefined);
  assert.equal(entry.contracts.released.length, 1);
});

test('세션: 최소 인원보다 적어지는 방출은 거절되고 아무것도 바뀌지 않는다', () => {
  const s = mk(12);
  let guard = 0;
  let last = null;
  while (guard++ < 20) {
    const victim = mine(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr)[0];
    last = s.releasePlayer(victim.id);
    if (!last.ok) break;
  }
  assert.equal(last.ok, false);
  assert.match(last.errors[0], /엔트리|코스트/);
  assert.equal(mine(s).filter((p) => p.origin === 'domestic').length, minDomestic(s.players, MY, rules));
  assert.throws(() => { const t = mk(12); t.advance(60); t.startPlayoffs(); t.releasePlayer('x'); }, /할 수 없는/);
});

test('연장 계약 기간 규칙: 남은 기간보다 길게, 최대 5년, 보수 30위 이내는 3년 이상(만 32세 이상 예외)', () => {
  const p = (age, yearsLeft) => ({ age, contract: { salaryEok: 3, yearsLeft } });
  assert.deepEqual(extensionYears(p(27, 1), 5, rules), [3, 5]);
  assert.deepEqual(extensionYears(p(27, 3), 5, rules), [4, 5]);
  assert.deepEqual(extensionYears(p(27, 5), 5, rules), null);
  assert.deepEqual(extensionYears(p(33, 1), 5, rules), [2, 5]);
  assert.deepEqual(extensionYears(p(27, 1), 31, rules), [2, 5]);
});

test('세션: 연장 계약 — 미리 보기와 실제 결과가 같고(결정적), 수락되면 계약이 바뀌며, 저장·복원해도 같다', () => {
  const s = mk(14);
  s.advance(9);
  const cand = mine(s).filter((p) => p.origin === 'domestic' && p.contract.yearsLeft <= 2).sort((a, b) => b.ovr - a.ovr)[0];
  assert.ok(cand);
  const ranks = salaryRanks(s.players);
  const [lo] = extensionYears(cand, ranks.get(cand.id), rules);
  const demand = s.extendCheck(cand.id, { salaryEok: 99, years: lo });
  assert.equal(demand.status, 'cap'); // 너무 큰 연봉은 캡 한도에 걸린다
  // 요구액의 90% 미만은 거절
  const low = s.extendCheck(cand.id, { salaryEok: 0.3, years: lo });
  assert.equal(low.ok, false); assert.equal(low.status, 'refuse'); assert.ok(low.verdict.ratio < rules.transactions.freeAgency.minOfferRatio);
  // 기간이 범위를 벗어나면 거절
  assert.equal(s.extendCheck(cand.id, { salaryEok: 2, years: cand.contract.yearsLeft }).status, 'years');
  // 수락되는 가장 낮은 제안 찾기
  let offer = null;
  for (let sal = 0.5; sal <= 8; sal = Math.round((sal + 0.1) * 10) / 10) { const c = s.extendCheck(cand.id, { salaryEok: sal, years: lo }); if (c.ok) { offer = { salaryEok: sal, years: lo }; break; } }
  assert.ok(offer, '수락되는 제안이 있어야 한다');
  const preview = s.extendCheck(cand.id, offer);
  assert.deepEqual(s.extendCheck(cand.id, offer).verdict, preview.verdict); // 같은 상태·같은 제안이면 같은 답
  const r = s.extendContract(cand.id, offer);
  assert.equal(r.ok, true);
  const now = s.players.find((p) => p.id === cand.id);
  assert.deepEqual(now.contract, { salaryEok: offer.salaryEok, yearsLeft: offer.years });
  assert.equal(s.game.actions.at(-1).type, 'extend');
  const back = restore(data, serialize(s));
  assert.deepEqual(back.players.find((p) => p.id === cand.id).contract, now.contract);
  // 정산 보정: 이미 지난 비율은 예전 연봉으로 낸 것으로 본다
  const adj = s.contractLog.extended[0].adj;
  assert.equal(adj, extensionAdjust(cand.contract.salaryEok, offer.salaryEok, 9, 54));
  const entry = toOffseason(s);
  assert.ok(entry.contracts.extended.length === 1);
});

test('세션: 거절된 연장 제안은 아무것도 바꾸지 않는다', () => {
  const s = mk(14);
  s.advance(2);
  const cand = mine(s).filter((p) => p.origin === 'domestic' && p.contract.yearsLeft <= 2)[0];
  const [lo] = extensionYears(cand, salaryRanks(s.players).get(cand.id), rules);
  const before = JSON.stringify(s.players.find((p) => p.id === cand.id));
  const r = s.extendContract(cand.id, { salaryEok: 0.3, years: lo });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s.players.find((p) => p.id === cand.id)), before);
  assert.equal(s.game.actions.filter((a) => a.type === 'extend').length, 0);
});

test('오프시즌: 첫 단계에서 방출하고 재계약 단계에서 연장하면 자금·로스터·FA 풀이 바뀌고 결정 리플레이가 같다', () => {
  const run = () => {
    const s = mk(21);
    toOffseason(s);
    const p0 = s.pending;
    assert.equal(p0.kind, 'trade');
    const roster = p0.payload.league.players.filter((p) => p.teamId === MY && p.origin === 'domestic');
    const victim = roster.filter((p) => p.contract.yearsLeft >= 1).sort((a, b) => b.contract.salaryEok - a.contract.salaryEok)[0];
    const fundsBefore = s.funds[MY];
    s.decide('trade', { accept: [], proposals: [], release: [victim.id] });
    assert.equal(s.pending.kind, 'resign');
    const stay = s.pending.payload.league.players.filter((p) => p.teamId === MY && p.origin === 'domestic' && p.contract.yearsLeft > 0);
    assert.ok(!stay.some((p) => p.id === victim.id));
    const ext = stay.sort((a, b) => b.ovr - a.ovr)[0];
    const [lo] = extensionYears(ext, null, rules) ?? [2];
    const extend = {};
    extend[ext.id] = { salaryEok: Math.max(ext.contract.salaryEok, 1.5), years: Math.max(lo, ext.contract.yearsLeft + 1) };
    s.decide('resign', { extend });
    let guard = 0;
    while (s.pending && guard++ < 60) {
      const { key, kind, payload } = s.pending;
      s.decide(key, kind === 'freeAgency' ? [] : kind === 'compensation' ? { type: 'cash' } : kind === 'draft' ? payload.available[0].id : kind === 'foreign' ? payload.candidates.find((c) => c.ok !== false)?.player.id ?? payload.candidates[0].player.id : null);
    }
    assert.equal(s.stage, 'regular');
    const rep = s.game.log.at(-1).report;
    return { s, victim, ext, extend, rep, fundsBefore };
  };
  const a = run();
  assert.equal(a.rep.waived.length, 1);
  assert.equal(a.rep.waived[0].severance, Math.round(a.victim.contract.salaryEok * a.victim.contract.yearsLeft * 100) / 100);
  assert.ok(a.rep.waived[0].severance > 0);
  assert.equal(a.rep.extended.length + a.rep.extendRefused.length, 1);
  if (a.rep.extended.length) {
    const now = a.s.players.find((p) => p.id === a.ext.id);
    assert.deepEqual(now.contract, { salaryEok: a.extend[a.ext.id].salaryEok, yearsLeft: a.extend[a.ext.id].years });
  }
  // 같은 결정이면 같은 결과
  const b = run();
  assert.deepEqual(a.s.players.map((p) => [p.id, p.contract.salaryEok ?? p.contract.salaryUsd, p.contract.yearsLeft]), b.s.players.map((p) => [p.id, p.contract.salaryEok ?? p.contract.salaryUsd, p.contract.yearsLeft]));
  assert.equal(JSON.stringify(a.rep.waived), JSON.stringify(b.rep.waived));
  void baseName;
});

test('호환: release·extend가 없는 이전 결정 모양과 이전 저장(조작 기록)도 그대로 열린다', () => {
  const s = mk(23);
  s.advance(5);
  const old = JSON.parse(serialize(s));
  assert.ok(!old.actions.some((a) => a.type === 'release' || a.type === 'extend'));
  assert.equal(restore(data, JSON.stringify(old)).day, 5);
  toOffseason(s);
  s.decide('trade', { accept: [], proposals: [] });
  s.decide('resign', {});
  assert.ok(s.pending.kind === 'freeAgency');
  assert.deepEqual(s.game.seasonEnd.entry.contracts, undefined);
});
