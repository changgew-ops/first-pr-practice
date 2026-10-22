import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHistory } from '../src/history-build.mjs';
import { loadHistory, champions, franchiseSummary, recentForm } from '../src/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));
const history = loadHistory();
const { seasons, franchises } = history;

test('원본 검증: 승패 합계·승률·순위·플레이오프 대진 오류가 0건이다', () => {
  const built = buildHistory(join(ROOT, 'data/history/raw'), teams);
  assert.deepEqual(built.errors, []);
});

test('저장된 seasons.json/franchises.json이 raw에서 다시 빌드한 결과와 같다 (빌드를 잊지 않았는지)', () => {
  const built = buildHistory(join(ROOT, 'data/history/raw'), teams);
  assert.deepEqual(built.seasons, seasons);
  assert.deepEqual(built.franchises, franchises);
});

test('30개 시즌(1997~2025-26), 시즌 순서와 구단 수', () => {
  assert.equal(seasons.length, 30);
  assert.equal(seasons[0].season, '1997');
  assert.equal(seasons.at(-1).season, '2025-26');
  assert.equal(seasons[0].teams.length, 8);
  for (const s of seasons.slice(1)) assert.equal(s.teams.length, 10, s.season);
  for (let i = 1; i < seasons.length; i++) assert.ok(seasons[i].startYear >= seasons[i - 1].startYear);
});

test('시즌마다 승 합계 = 패 합계, 팀별 경기 수가 고르다', () => {
  for (const s of seasons) {
    assert.equal(s.teams.reduce((a, t) => a + t.wins, 0), s.teams.reduce((a, t) => a + t.losses, 0), s.season);
    const games = s.teams.map((t) => t.wins + t.losses);
    assert.ok(Math.max(...games) - Math.min(...games) <= 1, s.season);
  }
});

test('2001-02 이후에는 홈·원정 기록의 합이 승패와 맞는다 (2024-25의 사이트 표시값 3건 제외)', () => {
  const rec = (t) => t.split('-').map(Number);
  const mismatches = [];
  for (const s of seasons) {
    if (s.startYear < 2001) continue;
    for (const t of s.teams) {
      const [hw, hl] = rec(t.home);
      const [aw, al] = rec(t.away);
      if (hw + aw !== t.wins || hl + al !== t.losses) mismatches.push(`${s.season} ${t.displayName}`);
    }
  }
  assert.deepEqual(mismatches.sort(), ['2024-25 대구 한국가스공사', '2024-25 수원 KT', '2024-25 안양 정관장'].sort());
});

test('플레이오프: 2007-08~2025-26 중 코로나로 끝난 2019-20을 뺀 18개 시즌에 있고, 우승팀은 정규리그 상위 6팀이다', () => {
  const withPo = seasons.filter((s) => s.playoffs).map((s) => s.season);
  assert.equal(withPo.length, 18);
  assert.ok(!withPo.includes('2019-20'));
  assert.ok(withPo.includes('2007-08') && withPo.includes('2025-26'));
  for (const s of seasons.filter((x) => x.playoffs)) {
    const top6 = s.teams.slice(0, 6).map((t) => t.franchiseId);
    assert.ok(top6.includes(s.playoffs.championId), s.season);
    assert.ok(top6.includes(s.playoffs.runnerUpId), s.season);
    assert.notEqual(s.playoffs.championId, s.playoffs.runnerUpId);
    const [r6, r4, fin] = s.playoffs.rounds;
    assert.equal(r6.series.length, 2);
    assert.equal(r4.series.length, 2);
    assert.equal(fin.series.length, 1);
  }
});

test('결승 시리즈: 7전 4선승이다 (2007-08 이후 모든 시즌)', () => {
  for (const s of seasons.filter((x) => x.playoffs)) assert.equal(s.playoffs.rounds[2].bestOf, 7, s.season);
});

test('화면에서 확인한 대표 사실들 (회귀 방지)', () => {
  const by = Object.fromEntries(seasons.map((s) => [s.season, s]));
  const champ = Object.fromEntries(champions(seasons).map((c) => [c.season, c.championId]));
  assert.equal(champ['2025-26'], 'busan-kcc');
  assert.equal(champ['2024-25'], 'changwon-lg');
  assert.equal(champ['2023-24'], 'busan-kcc');
  assert.equal(champ['2018-19'], 'ulsan-hyundai-mobis');
  assert.equal(by['1997'].teams[0].displayName, '부산기아');
  assert.equal(by['2024-25'].teams[0].wins, 41);
  const worst = seasons.flatMap((s) => s.teams.map((t) => ({ s: s.season, t }))).sort((a, b) => a.t.pct - b.t.pct)[0];
  assert.equal(worst.s, '1998-99'); // 대구동양 3승 42패
  assert.equal(by['2005-06'].teams.at(-1).losses, 46); // 인천전자랜드 8승 46패
  assert.equal(by['2019-20'].playoffs, null);
});

