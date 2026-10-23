import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAwards, awardRows, playerAwardHistory, awardHistoryText, AWARD_ORDER } from '../src/awards.mjs';
import { simulateGame, leagueBaseline } from '../src/game.mjs';
import { buildLineup } from '../src/lineup.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { entryRows, sumRows } from '../src/player-record.mjs';
import { newGame, playYear } from '../web/lib/game.js';
import { aggregateLines } from '../web/lib/league-view.js';
import { loadHistory } from '../src/history.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const data = { rules: read('league-rules.json'), teams: read('teams.json'), players: read('players.json'), history: loadHistory(), profiles: read('players/profiles.json') };
const rules = data.rules;

// ----- 합성 입력 -----
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const stats = (v) => ({ shooting: v, passing: v, defense: v, rebound: v, athletic: v, stamina: v });
const mkPlayer = (id, position, teamId, ovr = 60, extra = {}) => ({ id, name: id, position, teamId, ovr, ovrWas: ovr, age: 25, origin: 'domestic', stats: stats(ovr), ...extra });
const mkTotals = (games, pg) => ({ games, minutes: games * (pg.min ?? 28), points: games * pg.pts, rebounds: games * (pg.reb ?? 3), assists: games * (pg.ast ?? 2), steals: games * (pg.stl ?? 1), blocks: games * (pg.blk ?? 0.3) });
const standings = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, wins: 40 - i * 10, losses: 14 + i * 10, pointsAgainst: 4000 + i * 100 }));

function league() {
  const players = [];
  const totals = new Map();
  // 팀 a(1위)·b·c·d마다 포지션 5명. 점수는 id 순서로 조금씩 달라진다.
  ['a', 'b', 'c', 'd'].forEach((t, ti) => POS.forEach((pos, pi) => {
    const id = `${t}-${pos}`;
    players.push(mkPlayer(id, pos, t, 60 + pi));
    totals.set(id, mkTotals(54, { pts: 10 + pi - ti * 1.5, reb: 3 + (pos === 'C' ? 5 : 0), ast: pos === 'PG' ? 6 : 2 }));
  }));
  return { players, totals };
}
const run = (over = {}) => { const { players, totals } = league(); return computeAwards({ players, totals, standings, rookieIds: new Set(), rules, ...over }); };

test('어워드: 같은 입력이면 같은 결과이고 선수 목록 순서와 무관하다', () => {
  const { players, totals } = league();
  const a = computeAwards({ players, totals, standings, rookieIds: new Set(), rules });
  const b = computeAwards({ players: [...players].reverse(), totals, standings, rookieIds: new Set(), rules });
  assert.deepEqual(a, b);
  assert.deepEqual(a, computeAwards({ players, totals, standings, rookieIds: new Set(), rules }));
});

test('MVP: 기록이 같으면 팀 성적이 좋은 쪽이 받는다', () => {
  const players = [mkPlayer('x', 'SF', 'a'), mkPlayer('y', 'SF', 'd')];
  const totals = new Map([['x', mkTotals(54, { pts: 20 })], ['y', mkTotals(54, { pts: 20 })]]);
  assert.equal(computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).mvp, 'x');
  // 팀 성적을 받쳐 주더라도 기록 차이가 크면 개인 기록이 이긴다
  totals.set('y', mkTotals(54, { pts: 30, reb: 8, ast: 5 }));
  assert.equal(computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).mvp, 'y');
});

test('동률이면 OVR → id 순으로 가른다(순서·해시와 무관하게 고정)', () => {
  const players = [mkPlayer('b', 'SF', 'a', 60), mkPlayer('a', 'SF', 'a', 60), mkPlayer('c', 'SF', 'a', 70)];
  const totals = new Map(players.map((p) => [p.id, mkTotals(54, { pts: 15 })]));
  assert.equal(computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).mvp, 'c');
  players[2] = mkPlayer('c', 'SF', 'a', 60);
  assert.equal(computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).mvp, 'a');
});

