import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ovrDelta, statDelta, deltaText, deltaClass, deltaOf } from '../src/ovr-delta.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { progressPlayer, runOffseason } from '../src/offseason.mjs';
import { expandCard, cardPlayer } from '../src/cards.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { legacyOvr } from '../src/rating.mjs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards };

test('변화 표시 문자열: 오름 (+3), 내림 (-2), 0이나 기준 없음은 표시 없음', () => {
  assert.equal(deltaText(3), '(+3)'); assert.equal(deltaText(-2), '(-2)'); assert.equal(deltaText(0), '');
  assert.equal(deltaClass(3), 'up'); assert.equal(deltaClass(-1), 'down'); assert.equal(deltaClass(0), '');
  assert.equal(ovrDelta({ ovr: 66, ovrWas: 63 }), 3);
  assert.equal(ovrDelta({ ovr: 66 }), 0, '기준이 없으면 변화 없음');
  assert.equal(statDelta({ stats: { shooting: 70 }, statsWas: { shooting: 72 } }, 'shooting'), -2);
  assert.equal(statDelta({ stats: { shooting: 70 } }, 'shooting'), 0);
  assert.equal(deltaOf(null, 3), 0);
});

test('기준값: 게임 시작은 현재 값, 오프시즌 성장·노화는 노화 직전 값', () => {
  const league = createLeague(players, rules);
  for (const p of league.players) { assert.equal(p.ovrWas, p.ovr); assert.deepEqual(p.statsWas, p.stats); }
  const p0 = league.players[0];
  const next = progressPlayer(p0, rules, mulberry32(3));
  assert.equal(next.ovrWas, p0.ovr); assert.deepEqual(next.statsWas, p0.stats);
  assert.notStrictEqual(next.statsWas, p0.stats, '같은 객체를 공유하지 않는다');
  // 두 번째 오프시즌에서는 첫 오프시즌 뒤의 값이 기준이 된다
  const again = progressPlayer(next, rules, mulberry32(4));
  assert.equal(again.ovrWas, next.ovr);
});

test('오프시즌: 살아남은 선수는 노화 직전 값이 기준, 새로 들어온 선수(신인·FA 카드·외국인)는 기준이 없다', () => {
  const league = createLeague(players, rules);
  const standings = teams.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));
  const { league: next, report } = runOffseason(league, standings, teams, rules, mulberry32(9), { cards });
  const before = new Map(league.players.map((p) => [p.id, p]));
  let kept = 0;
  for (const p of next.players) {
    const old = before.get(p.id);
    if (old) { kept++; assert.equal(p.ovrWas, old.ovr, `${p.name} 기준값`); }
    else assert.equal(p.ovrWas, undefined, `${p.name}은(는) 새로 들어와 기준이 없다`);
  }
  assert.ok(kept > 100);
  assert.ok(report.progressed.length > 100);
});

test('시즌 중 갱신은 기준값을 건드리지 않아 변화로 보인다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'T', seed: 5 });
  while (!s.regularDone) s.advance(9);
  const changed = s.players.filter((p) => p.ovrWas != null && p.ovr !== p.ovrWas);
  assert.ok(changed.length >= 5, `시즌 중 OVR이 바뀐 선수 ${changed.length}명`);
  for (const p of s.players) assert.equal(p.ovrWas != null, true);
  const first = s.players.find((p) => p.ovr !== p.ovrWas);
  assert.equal(ovrDelta(first), first.ovr - first.ovrWas);
});

test('FA 시장에 과거 시즌 카드가 나온다: 수·중복·나이·보상 없음, 카드를 주지 않으면 없다', () => {
  const standings = teams.map((t, i) => ({ id: t.id, wins: 40 - i * 3, losses: 14 + i * 3 }));
  let total = 0, signedCards = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const league = createLeague(players, rules);
    const { league: next, report } = runOffseason(league, standings, teams, rules, mulberry32(seed), { cards });
    assert.equal(report.faCards.length, rules.cards.faPerYear, `FA 카드 수`);
    total += report.faCards.length;
    const all = [...next.players, ...next.freeAgents];
    const byId = new Map(all.map((p) => [p.id, p]));
    const kbl = all.map((p) => p.kblId).filter(Boolean);
    assert.equal(new Set(kbl).size, kbl.length, '같은 선수가 둘');
    for (const id of report.faCards) {
      const p = byId.get(id);
      if (!p) continue; // 계약 못 하고 풀에서 밀려난 카드
      assert.ok(p.card && p.age >= 18);
    }
    for (const sgn of report.signings) { if (report.faCards.includes(sgn.id)) { signedCards++; assert.equal(sgn.compensation, null, '카드는 원소속 구단이 없어 보상이 없다'); assert.equal(sgn.from, null); } }
    const plain = runOffseason(league, standings, teams, rules, mulberry32(seed));
    assert.equal(plain.report.faCards, undefined);
    assert.equal(plain.league.players.filter((p) => p.card && p.card.season !== rules.season).length, 0);
  }
  assert.ok(total >= 40);
  assert.ok(signedCards >= 6, `시장에서 계약된 카드 ${signedCards}`);
});

test('카드 균형: 12시즌 뒤에도 리그 국내 평균 OVR이 시작보다 3 넘게 오르지 않고 카드 선수가 상위권에 섞인다', () => {
  const rng = mulberry32(31);
  let league = createLeague(players, rules);
  const avg = (l) => { const d = l.players.filter((p) => p.origin === 'domestic'); return d.reduce((s, p) => s + legacyOvr(p.ovr), 0) / d.length; }; // 예전 OVR 눈금으로 잰 평균(src/rating.mjs)
  const start = avg(league);
  for (let y = 0; y < 12; y++) league = playLeagueYear(league, teams, rules, rng, { cards }).league;
  assert.ok(avg(league) - start < 3, `평균 OVR ${start.toFixed(1)} → ${avg(league).toFixed(1)}`);
  const top = [...league.players.filter((p) => p.origin === 'domestic')].sort((a, b) => b.ovr - a.ovr).slice(0, 40);
  assert.ok(top.filter((p) => p.card && p.card.season !== rules.season).length >= 3, '카드 선수가 상위 40명에 3명 이상');
});
