// 프로농구 단장 게임 — 화면 진입점: 데이터 불러오기, 세션·저장, 경로(#/…), 공통 틀.
//
// 화면(views/*.js)이 받는 ctx:
//   ctx.data        { rules, teams, players, history, profiles, careers }
//   ctx.session     진행 중인 세션(web/lib/session.js). 없으면 타이틀·새 게임 화면만 열린다
//   ctx.game        session.view — 기존 선택자(web/lib/game.js)가 쓰는 모양
//   ctx.go(path)    경로 이동('season', 'player/<id>' …)      ctx.refresh()  지금 화면 다시 그리기(상태가 바뀐 뒤)
//   ctx.name(teamId) / ctx.team(teamId)    ctx.toast(문구)    ctx.save(slot) 직접 저장
// 화면은 render(ctx, params) → { title, body } 를 내보낸다.
import { h } from './lib/dom.js';
import { loadData, profileIndex } from './lib/data.js';
import { listSlots, readSlot, writeSlot, latestSlot, configureSave } from './lib/save.js';
import { Session } from './lib/session.js';
import { bindInfoCtx } from './lib/player-info.js';
import { seasonLabel } from './lib/game.js';
import { colorOf } from './lib/team-ui.js';
import * as titleView from './views/title.js';
import * as introView from './views/intro.js';
import * as newView from './views/new.js';
import * as homeView from './views/home.js';
import * as newsView from './views/news.js';
import * as seasonView from './views/season.js';
import * as rosterView from './views/roster.js';
import * as playerView from './views/player.js';
import * as lineupView from './views/lineup.js';
import * as trainingView from './views/training.js';
import * as tradesView from './views/trades.js';
import * as offseasonView from './views/offseason.js';
import * as leagueView from './views/league.js';
import * as historyView from './views/history.js';
import * as reportView from './views/report.js';
import * as saveView from './views/save.js';
import * as achievementsView from './views/achievements.js';
import * as codexView from './views/codex.js';
import * as previewView from './views/preview.js';
import * as staffView from './views/staff.js';
import { ACHIEVEMENT_BY_ID } from '../src/achievements.mjs';

const root = document.getElementById('app');
const FREE = { title: titleView, intro: introView, new: newView, save: saveView }; // 세션 없이도 여는 화면
const ROUTES = {
  home: homeView, news: newsView, season: seasonView, roster: rosterView, player: playerView, lineup: lineupView, training: trainingView, trades: tradesView,
  offseason: offseasonView, league: leagueView, history: historyView, report: reportView, achievements: achievementsView, codex: codexView, preview: previewView, staff: staffView, save: saveView
};
// 사이드 메뉴 묶음: 앞쪽이 자주 쓰는 화면. 제목이 null인 묶음은 제목 없이 맨 위에 둔다.
const NAV_GROUPS = [
  { title: null, items: [['home', '홈'], ['season', '시즌'], ['lineup', '라인업'], ['roster', '로스터']] },
  { title: '구단 운영', items: [['training', '훈련'], ['staff', '감독·코치'], ['trades', '트레이드'], ['offseason', '오프시즌']] },
  { title: '기록·소식', items: [['preview', '시즌 프리뷰'], ['news', '뉴스'], ['league', '리그'], ['history', '구단 역사'], ['report', '시즌 결산']] },
  { title: '수집', items: [['achievements', '업적'], ['codex', '카드 도감']] }
];
const SAVE_NAV = ['save', '저장'];
const NAV = [...NAV_GROUPS.flatMap((g) => g.items), SAVE_NAV];

const ctx = { data: null, profiles: null, session: null };
bindInfoCtx(ctx); // 어느 화면에서든 선수 이름 버튼(playerLink)이 정보 창을 열 수 있게
Object.defineProperty(ctx, 'game', { get: () => ctx.session?.view });
ctx.team = (id) => ctx.data.teams.find((t) => t.id === id);
ctx.name = (id) => ctx.team(id)?.name ?? id;
ctx.go = (path) => { if (location.hash === `#/${path}`) render(); else location.hash = `#/${path}`; };
ctx.refresh = () => render();
ctx.toast = (text) => { // 여러 개가 동시에 떠도 겹치지 않게 한 컨테이너에 쌓는다
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: 'toast', role: 'status' }, text);
  box.append(el);
  setTimeout(() => el.remove(), 2600);
};

let autosaveTimer = null;
function attach(session) {
  ctx.session = session;
  session.onChange(() => { // 새 업적은 토스트로 알린다
    for (const id of session.takeFresh()) ctx.toast(`업적 달성: ${ACHIEVEMENT_BY_ID[id]?.name ?? id}`);
  });
  session.onChange(() => { // 상태가 바뀌면 잠깐 뒤 자동 저장 (연속 조작은 한 번으로)
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { if (!writeSlot('auto', session.game)) ctx.toast('저장 공간이 부족해 자동 저장을 못 했습니다. 저장 화면에서 오래된 슬롯을 지워 주세요.'); }, 300);
  });
}
/** 새 게임: { gmName, teamId, seed } */
ctx.newGame = ({ gmName, teamId, seed }) => { attach(Session.create(ctx.data, { gmName, managerId: teamId, seed })); writeSlot('auto', ctx.session.game); ctx.go('home'); };
ctx.loadSlot = (slot) => {
  const game = readSlot(slot);
  if (!game) { ctx.toast('불러올 수 없는 저장입니다'); return false; }
  try { attach(new Session(ctx.data, game)); } catch (e) { ctx.toast(`불러오지 못했습니다: ${e.message}`); return false; }
  ctx.go('home'); return true;
};
ctx.save = (slot) => {
  if (!ctx.session) return false;
  const ok = writeSlot(slot, ctx.session.game);
  ctx.toast(ok ? `${slot === 'auto' ? '자동 저장' : `슬롯 ${slot}`}에 저장했습니다` : '저장하지 못했습니다(저장 공간 부족)');
  return ok;
};
ctx.toTitle = () => { ctx.session = null; ctx.go('title'); };

