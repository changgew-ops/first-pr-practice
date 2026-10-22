import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHistory, buildDrafts, buildEvents } from '../src/history-build.mjs';
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

test('2024-25 라운드·수상: 6개 라운드가 검증을 통과하고 최종 순위와 같으며 수상 기록이 있다', () => {
  const s = seasons.find((x) => x.season === '2024-25');
  assert.equal(s.rounds.length, 6);
  for (const f of s.teams) {
    const t = s.rounds[5].teams.find((x) => x.franchiseId === f.franchiseId);
    assert.equal(`${t.wins}-${t.losses}`, `${f.wins}-${f.losses}`);
  }
  assert.deepEqual(s.rounds.map((r) => r.mvp.name), ['자밀 워니', '자밀 워니', '칼 타마요', '자밀 워니', '안영준', '박지훈']);
  assert.equal(s.awards['정규시즌 MVP(국내)'], '안영준');
  assert.equal(s.awards['베스트5'].length, 5);
  assert.equal(s.awards['감독상'], '전희철');
});

test('신인 드래프트 2023~2025: 검증 오류 0건, 저장본과 일치, 지명 수·순서', () => {
  const built = buildDrafts(join(ROOT, 'data/history/drafts'), teams);
  assert.deepEqual(built.errors, []);
  const saved = JSON.parse(readFileSync(join(ROOT, 'data/history/drafts.json'), 'utf8'));
  assert.deepEqual(built.drafts, saved);
  assert.deepEqual(saved.map((d) => d.draftYear), [2023, 2024, 2025]);
  const [d23, d24, d25] = saved;
  assert.equal(d23.picks.length, 20);
  assert.equal(d23.participantsKnown, false);
  assert.deepEqual(d23.picks.slice(0, 3).map((p) => p.name), ['문정현', '박무빈', '유기상']);
  assert.equal(d23.picks.find((p) => p.round === 2 && p.pick === 1).franchiseId, 'anyang-jungkwanjang'); // 2라운드는 역순: 1라운드 10순위 팀이 먼저
  assert.equal(d24.participants.length, 42);
  assert.equal(d24.picks.length, 26);
  assert.equal(d25.participants.length, 46);
  assert.equal(d25.picks.length, 26);
  assert.equal(d24.picks[0].name, '박정웅');
  assert.equal(d24.picks[0].franchiseId, 'anyang-jungkwanjang');
  // 2024 1라운드: 삼성·DB가 지명권을 맞바꿔 3순위는 DB, 8순위는 삼성
  assert.equal(d24.picks.find((p) => p.round === 1 && p.pick === 3).franchiseId, 'wonju-db');
  assert.equal(d24.picks.find((p) => p.round === 1 && p.pick === 8).franchiseId, 'seoul-samsung');
  assert.equal(d25.picks[0].name, '문유현');
  assert.deepEqual(d25.territorialPicks.map((t) => t.name), ['에디 다니엘', '김건하']);
});

