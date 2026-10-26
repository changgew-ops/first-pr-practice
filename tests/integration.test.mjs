// 통합 검수: 기능 하나하나가 아니라 "내가 바꾼 선택이 화면과 경기 결과에 일관되게 반영되고, 저장했다 불러와도 같은 시즌이 이어지는가"를 확인한다.
// 시나리오와 결과는 docs/QA.md에 표로 정리했다. 모든 시나리오는 시드를 고정해서 같은 결과가 나온다.
//  비교 방식: 살아 있는 세션 A와, 중간에 저장(serialize)했다 복원(restore)한 세션 B에 같은 조작·같은 진행을 시키고 상태 지문(fingerprint)이 같은지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { encodeSlot, decodeSlot } from '../web/lib/save.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { attendanceCalc, homeOrdinal } from '../web/lib/season-view.js';
import { slotsFromDraft, draftFromSlots, clearSlot, arrangeSeats, autoDraft } from '../web/lib/lineup-view.js';
import { powerOfLineup } from '../web/lib/game.js';
import { payrollEok } from '../src/valuation.mjs';
import { computeTeamMods, effectiveOf, pointsPerPower } from '../src/effective.mjs';
import { baseRosterFor } from '../src/synergy.mjs';
import { recommend } from '../src/tactics.mjs';
import { effectiveTable } from '../web/lib/game.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const base = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
// 부상이 잦고(기본의 약 7배) 교체 후보가 넉넉한 규칙: 우리 외국인이 다치는 상황을 짧은 시즌 안에 만들기 위한 시험용. 이 값에서는 건강한 선수가 모자라 부상을 안고 뛰는 일이 없다
const busy = { ...base, rules: { ...rules, injuries: { ...rules.injuries, perMinute: 0.002 }, inSeason: { ...rules.inSeason, foreign: { ...rules.inSeason.foreign, poolSize: 60 }, asia: { ...rules.inSeason.asia, poolSize: 60 } } } };
const MY = 'busan-kcc';

const plain = (v) => JSON.stringify(v, (k, x) => (x instanceof Map ? [...x.entries()] : x instanceof Set ? [...x] : x));
/** 세션의 화면·경기에 보이는 상태를 한 줄로(저장하지 않고 이어 간 세션과 저장했다 복원한 세션을 비교한다). 오프시즌에는 진행기가 없어 시즌 중 값은 뺀다 */
function fingerprint(s) {
  const off = s.stage === 'offseason';
  return plain({
    stage: s.stage, day: s.day, season: s.season,
    standings: off ? null : s.standings(), players: s.players, funds: s.funds,
    injuries: off ? null : s.injuries, rosterLog: off ? null : s.rosterLog, lineup: off ? null : s.lineup, lineupSwaps: off ? null : s.lineupSwaps, rest: off ? null : s.rest,
    cond: off ? null : [...s.conditions.entries()].sort(), tactics: off ? null : s.tactics, staff: off ? null : s.staff,
    games: off ? null : s.dayResults.map((d) => d.games.map((g) => [g.homeId, g.awayId, g.homePts, g.awayPts, g.overtimes, g.att, g.box])),
    poLive: !off && s.playoffs ? [s.state.poRounds, s.state.poGames, s.playoffs.gamesPlayed, s.playoffs.current.map((x) => [x.higherId, x.lowerId, x.wins, x.games.map((g) => [g.homePts, g.awayPts, g.att, g.fx])])] : null,
    playoffs: !off && s.playoffs ? s.playoffs.result().series.map((x) => [x.higherId, x.lowerId, x.winnerId, x.wins, x.games.map((g) => [g.homePts, g.awayPts, g.att, g.box])]) : null,
    contractLog: off ? null : s.contractLog, waivers: off ? null : s.waivers.map((w) => [w.player.id, w.left, w.mine]),
    pending: s.pending?.key ?? null, actions: s.state.actions, decisions: s.state.decisions,
    meta: { goals: s.goals, trust: s.trust, fans: s.fans, ach: s.achievements, codex: s.codex.length, logLen: s.game.log.length, lastEval: s.lastEval }
  });
}
const clone = (s) => restore(s.data, serialize(s));
function sameState(label, a, b) {
  const fa = JSON.parse(fingerprint(a)), fb = JSON.parse(fingerprint(b));
  const bad = Object.keys(fa).filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k]));
  assert.deepEqual(bad, [], `${label}: 저장했다 복원한 세션과 계속 진행한 세션이 다르다 (${bad.join(', ')})`);
}
const finishRegular = (s) => { while (!s.regularDone) s.advance(9); };
const toOffseason = (s) => { finishRegular(s); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); s.endSeason(); };
const myRoster = (s) => s.players.filter((p) => p.teamId === MY);
const idsOf = (l) => [...l.starters, ...l.bench].map((p) => p.id);
const myBoxIds = (dayRes) => { const g = dayRes.games.find((x) => x.homeId === MY || x.awayId === MY); return new Set((g.homeId === MY ? g.box.home : g.box.away).map((l) => l.id)); };

