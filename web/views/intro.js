// 게임 소개: 무슨 게임이고, 플레이어는 무엇을 하는지. 세 장을 넘겨 본다.
// 그림은 전부 인라인 SVG/CSS로 그린 것이다(실제 선수 사진·초상 없음). 숫자는 league-rules.json에서 읽는다.
import { h } from '../lib/dom.js';

const COURT = `<svg viewBox="0 0 320 190" role="img" aria-label="농구 코트 위에 놓인 선수 카드 세 장" class="st-art">
  <rect x="2" y="2" width="316" height="186" rx="10" class="c-floor"/>
  <g class="c-line" fill="none" stroke-width="2"><rect x="14" y="12" width="292" height="166" rx="4"/><line x1="160" y1="12" x2="160" y2="178"/><circle cx="160" cy="95" r="26"/>
    <rect x="14" y="62" width="62" height="66"/><path d="M76 72a24 24 0 0 1 0 46"/><rect x="244" y="62" width="62" height="66"/><path d="M244 72a24 24 0 0 0 0 46"/></g>
  <g transform="translate(44 36) rotate(-8)"><rect width="74" height="104" rx="9" class="c-card"/><rect x="6" y="6" width="62" height="14" rx="4" class="c-card-top"/><text x="10" y="17" class="c-t">PG</text><text x="46" y="17" class="c-t">OVR</text>
    <circle cx="37" cy="48" r="16" class="c-ph"/><rect x="21" y="68" width="32" height="5" rx="2" class="c-bar a"/><rect x="21" y="78" width="24" height="5" rx="2" class="c-bar b"/><rect x="21" y="88" width="28" height="5" rx="2" class="c-bar c"/></g>
  <g transform="translate(123 22)"><rect width="74" height="104" rx="9" class="c-card hot"/><rect x="6" y="6" width="62" height="14" rx="4" class="c-card-top hot"/><text x="10" y="17" class="c-t">C</text><text x="46" y="17" class="c-t">OVR</text>
    <circle cx="37" cy="48" r="16" class="c-ph"/><rect x="21" y="68" width="34" height="5" rx="2" class="c-bar a"/><rect x="21" y="78" width="30" height="5" rx="2" class="c-bar b"/><rect x="21" y="88" width="20" height="5" rx="2" class="c-bar c"/></g>
  <g transform="translate(204 36) rotate(8)"><rect width="74" height="104" rx="9" class="c-card"/><rect x="6" y="6" width="62" height="14" rx="4" class="c-card-top"/><text x="10" y="17" class="c-t">SG</text><text x="46" y="17" class="c-t">OVR</text>
    <circle cx="37" cy="48" r="16" class="c-ph"/><rect x="21" y="68" width="26" height="5" rx="2" class="c-bar a"/><rect x="21" y="78" width="32" height="5" rx="2" class="c-bar b"/><rect x="21" y="88" width="22" height="5" rx="2" class="c-bar c"/></g>
</svg>`;

