import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarSvg, avatarLook, avatarSeed } from '../web/lib/avatar.js';

const P = { id: 'p1', kblId: 'K001', name: '98 서장훈', baseName: '서장훈', position: 'C', rarity: 'legend', age: 27 };

test('같은 선수는 늘 같은 그림', () => {
  assert.equal(avatarSvg(P), avatarSvg({ ...P }));
  assert.equal(avatarSeed(P), avatarSeed({ ...P, name: '03 서장훈', id: 'other' }), '같은 kblId·baseName의 다른 시즌 카드는 같은 기본 모습');
});

test('유효한 SVG 문자열이고 외부 참조가 없다', () => {
  const s = avatarSvg(P, { size: 80, number: 7, teamColor: '#ff7a1a' });
  assert.match(s, /^<svg [^>]*viewBox="0 0 64 64"/);
  assert.ok(s.endsWith('</svg>'));
  assert.ok(!/href=|<image|<script/i.test(s));
  assert.ok(s.includes('>7</text>'), 'size 72 이상에서만 번호 표시');
  assert.ok(!avatarSvg(P, { size: 40, number: 7 }).includes('<text'));
  // 태그 짝 맞음
  for (const tag of ['g', 'text']) assert.equal((s.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length, (s.match(new RegExp(`</${tag}>`, 'g')) ?? []).length);
});

test('선수가 다르면 그림이 다르다', () => {
  const set = new Set();
  for (let i = 0; i < 40; i++) set.add(avatarSvg({ ...P, kblId: `K${i}`, baseName: `선수${i}`, name: `선수${i}` }, { size: 48 }));
  assert.ok(set.size >= 38, `서로 다른 그림 수 ${set.size}`);
});

test('나이·구단색·희귀도가 표현에 반영된다', () => {
  assert.notEqual(avatarSvg(P, { teamColor: '#112233' }), avatarSvg(P, { teamColor: '#aa3322' }));
  assert.notEqual(avatarSvg({ ...P, rarity: 'common' }), avatarSvg(P));
  assert.equal(avatarLook({ ...P, age: 20 }).round, true);
  assert.equal(avatarLook({ ...P, age: 35, hairStyle: 0 }).gray, avatarLook({ ...P, age: 35 }).hairStyle !== 6);
});

test('정보가 빠진 선수에도 그려진다', () => {
  assert.match(avatarSvg({ name: '무명' }), /<svg/);
  assert.match(avatarSvg({ id: 'x', position: 'PG' }, { decorative: false }), /role="img"/);
});
