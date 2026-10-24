// 게임 소개: 준비된 그림 세 장(web/assets/intro-1~3.webp — 가죽 틀 안에 제목·탭·설명·버튼까지 그려진 이미지)을 차례로 보여 주고,
// 그림 속 탭과 [이전]·[다음]·[게임 시작] 자리에 눌리는 투명 버튼을 얹는다. 그림을 바꿀 때는 파일을 바꾸고 아래 HOT 좌표(그림 안의 % 위치)를 맞춘다.
// 쪽은 경로(#/intro/2)에 들어 있어 뒤로 가기·백스페이스가 이전 쪽으로 돌아간다.
import { h } from '../lib/dom.js';

const ASSET = (n) => new URL(`../assets/intro-${n}.webp`, import.meta.url).href;
const SIZE = { w: 1024, h: 691 };
const pct = (x, y, w, hgt) => ({ left: `${(x / SIZE.w) * 100}%`, top: `${(y / SIZE.h) * 100}%`, width: `${(w / SIZE.w) * 100}%`, height: `${(hgt / SIZE.h) * 100}%` });
// 그림 안의 위치(px, 1024×691 기준)
const HOT = {
  tabs: [pct(40, 88, 97, 40), pct(141, 88, 149, 40), pct(296, 88, 125, 40)],
  prev: pct(40, 582, 57, 39), next: pct(908, 582, 60, 39), start: pct(872, 583, 99, 38)
};
const TABS = ['이 게임은', '당신은 단장입니다', '한 시즌의 흐름'];
// 화면 낭독용 설명(그림 속 글을 그대로 옮긴 것)
const ALT = [
  '소개 1/3, 이 게임은. 실제 KBL로 시작하는 싱글 GM 게임입니다. 실제 10개 구단과 선수, 1997년부터의 기록으로 만든 싱글 플레이 GM 게임입니다. 2026-27 시즌의 로스터에서 시작합니다. 선수는 카드, 기록은 진짜, 연봉과 샐러리캡, 가상 뉴스와 반응.',
  '소개 2/3, 당신은 단장입니다. 로스터 및 전술 관리, 선수 트레이드, 신인 드래프트, FA 영입 및 재계약을 맡습니다.',
  '소개 3/3, 한 시즌의 흐름. 시즌 준비, 정규시즌 54경기, 6강·4강 플레이오프와 챔피언 결정전, 비시즌 및 드래프트.'
];

export function render(ctx, params = []) {
  const n = Math.min(3, Math.max(1, Number(params[0]) || 1));
  const go = (k) => ctx.go(k === 0 ? 'title' : `intro/${k}`);
  const spot = (cls, label, style, onclick) => h('button', { class: `ts-hot ${cls}`, type: 'button', 'aria-label': label, style, onclick });
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); n < 3 ? go(n + 1) : ctx.go('new'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(n - 1); }
    else if (e.key === 'Escape') ctx.go('new');
  };
  const next = n < 3 ? spot('', '다음', HOT.next, () => go(n + 1)) : spot('ts-hot-push', '게임 시작', HOT.start, () => ctx.go('new'));
  const stage = h('div', { class: 'ts-stage', style: { aspectRatio: `${SIZE.w} / ${SIZE.h}` }, tabindex: 0, onkeydown: onKey },
    h('img', { class: 'ts-art', src: ASSET(n), alt: ALT[n - 1], width: SIZE.w, height: SIZE.h }),
    ...TABS.map((t, i) => (i + 1 === n ? null : spot('', `소개 ${i + 1}쪽: ${t}`, HOT.tabs[i], () => go(i + 1)))),
    spot('', n === 1 ? '이전: 타이틀로' : '이전', HOT.prev, () => go(n - 1)),
    next);
  setTimeout(() => stage.focus({ preventScroll: true }), 0);
  return { title: '게임 소개', body: h('div', { class: 'title-screen ts' }, stage, h('button', { class: 'ts-skip', type: 'button', onclick: () => ctx.go('new') }, '소개 건너뛰기 (Esc)')) };
}
