// 뉴스: 게임이 만든 가상 기사와 팬 커뮤니티 반응. 저장하지 않고 세션 상태에서 매번 같은 결과로 만든다(web/lib/news-view.js).
import { h, tabs, svg } from '../lib/dom.js';
import { getNews, filterItems, communityPosts, TABS, MOOD_TONE } from '../lib/news-view.js';
import { colorOf } from '../lib/team-ui.js';

export const DISCLAIMER = '이 기사와 댓글은 게임이 만든 가상 콘텐츠이며 실제 보도·실제 팬 반응이 아닙니다.';
const PAGE = 30;
const ui = { tab: 'all', shown: PAGE, open: new Set() };

/** 팬 심리 카드: 점수 막대, 분위기 한마디, 최근 흐름 */
export function moodCard(mood, { compact = false } = {}) {
  const tone = MOOD_TONE[mood.label];
  const trend = mood.trend > 0.4 ? `최근 ${mood.trend.toFixed(1)} 상승` : mood.trend < -0.4 ? `최근 ${Math.abs(mood.trend).toFixed(1)} 하락` : '최근 변화 없음';
  const hist = mood.history;
  let spark = null;
  if (hist.length > 1) {
    const w = 120, ht = 28, lo = Math.min(...hist, 40), hi = Math.max(...hist, 60);
    const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(ht - ((v - lo) / (hi - lo)) * ht).toFixed(1)}`).join(' ');
    spark = svg('svg', { viewBox: `0 0 ${w} ${ht}`, class: 'news-spark', role: 'img', 'aria-label': `팬 심리 최근 흐름: ${hist.at(-1)}점` }, svg('polyline', { points: pts, fill: 'none', 'stroke-width': 2 }));
  }
  return h('div', { class: `news-mood ${tone}` },
    h('div', { class: 'row between' }, h('b', '팬 심리'), h('span', { class: `news-mood-label ${tone}` }, `${mood.label} · ${mood.score}`)),
    h('div', { class: 'bar news-bar', role: 'img', 'aria-label': `팬 심리 ${mood.score}점, ${mood.label}` }, h('i', { style: { width: `${mood.score}%` } })),
    compact ? null : h('div', { class: 'news-mood-desc' }, mood.desc),
    h('div', { class: 'row between note' }, h('span', trend), spark));
}

function article(ctx, it, i) {
  const open = ui.open.has(it.id);
  const cmt = it.comments.length;
  const card = h('article', { class: `news-item ${it.scope === 'my' || it.scope === 'move' ? 'mine' : ''} tone-${it.tone}`, style: { '--team': colorOf(ctx.session.managerId) } },
    h('button', {
      class: 'news-head', 'aria-expanded': String(open), 'aria-controls': `news-body-${i}`,
      onclick: () => { if (open) ui.open.delete(it.id); else ui.open.add(it.id); ctx.refresh(); }
    },
    h('span', { class: 'news-meta' }, h('span', it.when), h('span', { class: 'dim' }, ' · '), h('span', it.outlet), it.tags.map((t) => h('span', { class: 'tag' }, t))),
    h('span', { class: 'news-title' }, it.headline),
    h('span', { class: 'news-sub note' }, open ? '접기' : cmt ? `댓글 ${cmt}` : '펼쳐 보기')),
    open ? h('div', { class: 'news-body', id: `news-body-${i}` }, h('p', it.body),
      cmt ? h('ul', { class: 'news-comments', 'aria-label': '댓글' }, it.comments.map((c) => h('li',
        h('div', { class: 'news-c-head' }, h('b', c.nick), h('span', { class: 'tag' }, c.team), h('span', { class: 'news-votes', title: '추천' }, `▲ ${c.votes}`)),
        h('div', c.text)))) : h('p', { class: 'note' }, '아직 달린 댓글이 없습니다.')) : null);
  return card;
}

function community(ctx, items) {
  const posts = communityPosts(items, ui.shown);
  return h('div', { class: 'news-board' }, posts.map((p) => h('div', { class: 'news-post' },
    h('div', { class: 'news-c-head' }, h('b', p.nick), h('span', { class: 'tag' }, p.team), h('span', { class: 'news-votes' }, `▲ ${p.votes}`)),
    h('div', p.text),
    h('div', { class: 'note news-ref' }, `「${p.article.headline}」 · ${p.article.when}`))));
}

export function render(ctx) {
  const news = getNews(ctx.session, ctx.data);
  const items = filterItems(news.items, ui.tab);
  const shown = items.slice(0, ui.shown);
  const body = h('div', { class: 'stack news' },
    h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'swatch' }), h('div', h('div', { class: 'crumb' }, '소식'), h('h1', '뉴스·커뮤니티')))),
    h('p', { class: 'callout news-disclaimer' }, DISCLAIMER),
    h('div', { class: 'card' }, moodCard(news.mood)),
    tabs(TABS, ui.tab, (t) => { ui.tab = t; ui.shown = PAGE; ctx.refresh(); }),
    items.length === 0 ? h('div', { class: 'card' }, h('p', { class: 'muted' }, '아직 이 분류의 기사가 없습니다. 시즌을 진행하면 기사가 쌓입니다.'))
      : ui.tab === 'community' ? community(ctx, news.items)
        : h('div', { class: 'news-feed' }, shown.map((it, i) => article(ctx, it, i))),
    items.length > ui.shown ? h('button', { class: 'btn', onclick: () => { ui.shown += PAGE; ctx.refresh(); } }, `더 보기 (${items.length - ui.shown}건 남음)`) : null);
  return { title: '뉴스', body };
}
