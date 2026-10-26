// 극단 득점 경기, 라이벌·이전 소속팀·인터뷰, 가성비 영입 뉴스(src/news.mjs, src/game.mjs)와 그 화면 입력(web/lib/news-view.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateGame, extremeKind } from '../src/game.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session } from '../web/lib/session.js';
import { getNews, pinnedBig } from '../web/lib/news-view.js';
import { loadHistory } from '../src/history.mjs';
import { expandCard } from '../src/cards.mjs';
import { careerRows } from '../src/career.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const cards = { domestic: read('cards/domestic.json').rows.map(expandCard), foreign: read('cards/foreign.json').rows.map(expandCard) };
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards };
const sim = data.rules.simulation;

const regularGames = (s) => s.dayResults.flatMap((d) => d.games);

test('극단 득점 판정: 키가 같으면 같고, 확률은 규칙대로이며 플레이오프는 낮다', () => {
  assert.deepEqual(extremeKind({ key: 'k1' }, sim), extremeKind({ key: 'k1' }, sim));
  assert.equal(extremeKind({ key: 'k1' }, { ...sim, extreme: { ...sim.extreme, enabled: false } }), null);
  assert.equal(extremeKind({ key: 'k1' }, { ...sim, extreme: undefined }), null);
  let reg = 0, po = 0, up = 0, down = 0; const N = 40000;
  for (let i = 0; i < N; i++) {
    const a = extremeKind({ key: `t:${i}`, playoff: false }, sim); const b = extremeKind({ key: `t:${i}`, playoff: true }, sim);
    if (a) { reg++; if (a.shift > 0) up++; else down++; assert.ok(Math.abs(a.shift) >= sim.extreme.shift[0] && Math.abs(a.shift) <= sim.extreme.shift[1]); }
    if (b) po++;
  }
  const rate = reg / N;
  assert.ok(rate > 0.011 && rate < 0.019, `정규리그 확률 ${rate}`);
  assert.ok(po / N < rate * 0.6, `플레이오프 확률 ${po / N}`);
  assert.ok(up > reg * 0.4 && down > reg * 0.4, `난타·수비 비율 ${up}:${down}`);
});

test('simulateGame: ex가 없거나 걸리지 않은 경기는 난수를 더 쓰지 않아 예전과 같고, 걸리면 합계가 이동한다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 3 });
  const base = { offense: 55, defense: 55 };
  const home = { id: 'busan-kcc', lineup: s.run.lineupOf('busan-kcc') }; const away = { id: 'wonju-db', lineup: s.run.lineupOf('wonju-db') };
  const count = (fn) => { let n = 0; const r = mulberry32(99); const rng = () => { n++; return r(); }; const out = fn(rng); return { n, out }; };
  const plain = count((rng) => simulateGame(home, away, base, sim, rng));
  const zero = count((rng) => simulateGame(home, away, base, { ...sim, extreme: { ...sim.extreme, prob: 0 } }, rng, { key: 'x' }));
  assert.deepEqual(zero.out, plain.out);
  assert.equal(zero.n, plain.n);
  let hit = null;
  for (let i = 0; i < 4000 && !hit; i++) if (extremeKind({ key: `h${i}` }, sim)) hit = i;
  const k = extremeKind({ key: `h${hit}` }, sim);
  const ex = count((rng) => simulateGame(home, away, base, sim, rng, { key: `h${hit}` }));
  assert.equal(ex.n, plain.n, '극단 경기도 경기 난수를 더 쓰지 않는다');
  assert.equal(ex.out.ex, k.kind);
  const tot = (g) => g.homePts + g.awayPts;
  assert.ok(Math.sign(tot(ex.out) - tot(plain.out)) === Math.sign(k.shift), `${tot(plain.out)} → ${tot(ex.out)} (${k.shift})`);
});

