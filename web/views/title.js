// 타이틀 화면: 준비된 한 장짜리 그림(web/assets/title-bg.webp — 제목·PUSH START·이어하기·저장 불러오기 버튼까지 그려진 이미지)을
// 화면 가득 보여 주고, 그림 속 버튼 자리에 눌리는 투명 버튼을 얹는다. 그림을 바꿀 때는 파일을 바꾸고 아래 HOT 좌표(그림 안의 % 위치)만 맞추면 된다.
import { h } from '../lib/dom.js';
import { latestSlot } from '../lib/save.js';

const ART = new URL('../assets/title-bg.webp', import.meta.url).href;
const ART_FALLBACK = new URL('../assets/title.svg', import.meta.url).href;
const SIZE = { w: 1024, h: 691 };
// 그림 속 버튼 위치(왼쪽·위·너비·높이, 1024×691 그림 안의 px)
const px = (x, y, w, hgt) => [(x / SIZE.w) * 100, (y / SIZE.h) * 100, (w / SIZE.w) * 100, (hgt / SIZE.h) * 100];
const HOT = { push: px(376, 495, 265, 84), cont: px(341, 610, 162, 45), save: px(514, 610, 163, 45) };
const place = ([l, t, w, hgt]) => ({ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${hgt}%` });

export function render(ctx) {
  const latest = latestSlot();
  const start = () => ctx.go('intro');
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } };
  const push = h('button', { class: 'ts-hot ts-hot-push', type: 'button', 'aria-label': '시작하기 (PUSH START)', style: place(HOT.push), onclick: start, onkeydown: onKey });
  setTimeout(() => push.focus(), 0);
  const cont = h('button', {
    class: 'ts-hot', type: 'button', 'aria-label': latest ? `이어하기: ${latest.meta.gmName} 단장, ${ctx.name(latest.meta.teamId)}` : '이어하기 (저장된 게임 없음)', style: place(HOT.cont),
    onclick: () => { if (latest) ctx.loadSlot(latest.slot); else ctx.toast('이어할 저장이 없습니다. PUSH START로 새 게임을 시작하세요.'); }
  });
  const save = h('button', { class: 'ts-hot', type: 'button', 'aria-label': '저장 불러오기', style: place(HOT.save), onclick: () => ctx.go('save') });
  const note = latest ? h('p', { class: 'ts-note' }, `${latest.meta.gmName} 단장 · ${ctx.name(latest.meta.teamId)} · ${latest.meta.season}${latest.meta.stage === 'regular' && latest.meta.day ? ` ${latest.meta.day}일차` : ''}`) : null;
  const stage = h('div', { class: 'ts-stage', style: { aspectRatio: `${SIZE.w} / ${SIZE.h}` } },
    h('img', { class: 'ts-art', src: ART, alt: '프로농구 단장 게임: 구단주 집무실에서 경기장이 내려다보이는 타이틀 화면', width: SIZE.w, height: SIZE.h, onerror: (e) => { e.currentTarget.onerror = null; e.currentTarget.src = ART_FALLBACK; } }),
    push, cont, save, note);
  return { title: '타이틀', body: h('div', { class: 'title-screen ts' }, stage) };
}
