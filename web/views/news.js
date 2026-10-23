import { h } from '../lib/dom.js';
export function render() { return { title: '뉴스', body: h('div', { class: 'stack' }, h('h1', '뉴스'), h('p', { class: 'muted' }, '준비 중입니다.')) }; }
