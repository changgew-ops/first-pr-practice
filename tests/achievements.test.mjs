import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, newAchievements } from '../src/achievements.mjs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards: { domestic: [], foreign: [] } };
const rules = data.rules;
const MY = 'busan-kcc';

const entry = (stage, { champ = false, net = 1, penalty = 0, awards = null, lines = {}, trades = 0, ev = null } = {}) => ({
  stage: { [MY]: stage }, championId: champ ? MY : 'a', ledger: { [MY]: { net, penalty } }, awards, lines, ...(trades ? { report: { trades: Array(trades).fill({}) } } : {}), ...(ev ? { eval: ev } : {})
});
// standings에서 우리 팀 순위를 rank로 맞춘다
const mk = (rank, stage, opts) => { const e = entry(stage, opts); e.standings = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 === rank ? MY : `t${i}`, rank: i + 1, wins: 54 - (i + 1) * 5, losses: (i + 1) * 5 })); if (opts?.wins != null) e.standings[rank - 1].wins = opts.wins; return e; };
const ctx = (log, extra = {}) => ({ log, my: MY, roster: [], funds: 20, codexCount: 0, mood: 50, trust: 60, startSeason: '2026-27', firstPrevRank: null, rules, ...extra });
const ids = (c, have = {}) => newAchievements(have, c);

test('업적 목록: 20~30개, 이름·설명·난이도가 있고 id가 겹치지 않는다', () => {
  assert.ok(ACHIEVEMENTS.length >= 20 && ACHIEVEMENTS.length <= 30, `${ACHIEVEMENTS.length}개`);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) { assert.ok(a.name && a.desc && ['bronze', 'silver', 'gold'].includes(a.tier), a.id); assert.equal(typeof a.check, 'function'); }
  assert.equal(ACHIEVEMENT_BY_ID.title1.name, '첫 우승');
});

test('기록이 없으면 아무것도 달성하지 않는다(규칙 기준값으로 걸리는 보유 업적 제외)', () => {
  assert.deepEqual(ids(ctx([])), []);
});

test('시즌 수·플레이오프·순위·승수 업적', () => {
  const log = [mk(5, '6강'), mk(1, '결승', { wins: 41 })];
  const got = ids(ctx(log));
  for (const id of ['season1', 'po1', 'rank1', 'wins40', 'final']) assert.ok(got.includes(id), id);
  for (const id of ['title1', 'seasons5', 'po5']) assert.ok(!got.includes(id), id);
  assert.ok(ids(ctx(Array.from({ length: 5 }, () => mk(3, '6강')))).includes('po5'));
  assert.ok(ids(ctx(Array.from({ length: 20 }, () => mk(7, null)))).includes('seasons20'));
});

test('우승·3연패: 연속이어야 3연패, 통산 3회는 떨어져 있어도 된다', () => {
  const champ = () => mk(1, '우승', { champ: true });
  assert.ok(ids(ctx([champ(), champ(), champ()])).includes('threepeat'));
  const gap = [champ(), champ(), mk(3, '4강'), champ()];
  const g = ids(ctx(gap));
  assert.ok(!g.includes('threepeat') && g.includes('title3') && g.includes('title1'));
});

test('언더독·신데렐라: 직전 시즌 순위와 비교하고, 첫 시즌은 실제 직전 순위(firstPrevRank)로 비교한다', () => {
  assert.ok(ids(ctx([mk(10, null), mk(4, '6강')])).includes('underdog'));
  assert.ok(!ids(ctx([mk(7, null), mk(4, '6강')])).includes('underdog'));
  assert.ok(ids(ctx([mk(4, '6강')], { firstPrevRank: 9 })).includes('underdog'));
  assert.ok(!ids(ctx([mk(4, '6강')], { firstPrevRank: null })).includes('underdog'));
  assert.ok(ids(ctx([mk(9, null), mk(1, '우승', { champ: true })])).includes('cinderella'));
});

test('재정 업적: 3시즌 연속 흑자·캡 준수는 연속이어야 하고, 자금은 지금 값이다', () => {
  assert.ok(ids(ctx([mk(3, null, { net: 1 }), mk(3, null, { net: 0 }), mk(3, null, { net: 2 })])).includes('profit3'));
  assert.ok(!ids(ctx([mk(3, null, { net: 1 }), mk(3, null, { net: -1 }), mk(3, null, { net: 2 })])).includes('profit3'));
  assert.ok(ids(ctx([mk(3, null), mk(3, null), mk(3, null)])).includes('capClean3'));
  assert.ok(!ids(ctx([mk(3, null), mk(3, null, { penalty: 0.5 }), mk(3, null)])).includes('capClean3'));
  assert.ok(ids(ctx([], { funds: 100 })).includes('rich'));
  assert.ok(!ids(ctx([], { funds: 99.9 })).includes('rich'));
});

