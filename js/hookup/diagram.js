/* Schematic hook-up drawing (SVG): process tap -> root valve -> siphon -> impulse tubing -> manifold -> instrument.
 * Components that a rule requires but the design lacks are drawn as dashed red placeholders. */
(function () {
  'use strict';
  const HU = (window.HU = window.HU || {});
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#d8d3f5', DIM = '#6a6688', BAD = '#ff5d6c', OKC = '#5ad17a', PIPE = '#4a5a96';

  function s(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  HU.diagram = function (rec, sys) {
    const d = rec.design, res = rec.results || [], by = {};
    res.forEach(r => { by[r.id] = r; });
    const bad = id => by[id] && (by[id].status === 'unapplied' || by[id].status === 'violated');
    const has = t => d.components.some(c => c.type === t);
    const rating = t => { const c = d.components.find(x => x.type === t); return c && c.rating ? c.rating + '#' : ''; };

    const svg = s('svg', { viewBox: '0 0 640 190', 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': `${d.tag} 훅업 도면` });
    svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.background = '#0b0918';
    const txt = (x, y, str, col, anchor) => s('text', { x, y, fill: col || INK, 'font-size': 9, 'text-anchor': anchor || 'middle', 'font-family': 'Galmuri9, Galmuri11, monospace' }, svg, str);

    // process line + tap
    s('rect', { x: 10, y: 22, width: 16, height: 146, fill: PIPE, stroke: '#2a3566' }, svg);
    s('rect', { x: 10, y: 22, width: 4, height: 146, fill: '#6a7ac0' }, svg);
    s('rect', { x: 26, y: 85, width: 12, height: 10, fill: PIPE }, svg);
    txt(2, 12, 'PROCESS', DIM, 'start'); txt(2, 184, `${sys.id} ${sys.pressure}barg`, DIM, 'start');

    const y0 = 90;
    let x = 38;
    const valve = (cx, label, col, sub) => {
      s('polygon', { points: `${cx - 10},${y0 - 8} ${cx},${y0} ${cx - 10},${y0 + 8}`, fill: col, stroke: '#0b0918' }, svg);
      s('polygon', { points: `${cx + 10},${y0 - 8} ${cx},${y0} ${cx + 10},${y0 + 8}`, fill: col, stroke: '#0b0918' }, svg);
      s('line', { x1: cx, y1: y0, x2: cx, y2: y0 - 16, stroke: col }, svg); s('rect', { x: cx - 4, y: y0 - 19, width: 8, height: 3, fill: col }, svg);
      txt(cx, y0 + 22, label, col === BAD ? BAD : INK); if (sub) txt(cx, y0 + 32, sub, DIM);
    };
    const missing = (cx, label, rule) => {
      s('rect', { x: cx - 18, y: y0 - 18, width: 36, height: 36, fill: 'none', stroke: BAD, 'stroke-dasharray': '3 3' }, svg);
      txt(cx, y0 + 4, '?', BAD); txt(cx, y0 + 32, label, BAD); txt(cx, y0 + 42, `${rule} 누락`, BAD);
    };
    const wire = (x1, x2) => s('line', { x1, y1: y0, x2, y2: y0, stroke: PIPE, 'stroke-width': 3 }, svg);

    const imp = d.kind !== 'temperature';
    if (imp) {
      wire(x, x + 14); x += 30;
      if (has('root_valve')) valve(x, '루트 밸브', OKC, rating('root_valve')); else missing(x, '루트 밸브', 'R-01');
      x += 26;
      if (d.phase === 'steam') {
        wire(x - 8, x + 8); x += 14;
        if (has('siphon')) { s('circle', { cx: x, cy: y0 - 7, r: 8, fill: 'none', stroke: OKC, 'stroke-width': 2 }, svg); txt(x, y0 + 22, '사이펀', INK); if (rating('siphon')) txt(x, y0 + 32, rating('siphon'), DIM); } else missing(x, '사이펀', 'R-02');
        x += 26;
      }
      // impulse tubing, slope exaggerated so it is visible
      const len = Math.min(220, 50 + d.tubing.length * 7), slopePx = Math.min(26, d.tubing.slope * 200), up = d.tubing.dir === 'down-to-process';
      const x2 = x + len, y2 = up ? y0 - slopePx : y0 + slopePx, tcol = (bad('R-05') || bad('R-06')) ? BAD : PIPE;
      s('line', { x1: x, y1: y0, x2, y2, stroke: tcol, 'stroke-width': 3 }, svg);
      // keep the tubing label on the side opposite to the drain/vent branch so they never collide
      const labY = d.phase === 'gas' ? Math.max(y0, y2) + 34 : Math.min(y0, y2) - 22;
      txt((x + x2) / 2, labY, `임펄스 ${d.tubing.length.toFixed(1)} m · 경사 ${(d.tubing.slope * 100).toFixed(1)}%`, tcol === BAD ? BAD : INK);
      if (d.tubing.dir) txt((x + x2) / 2, labY + 11, d.tubing.dir === 'down-to-process' ? '← 프로세스 쪽 하향' : '계기 쪽 하향 →', DIM);
      // drain / vent branch
      const dv = d.phase === 'gas' ? 'vent' : 'drain', bx = x + len * 0.55, by0 = y0 + (y2 - y0) * 0.55;
      if (has(dv)) {
        const dir = dv === 'vent' ? -1 : 1;
        s('line', { x1: bx, y1: by0, x2: bx, y2: by0 + dir * 26, stroke: PIPE, 'stroke-width': 3 }, svg);
        s('polygon', { points: `${bx - 6},${by0 + dir * 26} ${bx + 6},${by0 + dir * 26} ${bx},${by0 + dir * 38}`, fill: OKC }, svg);
        txt(bx + 22, by0 + dir * 30 + 3, dv === 'vent' ? '벤트' : '드레인', INK, 'start');
      } else if (bad('R-04')) { s('rect', { x: bx - 12, y: by0 + 10, width: 24, height: 22, fill: 'none', stroke: BAD, 'stroke-dasharray': '3 3' }, svg); txt(bx, by0 + 46, `${dv === 'vent' ? '벤트' : '드레인'} 누락 R-04`, BAD); }
      x = x2 + 14; wire(x2, x);
      if (['dp-flow', 'dp-level', 'dp'].includes(d.kind)) {
        if (has('manifold')) {
          s('rect', { x, y: y0 - 12, width: 46, height: 24, fill: '#2a3566', stroke: OKC }, svg);
          [10, 23, 36].forEach(dx => s('circle', { cx: x + dx, cy: y0, r: 4, fill: OKC }, svg));
          txt(x + 23, y0 + 26, '3-밸브 매니폴드', INK); if (rating('manifold')) txt(x + 23, y0 + 36, rating('manifold'), DIM);
        } else { s('rect', { x, y: y0 - 12, width: 46, height: 24, fill: 'none', stroke: BAD, 'stroke-dasharray': '3 3' }, svg); txt(x + 23, y0 + 4, '?', BAD); txt(x + 23, y0 + 26, '매니폴드 누락 R-03', BAD); }
        x += 56; wire(x - 10, x);
      }
    } else {
      wire(x, x + 10); x += 20;
      s('rect', { x, y: y0 - 6, width: 40, height: 12, fill: OKC }, svg); txt(x + 20, y0 + 22, '써모웰', INK); if (rating('thermowell')) txt(x + 20, y0 + 32, rating('thermowell'), bad('R-07') ? BAD : DIM);
      x += 54;
    }
    // instrument bubble
    const ix = Math.min(x + 18, 600), pfx = d.tag.split('-')[0];
    s('circle', { cx: ix, cy: y0, r: 17, fill: '#17142b', stroke: INK, 'stroke-width': 2 }, svg);
    s('line', { x1: ix - 17, y1: y0, x2: ix + 17, y2: y0, stroke: INK }, svg);
    txt(ix, y0 - 4, pfx, INK); txt(ix, y0 + 12, d.tag.split('-')[1], INK);
    txt(ix, y0 + 36, d.tag, '#ffd84a');
    if (bad('R-07')) txt(ix, y0 + 48, '등급 미달 R-07', BAD);
    if (by['R-07'] && by['R-07'].status === 'waived') txt(ix, y0 + 48, '등급 예외 승인 R-07', '#ffd84a');
    return svg;
  };
})();
