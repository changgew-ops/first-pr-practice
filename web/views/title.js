// 타이틀 화면: 그림(web/assets/title.svg — 나중에 파일만 바꾸면 된다)과 PUSH START.
import { h } from '../lib/dom.js';
import { latestSlot } from '../lib/save.js';
import { seasonLabel } from '../lib/game.js';

const ART = new URL('../assets/title.svg', import.meta.url).href;

export function render(ctx) {
  const latest = latestSlot();
  const start = () => ctx.go('intro');
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } };
  const btn = h('button', { class: 'push', type: 'button', onclick: start, onkeydown: onKey }, 'PUSH START');
  setTimeout(() => btn.focus(), 0);
  const body = h('div', { class: 'title-screen' },
    h('div', { class: 'title-art' }, h('img', { src: ART, alt: '', width: 640, height: 360 })),
    h('h1', { class: 'logo' }, h('span', { class: 'px' }, 'KBL'), h('span', { class: 'ko' }, '단장 게임')),
    h('p', { class: 'tagline' }, '실제 KBL 구단과 선수로 만드는 싱글 플레이 GM 게임'),
    btn,
    h('div', { class: 'title-menu' },
      latest ? h('button', { class: 'btn', onclick: () => ctx.loadSlot(latest.slot) }, `이어하기 · ${latest.meta.gmName} 단장 · ${ctx.name(latest.meta.teamId)} · ${latest.meta.season}${latest.meta.stage === 'regular' && latest.meta.day ? ` ${latest.meta.day}일차` : ''}`) : null,
      h('button', { class: 'btn ghost', onclick: () => ctx.go('save') }, '저장 불러오기')));
  return { title: '타이틀', body };
}
