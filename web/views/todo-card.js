// 홈 "지금 해야 할 일" 카드. 항목 계산은 web/lib/todo.js(순수 함수)이고, 여기서는 세션에서 입력을 모아 목록을 그린다.
import { h } from '../lib/dom.js';
import { buildTodo } from '../lib/todo.js';
import { conditionOf } from '../lib/tactics-view.js';
import { playerLink } from '../lib/player-info.js';
import { getNews } from '../lib/news-view.js';
import { ACHIEVEMENTS } from '../../src/achievements.mjs';

const PENDING = { trade: '트레이드 제안', resign: '재계약 협상', freeAgency: 'FA 영입', compensation: 'FA 보상 선택', draft: '신인 드래프트', foreign: '외국인 선수 영입' };
const LEVEL = { must: ['필수', 'bad'], review: ['검토', 'hot'], info: ['참고', ''] };
const state = { moreReview: false, showInfo: false };

/** 세션에서 buildTodo 입력을 모은다(테스트·디버그용으로 따로 내보낸다) */
export function todoInput(ctx) {
  const s = ctx.session, rules = ctx.data.rules, my = s.managerId;
  const roster = s.players.filter((p) => p.teamId === my);
  const live = s.stage === 'regular' || s.stage === 'playoffs';
  let news = [];
  try { news = getNews(s, ctx.data).items.slice(0, 4).map((it) => ({ headline: it.headline, when: it.when })); } catch { news = []; }
  const ach = Object.entries(s.achievements ?? {}).filter(([, season]) => season === s.season).map(([id]) => ({ id, name: ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id }));
  return {
    stage: s.stage, day: s.day, season: s.season, rules: rules.todo,
    roster, starters: live ? s.lineupOf(my).starters : [],
    injuries: live ? (s.injuries ?? []).filter((i) => i.teamId === my) : [],
    cond: live ? conditionOf(s, rules) : null,
    alerts: s.stage === 'regular' ? s.openAlerts : [],
    waivers: s.stage === 'regular' ? (s.waivers ?? []) : [],
    pendingLabel: s.pending ? (PENDING[s.pending.kind] ?? s.pending.kind) : null,
    healthyMin: rules.lineup.starters + rules.lineup.bench,
    news, achievements: ach
  };
}

export function todoCard(ctx) {
  const t = buildTodo(todoInput(ctx));
  const item = (it) => {
    const [label, tone] = LEVEL[it.level];
    return h('li', { class: `td-item td-${it.level}` },
      h('span', { class: `tag ${tone}` }, label),
      h('a', { class: 'td-text', href: it.to ?? '#/home' }, it.text),
      it.playerId ? playerLink(it.playerId, '선수 정보', { cls: 'td-info' }) : null);
  };
  const body = [];
  const empty = !t.counts.must && !t.counts.review;
  if (t.must.length) body.push(h('ul', { class: 'td-list' }, t.must.map(item)));
  if (t.review.length) body.push(h('ul', { class: 'td-list' }, (state.moreReview ? t.reviewAll : t.review).map(item)));
  if (t.reviewMore > 0) body.push(h('button', { type: 'button', class: 'btn ghost td-more', onclick: () => { state.moreReview = !state.moreReview; ctx.refresh(); } }, state.moreReview ? '접기' : `더 보기 (${t.reviewMore}건)`));
  if (empty) body.push(h('p', { class: 'muted td-empty' }, ctx.session.stage === 'offseason' ? '지금 결정해야 할 단계가 없습니다.' : '지금 대응할 일이 없습니다. 라인업과 훈련을 확인하고 진행하세요.'));
  if (t.info.length) body.push(h('details', { class: 'td-info-box', open: state.showInfo ? '' : null, ontoggle: (e) => { state.showInfo = e.target.open; } },
    h('summary', `참고 ${t.info.length}건`), h('ul', { class: 'td-list' }, t.info.map(item))));
  return h('div', { class: `card td-card ${t.must.length ? 'must' : ''}`, role: 'region', 'aria-label': '지금 해야 할 일' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '지금 해야 할 일'),
      h('span', { class: 'note' }, t.must.length ? `필수 ${t.must.length}건` : t.review.length ? `검토 ${t.counts.review}건` : '이상 없음')),
    body);
}
