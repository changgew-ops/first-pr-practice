import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferPosition } from '../src/position.mjs';
import { guessOrigin, mergeSeasons, candidateTeams, buildPool } from '../src/real-players.mjs';
import { parseStatsCsv } from '../src/stats-import.mjs';

const rules = JSON.parse(readFileSync(new URL('../data/league-rules.json', import.meta.url), 'utf8'));

const totals = (o = {}) => ({ games: 30, minutes: 900, points: 400, rebounds: 120, assists: 90, steals: 30, blocks: 10, fgm: 150, fga: 340, tpm: 40, tpa: 110, ftm: 60, fta: 80, ...o });
const row = (name, o) => ({ name, totals: totals(o), extra: {} });

test('inferPosition: 36분당 리바운드·어시스트로 역할을 추정한다', () => {
  const per36 = (reb, ast) => totals({ minutes: 360, rebounds: reb * 10, assists: ast * 10 });
  assert.equal(inferPosition(per36(11, 1)), 'C');
  assert.equal(inferPosition(per36(7, 2)), 'PF');
  assert.equal(inferPosition(per36(5, 2)), 'SF');
  assert.equal(inferPosition(per36(3, 6)), 'PG');
  assert.equal(inferPosition(per36(3, 2)), 'SG');
  assert.equal(inferPosition(totals({ minutes: 0, rebounds: 0, assists: 0 })), 'SG'); // 출전 0분이어도 터지지 않는다
});

test('guessOrigin: 이름에 공백이 있으면 외국 선수, 동명이인 표시는 무시한다', () => {
  assert.equal(guessOrigin('숀 롱'), 'foreign');
  assert.equal(guessOrigin('이정현(1)'), 'domestic');
  assert.equal(guessOrigin('허웅'), 'domestic');
});

test('mergeSeasons: 이름이 같은 선수는 스타일이 가까운 쪽끼리 잇는다', () => {
  const guard = (n) => row(n, { rebounds: 60, assists: 180 });
  const big = (n) => row(n, { rebounds: 300, assists: 30, tpa: 5, tpm: 1 });
  const prev = [guard('이정현(1)'), big('이정현(2)')];
  const cur = [big('이정현(1)'), guard('이정현(2)')]; // 번호가 뒤바뀌어 있다
  const { players, notes } = mergeSeasons(prev, cur);
  assert.equal(players.length, 2);
  for (const p of players) {
    const a = p.prev.totals.assists / p.prev.totals.rebounds;
    const b = p.cur.totals.assists / p.cur.totals.rebounds;
    assert.ok(Math.abs(Math.log(a / b)) < 0.01, '같은 유형끼리 이어져야 한다');
  }
  assert.equal(notes.length, 2);
});

test('mergeSeasons: 한쪽 시즌에만 있는 선수와 합쳐진 기록', () => {
  const { players } = mergeSeasons([row('가나다'), row('은퇴')], [row('가나다'), row('신인')]);
  const byName = Object.fromEntries(players.map((p) => [p.name, p]));
  assert.equal(byName['가나다'].totals.games, 60);
  assert.equal(byName['은퇴'].cur, null);
  assert.equal(byName['신인'].prev, null);
});

test('mergeSeasons: 올해만 있는 동명이인은 (신)으로 구분한다', () => {
  const { players } = mergeSeasons([row('김철수')], [row('김철수'), row('김철수', { minutes: 100 })]);
  assert.equal(new Set(players.map((p) => p.name)).size, players.length);
});

test('candidateTeams: 팀 승패가 구단 합계를 넘는 구단은 후보에서 빠진다', () => {
  const tt = { a: { wins: 40, losses: 20 }, b: { wins: 20, losses: 40 }, c: { wins: 30, losses: 30 } };
  assert.deepEqual(candidateTeams({ teamWins: 35, teamLosses: 10 }, tt), ['a']);
  assert.deepEqual(candidateTeams({ teamWins: 10, teamLosses: 10 }, tt).sort(), ['a', 'b', 'c']);
  assert.deepEqual(candidateTeams({}, tt).sort(), ['a', 'b', 'c']); // W/L이 없으면 거르지 않는다
});

test('buildPool: team-map 값이 우선하고, 모르는 항목은 비워 둔다', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row(`선수${i}`, { points: 200 + i * 20, minutes: 600 + i * 20 }));
  const { players } = mergeSeasons([], rows);
  const teamMap = new Map([['선수5', { team: 'seoul-sk', position: 'C', age: 27, number: 7 }]]);
  const pool = buildPool(players, rules, { teamMap });
  const p5 = pool.find((p) => p.name === '선수5');
  assert.equal(p5.teamId, 'seoul-sk');
  assert.equal(p5.position, 'C');
  assert.equal(p5.positionGiven, true);
  assert.equal(p5.age, 27);
  const other = pool.find((p) => p.name === '선수6');
  assert.equal(other.teamId, null);
  assert.equal(other.age, null);
  assert.ok(pool.every((p) => p.ovr >= 1 && p.ovr <= 100 && p.cost >= 1 && p.cost <= 20));
  // 출전 시간 순으로 정렬
  for (let i = 1; i < pool.length; i++) assert.ok(pool[i - 1].minutes >= pool[i].minutes);
});

test('실제 기록 CSV(25-26, 26-27): 합계 정합성과 W/L·DD2 컬럼', () => {
  for (const f of ['2025-26', '2026-27']) {
    const rows = parseStatsCsv(readFileSync(new URL(`../data/stats/${f}.csv`, import.meta.url), 'utf8'));
    assert.ok(rows.length > 100, f);
    const names = new Set();
    for (const r of rows) {
      assert.ok(!names.has(r.name), `${f} 이름 중복: ${r.name}`);
      names.add(r.name);
      const t = r.totals;
      assert.ok(t.fgm <= t.fga && t.tpm <= t.tpa && t.ftm <= t.fta, `${r.name} 성공 ≤ 시도`);
      assert.equal(t.points, 2 * (t.fgm - t.tpm) + 3 * t.tpm + t.ftm, `${r.name} 득점 = 야투+3점+자유투`);
      assert.equal(r.extra.teamWins + r.extra.teamLosses, t.games, `${r.name} 승+패 = 경기 수`);
    }
  }
});