test('베스트5: 가드 2·포워드 2·센터 1명이고, 한 칸이 모자라면 남은 선수 중 점수 순으로 채운다', () => {
  const r = run();
  const { players } = league();
  const pos = r.best5.map((id) => players.find((p) => p.id === id).position);
  const g = pos.filter((x) => x === 'PG' || x === 'SG').length, f = pos.filter((x) => x === 'SF' || x === 'PF').length, c = pos.filter((x) => x === 'C').length;
  assert.deepEqual([g, f, c], [2, 2, 1]);
  assert.equal(new Set(r.best5).size, 5);
  // 센터가 한 명도 없으면 센터 칸은 다른 선수가 채운다(5명 유지)
  const noC = league();
  noC.players = noC.players.filter((p) => p.position !== 'C');
  const r2 = computeAwards({ players: noC.players, totals: noC.totals, standings, rookieIds: new Set(), rules });
  assert.equal(r2.best5.length, 5);
  assert.equal(new Set(r2.best5).size, 5);
});

test('신인상: 이번 시즌 신인 후보 중에서만 뽑고, 규정 경기를 못 채우면 낮춘 기준으로, 아무도 없으면 시상하지 않는다', () => {
  const { players, totals } = league();
  players.push(mkPlayer('rk1', 'SG', 'b', 50), mkPlayer('rk2', 'SG', 'c', 50));
  totals.set('rk1', mkTotals(40, { pts: 8, min: 20 }));
  totals.set('rk2', mkTotals(40, { pts: 11, min: 20 }));
  const base = { players, totals, standings, rules };
  assert.equal(computeAwards({ ...base, rookieIds: new Set(['rk1', 'rk2']) }).rookie, 'rk2'); // 신인이 아닌 선수가 더 잘해도 후보가 아니다
  assert.equal(computeAwards({ ...base, rookieIds: new Set(['a-PG']) }).rookie, 'a-PG');
  assert.equal(computeAwards({ ...base, rookieIds: new Set(['nobody']) }).rookie, null);
  // 규정 경기(0.3 × 54 = 17경기)에는 못 미치지만 8경기 이상 → 낮춘 기준으로 시상
  totals.set('rk1', mkTotals(10, { pts: 9, min: 8 }));
  totals.set('rk2', mkTotals(3, { pts: 20, min: 8 }));
  assert.equal(computeAwards({ ...base, rookieIds: new Set(['rk1', 'rk2']) }).rookie, 'rk1');
  totals.set('rk1', mkTotals(4, { pts: 9, min: 8 }));
  assert.equal(computeAwards({ ...base, rookieIds: new Set(['rk1', 'rk2']) }).rookie, null);
  // 드래프트 기록이 없는 첫 시즌(rookieIds가 null): 국내 선수 중 어린 선수
  const young = league();
  young.players.find((p) => p.id === 'b-SG').age = 20;
  assert.equal(computeAwards({ players: young.players, totals: young.totals, standings, rookieIds: null, rules }).rookie, 'b-SG');
});

test('기량발전상: ovrWas 대비 가장 많이 오른 선수, 상승이 기준(+3)에 못 미치면 없음, ovrWas 없는 선수는 제외', () => {
  const { players, totals } = league();
  const set = (id, patch) => Object.assign(players.find((p) => p.id === id), patch);
  set('a-PG', { ovr: 66, ovrWas: 62 });
  set('b-SG', { ovr: 70, ovrWas: 61 });
  set('c-SF', { ovr: 80, ovrWas: undefined });
  set('d-PF', { ovr: 75, ovrWas: 60, age: 33 }); // 나이 한도 초과
  const get = () => computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).improved;
  assert.equal(get(), 'b-SG');
  set('b-SG', { ovr: 63, ovrWas: 61 });
  set('a-PG', { ovr: 63, ovrWas: 62 });
  assert.equal(get(), null);
});

