import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { standingsRows, formChips, streak, gameRow, boxTotals, bracketModel, seriesScore, advanceChoices, homeOrdinal, attendanceCalc, attendanceText } from '../web/lib/season-view.js';
import { attendanceFor, popularity, initialAttendance } from '../src/funds.mjs';

const rules = JSON.parse(readFileSync(new URL('../data/league-rules.json', import.meta.url), 'utf8'));

test('순위표 가공: 승률·득실·게임차와 6위 컷 표시', () => {
  const rows = standingsRows([
    { rank: 1, id: 'a', wins: 10, losses: 2, pointsFor: 1000, pointsAgainst: 900 },
    { rank: 2, id: 'b', wins: 8, losses: 4, pointsFor: 900, pointsAgainst: 900 },
    { rank: 3, id: 'c', wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }
  ], 2);
  assert.equal(rows[0].gb, 0); assert.equal(rows[1].gb, 2); assert.equal(rows[2].gb, 4);
  assert.ok(Math.abs(rows[0].diffPerGame - 100 / 12) < 1e-9);
  assert.deepEqual(rows.map((r) => r.cut), [false, true, false]);
  assert.equal(rows[2].pct, 0);
});

test('최근 경기 칩과 연승·연패', () => {
  const g = (win, day) => ({ day, win, home: true, oppId: 'x', my: 80, opp: 70, ot: 0 });
  const games = [g(false, 1), g(true, 2), g(true, 3), g(true, 4)];
  assert.equal(streak(games), 3);
  assert.equal(streak([g(true, 1), g(false, 2), g(false, 3)]), -2);
  assert.equal(streak([]), 0);
  const chips = formChips(games, () => '상대', 2);
  assert.deepEqual(chips.map((c) => c.label), ['승', '승']);
  assert.match(chips[0].title, /3일차 홈 vs 상대 80:70/);
});

test('경기 줄과 박스 합계', () => {
  const r = gameRow({ homeId: 'a', awayId: 'b', homePts: 80, awayPts: 70, winnerId: 'a', overtimes: 1 }, 'b');
  assert.equal(r.homeWon, true); assert.equal(r.mine, true); assert.equal(r.ot, 1);
  const t = boxTotals([{ points: 10, rebounds: 3, minutes: 20, fgm: 4, fga: 9 }, { points: 5, rebounds: 1, minutes: 18, fgm: 2, fga: 3 }]);
  assert.equal(t.points, 15); assert.equal(t.fga, 12); assert.equal(t.minutes, 38);
});

test('플레이오프 대진: 시드로 정해진 6강, 진행에 따라 4강·결승 팀이 채워진다', () => {
  const seeds = new Map(['s1', 's2', 's3', 's4', 's5', 's6'].map((id, i) => [id, i + 1]));
  const m0 = bracketModel(seeds, [], rules);
  assert.equal(m0.length, 5);
  assert.deepEqual([m0[0].a, m0[0].b, m0[1].a, m0[1].b], ['s3', 's6', 's4', 's5']);
  assert.deepEqual([m0[2].a, m0[2].b, m0[3].a, m0[3].b, m0[4].a], ['s1', null, 's2', null, null]);
  assert.deepEqual(m0.map((x) => x.name), ['6강', '6강', '4강', '4강', rules.playoffs.rounds[2].name]);
  const s0 = { round: '6강', higherId: 's3', lowerId: 's6', winnerId: 's6', wins: { s3: 1, s6: 3 }, games: [] };
  const s1 = { round: '6강', higherId: 's4', lowerId: 's5', winnerId: 's4', wins: { s4: 3, s5: 0 }, games: [] };
  const m1 = bracketModel(seeds, [s0, s1], rules);
  assert.equal(m1[0].played, true); assert.equal(m1[0].winnerId, 's6');
  assert.equal(m1[2].b, 's4'); assert.equal(m1[3].b, 's6'); // 1위 vs 4·5위 승자, 2위 vs 3·6위 승자
  assert.equal(seriesScore(s0), '1-3');
});

test('진행 버튼: 남은 날수에 맞게 자른다', () => {
  assert.deepEqual(advanceChoices(0, 54).map((c) => c.days), [1, 9, 54]);
  assert.deepEqual(advanceChoices(50, 54).map((c) => c.days), [1, 4]);
  assert.deepEqual(advanceChoices(53, 54).map((c) => c.days), [1]);
  assert.deepEqual(advanceChoices(54, 54), []);
});

test('홈 경기 순번: 같은 날 앞 경기와 지난 날의 홈 경기를 센다', () => {
  const days = [
    { day: 1, games: [{ homeId: 'a', awayId: 'b' }, { homeId: 'c', awayId: 'd' }] },
    { day: 2, games: [{ homeId: 'b', awayId: 'a' }, { homeId: 'a', awayId: 'c' }] },
    { day: 3, games: [{ homeId: 'a', awayId: 'd' }] }
  ];
  assert.equal(homeOrdinal(days, 1, 0), 0);
  assert.equal(homeOrdinal(days, 2, 1), 1);
  assert.equal(homeOrdinal(days, 3, 0), 2);
});

test('관중 표시: 수입 계산과 같은 모델·키, 수용 인원이 있으면 점유율·매진', () => {
  const teamData = [{ id: 'a', venue: { capacity: null } }, { id: 'b', venue: { capacity: 3000 } }];
  const att = initialAttendance(teamData, rules);
  const standings = [{ id: 'a', wins: 5, losses: 5 }, { id: 'b', wins: 5, losses: 5 }];
  const calc = attendanceCalc({ teamData, standings, att, season: '2026-27', rules });
  const g = { homeId: 'a', awayId: 'b' };
  const x = calc(g, { key: 'r0' });
  const direct = attendanceFor({ season: '2026-27', teamId: 'a', key: 'r0', pop: popularity(att.fan.a, 0.5, rules), oppPop: 1, capacity: null, scale: att.index }, rules);
  assert.equal(x.attendance, direct.attendance);
  assert.deepEqual(calc(g, { key: 'r0' }), x);
  assert.equal(x.occupancy, null);
  assert.equal(x.estimate, true); // 저장된 관중(g.att)이 없으면 추정
  assert.match(attendanceText(x), /^관중 [\d,]+명 \(추정\)$/);
  const kept = calc({ ...g, att: 2345 }, { key: 'r0' }); // 엔진이 경기 때 저장한 값은 그대로 보여 주고 추정 표시가 없다
  assert.equal(kept.attendance, 2345); assert.equal(kept.estimate, undefined);
  assert.match(attendanceText(kept), /^관중 2,345명$/);
  const full = calc({ homeId: 'b', awayId: 'a' }, { key: 'r0' });
  assert.ok(full.attendance <= 3000);
  assert.match(attendanceText({ attendance: 3000, sellout: true, occupancy: 1 }), /매진/);
  assert.match(attendanceText({ attendance: 1500, sellout: false, occupancy: 0.5 }), /점유율 50%/);
  const po = calc(g, { key: 'p6강:0', round: '6강' });
  assert.ok(po.attendance > 0);
});