const DESK = `<svg viewBox="0 0 320 190" role="img" aria-label="단장 책상: 모니터에 라인업, 서류, 커피" class="st-art">
  <rect x="2" y="2" width="316" height="186" rx="10" class="d-wall"/>
  <rect x="226" y="18" width="76" height="52" rx="3" class="d-frame"/><rect x="232" y="24" width="64" height="40" class="d-board"/><circle cx="246" cy="44" r="6" class="d-dot a"/><circle cx="264" cy="36" r="6" class="d-dot b"/><circle cx="282" cy="50" r="6" class="d-dot c"/><path d="M246 44 264 36 282 50" class="d-path"/>
  <rect x="0" y="126" width="320" height="64" class="d-desk"/><rect x="0" y="126" width="320" height="6" class="d-edge"/>
  <rect x="38" y="42" width="118" height="76" rx="5" class="d-mon"/><rect x="46" y="50" width="102" height="58" rx="2" class="d-screen"/>
  <g class="d-ui"><rect x="52" y="56" width="42" height="46" rx="2" class="d-court"/><rect x="100" y="56" width="42" height="8" rx="2" class="d-row a"/><rect x="100" y="68" width="42" height="8" rx="2" class="d-row"/><rect x="100" y="80" width="42" height="8" rx="2" class="d-row"/><rect x="100" y="92" width="42" height="8" rx="2" class="d-row b"/></g>
  <rect x="88" y="118" width="22" height="8" class="d-stand"/><rect x="72" y="124" width="54" height="4" rx="2" class="d-stand"/>
  <g transform="translate(176 104) rotate(-6)"><rect width="56" height="44" rx="2" class="d-paper"/><rect x="8" y="8" width="30" height="3" class="d-ln"/><rect x="8" y="16" width="38" height="3" class="d-ln"/><rect x="8" y="24" width="24" height="3" class="d-ln"/><circle cx="44" cy="34" r="5" class="d-seal"/></g>
  <g transform="translate(244 108)"><rect width="44" height="20" rx="2" class="d-paper2"/><rect x="5" y="6" width="26" height="3" class="d-ln"/><rect x="5" y="12" width="18" height="3" class="d-ln"/></g>
  <g transform="translate(18 104)"><rect width="18" height="22" rx="3" class="d-mug"/><path d="M18 8h5a5 5 0 0 1 0 10h-5" class="d-mug-h"/><path d="M5 2c-2-3 3-4 0-8M11 2c-2-3 3-4 0-8" class="d-steam"/></g>
</svg>`;

const BOARD = `<svg viewBox="0 0 320 190" role="img" aria-label="순위표 예시와 플레이오프 대진" class="st-art">
  <rect x="2" y="2" width="316" height="186" rx="10" class="d-wall"/>
  <g transform="translate(16 16)"><rect width="150" height="158" rx="6" class="b-panel"/><text x="10" y="18" class="b-h">순위표 (예시)</text>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<rect x="10" y="${28 + i * 12.4}" width="${120 - i * 8}" height="8" rx="2" class="b-row${i < 6 ? ' in' : ''}"/>`).join('')}
    <line x1="8" x2="142" y1="${28 + 6 * 12.4 - 2}" y2="${28 + 6 * 12.4 - 2}" class="b-cut"/></g>
  <g transform="translate(178 16)" class="b-bracket"><rect width="126" height="158" rx="6" class="b-panel"/><text x="10" y="18" class="b-h">플레이오프</text>
    <path d="M14 40h22v18h-22M14 76h22V58M36 58h24M14 112h22v18h-22M14 148h22v-18M36 130h24M60 58h14v72h-14M74 94h22M96 94h18" fill="none" class="b-ln"/>
    <circle cx="118" cy="94" r="6" class="b-trophy"/></g>
