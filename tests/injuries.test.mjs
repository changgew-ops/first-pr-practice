import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryChance, rollInjury, kindOfGames, foreignGameThresholds } from '../src/injuries.mjs';
import { buildLineup, buildLineupHealthy, substituteInjured, availableRoster, validateLineup } from '../src/lineup.mjs';
import { beginSeason } from '../src/season-run.mjs';
import { mulberry32, hashString } from '../src/rng.mjs';
import { createLeague } from '../src/league.mjs';
import { Session, serialize, restore } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { getNews } from '../web/lib/news-view.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json');
const teams = read('teams.json');
const players = read('players.json');
const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json') };
const MY = 'busan-kcc';

const withRules = (patch) => ({ ...data, rules: { ...rules, injuries: { ...rules.injuries, ...patch } } });
const league = () => createLeague(players, rules, { history: data.history, teamData: teams });

test('부상 확률: 출전 시간이 길수록, 나이가 많을수록, 스태미나가 낮을수록, 연속 출전이 길수록 높고 0분이면 0이다', () => {
  const p = { age: 27, stats: { stamina: 50 } };
  assert.equal(injuryChance(p, 0, rules), 0);
  assert.ok(injuryChance(p, 36, rules) > injuryChance(p, 12, rules));
  assert.ok(injuryChance({ ...p, age: 34 }, 30, rules) > injuryChance(p, 30, rules));
  assert.ok(injuryChance({ ...p, stats: { stamina: 30 } }, 30, rules) > injuryChance(p, 30, rules));
  assert.ok(injuryChance(p, 30, rules, 10) > injuryChance(p, 30, rules, 0));
  assert.ok(injuryChance(p, 30, rules, 10) <= injuryChance(p, 30, rules, 0) * (1 + rules.injuries.fatigue.slope) + 1e-12, '연속 출전 영향은 약하다');
  assert.equal(injuryChance(p, 30, { ...rules, injuries: { ...rules.injuries, enabled: false } }), 0);
});

test('부상 판정: 같은 키는 항상 같은 결과이고, 종류·경기 수 구간과 시즌 아웃이 규칙대로다', () => {
  const p = { age: 30, stats: { stamina: 40 } };
  const hot = { ...rules, injuries: { ...rules.injuries, perMinute: 0.02 } };
  const a = Array.from({ length: 400 }, (_, i) => rollInjury(p, 30, hot, `k${i}`));
  const b = Array.from({ length: 400 }, (_, i) => rollInjury(p, 30, hot, `k${i}`));
  assert.deepEqual(a, b);
  const hits = a.filter(Boolean);
  assert.ok(hits.length > 100 && hits.length < 400);
  for (const h of hits) {
    const sev = rules.injuries.severity.find((x) => x.kind === h.kind);
    assert.ok(h.games >= sev.games[0] && h.games <= sev.games[1], `${h.kind} ${h.games}`);
    assert.equal(kindOfGames(h.games, rules), h.kind);
    assert.ok(h.part);
  }
  assert.ok(new Set(hits.map((h) => h.kind)).size >= 3);
  assert.equal(rollInjury(p, 0, hot, 'x'), null);
  assert.deepEqual(foreignGameThresholds(rules), { temporary: 5, season: 18 }); // 2주·8주를 54경기/24주로 환산
});