// ---------- (1) 전력 표시는 실제 출전 편성과 같다 ----------
test('전력 표시: 직접 편성·휴식·부상을 바꾸면 표시 전력과 팀 보기가 실제로 뛸 12명 기준으로 바뀐다', () => {
  const s = Session.create(busy, { managerId: MY, gmName: 'T', seed: 31 });
  const auto0 = s.teamPower(MY);
  // 시즌 시작 전에는 자동 편성과 같다(예전 계산과 동일)
  assert.deepEqual(idsOf(auto0.lineup), idsOf(s.lineupOf(MY)));
  assert.equal(auto0.baseOvr, Math.round(powerOfLineup(s.lineupOf(MY)) * 100) / 100); // 기본 전력은 편성 OVR 합성
  assert.equal(auto0.power, auto0.effective); // 화면 기본 표시 전력 = 유효 전력(기본 전력 + 경기 보정)
  // 직접 편성: 가장 약한 국내 12명 → 전력이 내려가고, 다음 경기 박스스코어는 정확히 그 12명(+필요하면 외국인 규칙은 이미 통과)만 쓴다
  const weak = myRoster(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr).slice(0, 12);
  assert.equal(s.setLineup({ starters: weak.slice(0, 5).map((p) => p.id), bench: weak.slice(5).map((p) => p.id) }).ok, true);
  const p1 = s.teamPower(MY);
  assert.ok(p1.power < auto0.power - 3, `직접 편성한 약한 12명의 전력이 내려가야 한다 ${p1.power} < ${auto0.power}`);
  assert.deepEqual(new Set(idsOf(p1.lineup)), new Set(weak.map((p) => p.id)));
  const [d1] = s.advance(1);
  for (const id of myBoxIds(d1)) assert.ok(idsOf(p1.lineup).includes(id), '표시한 편성 밖의 선수가 뛰었다');
  // 자동 편성으로 돌리고 가장 센 선수 한 명을 쉬게 하면 표시 편성에서 빠진다
  s.setLineup(null);
  const star = myRoster(s).filter((p) => !s.injuryOf(p.id)).sort((a, b) => b.ovr - a.ovr)[0];
  const before = s.teamPower(MY);
  assert.ok(idsOf(before.lineup).includes(star.id));
  assert.equal(s.setRest([star.id]).ok, true);
  const after = s.teamPower(MY);
  assert.ok(!idsOf(after.lineup).includes(star.id), '쉬는 선수가 표시 편성에 남아 있다');
  assert.ok(after.power < before.power);
  const viewAuto = autoDraft(myRoster(s), s.rules, new Map([...s.injuries.map((i) => [i.playerId, i.left]), [star.id, 1]])); // 라인업 화면의 "자동 편성"(쉬는 선수 제외)도 엔진과 같은 12명
  assert.deepEqual(new Set([...viewAuto.starters, ...viewAuto.bench]), new Set(idsOf(after.lineup)));
  const [d2] = s.advance(1);
  assert.ok(!myBoxIds(d2).has(star.id), '쉬게 한 선수가 뛰었다');
  assert.deepEqual(s.rest, [], '휴식 지정은 하루가 지나면 비워진다');
  // 다음 경기 카드·순위표가 읽는 powerRanking도 같은 값
  const ranking = s.powerRanking();
  assert.equal(ranking.find((r) => r.id === MY).power, s.teamPower(MY).power);
  assert.deepEqual(ranking.map((r) => r.rank), ranking.map((_, i) => i + 1));
  // 부상: 다친 선수는 표시 편성에서 빠지고 그 경기에 뛰지 않는다(건강한 선수가 충분할 때)
  let hurt = null;
  for (let i = 0; i < 40 && !hurt; i++) { s.advance(1); hurt = s.injuries.find((x) => x.teamId === MY && x.left >= 2); }
  assert.ok(hurt, '40일 안에 우리 선수가 다치지 않았다(시드 고정이라 항상 같아야 한다)');
  assert.ok(!idsOf(s.lineupOf(MY)).includes(hurt.playerId), '다친 선수가 표시 편성에 있다');
  const [d3] = s.advance(1);
  assert.ok(!myBoxIds(d3).has(hurt.playerId), '다친 선수가 뛰었다');
  // 오프시즌에는 엔진 편성이 없어 로스터 자동 편성(예전 계산)으로 돌아간다
  toOffseason(s);
  assert.equal(s.teamPower(MY).baseOvr, Math.round(powerOfLineup(s.lineupOf(MY)) * 100) / 100);
});

// ---------- (플레이오프) 중 편성 변경: 다음 라운드에 반영되고 복원해도 같다 ----------
test('플레이오프 중 라인업 변경: 다음 라운드부터 적용되고, 저장했다 불러와도 같은 시리즈 결과가 나온다', () => {
  let tried = 0, differed = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = Session.create(base, { managerId: MY, gmName: 'T', seed });
    finishRegular(s); s.startPlayoffs();
    if (s.playoffStatus() === 'notQualified') continue;
    tried++;
    const noChange = clone(s);
    s.playoffRound(); noChange.playoffRound();
    const weak = myRoster(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr).slice(0, 12);
    assert.equal(s.setLineup({ starters: weak.slice(0, 5).map((p) => p.id), bench: weak.slice(5).map((p) => p.id) }).ok, true);
    assert.equal(s.state.actions.at(-1).po, 1, '플레이오프 중 조작은 치른 라운드 수를 같이 기록한다');
    assert.deepEqual(new Set(idsOf(s.lineupOf(MY))), new Set(weak.map((p) => p.id)), '플레이오프 중에도 표시 편성이 바뀐다');
    const back = clone(s);
    sameState(`seed ${seed} 편성 직후`, s, back);
    while (!s.playoffs.done) { s.playoffRound(); back.playoffRound(); noChange.playoffRound(); }
    sameState(`seed ${seed} 플레이오프 끝`, s, back);
    // 약한 12명으로 바꾸면 우리 팀이 나온 경기의 결과(득실)가 바뀌어야 한다(편성이 정말 쓰였다는 증거)
    const mine = (x) => plain(x.playoffs.result().series.slice(2).filter((r) => r.higherId === MY || r.lowerId === MY).map((r) => r.games.map((g) => [g.homePts, g.awayPts])));
    if (mine(s) !== mine(noChange)) differed++;
  }
  assert.ok(tried >= 3, '플레이오프에 오른 시드가 모자란다');
  assert.ok(differed >= 1, '플레이오프 중 편성 변경이 경기에 전혀 반영되지 않았다');
});