function shell(route, view) {
  const s = ctx.session, my = s.managerId;
  const stageLabel = { regular: s.day === 0 ? '시즌 시작 전' : `정규리그 ${s.day}/${s.totalDays}일차`, playoffs: '플레이오프', offseason: '오프시즌' }[s.stage];
  // 폰(≤860px)에서는 사이드바가 얇은 상단 바(브랜드 한 줄 + 햄버거)가 되고 메뉴는 눌러서 연다. 데스크톱 레이아웃은 그대로.
  const side = h('aside', { class: 'side' });
  const navLink = (key, label) => h('a', { href: `#/${key}`, class: route === key || (route === 'player' && key === 'roster') ? 'on' : '', 'aria-current': route === key ? 'page' : null }, label, key === 'offseason' && s.stage === 'offseason' ? h('span', { class: 'dotmark', 'aria-label': '결정 필요' }) : null);
  const menuBtn = h('button', { class: 'menu-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'side-menu', 'aria-label': '메뉴 열기' },
    h('span', { class: 'bars', 'aria-hidden': 'true' }), s.stage === 'offseason' ? h('span', { class: 'dotmark', 'aria-label': '결정 필요' }) : null);
  const onKey = (e) => { if (e.key === 'Escape') setMenu(false, true); };
  const onOutside = (e) => { if (!side.contains(e.target) || e.target.closest('a')) setMenu(false); };
  const setMenu = (open, refocus = false) => {
    side.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    document.removeEventListener('keydown', onKey); document.removeEventListener('click', onOutside);
    if (open) { document.addEventListener('keydown', onKey); setTimeout(() => document.addEventListener('click', onOutside), 0); }
    if (!open && refocus) menuBtn.focus();
  };
  menuBtn.addEventListener('click', () => setMenu(!side.classList.contains('open')));
  side.append(
    h('div', { class: 'side-top' },
      h('div', { class: 'brand' }, '프로농구 단장 게임', h('small', `${s.game.gm.name} 단장 · ${ctx.name(my)}`), h('small', `${seasonLabel(s.season)} · ${stageLabel}`)),
      menuBtn),
    h('div', { class: 'side-menu', id: 'side-menu' },
      h('nav', { class: 'nav', 'aria-label': '주 메뉴' }, NAV_GROUPS.map((g) => h('div', { class: 'nav-group' },
        g.title ? h('div', { class: 'nav-title' }, g.title) : null,
        g.items.map(([key, label]) => navLink(key, label))))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'small' }, '자동 저장 중'),
      h('nav', { class: 'nav nav-save', 'aria-label': '저장' }, navLink(...SAVE_NAV)),
      h('div', { class: 'side-actions' },
        h('button', { class: 'btn ghost', onclick: () => { setMenu(false); ctx.save('1'); } }, '빠른 저장'),
        h('button', { class: 'btn ghost', onclick: ctx.toTitle }, '타이틀로'))));
  return h('div', { class: 'shell', style: { '--team': colorOf(my) } }, side,
    h('main', { class: 'main' }, view));
}

async function render() {
  if (!ctx.data) return;
  const [route = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (!ctx.session) {
    const mod = FREE[route] ?? titleView;
    const out = mod.render(ctx, params);
    document.title = `${out.title ?? '프로농구 단장 게임'} · 프로농구 단장 게임`;
    root.replaceChildren(out.body ?? out);
    return;
  }
  const key = ROUTES[route] ? route : 'home';
  const out = ROUTES[key].render(ctx, params);
  document.title = `${out.title ?? key} · 프로농구 단장 게임`;
  root.replaceChildren(shell(key, out.body ?? out));
}

window.addEventListener('hashchange', render);
// 백스페이스: 이전 화면으로(입력칸·선택 상자에서는 글자 지우기라 건드리지 않는다)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (history.length > 1) { e.preventDefault(); history.back(); }
});
(async () => {
  try {
    ctx.data = await loadData();
    // 화면이 읽는 ctx.data.rules는 늘 "지금 시즌의 규칙"(금액 상수에 물가 지수를 곱한 것)이다. 원본은 data.baseRules.
    // 세션이 없으면(타이틀·새 게임) 원본 그대로. 이렇게 하면 모든 화면의 캡·연봉·요구액 숫자가 한 곳에서 시즌에 맞춰 바뀐다.
    const baseRules = ctx.data.rules;
    ctx.data.baseRules = baseRules;
    configureSave(baseRules.save);
    Object.defineProperty(ctx.data, 'rules', { configurable: true, enumerable: true, get: () => ctx.session?.rules ?? baseRules });
    ctx.profiles = profileIndex(ctx.data.profiles);
    render();
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'intro' }, h('h1', '데이터를 불러오지 못했습니다'), h('p', { class: 'muted' }, `${e.message}. 저장소 루트에서 npm run web 으로 서버를 띄운 뒤 http://localhost:8080/web/ 로 열어 주세요.`)));
  }
})();
