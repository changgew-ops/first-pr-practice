import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNews, josa, fill, TEMPLATES, COMMENTS, allTemplateStrings, moodLabel } from '../src/news.mjs';
import { Session } from '../web/lib/session.js';
import { getNews, filterItems, communityPosts, TABS } from '../web/lib/news-view.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };

const BANNED = ['씨발', '시발', '병신', 'ㅂㅅ', 'ㅅㅂ', '좆', '개새', '꺼져', '죽어', '미친', '쓰레기', '멍청', '한남', '김치녀', '홍어', '전라도', '경상도', '틀딱', '장애', '찐따', '정치', '대통령'];
const text = (it) => [it.headline, it.body, ...it.comments.map((c) => c.text)].join(' ');
const dirty = (s) => /undefined|NaN|[{}]|\(가\)|\(를\)|\(이\)|\(은\)|\/가|\/는|\/를|\/와/.test(s);

function playSeason(s, days = 200) {
  s.advance(days); s.startPlayoffs();
  while (!s.playoffs.done) s.playoffRound();
}

test('조사: 받침과 숫자·영문 끝소리에 따라 고른다', () => {
  assert.equal(josa('서울 삼성', '은/는'), '은');
  assert.equal(josa('원주 DB', '과/와'), '와');
  assert.equal(josa('서울 SK', '이/가'), '가');
  assert.equal(josa('창원 LG', '이/가'), '가');
  assert.equal(josa('부산 KCC', '은/는'), '는');
  assert.equal(josa('90-80', '으로/로'), '으로'); // 영
  assert.equal(josa('88-79', '으로/로'), '로'); // 구
  assert.equal(josa('3승 1패', '으로/로'), '로');
  assert.equal(josa('4강', '을/를'), '을');
  assert.equal(josa('이정현(2)', '이/가'), '이'); // 동명이인 표기는 소리 나지 않는다
  assert.equal(fill('{a:은/는} {b}', { a: '서울 삼성', b: 1 }), '서울 삼성은 1');
  assert.equal(fill('{a} {b}', { a: 1 }), null, '값이 없는 토큰이 있으면 쓰지 않는다');
});

test('템플릿: 사건 종류마다 제목·본문 4개 이상, 댓글 풀도 충분하고 금지어가 없다', () => {
  for (const [kind, g] of Object.entries(TEMPLATES)) {
    assert.ok(g.h.length >= 4, `${kind} 제목 ${g.h.length}개`);
    assert.ok(g.b.length >= 4, `${kind} 본문 ${g.b.length}개`);
    assert.equal(new Set(g.h).size, g.h.length, `${kind} 제목 중복`);
  }
  for (const [pool, list] of Object.entries(COMMENTS)) assert.ok(list.length >= 4, `${pool} 댓글 ${list.length}개`);
  for (const s of allTemplateStrings()) for (const w of BANNED) assert.ok(!s.includes(w), `금지어 '${w}': ${s}`);
  // 선수 이름이 들어가는 댓글은 칭찬 풀에만 있다
  for (const [pool, list] of Object.entries(COMMENTS)) if (pool !== 'player_good') assert.ok(list.every((t) => !t.includes('{player')), `${pool}에 선수 이름`);
});

test('팬 심리 분위기 이름: 높으면 환호, 낮고 내려가면 격앙, 낮고 잠잠하면 체념', () => {
  assert.equal(moodLabel(80, 0), '환호');
  assert.equal(moodLabel(60, 0), '기대');
  assert.equal(moodLabel(50, 0), '불안');
  assert.equal(moodLabel(30, -5), '격앙');
  assert.equal(moodLabel(30, 0), '체념');
});