// ---------- (2) 지난 경기 관중은 경기 때 정해져 바뀌지 않는다 ----------
test('관중: 경기가 진행될 때 저장되어 시즌이 더 지나도·복원해도 같고, 정산 평균·홈 카드와 일치한다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 7 });
  s.advance(10);
  const games = () => s.dayResults.flatMap((d) => d.games);
  const snap = games().map((g) => g.att);
  assert.ok(snap.every((a) => Number.isInteger(a) && a > 500), '모든 경기에 관중이 저장되어 있어야 한다');
  const calc = () => attendanceCalc({ teamData: s.data.teams, standings: s.standings(), att: s.state.league.att ?? null, season: s.state.league.season, rules: s.rules });
  const row = (d, i) => calc()(s.dayResults.find((x) => x.day === d).games[i], { key: `r${homeOrdinal(s.dayResults, d, i)}` });
  const first = row(3, 0); assert.equal(first.estimate, undefined, '저장된 관중은 추정이 아니다');
  finishRegular(s);
  assert.deepEqual(games().slice(0, snap.length).map((g) => g.att), snap, '시즌이 더 지나도 예전 경기의 관중이 달라지지 않는다');
  assert.equal(row(3, 0).attendance, first.attendance);
  // 복원해도 같은 값(경기 재생이 결정적)
  const back = clone(s);
  assert.deepEqual(back.dayResults.flatMap((d) => d.games).map((g) => g.att), games().map((g) => g.att));
  // 우리 홈 경기 평균 = 정산 장부의 경기당 관중(홈 카드가 읽는 값)
  const mine = games().filter((g) => g.homeId === MY).map((g) => g.att);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const poHome = s.playoffs.result().series.flatMap((x) => x.games).filter((g) => g.homeId === MY).map((g) => g.att);
  assert.ok(poHome.every((a) => Number.isInteger(a)), '플레이오프 경기도 관중이 저장된다');
  s.endSeason();
  const led = s.state.seasonEnd.entry.ledger?.[MY]?.attendance;
  assert.equal(led.avg, Math.round(mine.reduce((a, b) => a + b, 0) / mine.length), '경기 줄의 평균과 홈 카드의 평균이 같다');
  assert.equal(led.homeGames, mine.length);
  if (poHome.length) assert.equal(led.playoffAvg, Math.round(poHome.reduce((a, b) => a + b, 0) / poHome.length));
});

// ---------- (3) 코트 자리 ----------
test('코트 자리: 적용한 편성의 자리 순서는 저장·복원 뒤에도 같고, 빈 자리가 있는 편성은 저장되지 않는다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 3 });
  s.advance(3);
  const roster = myRoster(s);
  const dom = roster.filter((p) => p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr);
  const seats = arrangeSeats(dom.slice(0, 5));
  const slots = { seats, bench: dom.slice(5, 12).map((p) => p.id) };
  assert.equal(s.setLineup(draftFromSlots(slots)).ok, true);
  const back = clone(s);
  const re = slotsFromDraft(back.lineup, myRoster(back), back.rules);
  assert.deepEqual(re.seats, slots.seats, '자리 순서가 저장·복원 뒤에 같다');
  assert.deepEqual(re.bench, slots.bench);
  // 가운데 자리를 비우면 draft에서는 칸이 당겨지지만(편집 중 상태), 5명이 안 되어 적용도 저장도 되지 않는다
  const holey = clearSlot(slots, { area: 'seat', index: 1 });
  assert.equal(draftFromSlots(holey).starters.length, 4);
  const actionsBefore = s.state.actions.length;
  const r = s.setLineup(draftFromSlots(holey));
  assert.equal(r.ok, false); assert.match(r.errors[0], /5명/);
  assert.equal(s.state.actions.length, actionsBefore, '거절된 편성은 조작 기록에 남지 않는다');
  assert.deepEqual(s.lineup.starters, back.lineup.starters, '기존 편성이 그대로다');
  // 저장 슬롯(압축 형식)을 거쳐도 같다
  const viaSlot = restore(s.data, JSON.stringify(decodeSlot(encodeSlot({}, s.game)).game));
  assert.deepEqual(viaSlot.lineup, s.lineup);
});

// ---------- (4) 저장·불러오기 복원 정확성 ----------
const pick = (r, a) => a[Math.floor(r() * a.length)];
/** 시즌 중 조작 후보를 상태에서 뽑는다(같은 상태면 같은 조작) */
function genOps(s, r) {
  const ops = [];
  const roster = myRoster(s);
  const dom = () => roster.filter((p) => p.origin === 'domestic');
  for (let i = 0, k = Math.floor(r() * 4); i < k; i++) {
    const t = r();
    if (t < 0.15) ops.push({ type: 'rest', ids: [pick(r, dom()).id] });
    else if (t < 0.27 && s.tactics) ops.push({ type: 'tactic', id: pick(r, [null, ...s.tactics.list.map((x) => x.id)]) });
    else if (t < 0.4) { const d = dom().sort((a, b) => b.ovr - a.ovr); ops.push({ type: 'lineup', starters: d.slice(0, 5).map((p) => p.id), bench: d.slice(5, 12).map((p) => p.id) }); }
    else if (t < 0.45) ops.push({ type: 'lineupNull' });
    else if (t < 0.55) ops.push({ type: 'focus', playerId: pick(r, roster).id, stat: pick(r, ['shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina']) });
    else if (t < 0.65) { const fa = s.faMarket(); if (fa.length) ops.push({ type: 'fasign', playerId: pick(r, fa).player.id }); }
    else if (t < 0.72) ops.push({ type: 'release', playerId: pick(r, dom()).id });
    else if (t < 0.78) { const w = s.waivers.filter((x) => !x.mine); if (w.length) ops.push({ type: 'claim', playerId: pick(r, w).player.id }); }
    else if (t < 0.84) { const p = pick(r, dom()); ops.push({ type: 'extend', playerId: p.id, salaryEok: p.contract.salaryEok + 0.3, years: 3 }); }
    else if (t < 0.88 && s.staffPool) { const role = pick(r, ['head', 'off', 'def', 'cond']); const c = s.staffPool?.[role]?.[0]; if (c) ops.push({ type: 'staff', role, candId: c.id, years: 2 }); }
    else if (t < 0.92) { const offers = s.tradeOffers(); if (offers.length) ops.push({ type: 'accept', trade: pick(r, offers).trade }); }
    else { const inj = s.injuries.find((x) => x.teamId === MY && !x.temp && ['foreign', 'asia'].includes(roster.find((p) => p.id === x.playerId)?.origin)); if (inj) { const out = roster.find((p) => p.id === inj.playerId); const m = out.origin === 'foreign' ? s.foreignMarket() : s.asiaMarket(); if (m[0]) ops.push({ type: 'forrep', outId: inj.playerId, kind: inj.total >= 18 ? 'season' : 'temp', candId: m[0].player.id }); } }
  }
  return ops;
}
function applyOp(s, op) {
  try {
    switch (op.type) {
      case 'rest': return s.setRest(op.ids);
      case 'tactic': return s.setTactic(op.id);
      case 'lineup': return s.setLineup({ starters: op.starters, bench: op.bench });
      case 'lineupNull': return s.setLineup(null);
      case 'focus': return s.setFocus(op.playerId, op.stat);
      case 'fasign': { const c = s.faCheck(op.playerId, null); return s.signFa(op.playerId, { salaryEok: c.asking?.salaryEok ?? c.range?.[0], years: 1 }); }
      case 'release': return s.releasePlayer(op.playerId);
      case 'claim': return s.claimWaiver(op.playerId);
      case 'extend': return s.extendContract(op.playerId, { salaryEok: op.salaryEok, years: op.years });
      case 'staff': return s.replaceStaff(op.role, op.candId, op.years);
      case 'accept': return s.acceptOffer(op.trade);
      case 'forrep': return s.replaceForeign(op.outId, op.kind, op.candId);
      default: return { ok: false };
    }
  } catch (e) { return { ok: false, err: e.message }; }
}

