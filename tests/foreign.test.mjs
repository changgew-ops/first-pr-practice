import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadContext, validateSeason, norm } from '../tools/check-foreign.mjs';

const DIR = new URL('../data/history/foreign/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^\d{4}.*\.json$/.test(f)).sort();
const ctx = loadContext();
const docs = new Map(files.map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]));

test('외국인 선수 문서: 모든 시즌(1997~2026-27) 파일이 있다', () => {
  assert.deepEqual([...docs.keys()].sort(), [...ctx.seasons.map((s) => s.season), '2026-27'].sort());
});

test('외국인 선수 문서: 형식·구단·공식 기록 대조 검증을 모두 통과한다', () => {
  const problems = [];
  for (const [season, doc] of docs) {
    const { errors } = validateSeason(doc, ctx, `${season}.json`);
    for (const m of errors) problems.push(`${season}: ${m}`);
  }
  assert.deepEqual(problems, []);
});

test('외국인 선수 문서: 같은 선수의 국적이 시즌마다, 이벤트 파일과 어긋나지 않는다 (이어받은 값은 제외)', () => {
  const byName = new Map(); // 정규화 이름 → Map(국적 문자열 → [시즌…])
  for (const [season, doc] of docs) {
    for (const t of doc.teams) for (const p of t.players) {
      if (!p.nationality || p.inherited?.includes('nationality')) continue;
      const key = norm(p.officialName ?? p.name);
      const nat = [...p.nationality].sort().join('·');
      byName.set(key, byName.get(key) ?? new Map());
      byName.get(key).set(nat, [...(byName.get(key).get(nat) ?? []), season]);
    }
  }
  for (const e of ctx.events) for (const f of e.foreign ?? []) {
    if (!f.nationality || f.asiaQuota) continue;
    const key = norm(f.name);
    const nat = [...f.nationality].sort().join('·');
    byName.set(key, byName.get(key) ?? new Map());
    byName.get(key).set(nat, [...(byName.get(key).get(nat) ?? []), `${e.season}(이벤트)`]);
  }
  const conflicts = [...byName].filter(([, m]) => m.size > 1).map(([k, m]) => `${k}: ${[...m].map(([n, s]) => `${n}=${s.join(',')}`).join(' / ')}`);
  // 알려진 표기 차이는 아래에 사유와 함께 적는다
  const KNOWN = {};
  assert.deepEqual(conflicts.filter((c) => !(c.split(':')[0] in KNOWN)), []);
});
