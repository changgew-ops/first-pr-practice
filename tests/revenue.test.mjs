import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleSeason, revenueOf, initialAttendance, advanceAttendance, priceIndex, ticketYieldMan, attendanceFor, popularity, initialFunds } from '../src/funds.mjs';
import { parseArenasCsv, applyArenas } from '../src/arenas.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { loadHistory } from '../src/history.mjs';

const text = (p) => readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8');
const read = (p) => JSON.parse(text(p));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const att2324 = read('history/attendance-2023-24.json');
const rv = rules.revenue;
const REAL_AVG = att2324.league.totalAttendance / 270; // 2023-24 경기당 평균

// 2023-24 보정용: 모든 구단 5할, 지수는 2023-24 수준(리그 평균 2,735명)으로 맞춘다
const rec = { wins: 27, losses: 27 };
const asOf2324 = () => {
  const att = { ...initialAttendance(teams, rules), index: REAL_AVG / rv.gate.leagueAvgAttendance };
  return Object.fromEntries(teams.map((t) => [t.id, revenueOf(t.id, { team: t, teamData: teams, rec, stage: null, playoffs: null, prestige: null, season: rv.startYear, att }, { ...rules })]));
};

test('관중 자료: 시즌 표·2023-24 기사 수치가 서로 맞는다', () => {
  const rows = text('history/attendance.csv').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split(','));
  assert.equal(rows.length, 31);
  assert.equal(new Set(rows.map((r) => r[0])).size, 31);
  assert.equal(rows[0][0], '2026-27'); assert.equal(rows.at(-1)[0], '1997');
  const by = new Map(rows.map(([s, t]) => [s, Number(t)]));
  assert.equal(by.get('2023-24'), 836917); assert.equal(by.get('2025-26'), 913983);
  assert.ok(att2324.league.totalAttendance < by.get('2023-24'), '시즌 표는 플레이오프 포함 합계로 보인다');
  assert.equal(Math.round(att2324.league.totalAttendance / 270), 2735);
  // 객단가: 리그 100억/738,420, SK 15.3억/114,229 모두 약 1.34~1.36만원
  assert.ok(Math.abs(100e8 / att2324.league.totalAttendance - 13540) < 20);
  assert.ok(Math.abs(15.3e8 / 114229 - 13394) < 20);
});

test('보정: 구단별 팬 기반은 2023-24 구단 평균 관중 / 리그 평균에서 나왔다', () => {
  const by = Object.fromEntries(att2324.teams.map((t) => [t.team, t]));
  const ratio = (name) => (by[name].total / 27) / REAL_AVG;
  const fb = rv.gate.fanBase;
  for (const [id, name] of [['seoul-sk', '서울 SK'], ['changwon-lg', '창원 LG'], ['busan-kcc', '부산 KCC']]) assert.ok(Math.abs(fb[id] - ratio(name)) < 0.005, `${id} ${fb[id]} vs ${ratio(name).toFixed(3)}`);
  assert.ok(Math.abs(fb['wonju-db'] - (85634 / 27) / REAL_AVG) < 0.005);
  const known = att2324.teams.reduce((s, t) => s + t.total, 0);
  const rest = (att2324.league.totalAttendance - known) / 6 / 27 / REAL_AVG;
  assert.ok(Math.abs(rv.gate.fanBaseDefault - rest) < 0.005, `${rv.gate.fanBaseDefault} vs ${rest.toFixed(3)}`);
});

test('보정: 2023-24 수준에서 리그 평균 관중 약 2,700명·입장 수입 합 약 100억·구단 간 비율이 자료와 맞는다', () => {
  const out = asOf2324();
  const avgs = teams.map((t) => out[t.id].attendance.avg);
  const mean = avgs.reduce((a, b) => a + b) / avgs.length;
  assert.ok(Math.abs(mean - 2735) / 2735 < 0.05, `리그 평균 ${mean}`);
  const gate = teams.reduce((s, t) => s + out[t.id].parts.gate, 0);
  assert.ok(Math.abs(gate - 100) / 100 < 0.1, `입장 수입 ${gate.toFixed(1)}억`);
  const by = Object.fromEntries(att2324.teams.map((t) => [t.team, t.avg]));
  for (const [id, name] of [['seoul-sk', '서울 SK'], ['changwon-lg', '창원 LG'], ['busan-kcc', '부산 KCC']]) assert.ok(Math.abs(out[id].attendance.avg - by[name]) / by[name] < 0.08, `${id} ${out[id].attendance.avg} vs ${by[name]}`);
  assert.ok(Math.abs(out['seoul-sk'].parts.gate - 15.3) / 15.3 < 0.1, `SK 입장 수입 ${out['seoul-sk'].parts.gate}`);
  assert.ok(out['seoul-sk'].attendance.avg > out['changwon-lg'].attendance.avg && out['changwon-lg'].attendance.avg > out['busan-kcc'].attendance.avg);
});