test('라인업: 부상 선수는 자동 편성에서 빠지고, 건강한 선수가 모자라면 벤치를 줄이며, 직접 편성은 같은 자리를 건강한 선수가 메운다', () => {
  const roster = league().players.filter((p) => p.teamId === MY);
  const full = buildLineup(roster, rules, rules.simulation.benchWeight);
  const hurt = new Map([...full.starters.slice(0, 2), full.bench[0]].map((p, i) => [p.id, 3 + i]));
  const l = buildLineupHealthy(roster, rules, rules.simulation.benchWeight, hurt);
  for (const p of [...l.starters, ...l.bench]) assert.ok(!hurt.has(p.id), `${p.name} 부상 중인데 편성됨`);
  assert.equal(l.starters.length + l.bench.length, Math.min(12, roster.length - 3)); // 건강한 선수가 12명 미만이면 벤치가 줄어든다
  // 건강한 선수가 엔트리보다 적으면 벤치가 줄어든다
  const many = new Map(roster.slice(0, roster.length - 10).map((p) => [p.id, 5]));
  const small = buildLineupHealthy(roster, rules, rules.simulation.benchWeight, many);
  assert.equal(small.starters.length, 5);
  assert.equal(small.bench.length, 5);
  // 너무 적으면 가장 빨리 돌아오는 선수가 부상을 안고 뛴다
  const most = new Map(roster.slice(0, roster.length - 4).map((p, i) => [p.id, 10 + i]));
  const { roster: avail, playingHurt } = availableRoster(roster, most, 8);
  assert.equal(avail.length, 8);
  assert.equal(playingHurt.length, 4);
  assert.ok(playingHurt.every((id) => most.get(id) <= 10 + 3), '남은 결장이 가장 짧은 선수부터');
  // 직접 편성: 부상 선수 자리에 건강한 선수가 서고, 규칙(코스트·외국인 수)을 지킨다
  const hurt2 = new Map([[full.starters[0].id, 4], [full.bench[0].id, 2]]); // 엔트리 밖 선수가 둘이라 둘까지만 메울 수 있다
  const sub = substituteInjured(full, roster, hurt2, rules);
  assert.ok(sub);
  assert.equal(sub.swaps.length, 2);
  assert.equal(substituteInjured(full, roster, hurt, rules), null, '셋은 메울 수 없으면 자동 편성으로 돌아간다');
  assert.ok(validateLineup(sub.starters, sub.bench, rules).ok);
  for (const p of [...sub.starters, ...sub.bench]) assert.ok(!hurt2.has(p.id));
  // 같은 자리: 스타팅이 스타팅으로, 벤치가 벤치로
  for (const { out, in: inn } of sub.swaps) assert.equal(full.starters.some((p) => p.id === out.id), sub.starters.some((p) => p.id === inn.id));
  // 건강한 후보가 하나도 없으면 null(자동 편성으로 돌아간다)
  assert.equal(substituteInjured(full, full.starters.concat(full.bench), new Map([[full.starters[0].id, 3]]), rules), null);
});

test('시즌 진행: 같은 시드면 부상도 같고, 부상 선수는 결장 동안 뛰지 않으며 복귀 뒤에는 다시 뛴다', () => {
  const run = (seed) => {
    const r = beginSeason(league(), teams, rules, mulberry32(hashString(`t:${seed}`)), { manager: MY, keepGames: true, seed });
    const days = r.playDays();
    return { r, days };
  };
  const a = run(7), b = run(7);
  assert.deepEqual(a.r.rosterLog, b.r.rosterLog);
  const log = a.r.rosterLog;
  const injuries = log.filter((e) => e.type === 'injury');
  assert.ok(injuries.length > 5, `부상 ${injuries.length}건`);
  const minutesOn = (id, day) => a.days[day - 1].games.flatMap((g) => [...g.box.home, ...g.box.away]).find((l) => l.id === id)?.minutes ?? 0;
  let checked = 0;
  for (const inj of injuries.filter((e) => e.games < 99 && e.day + e.games + 1 <= 54).slice(0, 12)) {
    for (let d = inj.day + 1; d <= inj.day + inj.games; d++) assert.equal(minutesOn(inj.playerId, d), 0, `${inj.name} ${d}일차에 결장해야 한다`);
    const ret = log.find((e) => e.type === 'return' && e.playerId === inj.playerId && e.day === inj.day + inj.games);
    assert.ok(ret, `${inj.name} 복귀 기록`);
    checked++;
  }
  assert.ok(checked >= 3);
  // 결장 중 선수는 시즌 누적 기록에도 쌓이지 않는다: 시즌 아웃 선수는 그날 이후 출전이 없다
  for (const inj of injuries.filter((e) => e.games >= 99).slice(0, 3)) {
    const t = a.r.totals.get(inj.playerId);
    assert.ok(!t || t.games <= inj.day, `${inj.name} 시즌 아웃 뒤 기록`);
  }
  // 부상 확률 0이면 부상 기능을 끈 것과 같은 경기 결과(부상 난수는 경기 난수와 따로다)
  const score = (d) => d.flatMap((x) => x.games.map((g) => `${g.homePts}-${g.awayPts}`)).join(',');
  const calm = beginSeason(league(), teams, { ...rules, injuries: { ...rules.injuries, perMinute: 0 } }, mulberry32(hashString('t:9')), { manager: MY, keepGames: true, seed: 9 });
  const off = beginSeason(league(), teams, { ...rules, injuries: { ...rules.injuries, enabled: false } }, mulberry32(hashString('t:9')), { manager: MY, keepGames: true, seed: 9 });
  assert.equal(score(calm.playDays()), score(off.playDays()));
  assert.equal(calm.rosterLog.length, 0);
});