test('부문 1위·수비상·챔피언결정전 MVP', () => {
  const { players, totals } = league();
  totals.set('b-C', mkTotals(54, { pts: 12, reb: 14, blk: 3, stl: 1.2 }));
  totals.set('c-SG', mkTotals(54, { pts: 13, stl: 3, ast: 8 }));
  const series = [{ round: '챔피언결정전', games: [
    { homeId: 'a', awayId: 'b', box: { home: [{ id: 'a-PG', minutes: 30, points: 25, rebounds: 5, assists: 6, steals: 2, blocks: 0 }, { id: 'a-C', minutes: 30, points: 10, rebounds: 9, assists: 1, steals: 0, blocks: 2 }], away: [{ id: 'b-C', minutes: 30, points: 40, rebounds: 15, assists: 1, steals: 0, blocks: 2 }] }, homePts: 85, awayPts: 80, winnerId: 'a' },
    { homeId: 'b', awayId: 'a', box: { home: [], away: [{ id: 'a-PG', minutes: 30, points: 21, rebounds: 4, assists: 7, steals: 1, blocks: 0 }, { id: 'a-C', minutes: 30, points: 14, rebounds: 10, assists: 1, steals: 1, blocks: 1 }] }, homePts: 70, awayPts: 78, winnerId: 'a' }
  ] }];
  const r = computeAwards({ players, totals, standings, playoffs: { series, championId: 'a' }, finalName: '챔피언결정전', rookieIds: new Set(), rules });
  assert.equal(r.reb, 'b-C'); assert.equal(r.blk, 'b-C'); assert.equal(r.stl, 'c-SG'); assert.equal(r.ast, 'c-SG');
  assert.equal(r.finalsMvp, 'a-PG'); // 우승 구단 선수만 대상(상대 팀 b-C가 더 잘했어도)
  assert.equal(computeAwards({ players, totals, standings, rookieIds: new Set(), rules }).finalsMvp, null);
});

// ----- 실제 시뮬레이션 -----
const g1 = playYear(newGame(data, 'wonju-db', 42), data);
const e1 = g1.log[0];

test('시즌 결과에 어워드가 들어가고 선수 id와 항목만 담아 작다', () => {
  const a = e1.awards;
  assert.ok(a && a.mvp && a.best5.length === 5 && a.pts && a.reb && a.ast && a.stl && a.blk && a.defense);
  for (const id of [a.mvp, a.pts, a.finalsMvp, ...a.best5]) assert.ok(e1.lines[id], `${id}의 시즌 기록 줄`);
  assert.ok(JSON.stringify(a).length < 500, `어워드 ${JSON.stringify(a).length}바이트`);
  assert.equal(e1.lines[a.finalsMvp][13], e1.championId, '챔피언결정전 MVP는 우승 구단 선수');
  const rows = awardRows(e1);
  assert.deepEqual(rows.map((r) => r.key), AWARD_ORDER);
  assert.equal(rows.find((r) => r.key === 'best5').ids.length, 5);
});

test('같은 시드로 다시 돌리면 어워드도 같다(첫 시즌은 드래프트 기록이 없어 나이 기준 신인)', () => {
  const again = playYear(newGame(data, 'wonju-db', 42), data).log[0];
  assert.deepEqual(again.awards, e1.awards);
  assert.deepEqual(again.lines, e1.lines);
});

test('수상 이력: 시즌 로그에서 선수별로 모은다', () => {
  const id = e1.awards.mvp;
  const hist = playerAwardHistory(g1.log, id);
  assert.equal(hist[0].season, '2026-27');
  assert.ok(hist[0].keys.includes('mvp'));
  assert.match(awardHistoryText(hist), /2026-27 .*MVP/);
  assert.deepEqual(playerAwardHistory(g1.log, 'nobody'), []);
});

test('이전 저장(어워드·턴오버·파울이 없는 시즌)도 그대로 읽히고 "-"로 나온다', () => {
  const { awards, ...noAwards } = e1;
  assert.equal(awardRows(noAwards), null);
  assert.deepEqual(playerAwardHistory([noAwards], e1.awards.mvp), []);
  const id = Object.keys(e1.lines)[0];
  const old = { ...noAwards, lines: Object.fromEntries(Object.entries(e1.lines).map(([k, l]) => [k, l.slice(0, 14)])) };
  const row = entryRows(old, id)[0];
  assert.equal(row.to, null); assert.equal(row.pf, null); assert.equal(row.topg, null); assert.equal(row.pfpg, null);
  const now = entryRows(e1, id)[0];
  assert.equal(typeof now.to, 'number'); assert.ok(now.topg > 0 || now.gp === 0); assert.ok(now.pfpg >= 0);
  // 합계: 게임 줄에 턴오버·파울이 없는 시즌이 섞이면 합계도 없다
  assert.equal(sumRows([row, now]).to, null);
  assert.equal(sumRows([now, now]).to, now.to * 2);
  // 리그 화면 집계
  const old2 = aggregateLines(old).players.find((p) => p.id === id);
  assert.equal(old2.to, null); assert.equal(old2.pf, null);
  const new2 = aggregateLines(e1).players.find((p) => p.id === id);
  assert.equal(new2.to, now.to); assert.equal(new2.pf, now.pf);
});