</svg>`;

/** @returns {Array<{key:string,title:string,sub:string,art:string,body:(rules:object,data:object)=>Node}>} */
const pages = (ctx) => {
  const rules = ctx.data.rules, teams = ctx.data.teams.length;
  const first = ctx.data.history?.seasons?.[0]?.season ?? '1997';
  const rounds = rules.playoffs.rounds.map((r) => r.name).join(' → ');
  const chip = (icon, k, v) => h('li', { class: 'st-chip' }, h('span', { class: 'st-chip-ico', 'aria-hidden': 'true' }, icon), h('div', h('b', k), h('span', v)));
  return [
    { key: 'game', title: '이 게임은', sub: '실제 KBL로 시작하는 싱글 GM 게임', art: COURT, body: () => h('div', { class: 'st-copy' },
      h('p', { class: 'st-lead' }, `실제 KBL ${teams}개 구단과 선수, ${first}년부터의 기록으로 만든 싱글 플레이 GM 게임입니다. 2026-27 시즌의 로스터에서 시작합니다.`),
      h('ul', { class: 'st-chips' },
        chip('🏀', '선수는 카드', '슈팅·패스·수비·리바운드·운동능력·체력, OVR, 성장 한도(POT), 코스트'),
        chip('📊', '기록은 진짜', '능력치는 KBL 공식 시즌 기록에서 계산. 게임에서 뛴 시즌은 그 뒤에 이어서 쌓입니다'),
        chip('⚖️', '코스트와 캡', `라인업 코스트 합 ${rules.lineup.costCap} 제한, 국내 연봉 캡 ${rules.salaryCap.domesticEok}억(넘기면 기금)`),
        chip('📰', '가상 뉴스와 반응', '내 선택이 기사와 팬 커뮤니티 반응(가상)으로 돌아옵니다'))) },
    { key: 'gm', title: '당신은 단장입니다', sub: '벤치에 앉는 사람이 아니라, 선수단을 만드는 사람', art: DESK, body: () => h('div', { class: 'st-copy' },
      h('p', { class: 'st-lead' }, '경기는 시뮬레이션이 치릅니다. 당신이 정하는 것은 누구를 뽑고, 누구를 쓰고, 누구를 키우고, 누구를 보내는가입니다.'),
      h('ul', { class: 'st-duties' },
        h('li', h('b', '라인업'), h('span', `스타팅 ${rules.lineup.starters}명과 벤치 ${rules.lineup.bench}명을 코트에 짭니다`)),
        h('li', h('b', '훈련'), h('span', '선수마다 키울 능력치를 정합니다')),
        h('li', h('b', '이적 시장'), h('span', '트레이드, 재계약, FA 영입, 신인 드래프트')),
        h('li', h('b', '구단의 미래'), h('span', '성적과 우승이 전통·수입·선수들의 선호를 바꿉니다')))) },
    { key: 'season', title: '한 시즌의 흐름', sub: '이 순환을 반복하며 왕조를 만드세요', art: BOARD, body: () => h('div', { class: 'st-copy' },
      h('ol', { class: 'st-flow' },
        h('li', h('b', '시즌 시작'), h('span', '라인업·훈련 정하기')),
        h('li', h('b', `정규리그 ${rules.regularSeasonGames}경기`), h('span', '하루씩 또는 한꺼번에')),
        h('li', h('b', `플레이오프 ${rules.playoffs.qualify}팀`), h('span', rounds)),
        h('li', h('b', '오프시즌'), h('span', '은퇴·성장 → 트레이드 → 재계약 → FA → 드래프트')),
        h('li', h('b', '다음 시즌'), h('span', '새 선수단으로 다시 시작'))),
      h('p', { class: 'note' }, '언제든 저장 화면에서 직접 저장할 수 있고, 자동 저장도 켜져 있습니다.')) }
  ];
};

export function render(ctx) {
  const PAGES = pages(ctx);
  let i = 0;
  const host = h('div', { class: 'st-intro card' });
  const go = (n) => { i = Math.max(0, Math.min(PAGES.length - 1, n)); draw(); host.querySelector('.st-tab.on')?.focus({ preventScroll: true }); };
  const draw = () => {
    const p = PAGES[i];
    host.replaceChildren(
      h('div', { class: 'row between st-top' },
        h('div', { class: 'st-tabs', role: 'tablist', 'aria-label': '소개 쪽' }, PAGES.map((q, n) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(n === i), class: `st-tab ${n === i ? 'on' : ''}`, tabindex: n === i ? '0' : '-1', 'aria-label': `${n + 1}쪽 ${q.title}`, onclick: () => go(n) }, h('i'), h('span', q.title)))),
        h('button', { class: 'btn ghost', onclick: () => ctx.go('new') }, '건너뛰기')),
      h('div', { class: 'st-page', role: 'tabpanel' },
        h('div', { class: 'st-visual', html: p.art }),
        h('div', { class: 'st-text' }, h('div', { class: 'st-kicker' }, `소개 ${i + 1} / ${PAGES.length}`), h('h2', { class: 'st-title' }, p.title), h('p', { class: 'st-sub' }, p.sub), p.body())),
      h('div', { class: 'row between' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => go(i - 1) }, '이전'),
        i < PAGES.length - 1
          ? h('button', { class: 'btn primary', onclick: () => go(i + 1) }, '다음')
          : h('button', { class: 'btn primary big', onclick: () => ctx.go('new') }, '단장 취임하기')));
  };
  host.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  });
  draw();
  return { title: '게임 소개', body: h('div', { class: 'intro st-wrap' }, h('button', { class: 'btn ghost', onclick: () => ctx.go('title') }, '← 타이틀'), host) };
}