test('객단가: 시작 시즌 평균 약 1.35만원, 물가 지수로 해마다 오른다', () => {
  const y = ticketYieldMan(1, rules) * 10000;
  assert.ok(Math.abs(y - 13540) / 13540 < 0.03, `객단가 ${y}`);
  assert.equal(priceIndex(rv.startYear, rules), 1);
  let prev = 1;
  for (let s = rv.startYear + 1; s <= rv.startYear + 30; s++) { const p = priceIndex(s, rules); assert.ok(p > prev); prev = p; }
  assert.ok(Math.abs(priceIndex(rv.startYear + 10, rules) - 1.025 ** 10) < 1e-9);
  assert.equal(priceIndex(rv.startYear - 3, rules), 1); // 시작 이전은 1
});

test('수입 구성: 성분 합 = 총수입이고, 같은 입력이면 같은 값(관중 포함), 시즌이 다르면 경기별 관중이 달라진다', () => {
  const t = teams[0], att = initialAttendance(teams, rules);
  const ctx = (season) => ({ team: t, teamData: teams, rec, stage: '우승', playoffs: null, prestige: null, season, att });
  const a = revenueOf(t.id, ctx(2026), rules), b = revenueOf(t.id, ctx(2026), rules);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Object.values(a.parts).reduce((s, v) => s + v, 0) - a.revenue) < 0.02);
  assert.notEqual(a.attendance.total, revenueOf(t.id, ctx(2027), rules).attendance.total);
  const x = attendanceFor({ season: 2026, teamId: 'a', key: 'r1', pop: 1 }, rules), y = attendanceFor({ season: 2026, teamId: 'a', key: 'r1', pop: 1 }, rules);
  assert.deepEqual(x, y);
});

test('수용 인원: 있으면 관중 상한·매진·점유율, 없으면 상한 없음(자료 없음)', () => {
  const t = teams.find((x) => x.id === 'seoul-sk'), att = initialAttendance(teams, rules);
  const base = { teamData: teams, rec, stage: null, playoffs: null, prestige: null, season: 2026, att };
  const free = revenueOf(t.id, { ...base, team: t }, rules).attendance;
  assert.equal(free.capacity, null); assert.equal(free.occupancy, null); assert.equal(free.sellouts, 0);
  const small = applyArenas(teams, [{ teamId: t.id, arena: t.arena, capacity: 3000, source: 'test', note: null }]).find((x) => x.id === t.id);
  const capped = revenueOf(t.id, { ...base, team: small }, rules).attendance;
  assert.ok(capped.avg <= 3000 && capped.sellouts > 20 && capped.occupancy > 0.9);
  assert.ok(capped.avg < free.avg);
});

test('경기장 CSV: 구단 id·경기장 이름이 teams.json과 같고, 수용 인원은 비어 있거나 양수', () => {
  const rows = parseArenasCsv(text('arenas.csv'));
  assert.equal(rows.length, teams.length);
  for (const t of teams) { const r = rows.find((x) => x.teamId === t.id); assert.ok(r, `${t.id} 행 없음`); assert.equal(r.arena, t.arena); assert.ok(r.capacity === null || r.capacity > 0); if (r.capacity !== null) assert.ok(r.source, `${t.id} 수용 인원 출처 없음`); }
  assert.throws(() => parseArenasCsv('teamId,arena,capacity,source,note\nx,y,-5,,'));
  assert.equal(applyArenas(teams, []).every((t) => t.venue.capacity === null), true);
});