test('저장·복원: 같은 날 여러 번의 조작(편성·휴식·전술·영입·방출·웨이버·연장·트레이드·감독·외국인 교체)을 한 시즌 내내 하며 곳곳에서 저장해도 결과가 같다', () => {
  const kinds = new Set();
  for (const seed of [11, 12, 13, 14]) {
    const r = mulberry32(seed * 7 + 1);
    const A = Session.create(busy, { managerId: MY, gmName: 'T', seed });
    let B = null;
    while (A.stage === 'regular' && !A.regularDone) {
      for (const op of genOps(A, r)) {
        const ra = applyOp(A, op);
        if (B) assert.equal(applyOp(B, op)?.ok, ra?.ok, `${seed}: 같은 조작의 성공 여부가 다르다 (${op.type})`);
      }
      A.advance(1); if (B) B.advance(1);
      if ([3, 11, 20, 33, 47].includes(A.day)) { B = clone(A); sameState(`seed ${seed} day ${A.day} 복원 직후`, A, B); } else if (B) sameState(`seed ${seed} day ${A.day}`, A, B);
    }
    for (const a of A.state.actions) kinds.add(a.type);
  }
  // 이 시험이 실제로 여러 종류의 조작을 거쳤는지(조작이 전부 거절되어 아무것도 안 한 시험이 되지 않도록)
  for (const k of ['lineup', 'tactic', 'focus', 'release', 'extend', 'staff']) assert.ok(kinds.has(k), `조작 ${k}이(가) 한 번도 적용되지 않았다`);
});

test('저장·복원: 정규리그 마지막 날 앞뒤·플레이오프 시작 앞뒤·시즌 종료 앞뒤·오프시즌 결정 도중, 오래된 시즌을 정리한 저장(최근 1시즌만 상세)도 같다', () => {
  const data = { ...base, rules: { ...rules, save: { ...rules.save, keepSeasonsDetail: 1 } } };
  let A = Session.create(data, { managerId: MY, gmName: 'T', seed: 77 });
  const value = ({ kind, payload }) => (kind === 'trade' ? { accept: [], proposals: [] } : kind === 'resign' ? {} : kind === 'freeAgency' ? [] : kind === 'compensation' ? { type: 'cash' } : kind === 'draft' ? payload.available[0].id : kind === 'foreign' ? (payload.candidates?.[0]?.id ?? 'pass') : 'pass');
  for (let season = 0; season < 2; season++) {
    A.advance(20); let B = clone(A); sameState(`s${season} 20일`, A, B);
    while (A.day < A.totalDays - 1) { A.advance(Math.min(9, A.totalDays - 1 - A.day)); B.advance(Math.min(9, B.totalDays - 1 - B.day)); }
    sameState(`s${season} 마지막 날 전날`, A, B);
    B = clone(A); sameState(`s${season} 마지막 날 전날 복원`, A, B);
    A.advance(1); B.advance(1); sameState(`s${season} 마지막 날 후`, A, B);
    B = clone(A); sameState(`s${season} 정규리그 끝 복원`, A, B);
    A.startPlayoffs(); B.startPlayoffs(); sameState(`s${season} 플레이오프 시작 직후`, A, B);
    B = clone(A); sameState(`s${season} 플레이오프 시작 직후 복원`, A, B);
    A.playoffRound(); B.playoffRound(); B = clone(A); sameState(`s${season} 1라운드 후 복원`, A, B);
    while (!A.playoffs.done) { A.playoffRound(); B.playoffRound(); }
    sameState(`s${season} 플레이오프 끝`, A, B);
    B = clone(A);
    A.endSeason(); B.endSeason(); sameState(`s${season} 시즌 종료 직후`, A, B);
    B = clone(A); sameState(`s${season} 오프시즌 첫 결정 복원`, A, B);
    for (let guard = 0; A.stage === 'offseason' && A.pending && guard < 60; guard++) {
      const v = value(A.pending);
      A.decide(A.pending.key, v); B.decide(B.pending.key, v);
      if (guard % 2 === 1) B = clone(A); // 드래프트·FA 단계 한가운데에서도 저장·복원
      sameState(`s${season} 오프시즌 결정 ${guard}`, A, B);
    }
    assert.equal(A.stage, 'regular'); sameState(`s${season} 다음 시즌 시작`, A, B);
  }
  assert.equal(A.game.log.length, 2);
});

test('저장·복원: 옛 모양의 저장(관중·스태프·도감·업적·플레이오프 표시가 없는 JSON, 압축 안 한 문자열)도 새 코드로 열리고 시즌을 끝까지 치른다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 5 });
  s.advance(12);
  const dom = myRoster(s).filter((p) => p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr);
  // 옛 편성: 코스트 합계 제한이 있던 시절에 짠 것(가장 센 12명, 합계가 옛 한도를 넘는다)도 이제는 그대로 열린다
  assert.equal(s.setLineup({ starters: dom.slice(0, 5).map((p) => p.id), bench: dom.slice(5, 12).map((p) => p.id) }).ok, true);
  s.advance(3);
  const old = JSON.parse(serialize(s));
  for (const k of ['codex', 'achievements']) delete old[k];
  for (const k of ['att', 'staff', 'usedKbl']) delete old.league[k];
  for (const a of old.actions) delete a.po;
  old.league.players = old.league.players.map(({ lastGp, lastMin, claimLockUntil, temp, ...p }) => p);
  const text = JSON.stringify(old);
  for (const [label, game] of [['압축 안 한 JSON', JSON.parse(text)], ['압축 슬롯', decodeSlot(encodeSlot({}, old)).game]]) {
    const a = restore(base, JSON.stringify(game)), b = restore(base, JSON.stringify(game));
    assert.equal(a.day, 15, label);
    sameState(`${label}: 같은 옛 저장을 두 번 열면 같다`, a, b);
    finishRegular(a); a.startPlayoffs(); while (!a.playoffs.done) a.playoffRound(); a.endSeason();
    a.autoOffseason();
    assert.equal(a.stage, 'regular'); assert.equal(a.season, 2027);
  }
});

