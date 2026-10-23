import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moodOf, fanFactor, fanAppeal, advanceMood, initialMood, moodTier } from '../src/fans.mjs';
import { revenueOf, initialAttendance } from '../src/funds.mjs';
import { offerScore } from '../src/freeagency.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { loadHistory } from '../src/history.mjs';
import { attendanceCalc } from '../web/lib/season-view.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const f = rules.fans;

test('팬 열기 효과: 중립(50)은 효과가 없고, 높으면 관중·FA 호감이 조금 오르고 낮으면 내린다', () => {
  assert.equal(fanFactor(50, rules), 1);
  assert.equal(fanAppeal(50, rules), 0);
  assert.ok(Math.abs(fanFactor(100, rules) - (1 + f.attendance)) < 1e-9);
  assert.ok(Math.abs(fanFactor(0, rules) - (1 - f.attendance)) < 1e-9);
  assert.ok(fanAppeal(80, rules) > 0 && fanAppeal(20, rules) < 0);
  assert.ok(f.attendance <= 0.1 && f.freeAgency <= 0.1, '효과는 작게 시작한다');
  assert.equal(fanFactor(90, {}), 1, '규칙이 없으면 효과 없음');
  assert.equal(moodOf(undefined, 'a', rules), 50);
  assert.equal(moodOf({ mood: { a: 72 } }, 'a', rules), 72);
  assert.equal(moodTier(85), '열광'); assert.equal(moodTier(10), '냉담');
});

const t10 = teams.map((t) => t.id);
const standings = t10.map((id, i) => ({ id, wins: 45 - i * 4, losses: 9 + i * 4 }));
const poSeries = (champ, finalist) => ({ championId: champ, series: [
  { higherId: t10[2], lowerId: t10[5] }, { higherId: t10[3], lowerId: t10[4] },
  { higherId: t10[0], lowerId: t10[3] }, { higherId: t10[1], lowerId: t10[2] },
  { higherId: champ, lowerId: finalist }] });
const star = (id, teamId, ovr) => ({ id, teamId, ovr });

test('팬 열기 갱신: 승률·플레이오프·스타 보유로 오르고, 스타 이탈·연패로 내리며, 0~100을 넘지 않는다', () => {
  const po = poSeries(t10[0], t10[1]);
  const m = advanceMood(null, { standings, playoffs: po, teamData: teams, startPlayers: [], endPlayers: [] }, rules);
  assert.ok(m[t10[0]] > 50, '1위·우승 팀은 오른다');
  assert.ok(m[t10[9]] < 50, '꼴찌는 내린다');
  assert.ok(m[t10[0]] > m[t10[1]] && m[t10[1]] > m[t10[5]], '우승 > 준우승 > 탈락');
  // 스타 보유
  const withStar = advanceMood(null, { standings, playoffs: po, teamData: teams, startPlayers: [], endPlayers: [star('s', t10[6], f.star.ovr)] }, rules);
  assert.ok(withStar[t10[6]] > m[t10[6]]);
  // 스타 이탈: 시작에 있었는데 끝에는 다른 구단이거나 없다
  const lostTrade = advanceMood(null, { standings, playoffs: po, teamData: teams, startPlayers: [star('s', t10[6], f.star.ovr)], endPlayers: [star('s', t10[7], f.star.ovr)] }, rules);
  assert.ok(lostTrade[t10[6]] < m[t10[6]]);
  const lostRelease = advanceMood(null, { standings, playoffs: po, teamData: teams, startPlayers: [star('s', t10[6], f.star.ovr)], endPlayers: [] }, rules);
  assert.equal(lostRelease[t10[6]], lostTrade[t10[6]]);
  // 연패
  const streak = advanceMood(null, { standings, playoffs: po, teamData: teams, startPlayers: [], endPlayers: [], streaks: { [t10[6]]: 12 } }, rules);
  assert.ok(streak[t10[6]] < m[t10[6]]);
  assert.equal(advanceMood(null, { standings, playoffs: po, teamData: teams, streaks: { [t10[6]]: f.streak.from - 1 } }, rules)[t10[6]], m[t10[6]], '기준 연패 아래는 영향 없음');
  // 경계: 계속 오르거나 내려도 한계 안, 평균 쪽 복귀
  let hi = initialMood(teams, rules), lo = initialMood(teams, rules);
  const best = standings.map((s) => ({ ...s, wins: 54, losses: 0 })), worst = standings.map((s) => ({ ...s, wins: 0, losses: 54 }));
  for (let i = 0; i < 40; i++) { hi = advanceMood(hi, { standings: best, playoffs: poSeries(t10[0], t10[1]), teamData: teams, endPlayers: [star('a', t10[0], 99), star('b', t10[0], 99), star('c', t10[0], 99), star('d', t10[0], 99)] }, rules); lo = advanceMood(lo, { standings: worst, playoffs: poSeries(t10[1], t10[2]), teamData: teams, streaks: { [t10[9]]: 54 } }, rules); }
  assert.ok(hi[t10[0]] <= f.max && hi[t10[0]] > 80);
  assert.ok(lo[t10[9]] >= f.min && lo[t10[9]] < 25);
  assert.deepEqual(advanceMood({ x: 1 }, { standings, playoffs: null, teamData: teams }, { ...rules, fans: undefined }), { x: 1 });
});

