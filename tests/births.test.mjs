import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBirthsCsv, matchBirth, splitCsvLine, DRAFT_AGE } from '../src/real-players.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rows = parseBirthsCsv(read('data/players/births.csv'));
const byName = new Map();
for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
const discrepancies = parseBirthsCsv(read('data/players/birth-discrepancies.csv'));
const registry = parseBirthsCsv(read('data/players/registry.csv')); // 같은 형식(쉼표 CSV, # 주석)
const profiles = JSON.parse(read('data/players/profiles.json'));
const drafts = JSON.parse(read('data/history/drafts.json'));

const isDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(s) && d.toISOString().slice(0, 10) === s; };

test('births.csv: 선수번호가 겹치지 않고, 생년월일은 실제 날짜이며, 상태와 맞는다', () => {
  assert.ok(rows.length >= 1600);
  assert.equal(new Set(rows.map((r) => r.playerNo)).size, rows.length);
  for (const r of rows) {
    assert.ok(['domestic', 'foreign', 'asia'].includes(r.kind), `${r.playerNo} ${r.kind}`);
    assert.ok(['main', 'extra'].includes(r.list), r.playerNo);
    if (r.birth) {
      assert.ok(isDate(r.birth), `${r.name} ${r.birth}`);
      assert.ok(r.birth >= '1950-01-01' && r.birth <= '2010-12-31', `${r.name} ${r.birth}`);
      assert.equal(r.status, '확인', r.name);
    } else {
      assert.notEqual(r.status, '확인', `${r.name}: 생년월일이 없는데 확인으로 표시됨`);
    }
  }
});

test('births.csv: 달력에 없는 원문 날짜는 값으로 쓰지 않고 note에 남긴다', () => {
  const bad = rows.filter((r) => /원문 오류/.test(r.note));
  assert.deepEqual(bad.map((r) => r.name).sort(), ['앤서니 존슨', '알렌 위긴스', '이우정'].sort());
  for (const r of bad) assert.equal(r.birth, '');
});

test('따옴표가 있는 영문 이름도 칸이 밀리지 않는다', () => {
  assert.deepEqual(splitCsvLine('1,바이런 멀린스,"Byron James ""B. J."" Mullens",foreign'), ['1', '바이런 멀린스', 'Byron James "B. J." Mullens', 'foreign']);
  const r = rows.find((x) => x.name === '바이런 멀린스');
  assert.equal(r.nameEn, 'Byron James "B. J." Mullens');
  assert.equal(r.birth, '1989-02-14');
});

test('프로필·드래프트 기록의 생년월일이 공식 값과 같다 (다른 것은 birth-discrepancies.csv에 있어야 한다)', () => {
  const known = new Map(discrepancies.map((d) => [`${d.source}:${d.name}`, d]));
  const used = new Set();
  const check = (source, name, names, birth) => {
    const hits = names.flatMap((n) => byName.get(n) ?? []).filter((r) => r.birth);
    if (!hits.length || hits.some((h) => h.birth === birth)) return 1;
    const d = known.get(`${source}:${name}`);
    assert.ok(d, `${source} ${name}: 문서 ${birth} ≠ 공식 ${hits.map((h) => h.birth).join('/')} — birth-discrepancies.csv에 사유와 함께 적어야 합니다`);
    assert.equal(d.sourceBirth, birth, name);
    assert.ok(hits.some((h) => h.birth === d.officialBirth), `${name}: 표의 공식 값 ${d.officialBirth}`);
    used.add(`${source}:${name}`);
    return 0;
  };
  let agree = 0;
  for (const p of profiles) agree += check('profile', p.name, [p.name, ...(p.aliases ?? [])], p.birth);
  for (const d of drafts) for (const p of d.picks) if (p.birth) agree += check(`draft-${d.draftYear}`, p.name, [p.name], p.birth);
  assert.ok(agree >= 90, `일치 ${agree}건`);
  for (const k of known.keys()) assert.ok(used.has(k), `${k}: 이제 불일치가 아닌데 표에 남아 있음`);
});

test('등록선수 187명 전원의 공식 생년월일이 한 명으로 정해지고, 드래프트 때 나이가 범위 안이다', () => {
  assert.ok(registry.length >= 187);
  const unresolved = [];
  for (const e of registry) {
    const m = matchBirth({ name: e.name, kind: e.kind, team: e.team, draftYear: e.draftYear ? Number(e.draftYear) : null }, byName);
    if (!m.birth) { unresolved.push(`${e.name}(${e.team}): ${m.why}`); continue; }
    if (e.draftYear) {
      const age = Number(e.draftYear) - Number(m.birth.slice(0, 4));
      assert.ok(age >= DRAFT_AGE[0] && age <= DRAFT_AGE[1], `${e.name} 드래프트 ${e.draftYear} 때 ${age}세`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test('matchBirth: 같은 사람 병합, 드래프트 나이, 구단 계보, 구분으로 동명이인을 가르고 모르면 null', () => {
  const r = (name, birth, kind, team, list = 'main', playerNo = `${name}${birth}`) => ({ name, birth, kind, team, list, playerNo });
  const idx = (list) => { const m = new Map(); for (const x of list) m.set(x.name, [...(m.get(x.name) ?? []), x]); return m; };
  // 선수검색 + 추가 확인 명단의 같은 생년월일은 한 사람
  assert.equal(matchBirth({ name: 'A', kind: 'd', team: 'wonju-db', draftYear: 2014 }, idx([r('A', '1991-01-01', 'domestic', '원주 DB'), r('A', '1991-01-01', 'domestic', '연세대', 'extra')])).birth, '1991-01-01');
  // 드래프트 연도로: 1973년생은 2018 드래프트 선수일 수 없다
  const two = idx([r('B', '1973-03-12', 'domestic', '대구동양'), r('B', '1996-06-21', 'domestic', '대구 한국가스공사')]);
  assert.equal(matchBirth({ name: 'B', kind: 'd', team: 'daegu-kogas', draftYear: 2018 }, two).birth, '1996-06-21');
  // 드래프트 연도가 없으면 구단 계보 단서
  assert.equal(matchBirth({ name: 'B', kind: 'd', team: 'daegu-kogas', draftYear: null }, two).birth, '1996-06-21');
  // 정할 수 없으면 추정하지 않는다
  const amb = idx([r('C', '1990-01-01', 'domestic', '서울 SK'), r('C', '1991-01-01', 'domestic', '서울 SK')]);
  assert.equal(matchBirth({ name: 'C', kind: 'd', team: 'seoul-sk', draftYear: null }, amb).birth, null);
  // 구분이 다른 동명은 제외
  const kinds = idx([r('D', '1990-01-01', 'foreign', 'SK'), r('D', '1995-05-05', 'domestic', 'SK')]);
  assert.equal(matchBirth({ name: 'D', kind: 'f', team: 'seoul-sk', draftYear: null }, kinds).birth, '1990-01-01');
  // 생년월일이 비어 있는 행은 후보가 아니다
  assert.equal(matchBirth({ name: 'E', kind: 'd', team: 'seoul-sk' }, idx([r('E', '', 'domestic', 'SK')])).birth, null);
  // KT&G(안양)는 KT가 아니다
  assert.equal(matchBirth({ name: 'F', kind: 'd', team: 'suwon-kt', draftYear: null }, idx([r('F', '1980-01-01', 'domestic', '안양KT&G'), r('F', '1990-01-01', 'domestic', '부산KT')])).birth, '1990-01-01');
});