// ---------- (5) 외국인 부상 → 일시교체 → 편성 변경 → 저장 → 복원 → 원선수 복귀 → 교체 종료 → 재정·기록 ----------
test('연결 시나리오: 외국인 부상 → 대체 선수 일시교체 → 편성 변경 → 저장·불러오기 → 복귀 → 교체 종료 → 로스터·정산·기록·뉴스·교체 횟수', () => {
  let ran = 0;
  for (const seed of [33, 34, 35, 38, 39, 40]) {
    const A = Session.create(busy, { managerId: MY, gmName: 'T', seed });
    const start = myRoster(A);
    let hurt = null;
    while (!A.regularDone && !hurt) {
      A.advance(1);
      hurt = A.injuries.find((i) => i.teamId === MY && !i.temp && i.total >= A.foreignThresholds.temporary && A.players.find((p) => p.id === i.playerId)?.origin === 'foreign');
    }
    if (!hurt) continue;
    const out = A.players.find((p) => p.id === hurt.playerId);
    const cand = A.foreignMarket().find((m) => A.foreignCheck(out.id, 'temp', m.player.id).ok);
    if (!cand) continue;
    ran++;
    const joinDay = A.day;
    const slots0 = A.otherReplacements.used;
    const r = A.replaceForeign(out.id, 'temp', cand.player.id);
    assert.equal(r.ok, true);
    const tempId = r.player.id;
    // 로스터: 원선수와 대체 선수가 함께 있고, 외국인 슬롯 검사에서 일시교체 선수는 대체 신분
    assert.ok(myRoster(A).some((p) => p.id === out.id) && myRoster(A).some((p) => p.id === tempId));
    assert.equal(A.otherReplacements.used, slots0, '일시교체는 기타 사유 교체 횟수를 쓰지 않는다');
    assert.equal(A.replaceForeign(out.id, 'temp', cand.player.id).ok, false, '같은 선수를 또 일시교체할 수는 없다');
    // 편성 변경 후 저장·복원
    A.setLineup(null);
    const rest = myRoster(A).filter((p) => p.origin === 'domestic' && !A.injuryOf(p.id)).sort((a, b) => a.ovr - b.ovr)[0];
    A.setRest([rest.id]);
    const B = clone(A);
    sameState(`seed ${seed} 저장 직후`, A, B);
    let returnDay = null;
    while (!A.regularDone) {
      A.advance(1); B.advance(1);
      if (returnDay == null && A.rosterLog.some((e) => e.type === 'foreign' && e.kind === 'tempEnd' && e.forId === out.id)) returnDay = A.day;
      if (A.day % 9 === 0) sameState(`seed ${seed} day ${A.day}`, A, B);
    }
    sameState(`seed ${seed} 정규리그 끝`, A, B);
    // 복귀와 교체 종료는 같은 날: 원선수는 돌아오고 대체 선수는 명단에서 사라진다
    const log = A.rosterLog;
    const back = log.find((e) => e.type === 'return' && e.playerId === out.id && e.day >= joinDay);
    const end = log.find((e) => e.type === 'foreign' && e.kind === 'tempEnd' && e.forId === out.id);
    if (end) {
      assert.ok(back, '복귀 기록이 없다'); assert.equal(back.day, end.day, '복귀와 대체 종료는 같은 날');
      assert.ok(!myRoster(A).some((p) => p.id === tempId), '교체가 끝났는데 대체 선수가 명단에 있다');
    }
    // 기록 귀속: 부상 중에는 원선수가 뛰지 않고 대체 선수만, 복귀 뒤에는 원선수만 뛴다
    const daysOf = (id) => A.dayResults.filter((d) => d.games.some((g) => [...g.box.home, ...g.box.away].some((l) => l.id === id && (l.minutes ?? 0) > 0))).map((d) => d.day);
    const origDays = daysOf(out.id), tempDays = daysOf(tempId);
    const lastTemp = end ? end.day : A.totalDays;
    assert.ok(tempDays.length > 0, '대체 선수가 한 경기도 안 뛰었다');
    assert.ok(tempDays.every((d) => d > joinDay - 1 && d <= lastTemp), '대체 선수가 합류 전·종료 뒤에 뛰었다');
    assert.ok(origDays.every((d) => d <= hurt.day || (end && d >= end.day) || !end), `원선수가 부상 중에 뛰었다 (${origDays.filter((d) => d > hurt.day && (!end || d < end.day))})`);
    // 정산: 우리 팀 보수 총액 = 시즌 끝 명단의 연봉 합 + 대체 선수가 뛴 기간만큼의 일할 보수
    A.startPlayoffs(); while (!A.playoffs.done) A.playoffRound(); A.endSeason();
    const led = A.state.seasonEnd.entry.ledger[MY];
    const usd = A.rules.transactions.funds.foreignUsdToEok;
    const eokOf = (p) => (p.origin === 'foreign' ? p.contract.salaryUsd * usd : p.contract.salaryEok);
    const finalPay = A.state.seasonEnd.league.players.filter((p) => p.teamId === MY).reduce((s, p) => s + eokOf(p), 0);
    const tempEok = cand.usd * usd, served = (end ? end.day : A.totalDays) - joinDay;
    assert.ok(Math.abs(led.payroll - (finalPay + tempEok * served / A.totalDays)) < 0.06, `보수 총액 ${led.payroll} ≠ 명단 ${finalPay.toFixed(2)} + 일할 ${(tempEok * served / A.totalDays).toFixed(2)}`);
    assert.equal(A.state.seasonEnd.league.players.some((p) => p.id === tempId && p.teamId === MY), false, '시즌이 끝나면 일시교체 선수는 떠난다');
    // 뉴스에 부상·일시교체 기록이 남는다
    assert.ok(log.some((e) => e.type === 'foreign' && e.kind === 'temp' && e.outId === out.id), '일시교체 기록이 없다');
    if (ran >= 2) break;
  }
  assert.ok(ran >= 1, '외국인 부상 시나리오를 한 번도 만들지 못했다');
});

