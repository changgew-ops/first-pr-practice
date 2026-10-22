import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferPosition } from '../src/position.mjs';
import { guessOrigin, mergeSeasons, candidateTeams, buildPool, applyAliases, positionFromRegistry, ageFromDraft, resolveRegistry, statlessPlayers, pickRoster } from '../src/real-players.mjs';
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

test('applyAliases: 시트 표기를 현재 표기로 바꾼다', () => {
  const out = applyAliases([row('조니 오브라이언트'), row('허웅')], new Map([['조니 오브라이언트', '자니 오브라이언트']]));
  assert.deepEqual(out.map((r) => r.name), ['자니 오브라이언트', '허웅']);
});

test('positionFromRegistry·ageFromDraft: 가드·포워드는 기록으로 세분하고, 나이는 드래프트 연도로 어림한다', () => {
  const guard = totals({ minutes: 360, rebounds: 20, assists: 80 });
  const wing = totals({ minutes: 360, rebounds: 50, assists: 20 });
  const big = totals({ minutes: 360, rebounds: 100, assists: 10 });
  assert.equal(positionFromRegistry('G', guard), 'PG');
  assert.equal(positionFromRegistry('G', wing), 'SG');
  assert.equal(positionFromRegistry('G', null), 'SG');
  assert.equal(positionFromRegistry('F', wing), 'SF');
  assert.equal(positionFromRegistry('F', big), 'PF');
  assert.equal(positionFromRegistry('C', guard), 'C');
  assert.equal(ageFromDraft(2025, 2026), 23);
  assert.equal(ageFromDraft(null), null);
});

test('resolveRegistry: 동명이인은 2025-26 소속으로 짝짓고, 풀에 없으면 기록 없는 선수로 남긴다', () => {
  const pool = [
    { name: '이정현(1)', candidateTeams: ['a', 'b'] }, { name: '이정현(2)', candidateTeams: ['a', 'b'] },
    { name: '허웅', candidateTeams: null }
  ];
  const entries = [
    { name: '이정현', team: 'b' }, { name: '이정현', team: 'a' }, { name: '허웅', team: 'c' }, { name: '신인', team: 'c' }
  ];
  const { map, extra } = resolveRegistry(entries, pool, new Map([['이정현(1)', 'a'], ['이정현(2)', 'b']]));
  assert.equal(map.get('이정현(1)').team, 'a');
  assert.equal(map.get('이정현(2)').team, 'b');
  assert.equal(map.get('허웅').team, 'c');
  assert.deepEqual(extra.map((e) => e.name), ['신인']);
  // 짝을 정할 수 없으면 억지로 잇지 않는다
  const amb = resolveRegistry([{ name: '이정현', team: 'z' }], pool, new Map());
  assert.equal(amb.map.size, 0);
  assert.equal(amb.extra.length, 1);
  assert.equal(amb.notes.length, 1);
});

test('statlessPlayers: 등록 정보만으로 선수를 만든다 (능력치는 비움)', () => {
  const [p] = statlessPlayers([{ name: '신인', team: 'seoul-sk', number: 7, position: 'G', kind: 'a', draftYear: 2025 }]);
  assert.equal(p.teamId, 'seoul-sk');
  assert.equal(p.position, 'SG');
  assert.equal(p.origin, 'domestic');
  assert.equal(p.asiaQuota, true);
  assert.equal(p.age, 23);
  assert.equal(p.stats, null);
});

test('pickRoster: 출전 시간 순으로 뽑고, 비는 포지션은 후보로 보충하거나 가까운 포지션으로 바꾼다', () => {
  const mkp = (name, position, minutes, origin = 'domestic') => ({ name, position, minutes, origin });
  const dom = ['PG', 'SG', 'SG', 'SF', 'SF', 'SF', 'SG', 'SG', 'SF', 'SF', 'SG', 'SF'].map((pos, i) => mkp(`d${i}`, pos, 1000 - i * 10));
  const list = [...dom, mkp('bench-pf', 'PF', 5), mkp('bench-c', 'C', 4), mkp('f1', 'SF', 900, 'foreign'), mkp('f2', 'SF', 800, 'foreign')];
  const a = pickRoster(list, { domestic: 12, foreign: 2 });
  assert.equal(a.roster.length, 14);
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) assert.ok(a.roster.some((p) => p.position === pos), pos);
  assert.ok(a.swaps.length >= 1);
  // 후보에도 없는 포지션은 겹치는 선수의 포지션을 바꾼다
  const b = pickRoster(list.filter((p) => p.position !== 'C' && !p.name.startsWith('bench')), { domestic: 12, foreign: 2 });
  assert.ok(b.roster.some((p) => p.position === 'C'));
  assert.ok(b.relabeled.length >= 2);
  // 로스터 밖에 남은 선수가 dropped
  assert.equal(a.roster.length + a.dropped.length, list.length);
});

test('등록선수 화면(registry.csv): 10개 구단 모두 국내·외국 인원이 충분하고 번호가 구단 안에서 겹치지 않는다', () => {
  const lines = readFileSync(new URL('../data/players/registry.csv', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  lines.shift();
  const byTeam = new Map();
  for (const l of lines) {
    const [name, team, number, position, kind] = l.split(',');
    assert.ok(['G', 'F', 'C'].includes(position), name);
    assert.ok(['d', 'f', 'a'].includes(kind), name);
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({ name, number, kind });
  }
  assert.equal(byTeam.size, 10);
  for (const [team, list] of byTeam) {
    assert.ok(list.filter((p) => p.kind === 'd').length >= 12, `${team} 국내`);
    assert.equal(list.filter((p) => p.kind === 'f').length, 2, `${team} 외국`);
    assert.equal(new Set(list.map((p) => p.number)).size, list.length, `${team} 등번호`);
  }
});
