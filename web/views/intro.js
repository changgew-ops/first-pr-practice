// 게임 소개: 무슨 게임이고, 플레이어는 무엇을 하는지. 세 장을 넘겨 본다.
import { h } from '../lib/dom.js';

const PAGES = [
  { title: '이 게임은', lines: [
    ['KBL 단장 게임은', '실제 KBL 10개 구단과 선수, 1997년부터의 기록으로 만든 싱글 플레이 GM 게임입니다. 2026-27 시즌의 로스터에서 시작합니다.'],
    ['선수는 카드입니다', '선수마다 슈팅·패스·수비·리바운드·운동능력·체력 능력치와 OVR, 성장 한도(POT), 코스트가 있습니다. 능력치는 실제 시즌 기록에서 계산했습니다.'],
    ['기록은 진짜입니다', '선수 페이지에는 그 선수의 KBL 공식 시즌 기록이 나오고, 게임에서 뛴 시즌은 그 뒤에 이어서 쌓입니다.']
  ] },
  { title: '당신은 단장입니다', lines: [
    ['선수단 운영', '라인업은 코스트 합 65 안에서 스타팅 5명과 벤치 5명을 직접 짭니다. 훈련으로 선수마다 키울 능력치를 정합니다.'],
    ['이적 시장', '시즌이 끝나면 트레이드 제안이 오고, 재계약 협상, FA 영입, 신인 드래프트를 직접 결정합니다. 연봉 캡 30억, 넘기면 기금을 냅니다.'],
    ['구단의 미래', '성적과 우승이 구단의 전통과 수입, 선수들이 우리 팀을 고르는 마음을 바꿉니다.']
  ] },
  { title: '한 시즌의 흐름', lines: [
    ['시즌 시작', '라인업과 훈련을 정하고 시즌을 시작합니다. 정규리그 54경기를 하루씩 또는 한꺼번에 진행합니다.'],
    ['플레이오프', '정규리그 상위 6팀이 6강, 4강, 결승을 치릅니다.'],
    ['오프시즌', '은퇴와 성장 → 트레이드 → 재계약 → FA → 드래프트 → 다음 시즌. 이 순환을 반복하며 왕조를 만드세요.']
  ] }
];

export function render(ctx) {
  let i = 0;
  const host = h('div', { class: 'intro-card card' });
  const draw = () => {
    const p = PAGES[i];
    host.replaceChildren(
      h('div', { class: 'row between' }, h('span', { class: 'note' }, `소개 ${i + 1} / ${PAGES.length}`), h('button', { class: 'btn ghost', onclick: () => ctx.go('new') }, '건너뛰기')),
      h('h2', { class: 'intro-title' }, p.title),
      h('div', { class: 'intro-lines' }, p.lines.map(([k, v]) => h('div', { class: 'intro-line' }, h('b', k), h('p', v)))),
      h('div', { class: 'row between' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => { i--; draw(); } }, '이전'),
        i < PAGES.length - 1
          ? h('button', { class: 'btn primary', onclick: () => { i++; draw(); } }, '다음')
          : h('button', { class: 'btn primary', onclick: () => ctx.go('new') }, '단장 취임하기')));
  };
  draw();
  return { title: '게임 소개', body: h('div', { class: 'intro' }, h('button', { class: 'btn ghost', onclick: () => ctx.go('title') }, '← 타이틀'), host) };
}