test('팬 기반: 성적이 좋으면 오르고 나쁘면 내리며, 상·하한 안에서 출발값 쪽으로 돌아온다', () => {
  const st = (win) => teams.map((t) => ({ id: t.id, wins: win, losses: 54 - win }));
  const init = initialAttendance(teams, rules);
  const winner = advanceAttendance(init, { standings: st(40), playoffs: null, teamData: teams, season: 2026 }, rules);
  const loser = advanceAttendance(init, { standings: st(14), playoffs: null, teamData: teams, season: 2026 }, rules);
  const id = 'seoul-samsung';
  assert.ok(winner.fan[id] > init.fan[id] && loser.fan[id] < init.fan[id]);
  // 오래 지고 있어도 하한, 오래 이겨도 상한
  let lo = init, hi = init;
  for (let i = 0; i < 40; i++) {
    lo = advanceAttendance(lo, { standings: st(10), playoffs: null, teamData: teams, season: 2026 + i }, rules);
    hi = advanceAttendance(hi, { standings: st(44), playoffs: null, teamData: teams, season: 2026 + i }, rules);
  }
  const anchor = rv.gate.fanBase[id] ?? rv.gate.fanBaseDefault;
  assert.ok(lo.fan[id] >= anchor * rv.gate.fanMin - 1e-9 && hi.fan[id] <= anchor * rv.gate.fanMax + 1e-9);
  assert.ok(lo.fan[id] < anchor && hi.fan[id] > anchor);
  // 인기가 높으면 같은 승률에서도 관중이 많다
  assert.ok(popularity(1.5, 0.5, rules) > popularity(0.8, 0.5, rules));
});

test('리그 관중 규모: 시작 1.0, 장기적으로 완만한 상승, 상한 안(여러 시드 평균)', () => {
  assert.equal(initialAttendance(teams, rules).index, 1);
  assert.equal(rv.attendanceCap, 1.8); assert.ok(rv.attendanceTrend > 0 && rv.inflation > 0);
  const years = 30, seeds = [1, 2, 3];
  const tot = Array.from({ length: years }, () => []);
  let leagues = seeds.map((seed) => ({ rng: mulberry32(seed), league: createLeague(players, rules, { history: loadHistory(), teamData: teams }) }));
  for (let y = 0; y < years; y++) {
    leagues = leagues.map((s, i) => {
      const { league, report } = playLeagueYear(s.league, teams, rules, s.rng, {});
      const led = Object.values(report.ledger);
      tot[y].push(led.reduce((a, l) => a + l.attendance.total, 0));
      for (const l of led) assert.ok(Math.abs(Object.values(l.parts).reduce((a, v) => a + v, 0) - l.revenue) < 0.02);
      assert.ok(league.att.index <= rv.attendanceCap + 1e-9);
      return { rng: s.rng, league };
    });
  }
  const avg = (a) => a.reduce((x, y) => x + y) / a.length;
  const first = avg(tot[0]), last = avg(tot[years - 1]), mid = avg(tot[14]);
  assert.ok(first > 700000 && first < 900000, `시작 시즌 총 관중 ${first}`);
  assert.ok(mid > first && last > mid, `증가 추세 ${first} → ${mid} → ${last}`);
  assert.ok(last / first > 1.3 && last / first < 1.9, `30시즌 뒤 배율 ${(last / first).toFixed(2)}`);
  for (const row of tot) for (const v of row) assert.ok(v > 600000 && v < 1700000, `총 관중 ${v}`);
  // 구단 자금: 파산 구단 없음
  for (const s of leagues) for (const v of Object.values(s.league.funds)) assert.ok(v > -30);
});

test('이전 저장 호환: att 상태가 없는 league로도 정산되고 다음 상태를 만든다', () => {
  const league = createLeague(players, rules);
  assert.equal(league.att, undefined);
  const { league: next, report } = playLeagueYear(league, teams, rules, mulberry32(8), {});
  assert.ok(next.att && next.att.index > 0 && Object.keys(next.att.fan).length === teams.length);
  assert.ok(Object.values(report.ledger).every((l) => l.attendance.avg > 0 && l.revenue > 0));
  const standings = teams.map((t) => ({ id: t.id, wins: 27, losses: 27 }));
  const s = settleSeason(initialFunds(teams, rules), league.players, standings, null, teams, rules); // 예전 호출 방식(prestige·season·att 없음)
  assert.ok(s.att && s.ledger[teams[0].id].parts);
});
