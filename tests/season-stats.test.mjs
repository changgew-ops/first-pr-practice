import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildAll } from '../tools/build-season-stats.mjs';
import {
  aggregateStats, aggregateGames, aggregateLines, expandStatRow, splitCardName, valueOf, formatValue, filterPlayers, sortRecords, leadersOf,
  qualifyGames, hasData, teamValue, teamOrder
} from '../web/lib/league-view.js';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const seasons = read('data/history/seasons.json');
const statsOf = (season) => read(`data/history/stats/${season}.json`);

test('시즌 기록 JSON: data/history/stats가 공식 기록에서 다시 만든 것과 같다(생성물을 손으로 고치지 않는다)', () => {
  const built = buildAll();
  const files = readdirSync(new URL('../data/history/stats', import.meta.url)).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, built.map((b) => `${b.season}.json`).sort());
  assert.equal(built.length, 30); // 1997 ~ 2025-26 (진행 중인 2026-27은 게임이 직접 집계)
  for (const b of built) {
    const f = statsOf(b.season);
    assert.deepEqual(f.fields, b.fields);
    assert.deepEqual(f.rows, b.rows, `${b.season} 시즌 기록이 build:season-stats 결과와 다릅니다`);
  }
});

test('시즌 기록 JSON: 줄마다 득점 = 2·야투성공 + 3점성공 + 자유투성공, 리바운드 = 공격 + 수비, 승 + 패 = 경기 수', () => {
  for (const f of readdirSync(new URL('../data/history/stats', import.meta.url)).filter((x) => x.endsWith('.json'))) {
    const d = read(`data/history/stats/${f}`);
    const franchises = new Set(seasons.find((s) => s.season === d.season).teams.map((t) => t.franchiseId));
    for (const raw of d.rows) {
      const r = expandStatRow(d.fields, raw);
      const tag = `${d.season} ${r.name}(${r.teamId}, ${r.gt})`;
      assert.ok(franchises.has(r.teamId), `${tag} 그 시즌 순위표에 없는 구단`);
      assert.equal(r.pts, 2 * r.fgm + r.pm3 + r.ftm, `${tag} 득점 항등식`);
      assert.equal(r.reb, r.oreb + r.dreb, `${tag} 리바운드 항등식`);
      assert.equal(r.w + r.l, r.gp, `${tag} 승+패=경기`);
    }
  }
});

test('시즌 기록 집계: 2022-23·2023-24 정규리그 구단 평균 득점·어시스트가 KBL 발표값(80.0/17.4, 83.5/18.4)과 같다', () => {
  for (const [season, pts, ast] of [['2022-23', 80.0, 17.4], ['2023-24', 83.5, 18.4]]) {
    const a = aggregateStats(statsOf(season), ['r'], seasons.find((s) => s.season === season).teams);
    const gp = a.teams.reduce((s, t) => s + t.gp, 0);
    assert.equal(a.teams.length, 10);
    assert.equal(Number((a.teams.reduce((s, t) => s + t.pts, 0) / gp).toFixed(1)), pts, `${season} 경기당 득점`);
    assert.equal(Number((a.teams.reduce((s, t) => s + t.ast, 0) / gp).toFixed(1)), ast, `${season} 경기당 어시스트`);
    for (const t of a.teams) assert.equal(t.gp, 54);
  }
});

test('시즌 기록 집계: 구단 경기 수·승패는 순위표, 이적한 선수는 구단마다 한 줄을 합치고 주 소속을 정한다', () => {
  for (const s of seasons.filter((x) => x.season !== '2026-27').slice(0, 30)) {
    const a = aggregateStats(statsOf(s.season), ['r'], s.teams);
    for (const t of a.teams) {
      const st = s.teams.find((x) => x.franchiseId === t.id);
      assert.deepEqual([t.gp, t.w, t.l], [st.wins + st.losses, st.wins, st.losses], `${s.season} ${t.id}`);
    }
    assert.equal(a.teamsEstimated, false);
    // 같은 선수는 한 줄(선수번호가 키)
    assert.equal(new Set(a.players.map((p) => p.id)).size, a.players.length);
    for (const p of a.players) assert.ok(p.teamIds.includes(p.teamId));
  }
  const po = aggregateStats(statsOf('2010-11'), ['p', 'f']);
  assert.equal(po.teamsEstimated, true);
  assert.ok(po.players.length > 40 && po.teams.length >= 6);
});