// ---------- 보조: 단일 출처 ----------
test('전력의 단일 출처: 엔진이 다음 경기에 쓰는 편성(lineupOf)이 박스스코어의 출전 명단과 같다(자동·직접 편성·부상 대체)', () => {
  const s = Session.create(busy, { managerId: MY, gmName: 'T', seed: 31 });
  for (let day = 0; day < 30; day++) {
    const mine = s.lineupOf(MY);
    const ids = new Set(idsOf(mine));
    const [d] = s.advance(1);
    for (const id of myBoxIds(d)) assert.ok(ids.has(id), `${day + 1}일차: 표시 편성 밖의 선수 ${id}가 뛰었다`);
    // 스타팅 5명은 모두 출전
    const played = myBoxIds(d);
    for (const p of mine.starters) assert.ok(played.has(p.id), `${day + 1}일차: 스타팅 ${p.name}이(가) 뛰지 않았다`);
  }
  assert.ok(payrollEok(s.players, MY) > 0);
});


// ---------- (플레이오프 한 경기씩 진행) ----------
const poSig = (s) => plain(s.playoffs.result().series.map((x) => [x.round, x.higherId, x.lowerId, x.winnerId, x.wins, x.games.map((g) => [g.homeId, g.homePts, g.awayPts, g.overtimes, g.att, g.fx, g.box])]));
const poSeeds = (n = 3) => {
  const out = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = Session.create(base, { managerId: MY, gmName: 'T', seed });
    finishRegular(s); s.startPlayoffs();
    if (s.playoffStatus() !== 'notQualified') out.push({ seed, s });
    if (out.length >= n) break;
  }
  return out;
};

test('플레이오프 한 경기씩: 한 경기 진행·시리즈 끝까지·라운드 일괄이 모두 같은 결과를 낸다(난수 순서 동일)', () => {
  const found = poSeeds(3);
  assert.ok(found.length >= 3, '플레이오프에 오른 시드가 모자란다');
  for (const { seed, s } of found) {
    const byRound = clone(s), byStep = clone(s), bySeries = clone(s);
    while (!byRound.playoffs.done) byRound.playoffRound();
    let steps = 0;
    while (!byStep.playoffs.done) { byStep.playoffStep(); steps++; }
    while (!bySeries.playoffs.done) bySeries.playoffSeries();
    assert.equal(poSig(byStep), poSig(byRound), `seed ${seed}: 한 경기씩 진행한 결과가 라운드 일괄과 다르다`);
    assert.equal(poSig(bySeries), poSig(byRound), `seed ${seed}: 시리즈씩 진행한 결과가 라운드 일괄과 다르다`);
    assert.equal(byStep.state.poGames, byRound.playoffs.gamesPlayed);
    assert.equal(byStep.state.poRounds, 3);
    assert.ok(steps >= 3, '한 경기씩이라면 여러 번 눌러야 한다');
    sameState(`seed ${seed} 끝`, byStep, clone(byStep)); // 끝난 뒤 복원도 같다
  }
});

test('플레이오프 한 경기씩: 경기 사이에 저장·불러오기를 해도 다음 경기 결과가 같다(시리즈 중간·시리즈 끝·라운드 경계)', () => {
  const [{ seed, s }] = poSeeds(1);
  let live = s, restores = 0;
  for (let guard = 0; guard < 40 && !live.playoffs.done; guard++) {
    const r = live.playoffStep();
    const back = clone(live);
    sameState(`seed ${seed} ${live.state.poGames}경기째`, live, back);
    if (r.mySeriesDone || r.games.some((g) => g.roundDone) || restores < 2) { restores++; live = back; } // 복원한 세션으로 갈아타 계속 진행한다
  }
  assert.ok(restores >= 3, '시리즈 끝·라운드 경계 복원을 확인하지 못했다');
  // 저장 없이 계속 진행한 세션과 최종 결과가 같다
  const straight = clone(poSeeds(1)[0].s);
  while (!straight.playoffs.done) straight.playoffStep();
  assert.equal(poSig(live), poSig(straight));
});

test('플레이오프 한 경기씩: 경기 사이의 휴식·전술·편성 변경이 다음 경기에 반영되고(그 경기에 쓰인 값이 기록됨) 복원해도 같다', () => {
  let usedRest = 0, usedTactic = 0;
  for (const { seed, s } of poSeeds(3)) {
    s.playoffStep(); // 1차전
    const star = idsOf(s.lineupOf(MY)).map((id) => s.players.find((p) => p.id === id)).sort((a, b) => b.ovr - a.ovr)[0];
    assert.equal(s.setRest([star.id]).ok, true, '플레이오프에서도 휴식을 지정할 수 있다');
    const other = (s.tactics?.list ?? []).find((t) => t.id !== s.tactics.current)?.id ?? null;
    if (other) { assert.equal(s.setTactic(other).ok, true, '플레이오프에서도 전술을 바꿀 수 있다'); usedTactic++; }
    assert.ok(!idsOf(s.lineupOf(MY)).includes(star.id), '쉬는 선수가 다음 경기 편성에서 빠진다');
    assert.deepEqual(s.state.actions.slice(-2).map((a) => a.pg != null), [true, true], '조작에 치른 경기 수가 붙는다');
    const back = clone(s);
    sameState(`seed ${seed} 조작 직후`, s, back);
    const r = s.playoffStep(); const rb = back.playoffStep();
    const g = r.mine.game;
    const side = g.homeId === MY ? g.fx.home : g.fx.away;
    assert.ok(side.rested.includes(star.id), '그 경기에 쓰인 값(fx)에 휴식 선수가 기록된다');
    if (other) assert.equal(side.tactic, other, '그 경기에 쓰인 전술이 기록된다');
    assert.ok(!(g.homeId === MY ? g.box.home : g.box.away).some((l) => l.id === star.id && l.minutes > 0), '쉰 선수가 뛰었다');
    assert.equal(plain(r.mine.game.box), plain(rb.mine.game.box), '복원한 세션도 같은 박스스코어');
    assert.deepEqual(s.rest, [], '휴식 지정은 그 경기를 치르면 비워진다');
    usedRest++;
    sameState(`seed ${seed} 경기 후`, s, back);
  }
  assert.equal(usedRest, 3); assert.ok(usedTactic >= 1);
});