test('실제 데이터: 한 시즌과 오프시즌을 돌려도 기사에 undefined·NaN·빈 칸이 없고, 댓글은 3개 이하이며, 같은 입력이면 같은 기사', () => {
  for (const [seed, team] of [[1, 'busan-kcc'], [2, 'wonju-db'], [3, 'seoul-sk']]) {
    const s = Session.create(data, { managerId: team, gmName: 't', seed });
    for (let y = 0; y < 2; y++) {
      s.advance(20);
      let n = getNews(s, data);
      for (const it of n.items) assert.ok(it.headline && it.body, `${it.kind} 비었음`);
      playSeason(s); n = getNews(s, data);
      s.endSeason(); n = getNews(s, data);
      s.autoOffseason(); n = getNews(s, data);
      const ids = new Set();
      for (const it of n.items) {
        assert.ok(it.headline && it.body, `${it.kind} 비었음`);
        assert.ok(!dirty(text(it)), `${it.kind}: ${text(it)}`);
        assert.ok(it.comments.length <= 3);
        assert.equal(new Set(it.comments.map((c) => c.nick)).size, it.comments.length, '댓글 닉네임 중복');
        assert.ok(!ids.has(it.id), `기사 id 중복 ${it.id}`); ids.add(it.id);
        for (const w of BANNED) assert.ok(!text(it).includes(w), `금지어 ${w}`);
        for (const c of it.comments) assert.ok(c.votes >= 3 && c.team && c.nick);
      }
      assert.ok(Number.isFinite(n.mood.score) && n.mood.score >= 5 && n.mood.score <= 95);
    }
  }
  // 같은 저장(JSON)이면 같은 뉴스
  const s = Session.create(data, { managerId: 'seoul-sk', gmName: 't', seed: 5 });
  s.advance(31);
  const a = JSON.stringify(getNews(s, data));
  const b = JSON.stringify(getNews(new Session(data, JSON.parse(JSON.stringify(s.game))), data));
  assert.equal(a, b);
});

test('시즌 기사: 개막전·경기 결과·한 바퀴 결산·반환점·정규리그 종료·플레이오프·결산이 나온다', () => {
  const kinds = new Set();
  for (const [seed, team] of [[1, 'busan-kcc'], [2, 'wonju-db'], [3, 'seoul-sk'], [4, 'suwon-kt']]) {
    const s = Session.create(data, { managerId: team, gmName: 't', seed });
    kinds.add(getNews(s, data).items[0].kind);
    playSeason(s);
    for (const it of getNews(s, data).items) kinds.add(it.kind);
    s.endSeason();
    for (const it of getNews(s, data).items) kinds.add(it.kind);
  }
  for (const k of ['preview', 'opener_win', 'result_win', 'result_loss', 'cycle', 'midseason', 'regular_end', 'po_league', 'po_title', 'review_mid', 'funds_plus']) {
    if (k === 'opener_win' && kinds.has('opener_loss')) continue; // 개막전 결과는 시드에 따라 갈린다
    assert.ok(kinds.has(k) || (k === 'review_mid' && (kinds.has('review_top') || kinds.has('review_miss'))) || (k === 'funds_plus' && kinds.has('funds_minus')) || (k === 'po_title' && kinds.has('po_title_my')), `${k} 기사가 한 번도 나오지 않았다: ${[...kinds].join(',')}`);
  }
  assert.ok([...kinds].some((k) => /^(thriller|blowout|streak|star)_/.test(k)), '특별한 경기 기사가 하나는 있어야 한다');
});

test('오프시즌에서 바로 불러온 저장에서도 지난 시즌의 경기 기사가 나온다', () => {
  const s = Session.create(data, { managerId: 'seoul-sk', gmName: 't', seed: 9 });
  playSeason(s); s.endSeason();
  const loaded = new Session(data, JSON.parse(JSON.stringify(s.game)));
  const n = getNews(loaded, data);
  assert.ok(n.items.filter((i) => /^(result|opener|thriller|blowout|streak)_/.test(i.kind)).length >= 40);
  assert.ok(n.items.some((i) => i.kind.startsWith('review_')));
});