test('새 게임의 정규리그: 극단 경기가 1~2%대로 나오고 같은 시드·조작이면 같으며, 옛 저장(game.ex 없음)은 하나도 없다', () => {
  let n = 0, ex = 0; const flags = []; const sums = {};
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed });
    while (!s.regularDone) s.advance(9);
    const games = regularGames(s); n += games.length; ex += games.filter((g) => g.ex).length;
    flags.push(games.map((g) => g.ex ?? '-').join(''));
    const copy = new Session(data, JSON.parse(JSON.stringify(s.game)));
    assert.equal(regularGames(copy).map((g) => g.ex ?? '-').join(''), flags.at(-1), '저장·복원해도 같은 경기가 극단 경기다');
    const avg = games.reduce((a, g) => a + g.homePts + g.awayPts, 0) / games.length;
    for (const g of games.filter((x) => x.ex)) (sums[g.ex] ??= []).push(g.homePts + g.awayPts - avg);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(sums.shootout) > 15, `난타전 평균 +${mean(sums.shootout).toFixed(1)}`);
  assert.ok(mean(sums.defensive) < -15, `수비전 평균 ${mean(sums.defensive).toFixed(1)}`);
  assert.ok(ex / n > 0.008 && ex / n < 0.03, `극단 경기 비율 ${ex}/${n}`);
  const old = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 1 });
  const g0 = JSON.parse(JSON.stringify(old.game)); delete g0.ex;
  const o = new Session(data, g0);
  while (!o.regularDone) o.advance(9);
  assert.equal(regularGames(o).filter((g) => g.ex).length, 0, '옛 저장은 극단 경기가 없다');
});

test('뉴스: 극단 경기마다 대서특필 기사가 있고 숫자가 경기와 같으며, 홈·뉴스 상단에 고정된다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 2 });
  while (!s.regularDone) s.advance(9);
  const exGames = s.dayResults.flatMap((d) => d.games.filter((g) => g.ex).map((g) => ({ day: d.day, g })));
  assert.ok(exGames.length >= 1);
  const items = getNews(s, data).items.filter((it) => it.kind.startsWith('extreme_'));
  assert.equal(items.length, exGames.length);
  for (const { day, g } of exGames) {
    const total = g.homePts + g.awayPts;
    const want = g.ex === 'shootout' ? 'extreme_shootout' : 'extreme_defense';
    const it = items.find((x) => x.kind === want && x.when.endsWith(`${day}일차`) && x.body.includes(`${total}점`) && x.body.includes(String(g.homePts)) && x.body.includes(String(g.awayPts)));
    assert.ok(it, `${day}일차 ${total}점 기사`);
    assert.equal(it.kind, g.ex === 'shootout' ? 'extreme_shootout' : 'extreme_defense');
    assert.ok(it.big && it.day === day);
    assert.ok(it.headline.includes(String(total)) || it.body.includes(`${g.homePts}-${g.awayPts}`) || it.body.includes(`${g.awayPts}`), '점수가 기사에 있다');
  }
  // 고정: 마지막 극단 경기 직후에는 잡히고, 3경기일 넘게 지나면 풀린다
  const last = exGames.at(-1);
  const s2 = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 2 });
  s2.advance(last.day); assert.ok(pinnedBig(s2, getNews(s2, data)), '직후에는 고정');
  s2.advance(5); const p = pinnedBig(s2, getNews(s2, data));
  assert.ok(!p || p.day >= s2.day - 3, '오래된 기사는 고정하지 않는다');
});

