import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseBirthsCsv } from '../src/real-players.mjs';
import { buildSeasonIds } from '../tools/build-player-ids.mjs';
import { buildCareers, loadInputs } from '../tools/build-careers.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const csv = (p) => parseBirthsCsv(read(p));
const history = JSON.parse(read('data/history/seasons.json'));
const births = csv('data/players/births.csv');
const files = readdirSync(new URL('../data/stats/official', import.meta.url)).filter((f) => f.endsWith('.csv')).map((f) => f.replace('.csv', '')).sort();
const official = new Map(files.map((s) => [s, csv(`data/stats/official/${s}.csv`)]));
const franchise = new Map();
for (const s of history) for (const t of s.teams) franchise.set(t.displayName.replace(/\s/g, ''), t.franchiseId);
const fid = (team) => franchise.get(team.replace(/\s/g, ''));
const n = (v) => Number(v);

// 공식 기록 자체의 알려진 이상. 이유를 적어 둔다
const KNOWN = {
  // 2008-09 플레이오프: 강대협의 기록이 창원 LG 소속으로 적혔지만 5경기 2승 3패는 인천 전자랜드의 6강(KCC에 2-3)과 같다
  'playoff|2008-09|강대협|창원LG': '소속 표기 오류로 보이는 행'
};
// 구단 합계의 출전시간만 어긋나는 경우(경기 수·승패는 맞다)
const SHORT_MINUTES = { '2008-09|wonju-db|playoff': '선수 출전시간 합이 5경기 기준보다 약 9% 모자란다(KCC와의 4강 2-3). 공식 기록의 누락으로 보이며 이력의 시리즈 결과와는 맞는다' };
const known = (r, season) => `${r.gameType}|${season}|${r.name}|${r.team}` in KNOWN;

test('공식 기록: 시즌 파일이 이력의 시즌(1997~2025-26)과 진행 중인 2026-27을 모두 덮는다', () => {
  assert.deepEqual(files, [...history.map((s) => s.season), '2026-27'].sort());
  for (const [season, rows] of official) {
    assert.ok(rows.length > 100, season);
    assert.ok(rows.every((r) => ['regular', 'playoff', 'final'].includes(r.gameType)), season);
  }
});

test('공식 기록: 한 줄 안에서 득점·리바운드·야투·승패가 서로 맞는다', () => {
  let checked = 0;
  for (const [season, rows] of official) {
    for (const r of rows) {
      const where = `${season} ${r.name} ${r.gameType}`;
      assert.equal(n(r.pts), 2 * n(r.pm2) + 3 * n(r.pm3) + n(r.ftm), `${where} 득점`);
      assert.equal(n(r.reb), n(r.oreb) + n(r.dreb), `${where} 리바운드`);
      assert.equal(n(r.fgm), n(r.pm2) + n(r.pm3), `${where} 야투 성공`);
      assert.equal(n(r.fga), n(r.pa2) + n(r.pa3), `${where} 야투 시도`);
      assert.equal(n(r.w) + n(r.l), n(r.gp), `${where} 승+패=경기`);
      assert.ok(n(r.pm2) <= n(r.pa2) && n(r.pm3) <= n(r.pa3) && n(r.ftm) <= n(r.fta), `${where} 성공 ≤ 시도`);
      assert.ok(n(r.gp) > 0 && n(r.sec) >= 0, `${where} 출전`); // 1998-99 최호처럼 출전시간이 0초로 적힌 줄이 있다
      checked++;
    }
  }
  assert.ok(checked > 8000);
});

test('공식 기록: 선수번호는 프로필 명단에 있고, 한 시즌의 같은 번호는 한 이름이며, 소속은 그 시즌 구단이다', () => {
  const nos = new Set(births.map((b) => b.playerNo));
  for (const [season, rows] of official) {
    const teams = new Set(history.find((s) => s.season === season)?.teams.map((t) => t.franchiseId));
    const nameOf = new Map();
    for (const r of rows) {
      assert.ok(nos.has(r.playerNo), `${season} ${r.name} ${r.playerNo}: 프로필 명단에 없음`);
      assert.equal(nameOf.get(r.playerNo) ?? r.name, r.name, `${season} ${r.playerNo} 이름이 둘`);
      nameOf.set(r.playerNo, r.name);
      assert.ok(fid(r.team), `${season} ${r.name}: 알 수 없는 소속 "${r.team}"`);
      if (teams.size) assert.ok(teams.has(fid(r.team)), `${season} ${r.name}: ${r.team}은 그 시즌 구단이 아님`);
    }
  }
});

