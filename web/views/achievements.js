// 업적 화면: 달성한 업적(달성 시즌)과 아직 못 한 업적(조건).
import { h } from '../lib/dom.js';
import { ACHIEVEMENTS } from '../../src/achievements.mjs';

const TIER = { bronze: '동', silver: '은', gold: '금' };

export function render(ctx) {
  const have = ctx.session.achievements;
  const done = ACHIEVEMENTS.filter((a) => have[a.id]);
  const card = (a) => {
    const got = have[a.id];
    return h('li', { class: `ach ${got ? 'got' : 'todo'} t-${a.tier}` },
      h('span', { class: 'ach-medal', 'aria-hidden': 'true' }, TIER[a.tier]),
      h('div', { class: 'ach-body' }, h('b', a.name), h('div', { class: 'note' }, a.desc)),
      h('span', { class: 'ach-when note' }, got ? `${got} 달성` : '미달성'));
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '단장 업적'), h('h1', '업적'))),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', `달성 ${done.length} / ${ACHIEVEMENTS.length}`), h('span', { class: 'note' }, '동·은·금은 난이도입니다')),
      h('div', { class: 'bar gl-bar', role: 'img', 'aria-label': `업적 ${done.length}개 달성` }, h('i', { style: { width: `${(done.length / ACHIEVEMENTS.length) * 100}%` } }))),
    h('div', { class: 'card flush' }, h('ul', { class: 'ach-list' }, [...ACHIEVEMENTS].sort((a, b) => (have[b.id] ? 1 : 0) - (have[a.id] ? 1 : 0)).map(card))));
  return { title: '업적', body };
}