test('관중·FA 연결: 팬 열기가 높은 구단의 인기·관중이 늘고, 선수의 제안 점수가 오른다', () => {
  const att = initialAttendance(teams, rules);
  const team = teams[0], rec = { wins: 27, losses: 27 };
  const rev = (mood) => revenueOf(team.id, { team, teamData: teams, rec, stage: null, playoffs: null, prestige: null, season: 2026, att: mood == null ? att : { ...att, mood: { [team.id]: mood } } }, rules);
  const neutral = rev(null).attendance.avg;
  assert.equal(rev(50).attendance.avg, neutral, '중립이면 이전과 같다');
  assert.ok(rev(90).attendance.avg > neutral && rev(10).attendance.avg < neutral);
  assert.ok(rev(90).attendance.avg / neutral < 1 + f.attendance + 0.01, '효과는 설정한 크기 안');
  // 화면의 경기별 관중 계산도 같은 열기를 쓴다
  const st = teams.map((t) => ({ id: t.id, wins: 27, losses: 27 }));
  const calc = (mood) => attendanceCalc({ teamData: teams, standings: st, att: mood == null ? att : { ...att, mood: { [team.id]: mood } }, season: '2026-27', rules })({ homeId: team.id, awayId: teams[1].id }, { key: 'r0' }).attendance;
  assert.equal(calc(50), calc(null));
  assert.ok(calc(90) > calc(null) && calc(10) < calc(null), '경기별 관중 계산도 팬 열기를 쓴다');
  // FA: 같은 제안이라도 열기가 높은 구단에서 점수가 높다
  const p = { id: 'p1', ovr: 70, potential: 72, age: 27, prevTeamId: null, teamId: null };
  const ctx = (mood) => ({ season: 2026, winPct: new Map([[team.id, 0.5]]), prestige: new Map([[team.id, 0.5]]), fans: mood == null ? null : new Map([[team.id, mood]]) });
  const roster = [];
  const base = offerScore(p, 3, team.id, roster, ctx(null), rules).score;
  assert.equal(offerScore(p, 3, team.id, roster, ctx(50), rules).score, base);
  assert.ok(offerScore(p, 3, team.id, roster, ctx(90), rules).score > base);
  assert.ok(offerScore(p, 3, team.id, roster, ctx(10), rules).score < base);
  assert.ok(Math.abs(offerScore(p, 3, team.id, roster, ctx(100), rules).score - base - f.freeAgency) < 1e-9);
});

test('이전 저장 호환: 팬 열기 상태가 없는 league도 정산되고 다음 상태에 mood가 생긴다, 같은 시드는 같은 값', () => {
  const run = (seed) => {
    const league = createLeague(players, rules, { history: loadHistory(), teamData: teams });
    assert.equal(league.att, undefined);
    return playLeagueYear(league, teams, rules, mulberry32(seed), {}).league;
  };
  const a = run(5), b = run(5);
  assert.deepEqual(a.att.mood, b.att.mood);
  assert.deepEqual(Object.keys(a.att.mood).sort(), [...t10].sort());
  for (const v of Object.values(a.att.mood)) assert.ok(v >= f.min && v <= f.max);
  assert.ok(Object.values(a.att.mood).some((v) => v !== 50));
});

test('시뮬레이션 분포: 10시즌 뒤 팬 열기는 구단별로 갈리고 한계 안, 관중은 이전 모델과 크게 다르지 않다', () => {
  const league0 = createLeague(players, rules, { history: loadHistory(), teamData: teams });
  let league = league0, rng = mulberry32(11);
  let first = null, last = null;
  for (let y = 0; y < 10; y++) {
    const out = playLeagueYear(league, teams, rules, rng, {});
    league = out.league;
    const total = Object.values(out.report.ledger).reduce((s, l) => s + l.attendance.total, 0);
    if (y === 0) first = total; last = total;
  }
  const moods = Object.values(league.att.mood);
  assert.ok(Math.max(...moods) - Math.min(...moods) > 10, '구단 사이에 차이가 생긴다');
  assert.ok(moods.every((v) => v >= f.min && v <= f.max));
  assert.ok(last / first > 1.0 && last / first < 1.6, `10시즌 뒤 관중 배율 ${(last / first).toFixed(2)}`);
});

test('최장 연패: 경기 결과를 보관하지 않아도(keepGames 꺼짐) 센다, 보관한 경기에서 센 값과 같다', async () => {
  const { beginSeason } = await import('../src/season-run.mjs');
  const run = (keepGames) => {
    const league = createLeague(players, rules, { history: loadHistory(), teamData: teams });
    const r = beginSeason(league, teams, rules, mulberry32(9), { manager: teams[0].id, keepGames });
    r.playDays(); r.startPlayoffs(); while (!r.playoffs.done) r.playoffRound();
    return r.finish();
  };
  const withGames = run(true), without = run(false);
  assert.deepEqual(without.streaks, withGames.streaks);
  const worst = {};
  const cur = {};
  for (const g of withGames.result.games) for (const [id, win] of [[g.homeId, g.winnerId === g.homeId], [g.awayId, g.winnerId === g.awayId]]) { cur[id] = win ? 0 : (cur[id] ?? 0) + 1; worst[id] = Math.max(worst[id] ?? 0, cur[id]); }
  assert.deepEqual(withGames.streaks, worst);
  assert.ok(Object.values(withGames.streaks).every((n) => n >= 1 && n <= 54));
});
