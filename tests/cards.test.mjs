import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandCard, cardPlayer, cardYearLabel, cardName, weightedSample, ovrWeight, cardOvr, foreignPriceUsd } from '../src/cards.mjs';
import { buildAll } from '../tools/build-cards.mjs';
import { parseBirthsCsv } from '../src/real-players.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const cardFile = (k) => read(`cards/${k}.json`);
const cards = { domestic: cardFile('domestic').rows.map(expandCard), foreign: cardFile('foreign').rows.map(expandCard) };
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards };

test('카드 데이터: data/cards가 공식 기록에서 다시 만든 것과 같다(생성물을 손으로 고치지 않는다)', () => {
  const built = buildAll();
  for (const k of ['domestic', 'foreign']) {
    const file = cardFile(k);
    assert.deepEqual(file.fields, built[k].fields);
    assert.deepEqual(file.rows, built[k].rows, `${k} 카드가 build:cards 결과와 다릅니다`);
  }
  assert.ok(cards.domestic.length > 2000 && cards.foreign.length > 600);
});

test('카드 연도 표기: 시작 연도 두 자리, 출범 첫 시즌만 "97초"', () => {
  assert.equal(cardYearLabel('1998-99'), '98');
  assert.equal(cardYearLabel('1999-2000'), '99');
  assert.equal(cardYearLabel('2000-01'), '00');
  assert.equal(cardYearLabel('2026-27'), '26');
  assert.equal(cardYearLabel('1997-98'), '97');
  assert.equal(cardYearLabel('1997'), '97초');
  assert.equal(cardName('서장훈', '1998-99'), '98 서장훈');
});

test('카드 데이터: 선수 시즌마다 한 장, 프로필(국내/외국) 구분과 맞고 능력치·나이가 범위 안', () => {
  const births = new Map(parseBirthsCsv(readFileSync(new URL('../data/players/births.csv', import.meta.url), 'utf8')).map((b) => [b.playerNo, b]));
  const seen = new Set();
  for (const [kind, list] of [['domestic', cards.domestic], ['foreign', cards.foreign]]) {
    for (const c of list) {
      const key = `${c.kblId}:${c.season}`;
      assert.ok(!seen.has(key), `중복 카드 ${key}`); seen.add(key);
      const b = births.get(c.kblId);
      assert.ok(b, `${c.name}(${c.kblId}) 프로필 없음`);
      assert.equal(kind === 'domestic', b.kind === 'domestic', `${c.name} 구분`);
      for (const k of ['shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina']) assert.ok(c[k] >= 20 && c[k] <= 99, `${c.name} ${k}`);
      assert.ok(c.age == null || (c.age >= 16 && c.age <= 46), `${c.season} ${c.name} 나이 ${c.age}`);
      assert.ok(c.min >= 300 && c.gp > 0);
      assert.notEqual(c.season, '2026-27'); // 지금 뛰는 시즌은 카드로 만들지 않는다
    }
  }
});

test('카드 → 선수: 서장훈 카드는 시즌마다 다른 카드이고 나이가 해마다 하나씩 는다', () => {
  const sj = cards.domestic.filter((c) => c.name === '서장훈').sort((a, b) => a.season.localeCompare(b.season));
  assert.ok(sj.length >= 10);
  for (let i = 1; i < sj.length; i++) {
    const gap = Number(sj[i].season.slice(0, 4)) - Number(sj[i - 1].season.slice(0, 4));
    assert.ok(sj[i].age - sj[i - 1].age === gap || sj[i].age - sj[i - 1].age === gap + 1 || sj[i].age - sj[i - 1].age === gap - 1);
  }
  const p = cardPlayer(sj[0], { id: 't1' });
  assert.equal(p.name, `${cardYearLabel(sj[0].season)} 서장훈`);
  assert.equal(p.baseName, '서장훈');
  assert.equal(p.potential, p.ovr); // 카드의 잠재력은 그 시즌 능력치
  assert.equal(p.ovr, cardOvr(sj[0]));
  assert.equal(p.origin, 'domestic'); assert.equal(p.real, true); assert.equal(p.kblId, sj[0].kblId);
  assert.equal(p.age, sj[0].age ?? rules.cards.unknownAge);
});