test('공식 기록(정규시즌): 구단마다 선수 출전시간 합이 200분×경기 수에 가깝고, 선수 승수·경기 수가 구단 성적을 넘지 않는다 (298개 구단 시즌)', () => {
  let teamSeasons = 0;
  for (const s of history) {
    const rows = official.get(s.season).filter((r) => r.gameType === 'regular');
    for (const t of s.teams) {
      const mine = rows.filter((r) => fid(r.team) === t.franchiseId);
      const games = t.wins + t.losses;
      const minutes = mine.reduce((a, r) => a + n(r.sec), 0) / 60;
      const ratio = minutes / (200 * games); // 5명 × 40분 (연장이 있으면 조금 크다)
      assert.ok(ratio > 0.97 && ratio < 1.05, `${s.season} ${t.franchiseId} 출전시간 비 ${ratio.toFixed(3)}`);
      assert.ok(Math.max(...mine.map((r) => n(r.gp))) <= games, `${s.season} ${t.franchiseId} 선수 경기 수 > 구단 경기 수`);
      assert.ok(Math.max(...mine.map((r) => n(r.w))) <= t.wins, `${s.season} ${t.franchiseId} 선수 승 > 구단 승`);
      assert.ok(mine.reduce((a, r) => a + n(r.w), 0) >= 5 * t.wins, `${s.season} ${t.franchiseId} 이긴 경기마다 5명 이상 뛰어야 한다`);
      teamSeasons++;
    }
  }
  assert.equal(teamSeasons, 298); // 1997년은 8개 구단, 나머지 29시즌은 10개 구단
});

test('공식 기록(플레이오프·챔피언결정전): 구단 시리즈 결과와 선수 승수·출전시간이 맞는다 (2007-08~, 108개 구단 시즌)', () => {
  let checked = 0;
  for (const s of history.filter((x) => x.playoffs)) {
    const rows = official.get(s.season).filter((r) => r.gameType !== 'regular' && !known(r, s.season));
    for (const id of Object.keys(s.playoffs.seeds)) {
      const rec = { playoff: { w: 0, l: 0 }, final: { w: 0, l: 0 } };
      for (const round of s.playoffs.rounds) {
        const kind = round.name === '결승' ? 'final' : 'playoff';
        for (const q of round.series) {
          if (q.a === id) { rec[kind].w += q.winsA; rec[kind].l += q.winsB; }
          if (q.b === id) { rec[kind].w += q.winsB; rec[kind].l += q.winsA; }
        }
      }
      for (const kind of ['playoff', 'final']) {
        const g = rec[kind].w + rec[kind].l;
        const mine = rows.filter((r) => r.gameType === kind && fid(r.team) === id);
        if (!g) { assert.equal(mine.length, 0, `${s.season} ${id} ${kind}: 경기가 없는데 기록이 있음`); continue; }
        const ratio = mine.reduce((a, r) => a + n(r.sec), 0) / 60 / (200 * g);
        if (!(`${s.season}|${id}|${kind}` in SHORT_MINUTES)) assert.ok(ratio > 0.97 && ratio < 1.15, `${s.season} ${id} ${kind} 출전시간 비 ${ratio.toFixed(3)} (이력의 시리즈 합 ${rec[kind].w}-${rec[kind].l})`);
        assert.ok(Math.max(...mine.map((r) => n(r.w))) <= rec[kind].w, `${s.season} ${id} ${kind} 선수 승 > 구단 승`);
        assert.ok(Math.max(...mine.map((r) => n(r.gp))) <= g, `${s.season} ${id} ${kind} 선수 경기 수 > 구단 경기 수`);
        checked++;
      }
    }
  }
  assert.equal(checked, 144, "구단 시즌(플레이오프·챔피언결정전 따로)"); // 플레이오프 108개 구단 시즌 + 챔피언결정전 18시즌 x 2팀 = 144
});