test('league-view: 값·서식·정렬·필터·상위', () => {
  const p = (o) => ({ id: o.name, teamId: 'a', teamIds: ['a'], gp: 10, min: 300, pts: 100, reb: 50, oreb: null, dreb: null, ast: 20, stl: 5, blk: 2, fgm: 40, fga: 80, tpm: 5, tpa: 20, ftm: 15, fta: 20, to: null, pf: null, ...o });
  const rows = [p({ name: '가', pts: 200 }), p({ name: '나', pts: 150, gp: 3 }), p({ name: '다', pts: 180, teamId: 'b', teamIds: ['b'] }), p({ name: '라', pts: 90, fga: 0, fgm: 0 })];
  assert.equal(valueOf(rows[0], 'pts', 'avg'), 20);
  assert.equal(valueOf(rows[0], 'pts', 'total'), 200);
  assert.equal(valueOf(rows[0], 'fg'), 0.5);
  assert.equal(valueOf(rows[3], 'fg'), null);
  assert.equal(valueOf(rows[0], 'to'), null);
  assert.equal(formatValue(0.5, 'fg'), '50.0%'); assert.equal(formatValue(null, 'fg'), '-'); assert.equal(formatValue(1234, 'pts', 'total'), '1,234'); assert.equal(formatValue(20, 'pts'), '20.0');
  assert.deepEqual(sortRecords(rows, 'pts', -1, { mode: 'avg' }).map((r) => r.name), ['가', '나', '다', '라'].sort((a, b) => valueOf(rows.find((r) => r.name === b), 'pts') - valueOf(rows.find((r) => r.name === a), 'pts')));
  assert.equal(sortRecords(rows, 'fg', -1).at(-1).name, '라', '값이 없는 행은 뒤');
  assert.deepEqual(filterPlayers(rows, { team: 'b' }).map((r) => r.name), ['다']);
  assert.deepEqual(filterPlayers(rows, { q: '나' }).map((r) => r.name), ['나']);
  assert.deepEqual(filterPlayers(rows, { minGames: 5 }).map((r) => r.name), ['가', '다', '라']);
  assert.deepEqual(leadersOf(rows, 'pts', 2, { mode: 'avg', minGames: 5 }).map((x) => x.rec.name), ['가', '다']);
  assert.equal(leadersOf(rows, 'to', 3).length, 0);
  assert.equal(qualifyGames([{ gp: 54 }, { gp: 50 }], 0.5), 27);
  assert.equal(hasData(rows, 'to'), false); assert.equal(hasData(rows, 'pts'), true);
  assert.deepEqual(splitCardName('26 허웅'), { base: '허웅', label: '26' });
  assert.deepEqual(splitCardName('97초 정재근'), { base: '정재근', label: '97초' });
  assert.deepEqual(splitCardName('허웅'), { base: '허웅', label: null });
  const t = [{ w: 10, l: 5, pts: 100, pa: 90, gp: 15 }, { w: 10, l: 5, pts: 100, pa: 95, gp: 15 }];
  assert.ok(teamOrder(t[0], t[1]) < 0);
  assert.equal(teamValue(t[0], 'diff', 'total'), 10); assert.equal(teamValue({ ...t[0], pa: null }, 'diff'), null);
});

const data = { rules: read('data/league-rules.json'), teams: read('data/teams.json'), players: read('data/players.json'), history: loadHistory(), profiles: read('data/players/profiles.json'), careers: read('data/players/careers.json') };

test('진행 중 시즌 집계: 박스스코어 합이 시즌 누적과 같고 구단 득점·실점·승패가 순위표와 맞다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'T', seed: 8 });
  s.advance(27);
  const a = aggregateGames(s.dayResults);
  assert.equal(a.teams.length, 10);
  for (const p of a.players) {
    const t = s.run.totals.get(p.id);
    assert.deepEqual([p.gp, p.pts, p.reb, p.ast], [t.games, t.points, t.rebounds, t.assists], p.name);
    assert.ok(!/^\d{2}초? /.test(p.name), '카드 연도 표기는 이름에서 뗀다');
  }
  const st = s.standings();
  for (const t of a.teams) {
    const r = st.find((x) => x.id === t.id);
    assert.deepEqual([t.w, t.l, t.pts, t.pa], [r.wins, r.losses, r.pointsFor, r.pointsAgainst], t.id);
    assert.equal(t.gp, 27);
  }
  assert.ok(a.players.some((p) => p.card === '26'));
});

test('게임에서 끝난 시즌 집계: 저장된 선수 줄에서 선수·구단 기록을 만들고 이전 저장(앞 7칸만)도 연다', () => {
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'T', seed: 8 });
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs();
  for (let i = 0; i < 3 && s.stage === 'playoffs'; i++) { try { s.playoffRound(); } catch { break; } }
  if (s.stage !== 'offseason') s.endSeason();
  s.autoOffseason();
  const entry = s.game.log[0];
  assert.ok(entry && entry.lines);
  const a = aggregateLines(entry);
  assert.ok(a.players.length > 100);
  const sample = a.players.find((p) => p.gp > 30);
  assert.ok(sample.teamId && sample.fga > 0 && sample.name && !/^\d{2}초? /.test(sample.name));
  assert.equal(a.teams.length, 10);
  for (const t of a.teams) { const r = entry.standings.find((x) => x.id === t.id); assert.deepEqual([t.w, t.l, t.pts, t.pa], [r.wins, r.losses, r.pointsFor, r.pointsAgainst]); assert.ok(t.fga > 0); }
  // 이전 저장: 줄이 7칸뿐
  const old = { ...entry, lines: Object.fromEntries(Object.entries(entry.lines).map(([id, l]) => [id, l.slice(0, 7)])) };
  const b = aggregateLines(old);
  assert.ok(b.players.every((p) => p.fga == null));
  assert.ok(b.teams.every((t) => t.fga == null && t.pts > 0));
});
