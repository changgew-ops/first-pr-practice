// 임시 화면: 담당이 채운다.
import { h } from '../lib/dom.js';
export function render(ctx) { return { title: 'training', body: h('div', { class: 'card' }, h('h2', 'training'), h('p', { class: 'muted' }, '준비 중입니다.')) }; }
