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

test('외국인 선수 문서: 같은 선수의 국적이 시즌마다·이벤트 파일과 겹친다 (국적 추가는 허용, 이어받은 값·미상은 제외)', () => {
  // 국적은 시즌 사이에 늘 수 있다(스펠맨 레바논, 알렉산더 바레인 등). 서로 하나도 안 겹치면 옮김 오류나 이어받기 오류다.
  const byName = new Map(); // 정규화 이름 → [{ set, where }]
  const add = (name, nat, where) => {
    if (!nat?.length || nat.includes('미상')) return;
    const key = norm(name);
    byName.set(key, [...(byName.get(key) ?? []), { set: new Set(nat), where }]);
  };
  for (const [season, doc] of docs) for (const t of doc.teams) for (const p of t.players) {
    if (p.inherited?.includes('nationality')) continue;
    add(p.officialName ?? p.name, p.nationality, season);
  }
  for (const e of ctx.events) for (const f of e.foreign ?? []) if (!f.asiaQuota) add(f.name, f.nationality, `${e.season}(이벤트)`);
  const conflicts = [];
  for (const [name, list] of byName) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (![...list[i].set].some((x) => list[j].set.has(x))) conflicts.push(`${name}: ${[...list[i].set]}(${list[i].where}) ↔ ${[...list[j].set]}(${list[j].where})`);
    }
  }
  // 위키 문서 사이에서 어긋나는 값이 생기면 여기에 이유와 함께 적어 허용한다(지금은 없다: 그리핀·제임스는 인물 문서로 정정)
  const KNOWN = {};
  assert.deepEqual(conflicts.filter((c) => !(c.split(':')[0] in KNOWN)), []);
});
