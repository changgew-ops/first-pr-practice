import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../web/lib/session.js';
import { windowStatus, tradablePlayers, valueComparison, precheck, rejectionText, payrollAfter, salaryOf } from '../web/lib/trades-view.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const MY = 'busan-kcc';
const league = (s) => ({ ...s.game.league, players: s.players });

test('트레이드 창 상태: 시즌 시작 전·진행 중·마감·플레이오프·오프시즌', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 41 });
  assert.equal(windowStatus(s).open, true);
  s.advance(10);
  const w = windowStatus(s);
  assert.equal(w.open, true); assert.match(w.detail, /26경기일/);
  s.advance(26);
  assert.match(windowStatus(s).detail, /마지막/);
  s.advance(1);
  assert.equal(windowStatus(s).open, false); assert.match(windowStatus(s).headline, /마감/);
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs();
  assert.match(windowStatus(s).headline, /플레이오프/);
  while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  assert.match(windowStatus(s).headline, /오프시즌/);
});

test('트레이드 가능 선수는 국내 선수만이고, 같은 인원이 아니면 미리 오류를 알려 준다', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 42 });
  s.advance(3);
  const mine = tradablePlayers(s.players, MY);
  assert.ok(mine.length >= 10 && mine.every((p) => p.origin === 'domestic'));
  const theirs = tradablePlayers(s.players, 'wonju-db');
  assert.deepEqual(precheck(league(s), { teamA: MY, teamB: 'wonju-db', giveA: [], giveB: [] }, data.rules, s.day), { errors: [], idle: true });
  const uneven = precheck(league(s), { teamA: MY, teamB: 'wonju-db', giveA: [mine[0].id, mine[1].id], giveB: [theirs[0].id] }, data.rules, s.day);
  assert.match(uneven.errors[0], /같은 인원/);
  const foreign = s.players.find((p) => p.teamId === MY && p.origin === 'foreign');
  const bad = precheck(league(s), { teamA: MY, teamB: 'wonju-db', giveA: [foreign.id], giveB: [theirs[0].id] }, data.rules, s.day);
  assert.ok(bad.errors.length > 0);
});

test('가치 비교: 받는 쪽이 더 좋으면 이득, 나쁘면 손해. 연봉 변화와 거절 문구', () => {
  const s = Session.create(data, { managerId: MY, gmName: 'A', seed: 40 }); // 5경기일 뒤의 순위·전력에 따라 구단 성향(가치 평가)이 달라지므로, 이 시드로 "받는 쪽이 더 좋으면 이득"이 성립하는 상황을 쓴다
  s.advance(5);
  const ctx = s.run.tradeContext();
  const mine = [...tradablePlayers(s.players, MY)].sort((a, b) => b.ovr - a.ovr);
  const theirs = [...tradablePlayers(s.players, 'wonju-db')].sort((a, b) => b.ovr - a.ovr);
  const up = valueComparison([theirs[0]], [mine.at(-1)], MY, league(s), ctx, data.rules);
  assert.equal(up.tone, 'good'); assert.ok(up.ratio > 1);
  const down = valueComparison([theirs.at(-1)], [mine[0]], MY, league(s), ctx, data.rules);
  assert.equal(down.tone, 'bad');
  const trade = { teamA: MY, teamB: 'wonju-db', giveA: [mine[0].id], giveB: [theirs[0].id] };
  const pay = payrollAfter(s.players, trade, data.rules);
  assert.ok(Math.abs(pay.mine - (s.players.filter((p) => p.teamId === MY && p.origin === 'domestic').reduce((a, p) => a + p.contract.salaryEok, 0) - salaryOf([mine[0]]) + salaryOf([theirs[0]]))) < 1e-9);
  const r = s.proposeTrade({ teamA: MY, teamB: 'wonju-db', giveA: [mine.at(-1).id], giveB: [theirs[0].id] });
  assert.equal(r.executed, false);
  assert.match(rejectionText(r, data.rules, '원주 DB'), /가치 비율 \d\.\d\d — 1\.05 이상/);
  assert.equal(rejectionText({ executed: true }, data.rules, 'x'), null);
});