test('플레이오프 컨디션: 경기마다 두 팀 선수만 지치고 라운드가 끝나면 회복한다(rules.playoffs.condition)', () => {
  const [{ s }] = poSeeds(1);
  const start = rules.condition.start;
  assert.ok(s.players.every((p) => (s.conditions.get(p.id) ?? start) === start), '플레이오프는 모두 회복해서 시작한다');
  const r = s.playoffStep();
  const g = r.mine.game;
  const playing = new Set([g.homeId, g.awayId, ...(r.games ?? []).flatMap((x) => [x.game?.homeId, x.game?.awayId])]); // 같은 날 다른 시리즈도 한 경기씩 치른다
  for (const p of s.players) {
    const c = s.conditions.get(p.id) ?? start;
    if (!playing.has(p.teamId)) assert.equal(c, start, '경기를 안 치른 팀의 컨디션은 그대로');
  }
  assert.ok(myRoster(s).some((p) => (s.conditions.get(p.id) ?? start) < start), '경기를 치른 우리 선수는 지쳤다');
  // 끝까지 진행해도 컨디션은 범위 안
  while (!s.playoffs.done) s.playoffStep();
  assert.ok([...s.conditions.values()].every((v) => v >= 0 && v <= 100));
});

// ---------- (여러 날 진행 중 중요 사건 중단) ----------
test('중요 사건: 진행이 그 날에서 멈추고(우리 주전 중상·인원 부족·교체 시점), 알림은 한 번만 생기며, 저장·복원해도 같은 알림이 같은 날에 다시 생긴다', () => {
  const hurtRules = { ...busy, rules: { ...busy.rules, injuries: { ...busy.rules.injuries, perMinute: 0.004 } } };
  const run = (seed) => { const s = Session.create(hurtRules, { managerId: MY, gmName: 'T', seed }); s.advance(54, { stopOnEvents: true }); return s; };
  let stopped = 0;
  for (const seed of [41, 42, 43, 44]) {
    const s = run(seed);
    if (!s.lastStop?.length) continue;
    stopped++;
    assert.ok(s.day < 54 || s.regularDone === false || s.lastStop, '멈췄다면 그 날에 서 있다');
    assert.ok(s.lastStop.every((a) => a.day === s.day), '멈춘 날의 사건이다');
    assert.ok(s.lastStop.some((a) => a.kind === 'injury' || a.kind === 'shortage' || a.kind === 'waiver' || a.kind === 'bubble'));
    // 같은 시드에서 같은 날에 멈춘다(결정적)
    const twin = run(seed);
    assert.equal(twin.day, s.day);
    assert.equal(plain(twin.alerts), plain(s.alerts));
    // 저장했다 복원해도 같은 알림이 생긴다(조작 기록과 무관한 파생 정보)
    const back = clone(s);
    assert.equal(plain(back.alerts), plain(s.alerts));
    // 이어서 진행하면 같은 사건이 다시 생기지 않는다
    const before = s.alerts.length;
    const ids = new Set(s.alerts.map((a) => a.id));
    s.advance(1, { stopOnEvents: true });
    const dup = s.alerts.filter((a) => a.kind === 'injury').map((a) => a.playerId + ':' + a.day);
    assert.equal(new Set(dup).size, dup.length, '같은 부상 알림이 두 번 생겼다');
    assert.ok(s.alerts.length >= before);
    for (const id of ids) assert.ok(s.alerts.some((a) => a.id === id));
  }
  assert.ok(stopped >= 2, '부상이 잦은 규칙인데도 멈춘 시드가 거의 없다');
  // stopOnEvents를 쓰지 않으면(자동 진행·테스트) 54일을 그대로 진행한다
  const plainRun = Session.create(hurtRules, { managerId: MY, gmName: 'T', seed: 41 });
  plainRun.advance(54);
  assert.equal(plainRun.regularDone, true);
  assert.equal(plainRun.lastStop, null);
});

test('플레이오프 중 옛 저장(poGames·pg 없음, 라운드 수만 있음)도 열리고 이어서 진행해 같은 결과가 나온다', () => {
  const [{ seed, s }] = poSeeds(1);
  s.playoffRound();
  const weak = myRoster(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr).slice(0, 12);
  s.setLineup({ starters: weak.slice(0, 5).map((p) => p.id), bench: weak.slice(5).map((p) => p.id) });
  const old = JSON.parse(serialize(s));
  delete old.poGames; for (const a of old.actions) delete a.pg; // 이 변경 전 저장 모양
  const opened = restore(s.data, JSON.stringify(old));
  assert.equal(opened.state.poGames, s.playoffs.gamesPlayed, '열면서 치른 경기 수를 채운다');
  { const fa = JSON.parse(fingerprint(s)), fb = JSON.parse(fingerprint(opened)); delete fa.actions; delete fb.actions; assert.deepEqual(fa, fb, `seed ${seed} 옛 저장: 열었을 때 상태가 다르다(조작 기록의 pg 표시만 제외)`); }
  while (!s.playoffs.done) { s.playoffStep(); opened.playoffStep(); }
  assert.equal(poSig(s), poSig(opened));
});

// ---------- (6) 유효 전력: 엔진이 쓰는 보정 = 화면이 보여 주는 보정 ----------
/** 세션의 지금 상태에서 effective 모듈로 다시 계산한 팀 보정(엔진의 team.mods와 같아야 한다) */
function recomputeMods(s) {
  const teams = s.data.teams.map((t) => ({ id: t.id, lineup: s.lineupOf(t.id) }));
  const staff = s.staff;
  return computeTeamMods(teams, { rules: s.rules, staff, manager: s.managerId, tacticChoice: s.tactics?.choice ?? null, condition: s.stage === 'regular' || s.rules.playoffs.condition?.enabled !== false, cond: s.conditions, meanIds: null, protagonist: Boolean(s.game.protagonist), baseRoster: baseRosterFor(s.data.players) }).mods;
}

