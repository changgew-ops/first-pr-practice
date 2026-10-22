// 아주 작은 DOM 도우미와 화면에서 같이 쓰는 표시 함수.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
  children.flat().forEach((c) => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}

export const STAT_LABELS = { shooting: '슈팅', passing: '패스', defense: '수비', rebound: '리바운드', athletic: '운동능력', stamina: '체력' };
export const STAT_KEYS = Object.keys(STAT_LABELS);
export const POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
export const ORIGIN_LABEL = { domestic: '국내', foreign: '외국', asia: '아시아쿼터' };
export const RARITY_LABEL = { common: '일반', rare: '레어', ace: '에이스', legend: '레전드' };

export const eok = (v, d = 1) => `${Number(v).toFixed(d)}억`;
export const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

/** OVR 칩: 희귀도 색 */
export function ovrChip(p) {
  return h('span', { class: `ovr r-${p.rarity}`, title: RARITY_LABEL[p.rarity] }, p.ovr);
}

export function link(href, text, cls) { return h('a', { href, class: cls }, text); }

/** 능력치 레이더 (6각형). values: { shooting: 70, … } */
export function radar(values, { size = 220, max = 100, min = 30 } = {}) {
  const c = size / 2, r = size / 2 - 38, n = STAT_KEYS.length;
  const pt = (i, f) => [c + Math.sin((2 * Math.PI * i) / n) * r * f, c - Math.cos((2 * Math.PI * i) / n) * r * f];
  const f = (v) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const poly = (fn) => STAT_KEYS.map((k, i) => pt(i, fn(k)).join(',')).join(' ');
  const el = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'radar', role: 'img', 'aria-label': STAT_KEYS.map((k) => `${STAT_LABELS[k]} ${values[k]}`).join(', ') });
  for (const ring of [0.25, 0.5, 0.75, 1]) el.append(svg('polygon', { points: poly(() => ring), class: 'radar-ring' }));
  STAT_KEYS.forEach((k, i) => { const [x, y] = pt(i, 1); el.append(svg('line', { x1: c, y1: c, x2: x, y2: y, class: 'radar-axis' })); });
  el.append(svg('polygon', { points: poly((k) => f(values[k])), class: 'radar-area' }));
  STAT_KEYS.forEach((k, i) => {
    const [lx, ly] = pt(i, 1.2); const [vx, vy] = pt(i, f(values[k]));
    el.append(svg('circle', { cx: vx, cy: vy, r: 3, class: 'radar-dot' }));
    el.append(svg('text', { x: lx, y: ly, class: 'radar-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, STAT_LABELS[k]));
  });
  return el;
}

/** 순위 흐름 선 그래프. ranks: [{ label, rank|null }], 1위가 위 */
export function rankChart(ranks, { width = 640, height = 140, teams = 10 } = {}) {
  const pad = { l: 28, r: 10, t: 10, b: 22 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  const x = (i) => pad.l + (ranks.length <= 1 ? w / 2 : (i / (ranks.length - 1)) * w);
  const y = (rank) => pad.t + ((rank - 1) / (teams - 1)) * hgt;
  const el = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'rank-chart', role: 'img' });
  for (const r of [1, 3, 6, 10]) {
    el.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: y(r), y2: y(r), class: 'grid' }));
    el.append(svg('text', { x: pad.l - 6, y: y(r), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, r));
  }
  let d = '';
  ranks.forEach((p, i) => { if (p.rank != null) d += `${d && ranks[i - 1]?.rank != null ? 'L' : 'M'}${x(i)},${y(p.rank)}`; });
  el.append(svg('path', { d, class: 'line' }));
  ranks.forEach((p, i) => {
    if (p.rank == null) return;
    el.append(svg('circle', { cx: x(i), cy: y(p.rank), r: p.champion ? 5 : 3, class: p.champion ? 'dot champ' : 'dot' }, svg('title', {}, `${p.label} ${p.rank}위${p.champion ? ' · 우승' : ''}`)));
  });
  const step = Math.ceil(ranks.length / 8);
  ranks.forEach((p, i) => { if (i % step === 0 || i === ranks.length - 1) el.append(svg('text', { x: x(i), y: height - 6, class: 'axis', 'text-anchor': 'middle' }, p.label.replace(/^(\d{4})-(\d{2})$/, "'$2"))); });
  return el;
}

/** 정렬 가능한 표. cols: [{ key, label, get(row), render?(row), sort?: 'num'|'str', align?: 'r' }] */
export function table(rows, cols, { sort = null, onRow = null, rowClass = null, empty = '표시할 항목이 없습니다' } = {}) {
  const state = { key: sort?.key ?? null, dir: sort?.dir ?? -1 };
  const wrap = h('div', { class: 'table-wrap' });
  const draw = () => {
    let list = [...rows];
    const col = cols.find((c) => c.key === state.key);
    if (col) list.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return r * state.dir;
    });
    const head = h('tr', cols.map((c) => h('th', {
      class: `${c.align === 'r' ? 'r' : ''} ${c.sort === false ? '' : 'sortable'} ${state.key === c.key ? 'sorted' : ''}`,
      onclick: c.sort === false ? null : () => { state.dir = state.key === c.key ? -state.dir : (c.sort === 'str' ? 1 : -1); state.key = c.key; draw(); },
      title: c.title
    }, c.label, state.key === c.key ? (state.dir < 0 ? ' ▾' : ' ▴') : '')));
    const body = list.map((row) => h('tr', { class: `${rowClass?.(row) ?? ''} ${onRow ? 'clickable' : ''}`, onclick: onRow ? () => onRow(row) : null },
      cols.map((c) => h('td', { class: c.align === 'r' ? 'r' : '' }, c.render ? c.render(row) : c.get(row)))));
    wrap.replaceChildren(rows.length ? h('table', h('thead', head), h('tbody', body)) : h('p', { class: 'muted pad' }, empty));
  };
  draw();
  return wrap;
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([key, label]) => h('button', { role: 'tab', class: key === active ? 'on' : '', 'aria-selected': key === active, onclick: () => onChange(key) }, label)));
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

export function bar(value, max, { cls = '', label = null } = {}) {
  return h('div', { class: `bar ${cls}`, title: label ?? `${value} / ${max}` }, h('i', { style: { width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` } }));
}