test('수상 업적: 우리 선수만 센다(선수 시즌 줄 13번째 칸이 소속)', () => {
  const lines = { p1: Array(14).fill(0).map((_, i) => (i === 13 ? MY : 0)), p2: Array(14).fill(0).map((_, i) => (i === 13 ? 'other' : 0)), p3: Array(14).fill(0).map((_, i) => (i === 13 ? MY : 0)) };
  const e = mk(3, null, { awards: { mvp: 'p1', rookie: 'p2', best5: ['p1', 'p2', 'p3'] }, lines });
  const got = ids(ctx([e]));
  assert.ok(got.includes('mvp') && got.includes('best5x2') && !got.includes('rookieAward'));
  assert.ok(ids(ctx([mk(3, null, { awards: { rookie: 'p1' }, lines })])).includes('rookieAward'));
});

test('로스터·도감·신뢰도·팬 열기 업적', () => {
  const p = (ovr, card) => ({ ovr, teamId: MY, ...(card ? { card: { season: card } } : {}) });
  assert.ok(ids(ctx([], { roster: [p(80)] })).includes('star80'));
  assert.ok(!ids(ctx([], { roster: [p(79)] })).includes('star80'));
  const past = Array.from({ length: 5 }, () => p(60, '2018-19'));
  assert.ok(ids(ctx([], { roster: past })).includes('pastCards'));
  assert.ok(!ids(ctx([], { roster: [...past.slice(0, 4), p(60, '2026-27')] })).includes('pastCards'), '시작 시즌 카드는 과거 카드가 아니다');
  assert.ok(ids(ctx([], { codexCount: 50 })).includes('codex50') && !ids(ctx([], { codexCount: 49 })).includes('codex50'));
  assert.ok(ids(ctx([], { codexCount: 120 })).includes('codex120'));
  assert.ok(ids(ctx([], { trust: 90 })).includes('trust90') && !ids(ctx([], { trust: 89 })).includes('trust90'));
  assert.ok(ids(ctx([], { mood: 70 })).includes('fans70') && !ids(ctx([], { mood: 69 })).includes('fans70'));
  assert.ok(ids(ctx([mk(3, null, { trades: 1 })])).includes('trade1'));
  assert.ok(ids(ctx([mk(3, null, { ev: { goals: [{ met: true }, { met: true }, { met: true }] } })])).includes('goalsAll'));
  assert.ok(!ids(ctx([mk(3, null, { ev: { goals: [{ met: true }, { met: false }, { met: true }] } })])).includes('goalsAll'));
});

test('이미 달성한 업적은 다시 나오지 않는다', () => {
  const c = ctx([mk(1, '우승', { champ: true })]);
  const first = ids(c);
  assert.ok(first.includes('title1'));
  assert.deepEqual(ids(c, Object.fromEntries(first.map((id) => [id, '2026-27']))), []);
});

test('세션 연결: 시즌을 끝내면 업적이 저장되고(달성 시즌만), 새 업적은 한 번만 알려 준다, 같은 시드는 같다', () => {
  const play = () => {
    const s = Session.create(data, { managerId: MY, gmName: 't', seed: 21 });
    while (!s.regularDone) s.advance(9);
    s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
    s.endSeason(); s.autoOffseason();
    return s;
  };
  const s = play();
  assert.ok(s.achievements.season1, '첫 시즌 완주');
  assert.match(s.achievements.season1, /^\d{4}-\d{2}$/);
  const fresh = s.takeFresh();
  assert.ok(fresh.includes('season1'));
  assert.deepEqual(s.takeFresh(), [], '한 번만');
  assert.deepEqual(play().achievements, s.achievements);
  // 불러오기(이전 저장)는 조용히 따라잡는다: 업적 필드를 지운 저장을 열면 다시 계산되지만 알림은 없다
  const game = JSON.parse(JSON.stringify(s.game)); delete game.achievements; delete game.codex;
  const back = new Session(data, game);
  assert.ok(back.achievements.season1);
  assert.deepEqual(back.takeFresh(), []);
});