test('드래프트 검증: 추첨 공 합계, 지명 구단, 참가자 명단에 없는 선수는 오류로 잡는다', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const raw = JSON.parse(readFileSync(join(ROOT, 'data/history/drafts/2024.json'), 'utf8'));
  const run = (mutate) => {
    const dir = mkdtempSync(join(tmpdir(), 'draft-'));
    try {
      const copy = JSON.parse(JSON.stringify(raw));
      mutate(copy);
      writeFileSync(join(dir, '2024.json'), JSON.stringify(copy));
      return buildDrafts(dir, teams).errors.join('\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(run(() => {}), '');
  assert.match(run((c) => { c.lottery[0][1] = 41; }), /공 합계/);
  assert.match(run((c) => { c.picks[0].team = '서울 SK'; }), /지명 구단/);
  assert.match(run((c) => { c.picks[0].name = '없는선수'; }), /참가자 명단에 없습니다/);
  assert.match(run((c) => { c.tradedPicks = []; }), /지명 구단/);
});

// 나무위키 KBL 문서(구단별 우승 연도·타이틀 스폰서)와의 대조
const POFF = {
  'ulsan-hyundai-mobis': ['1997', '2006-07', '2009-10', '2012-13', '2013-14', '2014-15', '2018-19'],
  'busan-kcc': ['1997-98', '1998-99', '2003-04', '2008-09', '2010-11', '2023-24', '2025-26'],
  'seoul-sk': ['1999-2000', '2017-18', '2021-22'],
  'seoul-samsung': ['2000-01', '2005-06'],
  'wonju-db': ['2002-03', '2004-05', '2007-08'],
  'anyang-jungkwanjang': ['2011-12', '2016-17', '2020-21', '2022-23'],
  'changwon-lg': ['2024-25'],
  'goyang-sono': ['2001-02', '2015-16'],
  'suwon-kt': [],
  'daegu-kogas': []
};
const REGULAR = {
  'ulsan-hyundai-mobis': ['1997', '2005-06', '2006-07', '2008-09', '2009-10', '2014-15', '2018-19'],
  'wonju-db': ['2003-04', '2004-05', '2007-08', '2011-12', '2017-18', '2023-24'],
  'busan-kcc': ['1997-98', '1998-99', '1999-2000', '2015-16', '2020-21'],
  'seoul-sk': ['2012-13', '2021-22', '2024-25'],
  'changwon-lg': ['2013-14', '2025-26'],
  'anyang-jungkwanjang': ['2016-17', '2022-23'],
  'goyang-sono': ['2001-02', '2002-03'],
  'seoul-samsung': ['2000-01'],
  'suwon-kt': ['2010-11'],
  'daegu-kogas': []
};

test('우승 연도: 시즌별 챔피언(championId)이 구단별 플레이오프 우승 연도와 정확히 같다 (2019-20은 우승 없음)', () => {
  const byTeam = {};
  for (const s of seasons) if (s.championId) (byTeam[s.championId] ??= []).push(s.season);
  for (const t of teams) assert.deepEqual(byTeam[t.id] ?? [], POFF[t.id], t.id);
  assert.equal(seasons.find((s) => s.season === '2019-20').championId, null);
  assert.equal(seasons.filter((s) => s.championId).length, 29);
  // 플레이오프 화면이 있는 시즌은 결승 승자와 같다
  for (const s of seasons) if (s.playoffs) assert.equal(s.championId, s.playoffs.championId, s.season);
});

test('정규시즌 우승: 1위 구단이 구단별 정규시즌 우승 연도와 같다 (코로나로 중단된 2019-20 제외)', () => {
  const byTeam = {};
  for (const s of seasons) if (s.season !== '2019-20') (byTeam[s.teams[0].franchiseId] ??= []).push(s.season);
  for (const t of teams) assert.deepEqual(byTeam[t.id] ?? [], REGULAR[t.id], t.id);
});

test('구단 정보: 우승 횟수 = 플레이오프 + 정규시즌 + 컵대회 (위키 표기), 소노·가스공사는 위키가 계보를 따로 센다', () => {
  for (const t of teams) {
    assert.ok(t.arena && t.founded.length >= 1, t.id);
    const total = POFF[t.id].length + REGULAR[t.id].length + t.cupTitles.length;
    assert.equal(t.lineageTitles, total, `${t.id} 계보 합산 우승`);
    if (!t.lineageNote) assert.equal(t.officialTitles, total, `${t.id} 공식 우승`);
  }
  const sono = teams.find((t) => t.id === 'goyang-sono');
  assert.equal(sono.officialTitles, 0);
  assert.equal(sono.lineageTitles, 5);
});

test('타이틀 스폰서: 모든 시즌에 있고 연속 범위가 맞다', () => {
  for (const s of seasons) assert.ok(s.titleSponsor?.name, s.season);
  const at = (name) => seasons.find((s) => s.season === name).titleSponsor;
  assert.equal(at('1997').sponsor, 'FILA');
  assert.equal(at('1997-98').sponsor, 'FILA');
  assert.equal(at('2002-03').name, '애니콜 프로농구');
  assert.equal(at('2013-14').sponsor, 'KB국민카드');
  assert.equal(at('2025-26').name, 'LG전자 프로농구');
});

test('2023-24: 날짜로 나뉜 라운드(팀마다 경기 수 다름), 상대전적, 수상', () => {
  const s = seasons.find((x) => x.season === '2023-24');
  assert.equal(s.rounds.length, 6);
  const r1 = s.rounds[0].teams;
  assert.equal(r1.reduce((a, t) => a + t.games, 0), 90); // 1라운드 = 45경기
  assert.notEqual(new Set(r1.map((t) => t.games)).size, 1);
  assert.equal(s.rounds[0].teams[0].roundWins, 9); // 1라운드는 라운드 전적 열이 없어 누적으로 채운다
  for (const f of s.teams) {
    const t = s.rounds[5].teams.find((x) => x.franchiseId === f.franchiseId);
    assert.equal(`${t.wins}-${t.losses}`, `${f.wins}-${f.losses}`);
  }
  const h = s.headToHead;
  const idx = (id) => h.teams.indexOf(id);
  const w = (a, b) => h.wins[idx(a)][idx(b)];
  assert.equal(w('changwon-lg', 'anyang-jungkwanjang'), 4); // 위키 표(6)를 두 팀 승패에 맞게 고친 값
  assert.equal(w('anyang-jungkwanjang', 'changwon-lg'), 2);
  for (const a of h.teams) for (const b of h.teams) if (a !== b) assert.equal(w(a, b) + w(b, a), 6);
  assert.equal(s.awards['정규시즌 MVP(외국)'], '디드릭 로슨');
  assert.equal(s.awards['감독상'], '김주성');
});

test('시즌별 소속 CSV: 선수기록 시트와 같은 선수 수, 모두 실제 구단', () => {
  const ids = new Set(teams.map((t) => t.id));
  const lines = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  for (const [season, count] of [['2025-26', 193], ['2024-25', 203], ['2023-24', 200]]) {
    const stats = lines(`data/stats/${season}.csv`).slice(1).map((l) => l.split(',')[0]);
    const team = lines(`data/players/team-${season}.csv`).slice(1).map((l) => l.split(','));
    assert.equal(stats.length, count, `${season} 기록`);
    assert.equal(team.length, count, `${season} 소속`);
    const statSet = new Set(stats);
    for (const [name, id] of team) {
      assert.ok(ids.has(id), `${season} ${name} 구단 ${id}`);
      assert.ok(statSet.has(name) || statSet.has(name.replace(/\(\d+\)$/, '')) || [...statSet].some((n) => n.replace(/\(\d+\)$/, '') === name), `${season} 소속 목록의 ${name}이(가) 기록에 없음`);
    }
  }
});

// 시즌 이벤트(오프시즌 트레이드·외국인·FA·은퇴·군 입대)
const csvLines = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
function seasonTeamMaps() {
  const m = new Map();
  for (const s of ['2023-24', '2024-25', '2025-26']) m.set(s, new Map(csvLines(`data/players/team-${s}.csv`).slice(1).map((l) => l.split(',').slice(0, 2))));
  m.set('2026-27', new Map(csvLines('data/players/registry.csv').slice(1).map((l) => l.split(',').slice(0, 2))));
  return m;
}

test('시즌 이벤트: 모든 파일이 검증을 통과하고 저장본(events.json)과 같다', () => {
  const built = buildEvents(join(ROOT, 'data/history/events'), teams, { seasonTeams: seasonTeamMaps() });
  assert.deepEqual(built.errors, []);
  const saved = JSON.parse(readFileSync(join(ROOT, 'data/history/events.json'), 'utf8'));
  assert.deepEqual(built.events, saved);
  assert.ok(saved.length >= 1);
});

test('시즌 이벤트 2026-27: FA 대상자 = 계약 + 미체결 + 제외, 아시아쿼터 9명, 위키 FA 새 소속이 등록선수 화면과 모두 일치', () => {
  const ev = JSON.parse(readFileSync(join(ROOT, 'data/history/events.json'), 'utf8')).find((e) => e.season === '2026-27');
  assert.equal(ev.fa.contracts.length, 25);
  assert.equal(ev.foreign.filter((f) => f.asiaQuota).length, 9);
  assert.deepEqual(ev.trades.map((t) => [t.teamA, t.giveA[0], t.teamB, t.giveB[0]]), [['anyang-jungkwanjang', '김경원', 'ulsan-hyundai-mobis', '이대헌']]);
  const choi = ev.fa.contracts.find((c) => c.name === '최승욱');
  assert.equal(choi.fromFranchiseId, '계약 미체결');
  assert.equal(choi.toFranchiseId, 'daegu-kogas');
  // 위키 새 소속 ↔ 등록선수 화면(동명이인 최승욱 제외)
  const reg = seasonTeamMaps().get('2026-27');
  for (const c of ev.fa.contracts) if (c.name !== '최승욱') assert.equal(reg.get(c.name), c.toFranchiseId, c.name);
});

test('등록선수 화면에 없는 주전급(출전 600분 이상)은 은퇴·임의 탈퇴·군 입대 등 이벤트로 설명된다', () => {
  const ev = JSON.parse(readFileSync(join(ROOT, 'data/history/events.json'), 'utf8')).find((e) => e.season === '2026-27');
  const gone = new Set([...ev.retirements, ...ev.voluntaryLeave, ...ev.military.enlist].flatMap((g) => g.names));
  const pool = JSON.parse(readFileSync(join(ROOT, 'data/players/real-pool.json'), 'utf8'));
  const unexplained = pool.filter((p) => !p.registered && p.minutes >= 600 && p.origin === 'domestic' && !gone.has(p.name.replace(/\(\d+\)$/, ''))).map((p) => p.name);
  assert.deepEqual(unexplained, []);
});