test('부상 빈도: 팀당 시즌 평균 부상 건수와 결장 경기가 목표(3건·약 20경기) 근처이고 대부분 경상이다', () => {
  let inj = 0, missed = 0, minor = 0, seasons = 0;
  for (const seed of [1, 2, 3]) {
    const r = beginSeason(league(), teams, rules, mulberry32(hashString(`f:${seed}`)), { manager: MY, seed });
    r.playDays();
    for (const e of r.rosterLog.filter((x) => x.type === 'injury')) { inj++; missed += Math.min(e.games, 54 - e.day); if (e.kind === 'minor') minor++; }
    seasons += teams.length;
  }
  const perTeam = inj / seasons;
  assert.ok(perTeam > 2 && perTeam < 4.5, `팀당 부상 ${perTeam.toFixed(2)}건`);
  assert.ok(missed / seasons > 8 && missed / seasons < 35, `팀당 결장 ${(missed / seasons).toFixed(1)}경기`);
  assert.ok(minor / inj > 0.45, '경상이 가장 많다');
});

test('플레이오프·오프시즌: 플레이오프에서는 새 부상이 없고 휴식 동안 일부 회복하며, 시즌이 끝나면 결장이 모두 해소된다', () => {
  const s = Session.create(withRules({ perMinute: 0.004 }), { managerId: MY, gmName: 't', seed: 3 });
  while (!s.regularDone) s.advance(9);
  const before = new Map(s.injuries.map((i) => [i.playerId, i.left]));
  assert.ok(before.size > 0);
  s.startPlayoffs();
  for (const i of s.injuries) assert.equal(i.left, before.get(i.playerId) - rules.injuries.playoffRecoveryGames);
  while (!s.playoffs.done) s.playoffRound();
  const injuriesAtEnd = s.rosterLog.filter((e) => e.type === 'injury' && e.day > 54);
  assert.equal(injuriesAtEnd.length, 0);
  s.endSeason(); s.autoOffseason();
  assert.equal(s.stage, 'regular');
  assert.equal(s.injuries.length, 0);
});

test('세션: 부상이 있어도 저장·복원하면 같은 상태이고, 부상 필드가 없는 옛 저장·요약도 열린다(건강으로 취급)', () => {
  const s = Session.create(data, { managerId: MY, gmName: 't', seed: 11 });
  s.advance(20);
  const back = restore(data, serialize(s));
  assert.deepEqual(back.injuries, s.injuries);
  assert.deepEqual(back.players.map((p) => [p.id, p.teamId]), s.players.map((p) => [p.id, p.teamId]));
  assert.equal(JSON.stringify(back.standings()), JSON.stringify(s.standings()));
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); while (!s.playoffs.done) s.playoffRound();
  const entry = s.endSeason();
  assert.ok(entry.roster?.inj, '시즌 결과에 부상 요약이 있다');
  assert.ok(JSON.stringify(entry.roster).length < 6000, `요약 크기 ${JSON.stringify(entry.roster).length}`);
  // 옛 저장: 요약(roster)이 없는 시즌 항목과 부상 필드가 없는 상태에서도 뉴스·선수 화면 계산이 깨지지 않는다
  s.autoOffseason();
  const old = JSON.parse(serialize(s));
  for (const e of old.log) delete e.roster;
  const o = new Session(data, old);
  assert.ok(getNews(o, data).items.length > 0);
  assert.deepEqual(o.injuries, []);
  assert.equal(o.injuryOf('없는선수'), null);
});

test('뉴스: 부상 기사가 우리 구단의 부상과 리그의 장기 부상으로 나온다(문단 2~4, 댓글 2~5)', () => {
  const s = Session.create(withRules({ perMinute: 0.004 }), { managerId: MY, gmName: 't', seed: 5 });
  const d = withRules({ perMinute: 0.004 });
  while (!s.regularDone) s.advance(9);
  const items = getNews(s, d).items.filter((i) => i.kind === 'injury_my' || i.kind === 'injury_star');
  assert.ok(items.some((i) => i.kind === 'injury_my'), '우리 구단 부상 기사');
  for (const it of items) {
    assert.ok(it.paragraphs.length >= 2 && it.paragraphs.length <= 4, `${it.kind} 문단 ${it.paragraphs.length}`);
    assert.ok(it.comments.length >= 1 && it.comments.length <= 5);
    assert.ok(!/undefined|NaN|[{}]/.test([it.headline, it.body].join(' ')), it.body);
    assert.ok(it.body.length >= 160 && it.body.length <= 800, `${it.kind} ${it.body.length}자`);
  }
});
