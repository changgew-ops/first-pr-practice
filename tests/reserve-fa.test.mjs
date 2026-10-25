// 새 게임 첫 시즌에도 시즌 중 FA 시장에 영입할 선수가 있다(가상 선수), 옛 저장·규칙이 없을 때는 비어 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { reserveFreeAgents } from '../src/league.mjs';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const base = { rules, teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), cards };
const noWaiver = { ...base, rules: { ...rules, waivers: { ...rules.waivers, enabled: false } } };
const MY = 'busan-kcc';

test('새 게임 첫 시즌: 시장에 가상 FA가 포지션마다 있고 실존 선수·이름과 겹치지 않는다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 21 });
  const market = s.faMarket();
  const { perPosition } = rules.inSeason.fa.reserve;
  assert.equal(market.length, perPosition * 5);
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) assert.equal(market.filter((m) => m.player.position === pos).length, perPosition);
  assert.ok(market.every((m) => m.player.virtual && m.player.real === false && m.player.origin === 'domestic' && m.player.teamId === null));
  const taken = new Set(s.players.map((p) => p.name));
  assert.ok(market.every((m) => !taken.has(m.player.name)));
  assert.equal(new Set(market.map((m) => m.player.id)).size, market.length);
  // 시작 로스터 선수보다 약하다(주전을 밀어내지 않는다)
  const lowestRostered = Math.min(...s.players.filter((p) => p.origin === 'domestic').map((p) => p.ovr));
  assert.ok(market.every((m) => m.player.ovr <= lowestRostered + 2), '가상 FA는 예비 전력 수준');
});

test('같은 시드면 같은 가상 FA, 규칙이 없으면 비어 있다', () => {
  const a = reserveFreeAgents(rules, 7, ['x']), b = reserveFreeAgents(rules, 7, ['x']), c = reserveFreeAgents(rules, 8, ['x']);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.freeAgents.map((p) => p.name), c.freeAgents.map((p) => p.name));
  const none = reserveFreeAgents({ ...rules, inSeason: { ...rules.inSeason, fa: { ...rules.inSeason.fa, reserve: undefined } } }, 7, []);
  assert.deepEqual(none.freeAgents, []);
});

test('가상 FA 영입 → 저장·복원이 같고 시즌을 끝까지 돌릴 수 있다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 21 });
  const cand = s.faMarket()[0];
  const victim = s.players.filter((p) => p.teamId === MY && p.origin === 'domestic').sort((a, b) => a.ovr - b.ovr)[0];
  assert.equal(s.releasePlayer(victim.id).ok, true);
  const r = s.signFa(cand.player.id, { salaryEok: cand.asking, years: 1 });
  assert.equal(r.ok, true, r.errors?.[0]);
  assert.ok(!s.faMarket().some((m) => m.player.id === cand.player.id));
  const back = restore(noWaiver, serialize(s));
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId]).sort(), s.players.map((p) => [p.id, p.teamId]).sort());
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  s.endSeason();
  assert.equal(s.stage, 'offseason');
});

test('옛 저장(league.freeAgents가 비어 있는 게임)은 그대로 열린다', () => {
  const s = Session.create(noWaiver, { managerId: MY, gmName: 'T', seed: 21 });
  const saved = JSON.parse(serialize(s));
  saved.league.freeAgents = [];
  const old = restore(noWaiver, JSON.stringify(saved));
  assert.equal(old.faMarket().length, 0);
});