test('화면 분류: 우리 팀·리그·이적·커뮤니티 탭이 서로 다른 기사를 고른다', () => {
  const s = Session.create(data, { managerId: 'seoul-sk', gmName: 't', seed: 3 });
  playSeason(s); s.endSeason(); s.autoOffseason();
  const { items } = getNews(s, data);
  assert.deepEqual(TABS.map((t) => t[0]), ['all', 'my', 'league', 'move', 'community']);
  assert.equal(filterItems(items, 'all').length, items.length);
  assert.ok(filterItems(items, 'my').every((i) => i.scope === 'my' || i.scope === 'move'));
  assert.ok(filterItems(items, 'league').every((i) => i.scope === 'league') && filterItems(items, 'league').length > 0);
  assert.ok(filterItems(items, 'move').length > 0);
  assert.ok(filterItems(items, 'community').every((i) => i.comments.length));
  const posts = communityPosts(items, 20);
  assert.ok(posts.length > 0 && posts.length <= 20 && posts.every((p) => p.article && p.nick));
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].t >= items[i].t, '최신순이어야 한다');
});

// ----- 팬 심리 단조성: 합성 입력 -----
const T = Array.from({ length: 10 }, (_, i) => `t${i}`);
function synth(results) {
  // 우리 팀(t0)의 결과(true=승)를 그대로 한 경기씩. 나머지 팀의 경기는 홈 팀이 이긴다
  const dayResults = results.map((win, i) => {
    const games = [{ homeId: 't0', awayId: 't1', homePts: win ? 80 : 70, awayPts: win ? 70 : 80, winnerId: win ? 't0' : 't1', overtimes: 0 }];
    for (let k = 1; k < 5; k++) games.push({ homeId: T[k * 2], awayId: T[k * 2 + 1], homePts: 80, awayPts: 70, winnerId: T[k * 2], overtimes: 0 });
    return { day: i + 1, games };
  });
  return buildNews({ seed: 1, myTeamId: 't0', teams: T, startYear: 2026, season: '2026-27', teamName: (id) => `팀${'ABCDEFGHIJ'[Number(id.slice(1))]}`, games: 54, log: [], current: { stage: 'regular', day: results.length, totalDays: 54, dayResults } });
}

test('팬 심리 단조성: 이길수록 오르고 질수록 내리며, 연패 뒤 승리는 올린다', () => {
  let prev = synth([true]).mood.raw;
  for (let k = 2; k <= 10; k++) {
    const m = synth(Array(k).fill(true)).mood.raw;
    assert.ok(m > prev, `${k}연승: ${m} <= ${prev}`); prev = m;
  }
  prev = synth([false]).mood.raw;
  for (let k = 2; k <= 10; k++) {
    const m = synth(Array(k).fill(false)).mood.raw;
    assert.ok(m < prev, `${k}연패: ${m} >= ${prev}`); prev = m;
  }
  assert.ok(synth(Array(8).fill(true)).mood.score > 55 && synth(Array(8).fill(false)).mood.score < 55);
  const slump = synth([false, false, false, false, false]).mood.raw;
  assert.ok(synth([false, false, false, false, false, true]).mood.raw > slump);
  assert.ok(synth([true, true, true, true, true, false]).mood.raw < synth([true, true, true, true, true]).mood.raw);
  assert.equal(synth(Array(10).fill(true)).mood.label === '환호' || synth(Array(10).fill(true)).mood.label === '기대', true);
  assert.ok(['격앙', '체념'].includes(synth(Array(10).fill(false)).mood.label));
});

test('연승·연패 기사는 3·5·7연승(패)에서 나온다', () => {
  const n = synth(Array(5).fill(true));
  assert.deepEqual(n.items.filter((i) => i.kind === 'streak_win').map((i) => i.headline.match(/(\d+)연승/)?.[1]).sort(), ['3', '5']);
  const m = synth(Array(7).fill(false));
  assert.equal(m.items.filter((i) => i.kind === 'streak_lose').length, 3);
});

test('성능: 시즌 전체(54일)에서 뉴스를 만드는 데 오래 걸리지 않는다', () => {
  const s = Session.create(data, { managerId: 'wonju-db', gmName: 't', seed: 21 });
  playSeason(s);
  const t = performance.now();
  const n = getNews(s, data);
  const ms = performance.now() - t;
  assert.ok(n.items.length > 60);
  assert.ok(ms < 400, `${ms.toFixed(0)}ms`);
  const t2 = performance.now(); getNews(s, data); assert.ok(performance.now() - t2 < 5, '같은 상태에서는 캐시를 쓴다');
});