test('기록 시트(data/stats 2021-22~2026-27)가 공식 기록과 한 글자도 다르지 않다: 선수번호로 이어지고 합계가 같다', () => {
  const { text, problems, count } = buildSeasonIds((p) => read(p));
  assert.deepEqual(problems, []);
  assert.equal(text, read('data/players/season-ids.csv'), 'season-ids.csv가 낡았습니다: npm run build:ids');
  assert.equal(count, 1112);
  const ids = new Map(csv('data/players/season-ids.csv').map((r) => [`${r.season}|${r.label}`, r.playerNo]));
  const SUM = [['games', 'gp'], ['pts', 'pts'], ['reb', 'reb'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['w', 'w'], ['l', 'l'], ['fgm', 'fgm'], ['fga', 'fga'], ['tpm', 'pm3'], ['tpa', 'pa3'], ['ftm', 'ftm'], ['fta', 'fta'], ['oreb', 'oreb'], ['dreb', 'dreb'], ['to', 'to'], ['pf', 'pf']];
  for (const season of ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27']) {
    const sums = new Map();
    for (const r of official.get(season)) {
      const o = sums.get(r.playerNo) ?? { sec: 0 };
      o.sec += n(r.sec);
      for (const [, k] of SUM) o[k] = (o[k] ?? 0) + n(r[k]);
      sums.set(r.playerNo, o);
    }
    const lines = read(`data/stats/${season}.csv`).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    const head = lines.shift().split(',');
    const seen = new Set();
    for (const l of lines) {
      const c = l.split(',');
      const no = ids.get(`${season}|${c[0]}`);
      assert.ok(no, `${season} ${c[0]}`);
      seen.add(no);
      const o = sums.get(no);
      for (const [col, k] of SUM) assert.equal(n(c[head.indexOf(col)]), o[k], `${season} ${c[0]} ${col}`);
      assert.ok(Math.abs(n(c[head.indexOf('minutes')]) - o.sec / 60) < 0.2, `${season} ${c[0]} minutes`);
    }
    assert.equal(seen.size, sums.size, `${season}: 공식 기록에만 있는 선수가 있다`);
  }
});

test('시즌 소속 CSV(team-<시즌>.csv)가 공식 기록의 소속과 같다 (이적한 선수는 소속 중 하나)', () => {
  const ids = new Map(csv('data/players/season-ids.csv').map((r) => [`${r.season}|${r.label}`, r.playerNo]));
  let checked = 0;
  for (const season of ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26']) {
    const teamsOf = new Map();
    for (const r of official.get(season)) (teamsOf.get(r.playerNo) ?? teamsOf.set(r.playerNo, new Set()).get(r.playerNo)).add(fid(r.team));
    const lines = read(`data/players/team-${season}.csv`).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(1);
    for (const l of lines) {
      const [name, team] = l.split(',');
      const no = ids.get(`${season}|${name}`);
      assert.ok(no, `${season} ${name}: 선수번호 없음`);
      assert.ok(teamsOf.get(no).has(team), `${season} ${name}: ${team} ≠ 공식 ${[...teamsOf.get(no)].join('/')}`);
      checked++;
    }
  }
  assert.ok(checked > 950);
});

test('프로필의 KBL 경력이 공식 기록의 소속·시즌 안에 있다 (같은 사람의 번호가 둘이면 모두 합친다)', () => {
  const profiles = JSON.parse(read('data/players/profiles.json'));
  const season = (y) => `${y}-${String(y + 1).slice(2)}`;
  const teamsBy = new Map(); // `${이름}|${생년월일}` → { 시즌 → Set(구단) }  (정규시즌)
  for (const b of births) {
    if (!b.birth) continue;
    const key = `${b.name}|${b.birth}`;
    teamsBy.set(key, teamsBy.get(key) ?? new Set());
    teamsBy.get(key).add(b.playerNo);
  }
  const bySeason = (nos) => {
    const m = new Map();
    for (const [s, rows] of official) for (const r of rows) if (nos.has(r.playerNo)) (m.get(s) ?? m.set(s, new Set()).get(s)).add(fid(r.team));
    return m;
  };
  let checked = 0;
  for (const p of profiles) {
    const nos = new Set();
    for (const name of [p.name, ...(p.aliases ?? [])]) for (const no of teamsBy.get(`${name}|${p.birth}`) ?? []) nos.add(no);
    if (!nos.size) continue; // 공식 생년월일과 달라 이어지지 않는 선수(birth-discrepancies.csv)
    const seasons = bySeason(nos);
    for (const c of p.career ?? []) {
      const m = /^(\d{4})(?:~(\d{4})?)?$/.exec(c.years);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : c.years.endsWith('~') ? 2026 : null;
      // 한 해만 쓴 표기는 시작 연도·끝나는 연도 중 한 시즌이면 된다. 구간 표기는 시즌마다 맞아야 한다
      const requirements = end === null ? [[season(start), season(start - 1)]] : Array.from({ length: end - start }, (_, i) => [season(start + i)]);
      for (const alt of requirements) {
        if (!alt.some((x) => seasons.has(x))) continue; // 그 시즌 기록이 없는 선수(공식 기록은 출전한 선수만 싣는다)
        assert.ok(alt.some((x) => seasons.get(x)?.has(c.team)), `${p.name} ${c.team} ${c.years}: 공식 기록의 소속 ${[...seasons].map(([x, t]) => `${x}=${[...t]}`).join(' ')}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 40, `대조한 경력 ${checked}`);
});

test('수상 경력: 이력(seasons.json)의 수상과 같다 (2021-22~2025-26, 표기만 다른 이름 2건은 허용)', () => {
  const awards = csv('data/history/awards.csv');
  assert.equal(awards.length, 900);
  const seasonSet = new Set(history.map((s) => s.season));
  assert.ok(awards.every((a) => seasonSet.has(a.season)), '이력에 없는 시즌의 수상이 있음');
  const SPELLING = { '조엘 카룰랑안': '조엘 카굴랑안', '론제이 아바리엔토스': '론 제이 아바리엔토스' }; // 수상 화면과 기록 화면의 표기 차이
  const fix = (v) => SPELLING[v] ?? v;
  const NON = '정규시즌 비계량 부문 수상자';
  const map = { 정규시즌_MVP국내: ['MVP'], 정규시즌_MVP외국: ['외국선수상'], 최우수_수비상: ['최우수 수비상'], 식스맨상: ['식스맨상'], 기량발전상: ['기량 발전상'], 페어플레이상: ['이성구 페어플레이상 (모범선수상)'], 인기상: ['인기상'], 신인상: ['신인 선수상'], 감독상: ['감독상'] };
  const raw = { 정규시즌_MVP국내: '정규시즌 MVP(국내)', 정규시즌_MVP외국: '정규시즌 MVP(외국)', 최우수_수비상: '최우수 수비상', 식스맨상: '식스맨상', 기량발전상: '기량발전상', 페어플레이상: '페어플레이상', 인기상: '인기상', 신인상: '신인상', 감독상: '감독상' };
  let checked = 0;
  for (const s of history.filter((x) => x.awards && x.season >= '2021-22')) {
    const rows = awards.filter((a) => a.season === s.season && a.category === NON);
    for (const [key, names] of Object.entries(map)) {
      if (!(raw[key] in s.awards)) continue;
      const got = rows.filter((a) => names.includes(a.award)).map((a) => fix(a.name)).sort();
      const want = [s.awards[raw[key]]].flat().sort();
      assert.deepEqual(got, want, `${s.season} ${raw[key]}`);
      checked++;
    }
    assert.deepEqual(rows.filter((a) => a.award === '베스트5').map((a) => fix(a.name)).sort(), [...s.awards['베스트5']].sort(), `${s.season} 베스트5`);
    checked++;
  }
  assert.ok(checked >= 35, `대조한 수상 ${checked}`);
  // 우승팀·준우승팀(플레이오프)이 이력과 같다
  for (const s of history.filter((x) => x.playoffs)) {
    const row = (award) => awards.find((a) => a.season === s.season && a.category === '플레이오프 우승팀 및 MVP' && a.award === award);
    assert.ok(row('우승'), s.season);
  }
});

test('화면용 선수 기록(careers.json)이 공식 기록에서 다시 만든 것과 같다', () => {
  const rebuilt = JSON.stringify(buildCareers(loadInputs())) + '\n';
  assert.equal(read('data/players/careers.json'), rebuilt, 'careers.json이 낡았습니다: npm run build:careers');
  const careers = JSON.parse(read('data/players/careers.json'));
  const players = JSON.parse(read('data/players.json'));
  for (const p of players) {
    assert.ok(p.kblId, `${p.name}: kblId 없음`);
    assert.ok(careers[p.kblId], `${p.name} ${p.kblId}: 기록 없음`);
    assert.ok(careers[p.kblId].rows.some((r) => r[0] === '2026-27' || r[0] === '2025-26'), `${p.name}: 최근 시즌 기록 없음`);
  }
  assert.equal(new Set(players.map((p) => p.kblId)).size, players.length, '선수번호가 겹침');
});
