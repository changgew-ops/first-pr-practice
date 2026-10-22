// KBL 단장 게임 — 화면 진입점: 데이터 불러오기, 저장, 경로(#/…), 공통 틀.
import { h } from './lib/dom.js';
import { loadData, profileIndex } from './lib/data.js';
import { loadSave, writeSave, clearSave } from './lib/save.js';
import { newGame, playYear, seasonLabel, VERSION } from './lib/game.js';
import { colorOf } from './lib/team-ui.js';
import * as selectView from './views/select.js';
import * as homeView from './views/home.js';
import * as rosterView from './views/roster.js';
import * as playerView from './views/player.js';
import * as lineupView from './views/lineup.js';
import * as leagueView from './views/league.js';
import * as historyView from './views/history.js';
import * as reportView from './views/report.js';

const root = document.getElementById('app');
const ROUTES = {
  home: [homeView, '홈'], roster: [rosterView, '로스터'], player: [playerView, '선수'], lineup: [lineupView, '라인업'],
  league: [leagueView, '리그'], history: [historyView, '구단 역사'], report: [reportView, '시즌 결산']
};
const NAV = [['home', '홈'], ['roster', '로스터'], ['lineup', '라인업'], ['league', '리그'], ['history', '구단 역사'], ['report', '시즌 결산']];

const ctx = { data: null, game: null, profiles: null, busy: false };
ctx.team = (id) => ctx.data.teams.find((t) => t.id === id);
ctx.name = (id) => ctx.team(id)?.name ?? id;
ctx.go = (path) => { if (location.hash === `#/${path}`) render(); else location.hash = `#/${path}`; };
ctx.save = () => writeSave(ctx.game);
ctx.start = (teamId, seed) => { ctx.game = newGame(ctx.data, teamId, seed); ctx.save(); ctx.go('home'); };
ctx.reset = () => { if (confirm('저장된 게임을 지우고 구단 선택으로 돌아갑니다. 계속할까요?')) { clearSave(); ctx.game = null; ctx.go(''); render(); } };
ctx.play = () => {
  if (ctx.busy) return;
  ctx.busy = true;
  const label = seasonLabel(ctx.game.league.season);
  const overlay = h('div', { class: 'overlay', role: 'status' }, h('div', { class: 'card' }, h('h3', `${label} 시즌 진행 중…`), h('p', { class: 'muted' }, '정규리그 54경기, 플레이오프, 오프시즌 처리')));
  document.body.append(overlay);
  setTimeout(() => { // 오버레이가 먼저 그려지도록 한 박자 늦춘다
    try {
      ctx.game = playYear(ctx.game, ctx.data);
      ctx.save();
      ctx.go('report');
    } catch (e) {
      console.error(e);
      alert(`시즌 진행 중 오류: ${e.message}`);
    } finally { overlay.remove(); ctx.busy = false; render(); }
  }, 30);
};

function shell(route, view) {
  const my = ctx.game.managerId;
  const el = h('div', { class: 'shell', style: { '--team': colorOf(my) } },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, 'KBL 단장 게임', h('small', `${ctx.name(my)} · ${seasonLabel(ctx.game.league.season)}`)),
      h('nav', { class: 'nav', 'aria-label': '주 메뉴' }, NAV.map(([key, label]) => h('a', { href: `#/${key}`, class: route === key || (route === 'player' && key === 'roster') ? 'on' : '', 'aria-current': route === key ? 'page' : null }, label))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'small' }, '자동 저장 · 브라우저에만 저장됩니다'),
      h('button', { class: 'btn ghost', onclick: ctx.reset }, '새 게임')),
    h('main', { class: 'main' }, view));
  return el;
}

async function render() {
  if (!ctx.data) return;
  const [route = '', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (!ctx.game) { root.replaceChildren(selectView.render(ctx)); document.title = 'KBL 단장 게임'; return; }
  const key = ROUTES[route] ? route : 'home';
  const [mod, label] = ROUTES[key];
  const out = mod.render(ctx, params);
  document.title = `${out.title ?? label} · KBL 단장 게임`;
  root.replaceChildren(shell(key, out.body ?? out));
}

window.addEventListener('hashchange', render);
(async () => {
  try {
    ctx.data = await loadData();
    ctx.profiles = profileIndex(ctx.data.profiles);
    const saved = loadSave();
    // 저장본의 선수·구단이 현재 데이터와 맞는지 가볍게 확인한다(데이터가 크게 바뀐 뒤에는 새 게임으로)
    if (saved?.version === VERSION && ctx.data.teams.some((t) => t.id === saved.managerId) && saved.league?.players?.length) ctx.game = saved;
    render();
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'intro' }, h('h1', '데이터를 불러오지 못했습니다'), h('p', { class: 'muted' }, `${e.message}. 저장소 루트에서 npm run web 으로 서버를 띄운 뒤 http://localhost:8080/web/ 로 열어 주세요.`)));
  }
})();