test('구단 계보: 현재 10개 구단이 모든 시즌에 한 번씩 이어지고 이름 구간이 끊기지 않는다', () => {
  assert.equal(franchises.length, 10);
  for (const f of franchises) {
    let covered = 0;
    for (const n of f.names) {
      const a = seasons.findIndex((s) => s.season === n.from);
      const b = seasons.findIndex((s) => s.season === n.to);
      assert.ok(a >= 0 && b >= a, `${f.id} ${n.name}`);
      covered += b - a + 1;
    }
    const expected = f.id === 'seoul-sk' || f.id === 'changwon-lg' ? 29 : 30; // 두 구단은 1997-98에 합류
    assert.equal(covered, expected, f.id);
    // 구간이 서로 이어진다 (다음 구간은 바로 다음 시즌에서 시작)
    for (let i = 1; i < f.names.length; i++) {
      const prevEnd = seasons.findIndex((s) => s.season === f.names[i - 1].to);
      const nextStart = seasons.findIndex((s) => s.season === f.names[i].from);
      assert.equal(nextStart, prevEnd + 1, `${f.id}: ${f.names[i - 1].name} → ${f.names[i].name}`);
    }
  }
});

test('구단 이름 변천: 대표 사례', () => {
  const names = (id) => franchises.find((f) => f.id === id).names.map((n) => n.name);
  assert.deepEqual(names('suwon-kt').slice(0, 4), ['광주나산', '광주 골드뱅크', '여수 골드뱅크', '여수 코리아텐더']);
  assert.ok(names('suwon-kt').includes('부산KTF') && names('suwon-kt').at(-1) === '수원 KT');
  assert.equal(names('goyang-sono')[0], '대구동양');
  assert.equal(names('goyang-sono').at(-1), '고양 소노');
  assert.equal(names('daegu-kogas').at(-1), '대구 한국가스공사');
  assert.equal(names('busan-kcc')[0], '대전현대');
});

test('구단 요약: 우승·결승 횟수는 우승 기록이 있는 시즌 안에서 서로 맞는다', () => {
  const sum = franchiseSummary(history);
  const totalTitles = sum.reduce((a, s) => a + s.titles.length, 0);
  assert.equal(totalTitles, 18);
  assert.equal(sum.reduce((a, s) => a + s.finals, 0), 36);
  for (const s of sum) {
    assert.ok(s.finals >= s.titles.length);
    assert.ok(s.playoffAppearances >= s.finals);
    assert.ok(s.bestRank >= 1 && s.worstRank <= 10);
    assert.ok(s.winPct > 0.3 && s.winPct < 0.7);
  }
  const kcc = sum.find((s) => s.id === 'busan-kcc');
  assert.ok(kcc.titles.includes('2025-26') && kcc.titles.includes('2023-24') && kcc.titles.includes('2010-11'));
  assert.equal(recentForm(history, 'busan-kcc', 3).length, 3);
});

test('2025-26 라운드별 순위: 6개 라운드, 누적 경기 수, 마지막 라운드 = 최종 순위, 라운드 MVP', () => {
  const s = seasons.at(-1);
  assert.equal(s.rounds.length, 6);
  s.rounds.forEach((r, i) => {
    assert.equal(r.teams.length, 10);
    for (const t of r.teams) assert.equal(t.games, 9 * (i + 1));
    assert.ok(r.mvp.name && teams.some((t) => t.id === r.mvp.franchiseId));
  });
  for (const f of s.teams) {
    const t = s.rounds[5].teams.find((x) => x.franchiseId === f.franchiseId);
    assert.equal(`${t.wins}-${t.losses}`, `${f.wins}-${f.losses}`);
  }
  assert.equal(s.rounds[0].mvp.name, '허웅');
  assert.equal(s.rounds[5].mvp.franchiseId, 'wonju-db');
});

test('라운드 검증: 누적과 맞지 않는 라운드 전적·경기 수·최종 순위는 오류로 잡는다', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const raw = JSON.parse(readFileSync(join(ROOT, 'data/history/raw/2025-26.json'), 'utf8'));
  const run = (mutate) => {
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    try {
      const copy = JSON.parse(JSON.stringify(raw));
      mutate(copy);
      writeFileSync(join(dir, '2025-26.json'), JSON.stringify(copy));
      return buildHistory(dir, teams).errors.filter((e) => !e.includes('순위표에 없습니다')).join('\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(run(() => {}), '');
  assert.match(run((c) => { c.rounds[1].rows[0][7] = '5-4'; }), /라운드 전적/);
  assert.match(run((c) => { c.rounds[2].rows[0][2] = 28; }), /경기 수/);
  assert.match(run((c) => { c.rounds[5].rows[0][3] = 35; c.rounds[5].rows[0][4] = 19; c.rounds[5].rows[0][5] = 0.648; }), /최종|라운드 전적/);
});
