// 카드 도감: 우리 구단이 한 번이라도 보유·영입한 시즌 카드. 사진·초상은 쓰지 않고 자동 조합 일러스트를 쓴다.
import { h, RARITY_LABEL, POS_ORDER } from '../lib/dom.js';
import { buildCatalog, filterCatalog, codexProgress } from '../../src/codex.mjs';
import { avatarEl, AVATAR_NOTE } from '../lib/avatar.js';

const PAGE = 48;
const ui = { collected: 'all', rarity: 'all', position: 'all', kind: 'all', season: 'all', query: '', page: 0 };
const KIND = { d: '국내', f: '외국', a: '아시아쿼터' };

function select(label, key, options, ctx) {
  return h('label', { class: 'cx-f' }, h('span', { class: 'note' }, label),
    h('select', { 'aria-label': label, onchange: (e) => { ui[key] = e.target.value; ui.page = 0; ctx.refresh(); } },
      options.map(([v, t]) => h('option', { value: v, selected: ui[key] === v }, t))));
}

export function render(ctx) {
  const { session, data } = ctx;
  const have = new Set(session.codex);
  const catalog = buildCatalog(data.cards, data.players.filter((p) => p.real), data.baseRules?.season ?? data.rules.season);
  const prog = codexProgress(catalog, have);
  const seasons = [...new Set(catalog.map((c) => c.season))].sort().reverse();
  const rows = filterCatalog(catalog, have, ui);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (ui.page >= pages) ui.page = pages - 1;
  const slice = rows.slice(ui.page * PAGE, (ui.page + 1) * PAGE);
  const card = (c) => {
    const got = have.has(c.key);
    return h('li', { class: `cx-card r-${c.rarity} ${got ? 'got' : 'miss'}`, title: got ? c.display : `${c.display} (미수집)` },
      got ? avatarEl({ kblId: c.kblId, baseName: c.name, age: c.age, position: c.position, rarity: c.rarity }, { size: 56 }) : h('div', { class: 'cx-lock', 'aria-hidden': 'true' }, '?'),
      h('div', { class: 'cx-name' }, c.display), h('div', { class: 'note' }, `${c.position} · OVR ${c.ovr}`),
      h('div', { class: 'cx-tags' }, h('span', { class: 'tag' }, RARITY_LABEL[c.rarity]), c.kind !== 'd' ? h('span', { class: 'tag' }, KIND[c.kind]) : null));
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '카드 도감'), h('h1', '카드 도감'))),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', `수집 ${prog.got} / ${prog.total}장`), h('span', { class: 'note' }, `${((prog.got / Math.max(1, prog.total)) * 100).toFixed(1)}%`)),
      h('div', { class: 'bar gl-bar', role: 'img', 'aria-label': `도감 ${prog.got}장 수집` }, h('i', { style: { width: `${(prog.got / Math.max(1, prog.total)) * 100}%` } })),
      h('div', { class: 'cx-rar' }, Object.entries(RARITY_LABEL).map(([k, t]) => h('span', { class: 'note' }, `${t} ${prog.byRarity[k]?.[0] ?? 0}/${prog.byRarity[k]?.[1] ?? 0}`))),
      h('p', { class: 'note', style: { margin: '6px 0 0' } }, '우리 구단에서 한 번이라도 뛴 시즌 카드가 채워집니다(시작 로스터, 드래프트, FA, 외국인 영입, 트레이드). ' + AVATAR_NOTE)),
    h('div', { class: 'card cx-filters' },
      select('수집', 'collected', [['all', '전체'], ['yes', '수집함'], ['no', '미수집']], ctx),
      select('희귀도', 'rarity', [['all', '전체'], ...Object.entries(RARITY_LABEL)], ctx),
      select('포지션', 'position', [['all', '전체'], ...POS_ORDER.map((p) => [p, p])], ctx),
      select('구분', 'kind', [['all', '전체'], ['d', '국내'], ['f', '외국'], ['a', '아시아쿼터']], ctx),
      select('시즌', 'season', [['all', '전체'], ...seasons.map((s) => [s, s])], ctx),
      h('label', { class: 'cx-f' }, h('span', { class: 'note' }, '이름'),
        h('input', { type: 'search', value: ui.query, placeholder: '선수 이름', 'aria-label': '이름 검색', onchange: (e) => { ui.query = e.target.value; ui.page = 0; ctx.refresh(); } }))),
    h('div', { class: 'row between' }, h('span', { class: 'note' }, `${rows.length}장 표시`),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', disabled: ui.page === 0, onclick: () => { ui.page--; ctx.refresh(); } }, '이전'),
        h('span', { class: 'note' }, `${ui.page + 1} / ${pages}`), h('button', { class: 'btn', type: 'button', disabled: ui.page >= pages - 1, onclick: () => { ui.page++; ctx.refresh(); } }, '다음'))),
    slice.length ? h('ul', { class: 'cx-grid' }, slice.map(card)) : h('div', { class: 'card' }, h('p', { class: 'muted' }, '조건에 맞는 카드가 없습니다.')));
  return { title: '카드 도감', body };
}