// ----- 턴오버·파울 -----
const teams = data.teams.map((t) => ({ id: t.id, lineup: buildLineup(data.players.filter((p) => p.teamId === t.id), rules, rules.simulation.benchWeight) }));
const baseline = leagueBaseline(teams.map((t) => t.lineup), rules.simulation);

test('턴오버·파울은 기록만 한다: 같은 시드의 점수·박스스코어 다른 열이 규칙 값이 없을 때와 똑같다', () => {
  const sim = rules.simulation;
  const simOff = { ...sim }; delete simOff.teamTurnovers; delete simOff.teamFouls;
  const ra = mulberry32(5), rb = mulberry32(5);
  const strip = (box) => box.map(({ turnovers, fouls, ...rest }) => rest);
  for (let i = 0; i < 300; i++) {
    const home = teams[i % 10], away = teams[(i * 3 + 1) % 10];
    if (home === away) continue;
    const x = simulateGame(home, away, baseline, sim, ra), y = simulateGame(home, away, baseline, simOff, rb);
    assert.equal(x.homePts, y.homePts); assert.equal(x.awayPts, y.awayPts); assert.equal(x.overtimes, y.overtimes);
    assert.deepEqual(strip(x.box.home), y.box.home); assert.deepEqual(strip(x.box.away), y.box.away);
    assert.ok(x.box.home.every((l) => Number.isInteger(l.turnovers) && Number.isInteger(l.fouls) && l.turnovers >= 0 && l.fouls >= 0));
    assert.ok(y.box.home.every((l) => l.turnovers === undefined));
  }
});

test('턴오버·파울: 팀 경기당 평균이 규칙 값 근처이고, 득점·어시가 많은 선수가 턴오버를 더 하며, 수비·리바운드 비중이 큰 선수가 파울을 더 한다', () => {
  const sim = rules.simulation;
  const rng = mulberry32(9);
  let to = 0, pf = 0, n = 0;
  const per = new Map();
  for (let i = 0; i < 1500; i++) {
    const home = teams[i % 10], away = teams[(i * 7 + 3) % 10];
    if (home === away) continue;
    const r = simulateGame(home, away, baseline, sim, rng);
    for (const box of [r.box.home, r.box.away]) {
      to += box.reduce((s, l) => s + l.turnovers, 0); pf += box.reduce((s, l) => s + l.fouls, 0); n++;
      for (const l of box) { const a = per.get(l.id) ?? { min: 0, to: 0, pf: 0, pts: 0, ast: 0 }; a.min += l.minutes; a.to += l.turnovers; a.pf += l.fouls; a.pts += l.points; a.ast += l.assists; per.set(l.id, a); }
    }
  }
  assert.ok(Math.abs(to / n - sim.teamTurnovers) < 0.4, `팀 턴오버 ${(to / n).toFixed(2)}`);
  assert.ok(Math.abs(pf / n - sim.teamFouls) < 0.5, `팀 파울 ${(pf / n).toFixed(2)}`);
  // 출전 시간이 충분한 선수 중 득점+어시 상위 1/3과 하위 1/3의 40분당 턴오버
  const rows = [...per.values()].filter((a) => a.min >= 1500).map((a) => ({ to40: a.to / a.min * 40, use: (a.pts + 1.3 * a.ast) / a.min }));
  rows.sort((a, b) => b.use - a.use);
  const third = Math.floor(rows.length / 3);
  const avg = (list) => list.reduce((s, r) => s + r.to40, 0) / list.length;
  assert.ok(avg(rows.slice(0, third)) > avg(rows.slice(-third)), '공을 많이 만지는 선수가 턴오버를 더 한다');
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const pfRows = [...per].filter(([, a]) => a.min >= 1500).map(([id, a]) => ({ pf40: a.pf / a.min * 40, role: (byId.get(id)?.stats.defense ?? 50) ** 1.3 * (byId.get(id)?.stats.rebound ?? 50) ** 0.9 }));
  pfRows.sort((a, b) => b.role - a.role);
  const t3 = Math.floor(pfRows.length / 3);
  const avgPf = (list) => list.reduce((s, r) => s + r.pf40, 0) / list.length;
  assert.ok(avgPf(pfRows.slice(0, t3)) > avgPf(pfRows.slice(-t3)), '수비·리바운드 비중이 큰 선수가 파울을 더 한다');
});
