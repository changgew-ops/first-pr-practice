// 임시 화면: 담당이 채운다.
import { h } from '../lib/dom.js';
export function render(ctx) { return { title: 'trades', body: h('div', { class: 'card' }, h('h2', '트레이드'), h('p', { class: 'muted' }, '준비 중입니다.')) }; }