test('뉴스: 라이벌·이전 소속팀·인터뷰 기사의 근거 숫자가 자료와 같다', () => {
  const kinds = {};
  const history = data.history.seasons;
  const poMeet = (a, b) => history.reduce((n, hs) => n + (hs.playoffs?.rounds ?? []).reduce((m, r) => m + r.series.filter((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)).length, 0), 0);
  const nameToId = new Map(data.teams.map((t) => [t.name, t.id]));
  for (const [seed, team] of [[1, 'busan-kcc'], [2, 'seoul-sk']]) {
    const s = Session.create(data, { managerId: team, gmName: 't', seed });
    while (!s.regularDone) s.advance(9);
    for (const it of getNews(s, data).items) {
      if (!/^(rival_|former_|interview_)/.test(it.kind)) continue;
      (kinds[it.kind] ??= []).push(it);
      const text = [it.headline, it.body].join(' ');
      assert.ok(!/undefined|NaN|\{|\}/.test(text), text);
      if (it.kind.startsWith('interview_')) {
        assert.ok(it.body.includes('가상'), '가상 인터뷰임을 밝힌다');
        assert.ok(it.headline.includes('가상') || it.body.includes('가상 코멘트') || it.body.includes('가상의') || it.body.includes('가상 인터뷰'));
      }
      const m = it.body.match(/역대 플레이오프에서 (\d+)차례/);
      if (m) {
        const mentioned = data.teams.filter((t) => t.id !== team && it.body.includes(t.name) && poMeet(team, t.id) === Number(m[1]));
        assert.ok(mentioned.length >= 1, `${it.kind}: 플레이오프 ${m[1]}차례가 자료와 다르다`);
      }
      const f = it.body.match(/(\d+)시즌 동안 (\d+)경기|(\d+)시즌, 통산 (\d+)경기|(\d+)시즌 (\d+)경기/);
      if (f && it.kind.startsWith('former_')) {
        const seasons = Number(f[1] ?? f[3] ?? f[5]); const gp = Number(f[2] ?? f[4] ?? f[6]);
        const plain = (q) => q.name.replace(/^\d{2}초? /, '');
        const p = data.players.filter((q) => q.kblId && it.headline.includes(plain(q))).sort((a, b) => plain(b).length - plain(a).length)[0];
        assert.ok(p?.kblId, `${it.headline}: 선수를 찾지 못했다`);
        const rows = careerRows(data.careers[p.kblId], ['r']);
        const byTeam = new Map();
        for (const r of rows) { const o = byTeam.get(r.teamId) ?? { gp: 0, seasons: new Set() }; o.gp += r.gp; o.seasons.add(r.season); byTeam.set(r.teamId, o); }
        assert.ok([...byTeam.values()].some((o) => o.gp === gp && o.seasons.size === seasons), `${it.headline}: ${seasons}시즌 ${gp}경기가 기록과 다르다`);
      }
    }
  }
  assert.ok(kinds.rival_pre?.length && (kinds.rival_win?.length || kinds.rival_loss?.length), JSON.stringify(Object.keys(kinds)));
  assert.ok(kinds.interview_up || kinds.interview_down, '인터뷰 기사');
  assert.ok(kinds.former_my || kinds.former_opp, '이전 소속팀 기사');
  void nameToId;
});

test('뉴스: 가성비 영입(베스트·워스트·우리 팀)은 순위가 내려가고 숫자가 보고서와 같다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 't', seed: 1 });
  for (let y = 0; y < 2; y++) {
    s.advance(300); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); s.endSeason(); s.autoOffseason();
  }
  s.advance(300); s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound(); s.endSeason();
  const items = getNews(s, data).items;
  const best = items.find((it) => it.kind === 'value_best'); const worst = items.find((it) => it.kind === 'value_worst');
  assert.ok(best && worst, '가성비 기사');
  const sigs = s.state.log.at(-1).report.signings;
  const rank = (it) => [...it.body.matchAll(/(\d+)위 ([^(]+)\(([^·)]+)·([^·)]+)·([\d.]+)억/g)].map((m) => ({ n: Number(m[1]), name: m[2].trim(), team: m[3], src: m[4], salary: Number(m[5]) }));
  for (const it of [best, worst]) {
    const rows = rank(it);
    assert.ok(rows.length >= 3, `${it.kind} 목록 ${rows.length}`);
    rows.forEach((r, i) => assert.equal(r.n, i + 1));
    for (const r of rows.filter((x) => x.src === 'FA')) {
      assert.ok(sigs.some((g) => Math.abs(g.salaryEok - r.salary) < 0.06 && g.name.replace(/^\d{2}초? /, '') === r.name), `${r.name} ${r.salary}억이 FA 계약과 다르다`);
    }
    assert.ok(it.body.length <= 800 && it.paragraphs.length >= 2 && it.paragraphs.length <= 4);
  }
  assert.ok(worst.body.includes('연봉 3억 이상'), '워스트는 연봉 3억 이상 계약만 비교한다');
  for (const r of rank(worst)) assert.ok(r.salary >= 3);
  assert.ok(!/먹튀|쓰레기|무능/.test(worst.body + worst.headline), '순화된 표현');
});
