// 뉴스: 게임이 만든 가상 기사와 팬 커뮤니티 반응. 저장하지 않고 세션 상태에서 매번 같은 결과로 만든다(web/lib/news-view.js).
import { h, tabs, svg } from '../lib/dom.js';
import { getNews, filterItems, communityPosts, pinnedBig, TABS, MOOD_TONE } from '../lib/news-view.js';
import { colorOf } from '../lib/team-ui.js';
import { nameButton } from '../lib/player-info.js';

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

// 기사 본문 속 선수 이름을 눌러 정보 창을 열 수 있게 한다. 이름은 지금 리그에 있는 선수의 이름(카드 연도 뺀 이름)으로 찾는다.
// 한글 낱말 한가운데가 아니라 낱말 첫머리에서 시작하는 이름만 찾는다(두 글자 이름이 다른 낱말 속에서 걸리지 않게). 이미 리그를 떠난 선수(은퇴 등)는 링크가 없다.
let nameIndex = null;
function namesOf(ctx) {
  const players = ctx.session.players;
  if (nameIndex && nameIndex.players === players) return nameIndex;
  const byName = new Map();
  for (const p of players) {
    const n = p.baseName ?? p.name;
    if (n && n.length >= 2 && !byName.has(n)) byName.set(n, p);
  }
  const esc = [...byName.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  nameIndex = { players, byName, re: esc.length ? new RegExp(`(?<![가-힣])(?:${esc.join('|')})`, 'g') : null };
  return nameIndex;
}
export function linkNames(ctx, text) {
  const { byName, re } = namesOf(ctx);
  if (!re) return [text];
  const out = []; let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const p = byName.get(m[0]);
    out.push(nameButton({ ...p, name: m[0] }, { ctx }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function commentEl(c) {
  return h('li', { class: c.replyTo ? 'reply' : '' },
    h('div', { class: 'news-c-head' }, c.replyTo ? h('span', { class: 'news-reply-mark', 'aria-label': `${c.replyTo}님에게 답글` }, `↳ @${c.replyTo}`) : null, h('b', c.nick), h('span', { class: 'tag' }, c.team), h('span', { class: 'news-votes', title: '추천' }, `▲ ${c.votes}`)),
    h('div', c.text));
}

function article(ctx, it, i) {
  const open = ui.open.has(it.id);
  const cmt = it.comments.length;
  return h('article', { class: `news-item ${it.scope === 'my' || it.scope === 'move' ? 'mine' : ''} ${it.big ? 'big' : ''} tone-${it.tone}`, style: { '--team': colorOf(ctx.session.managerId) } },
    h('button', {
      class: 'news-head', 'aria-expanded': String(open), 'aria-controls': `news-body-${i}`,
      onclick: () => { if (open) ui.open.delete(it.id); else ui.open.add(it.id); ctx.refresh(); }
    },
    h('span', { class: 'news-meta' }, it.big ? h('span', { class: 'tag news-big' }, '대서특필') : null, h('span', it.when), h('span', { class: 'dim' }, ' · '), h('span', it.outlet), it.tags.map((t) => h('span', { class: 'tag' }, t))),
    h('span', { class: 'news-title' }, it.headline),
    open ? null : h('span', { class: 'news-summary' }, it.summary),
    h('span', { class: 'news-sub note' }, open ? '접기' : `전문 보기 · 댓글 ${cmt}`)),
    open ? h('div', { class: 'news-body', id: `news-body-${i}` },
      it.paragraphs.map((p) => h('p', { class: 'news-p' }, linkNames(ctx, p))),
      cmt ? h('div', { class: 'news-comments-wrap' }, h('h3', { class: 'news-c-title' }, `댓글 ${cmt}`), h('ul', { class: 'news-comments', 'aria-label': '댓글' }, it.comments.map(commentEl))) : h('p', { class: 'note' }, '아직 달린 댓글이 없습니다.')) : null);
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
  const pin = ui.tab === 'all' || ui.tab === 'league' || ui.tab === 'my' ? pinnedBig(ctx.session, news) : null;
  const pinned = pin && items.includes(pin) ? pin : null; // 최근 대서특필 기사는 목록 맨 위에 고정한다
  const shown = (pinned ? [pinned, ...items.filter((it) => it !== pinned)] : items).slice(0, ui.shown);
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
