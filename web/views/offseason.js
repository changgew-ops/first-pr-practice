// 임시 화면: 담당이 채운다.
import { h } from '../lib/dom.js';
export function render(ctx) { return { title: 'offseason', body: h('div', { class: 'card' }, h('h2', 'offseason'), h('p', { class: 'muted' }, '준비 중입니다.')) }; }