test('유효 전력: 임의의 날 5곳에서 엔진이 실제로 쓴 보정 = effective 모듈 값, 화면 전력 = 기본 + 보정÷pointsPerPower', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 41 });
  const ppp = pointsPerPower(s.rules);
  for (const d of [0, 3, 7, 12, 20]) {
    while (s.day < d) s.advance(1);
    if (d === 7) s.setTactic(s.tactics.list.at(-1).id); // 일부러 가장 안 맞는 전술
    if (d === 12) s.setRest([myRoster(s).sort((a, b) => b.ovr - a.ovr)[0].id]);
    const mods = recomputeMods(s);
    for (const t of s.data.teams) {
      const live = s.teamMods[t.id], again = mods.get(t.id);
      assert.equal(live.edge, again.edge, `${d}일차 ${t.id}: 엔진 보정 합이 effective 모듈과 다르다`);
      assert.deepEqual(live.parts, again.parts, `${d}일차 ${t.id}: 보정 내역이 다르다`);
      const tp = s.teamPower(t.id);
      assert.equal(tp.edge, live.edge);
      assert.equal(tp.baseOvr, Math.round(powerOfLineup(s.lineupOf(t.id)) * 100) / 100);
      assert.equal(tp.effective, Math.round((powerOfLineup(s.lineupOf(t.id)) + tp.edge / ppp) * 100) / 100);
      assert.equal(tp.power, tp.effective);
    }
    assert.equal(s.powerRanking().find((r) => r.id === MY).power, s.teamPower(MY).power);
  }
});

test('유효 전력: 휴식·전술·컨디션·감독이 표시 전력을 올바른 방향으로 움직이고, 편집 중 편성 미리보기도 같은 값이다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 42 });
  while (s.day < 4) s.advance(1);
  const baseline = s.teamPower(MY);
  // 전술: 추천(적합도 최상) ≥ 균형 ≥ 가장 안 맞는 전술. 차이는 기대 득점 이득 ÷ pointsPerPower
  const ppp = pointsPerPower(s.rules);
  const list = recommend(s.lineupOf(MY), s.rules, s.tactics.refs, 1);
  s.setTactic('balanced');
  const bal = s.teamPower(MY);
  const best = list.find((r) => r.id !== 'balanced'), worst = list.at(-1);
  s.setTactic(best.id); const tb = s.teamPower(MY);
  s.setTactic(worst.id); const tw = s.teamPower(MY);
  assert.ok(tb.effective >= bal.effective - 0.011, `추천 전술이 균형보다 낮다 ${tb.effective} < ${bal.effective}`);
  assert.ok(tw.effective <= bal.effective + 0.011, `맞지 않는 전술이 균형보다 높다 ${tw.effective} > ${bal.effective}`);
  // 화면의 전술 행에 보이는 기대 득점 이득(s.tactics.list[].edge)은 엔진이 그 전술을 골랐을 때 쓰는 값(parts.tactic)과 같다
  assert.equal(tb.parts.tactic, s.tactics.list.find((r) => r.id === best.id).edge);
  assert.equal(tw.parts.tactic, s.tactics.list.find((r) => r.id === worst.id).edge);
  assert.equal(bal.parts.tactic, 0);
  // 휴식: 가장 센 선수를 쉬게 하면 기본 전력과 유효 전력이 내려간다
  s.setTactic(null);
  const before = s.teamPower(MY);
  s.setRest([myRoster(s).filter((p) => !s.injuryOf(p.id)).sort((a, b) => b.ovr - a.ovr)[0].id]);
  const rested = s.teamPower(MY);
  assert.ok(rested.baseOvr < before.baseOvr && rested.effective < before.effective);
  s.setRest([]);
  // 컨디션: 쉬지 않고 계속 뛰게 하면 팀 컨디션 보정이 나빠진다(리그 평균 대비)
  for (let i = 0; i < 12; i++) s.advance(1);
  const tired = s.teamPower(MY);
  assert.ok(Object.keys(tired.parts).every((k) => Number.isFinite(tired.parts[k])));
  // 편집 중 편성 미리보기(effectiveIf): 지금 편성을 그대로 넣으면 지금 값과 같다
  const lu = s.lineupOf(MY), cur = s.teamPower(MY);
  const same = s.effectiveIf({ starters: lu.starters, bench: lu.bench });
  assert.equal(same.effective, cur.effective);
  assert.equal(same.edge, cur.edge);
  // 약한 편성으로 바꾸면 미리보기 전력이 내려간다
  const weak = myRoster(s).filter((p) => p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr).slice(0, 12);
  const wk = s.effectiveIf({ starters: weak.slice(0, 5), bench: weak.slice(5) });
  assert.ok(wk.effective < cur.effective - 3);
  assert.ok(baseline && ppp > 0);
});

test('유효 전력: 시즌 시작 전 표(effectiveTable)와 프리뷰는 저장했다 복원해도 같은 값이다', () => {
  const s = Session.create(base, { managerId: MY, gmName: 'T', seed: 43 });
  const t0 = JSON.stringify([...effectiveTable(s.view, s.data).entries()].map(([id, e]) => [id, e.baseOvr, e.edge, e.effective]));
  const pv0 = s.preview();
  const r = clone(s);
  const t1 = JSON.stringify([...effectiveTable(r.view, r.data).entries()].map(([id, e]) => [id, e.baseOvr, e.edge, e.effective]));
  assert.equal(t1, t0);
  assert.equal(JSON.stringify(r.preview().rows.map((x) => [x.id, x.power, x.titleP, x.playoffP])), JSON.stringify(pv0.rows.map((x) => [x.id, x.power, x.titleP, x.playoffP])));
  // 시즌 시작 전(0일차) 엔진 표시 전력과 시작 전 표가 같은 값이다
  for (const t of s.data.teams) assert.equal(s.teamPower(t.id).effective, effectiveTable(s.view, s.data).get(t.id).effective, `${t.id}: 시작 전 표와 엔진 표시가 다르다`);
});