test('가중 추출: 같은 시드면 같은 결과, 중복 없음, OVR이 높을수록 드물다', () => {
  const items = cards.domestic.filter((c) => c.min >= 600);
  const w = (c) => ovrWeight(cardOvr(c), rules.cards);
  const a = weightedSample(items, w, 30, mulberry32(3)).map((c) => `${c.kblId}:${c.season}`);
  const b = weightedSample(items, w, 30, mulberry32(3)).map((c) => `${c.kblId}:${c.season}`);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 30);
  assert.ok(ovrWeight(60, rules.cards) === 1 && ovrWeight(80, rules.cards) < ovrWeight(70, rules.cards));
  const mean = (list) => list.reduce((s, c) => s + cardOvr(c), 0) / list.length;
  let sampled = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) for (const c of weightedSample(items, w, 10, mulberry32(seed))) { sampled += cardOvr(c); n++; }
  assert.ok(sampled / n < mean(items), '높은 OVR 카드가 덜 나온다');
});

test('외국인 요구 연봉: OVR에 비례하고 한도 안', () => {
  const cfg = rules.cards.foreignUsd;
  assert.equal(foreignPriceUsd(cfg.ovrLow - 10, cfg), cfg.min);
  assert.equal(foreignPriceUsd(cfg.ovrHigh + 10, cfg), cfg.max);
  assert.ok(foreignPriceUsd(72, cfg) > cfg.min && foreignPriceUsd(72, cfg) < cfg.max);
  assert.ok(cfg.max <= rules.salaryCap.foreignUsdPerPlayer);
});

test('엔진: 카드가 있으면 신인 후보와 외국인 영입에 과거 시즌 카드가 섞이고, 같은 사람은 리그에 한 명뿐이며 외국인 한도를 지킨다', () => {
  const rng = mulberry32(21);
  let league = createLeague(players, rules);
  let drafted = 0, foreign = 0;
  for (let y = 0; y < 6; y++) {
    const { league: next, report } = playLeagueYear(league, teams, rules, rng, { cards });
    const dc = report.drafted.filter((d) => d.card);
    assert.ok(dc.length <= rules.cards.draftPerYear);
    drafted += dc.length; foreign += report.foreignReplaced.filter((d) => d.card).length;
    const ids = [...next.players, ...next.freeAgents].map((p) => p.kblId).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, '같은 선수가 리그에 둘');
    for (const t of teams) {
      const f = next.players.filter((p) => p.teamId === t.id && p.origin === 'foreign');
      assert.ok(f.length <= rules.roster.foreign);
      assert.ok(f.reduce((s, p) => s + p.contract.salaryUsd, 0) <= rules.salaryCap.foreignUsdTotal + 1);
      for (const p of f) assert.ok(p.contract.salaryUsd <= rules.salaryCap.foreignUsdPerPlayer);
    }
    league = next;
  }
  assert.ok(drafted >= 6, `드래프트 카드 ${drafted}`);
  assert.ok(foreign >= 6, `외국인 카드 ${foreign}`);
});

test('엔진: 카드를 주지 않으면 이전과 같다(카드 선수가 없다)', () => {
  const rng = mulberry32(21);
  let league = createLeague(players, rules);
  for (let y = 0; y < 2; y++) league = playLeagueYear(league, teams, rules, rng).league;
  assert.equal(league.players.filter((p) => p.card).length, 0);
});

test('세션: 오프시즌에서 외국인 영입을 직접 고를 수 있고(foreign:n), 선택이 기록된다', () => {
  let asked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'T', seed });
    while (!s.regularDone) s.advance(9);
    s.startPlayoffs();
    while (s.playoffStatus() === 'alive' || s.stage === 'playoffs') { try { s.playoffRound(); } catch { break; } if (s.stage !== 'playoffs') break; }
    if (s.stage !== 'offseason') s.endSeason();
    let guard = 0;
    while (s.stage === 'offseason' && s.pending && guard++ < 80) {
      const { key, kind, payload } = s.pending;
      if (kind === 'trade') s.decide(key, { accept: [], proposals: [] });
      else if (kind === 'resign') s.decide(key, {});
      else if (kind === 'freeAgency') s.decide(key, []);
      else if (kind === 'compensation') s.decide(key, { type: 'cash' });
      else if (kind === 'draft') s.decide(key, payload.available[0].id);
      else if (kind === 'foreign') {
        asked++;
        assert.ok(payload.candidates.length > 0 && payload.candidates.every((c) => c.player.card && c.usd <= payload.maxUsd));
        const choice = payload.candidates[payload.candidates.length - 1].player;
        s.decide(key, choice.id);
        assert.ok(s.game.decisions[key] === choice.id || s.stage !== 'offseason');
      } else assert.fail(`모르는 결정 ${kind}`);
    }
    assert.equal(s.stage, 'regular');
    if (asked) break;
  }
  assert.ok(asked > 0, '외국인 영입 결정이 한 번도 나오지 않았다');
});
