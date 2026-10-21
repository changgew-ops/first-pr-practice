/* Procedural pixel-art sprites: palette-swappable characters, furniture, floor/wall textures.
 * Everything is drawn once into offscreen canvases (1 css px = 1 art px) and auto-outlined. */
(function () {
  'use strict';
  const P = (window.PO = window.PO || {});
  const OUT = '#1c1530';

  // ---------- helpers ----------
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function shade(c, a) {
    const [r, g, b] = hex(c), t = a < 0 ? 0 : 255, p = Math.abs(a);
    return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
  }
  function mix(a, b, t) {
    const x = hex(a), y = hex(b);
    return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const r = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  function disc(g, cx, cy, rad, c) {
    for (let y = -rad; y <= rad; y++) {
      const w = Math.floor(Math.sqrt(rad * rad - y * y + rad * 0.4));
      g.fillStyle = c; g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  // shaded box: light top edge, dark bottom edge
  function box(g, x, y, w, h, c, hi = 0.22, lo = 0.28) {
    r(g, x, y, w, h, c);
    if (h > 2) { r(g, x, y, w, 1, shade(c, hi)); r(g, x, y + h - 1, w, 1, shade(c, -lo)); }
  }
  Object.assign(P, { mk, hex, shade, mix, rng, hash, r, disc, box });

  function outline(src, col) {
    const w = src.width, h = src.height, [c, g] = mk(w + 2, h + 2);
    g.drawImage(src, 1, 1);
    const id = g.getImageData(0, 0, w + 2, h + 2), d = id.data, W = w + 2, H = h + 2;
    const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[(y * W + x) * 4 + 3];
    const o = hex(col), out = new Uint8ClampedArray(d);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (A(x, y) === 0 && (A(x - 1, y) || A(x + 1, y) || A(x, y - 1) || A(x, y + 1))) {
        const i = (y * W + x) * 4; out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2]; out[i + 3] = 255;
      }
    }
    id.data.set(out); g.putImageData(id, 0, 0);
    return c;
  }
  function pad(src) { const [c, g] = mk(src.width + 2, src.height + 2); g.drawImage(src, 1, 1); return c; }
  // anchor (ax, ay) is the sprite's top-left corner in the outlined canvas
  function build(w, h, fn, opt = {}) {
    const [c, g] = mk(w, h); fn(g, w, h);
    return { c: opt.noOutline ? pad(c) : outline(c, opt.out || OUT), ax: 1, ay: 1, w, h };
  }
  function flip(s) {
    const [c, g] = mk(s.c.width, s.c.height);
    g.translate(s.c.width, 0); g.scale(-1, 1); g.drawImage(s.c, 0, 0);
    return { c, ax: s.c.width - s.ax, ay: s.ay, w: s.w, h: s.h };
  }
  P.drawSpr = (g, s, x, y) => g.drawImage(s.c, Math.round(x - s.ax), Math.round(y - s.ay));
  Object.assign(P, { build, flip });

  // ---------- characters ----------
  const SKINS = ['#f6d3b3', '#ecbf94', '#cf9568', '#9a6540', '#6e4630'];
  const HAIRS = ['#2a1d17', '#5a3720', '#a8652a', '#d8b24a', '#8b2f2f', '#3b3a5e', '#c9c9d6', '#1b3b2f'];
  const SHIRTS = ['#e0566b', '#4a90e2', '#f2b84b', '#58b868', '#a678e0', '#e8894a', '#3fbfb6', '#d96fb5', '#7a88f0', '#9bc14a'];
  const PANTS = ['#2f3a5a', '#3d3d4d', '#5a4636', '#2c4a45', '#4a2f4f'];
  const STYLES = ['short', 'spiky', 'long', 'bun', 'cap', 'bob'];
  const ACCS = ['none', 'glasses', 'headset', 'none', 'glasses'];

  P.makeLook = function (id) {
    const R = rng(hash(id)), pick = a => a[Math.floor(R() * a.length)];
    return { skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS), shoe: '#2b2438',
             style: pick(STYLES), acc: pick(ACCS), key: id };
  };

  function hairFront(g, L, back) {
    const h = L.hair, hh = shade(h, 0.28), hd = shade(h, -0.25);
    if (back) {
      r(g, 3, 2, 8, 8, h); r(g, 2, 3, 1, 5, h); r(g, 11, 3, 1, 5, h);
      r(g, 4, 2, 3, 1, hh); r(g, 3, 9, 8, 1, hd);
      if (L.style === 'long') r(g, 3, 9, 8, 5, h), r(g, 3, 13, 8, 1, hd);
      if (L.style === 'bob') r(g, 2, 3, 10, 7, h), r(g, 2, 9, 10, 1, hd);
      if (L.style === 'bun') r(g, 5, 0, 4, 2, h), r(g, 6, 0, 2, 1, hh);
      if (L.style === 'spiky') r(g, 4, 1, 2, 1, h), r(g, 7, 0, 2, 2, h), r(g, 9, 1, 2, 1, h);
      if (L.style === 'cap') { r(g, 3, 2, 8, 4, L.shirt); r(g, 4, 2, 3, 1, shade(L.shirt, 0.3)); r(g, 3, 5, 8, 1, shade(L.shirt, -0.25)); }
      return;
    }
    r(g, 3, 2, 8, 3, h); r(g, 2, 3, 1, 4, h); r(g, 11, 3, 1, 4, h);
    r(g, 3, 5, 2, 1, h); r(g, 9, 5, 2, 1, h); r(g, 4, 2, 3, 1, hh);
    if (L.style === 'long') { r(g, 2, 3, 1, 8, h); r(g, 11, 3, 1, 8, h); r(g, 2, 10, 1, 1, hd); r(g, 11, 10, 1, 1, hd); }
    if (L.style === 'bob') { r(g, 2, 3, 1, 6, h); r(g, 11, 3, 1, 6, h); r(g, 3, 5, 8, 1, h); r(g, 5, 5, 2, 1, hh); }
    if (L.style === 'bun') { r(g, 5, 0, 4, 2, h); r(g, 6, 0, 2, 1, hh); }
    if (L.style === 'spiky') { r(g, 4, 1, 2, 1, h); r(g, 7, 0, 2, 2, h); r(g, 9, 1, 2, 1, h); }
    if (L.style === 'cap') {
      const c = L.shirt;
      r(g, 3, 2, 8, 3, c); r(g, 4, 2, 3, 1, shade(c, 0.3)); r(g, 2, 4, 10, 1, shade(c, -0.15)); r(g, 3, 5, 8, 1, shade(c, -0.3));
      r(g, 2, 4, 1, 2, L.hair); r(g, 11, 4, 1, 2, L.hair);
    }
  }
  function face(g, L, o) {
    const sk = L.skin;
    r(g, 3, 5, 8, 5, sk); r(g, 4, 9, 6, 1, shade(sk, -0.12));
    if (L.style !== 'cap') { /* hair redrawn above */ }
    if (!o.blink) { r(g, 5, 7, 1, 2, '#2a2035'); r(g, 8, 7, 1, 2, '#2a2035'); }
    else { r(g, 5, 8, 1, 1, '#2a2035'); r(g, 8, 8, 1, 1, '#2a2035'); }
    r(g, 4, 8, 1, 1, '#f09a9a'); r(g, 9, 8, 1, 1, '#f09a9a');   // blush
    if (o.mouth) r(g, 6, 9, 2, 1, '#9a3d3d');
    if (L.acc === 'glasses') {
      const gl = '#2a2a40';
      r(g, 4, 6, 3, 1, gl); r(g, 4, 8, 3, 1, gl); r(g, 4, 6, 1, 3, gl); r(g, 6, 6, 1, 3, gl);
      r(g, 7, 6, 3, 1, gl); r(g, 7, 8, 3, 1, gl); r(g, 7, 6, 1, 3, gl); r(g, 9, 6, 1, 3, gl);
      r(g, 5, 7, 1, 1, '#bfe4ff'); r(g, 8, 7, 1, 1, '#bfe4ff');
      r(g, 5, 8, 1, 1, sk); r(g, 8, 8, 1, 1, sk);
    }
  }
  function headset(g, L, side) {
    if (L.acc !== 'headset') return;
    if (side === 'back') { r(g, 1, 4, 2, 4, '#4a4a66'); r(g, 11, 4, 2, 4, '#4a4a66'); r(g, 3, 1, 8, 1, '#4a4a66'); return; }
    r(g, 2, 2, 10, 1, '#4a4a66'); r(g, 1, 4, 2, 4, '#4a4a66'); r(g, 11, 4, 2, 4, '#4a4a66'); r(g, 1, 5, 1, 2, '#7a7aa0');
    r(g, 2, 8, 3, 1, '#4a4a66'); r(g, 4, 9, 1, 1, '#ff7a90');
  }

  function front(g, L, o = {}) {
    const sk = L.skin, skd = shade(sk, -0.15), sh = L.shirt, shl = shade(sh, 0.2), shd = shade(sh, -0.22);
    const pn = L.pants, pnd = shade(pn, -0.22), lp = o.leg || 0;
    const l1 = lp === 1 ? 1 : 0, l2 = lp === 2 ? 1 : 0;
    r(g, 3, 16, 3, 5 - l1, pn); r(g, 8, 16, 3, 5 - l2, pn); r(g, 6, 16, 2, 2, pnd); r(g, 3, 16, 8, 1, pnd);
    r(g, 2, 21 - l1, 4, 2, L.shoe); r(g, 8, 21 - l2, 4, 2, L.shoe);
    r(g, 3, 10, 8, 6, sh); r(g, 3, 10, 1, 6, shl); r(g, 10, 10, 1, 6, shd); r(g, 3, 15, 8, 1, shd);
    r(g, 6, 9, 2, 1, skd); r(g, 6, 10, 2, 1, skd);
    const sw = o.arms === 'swing' ? (lp === 1 ? 1 : -1) : 0;
    if (o.arms === 'up') {
      const k = o.k ? 1 : 0;
      r(g, 1, 7 + k, 2, 4, sh); r(g, 11, 7 + (1 - k), 2, 4, sh); r(g, 1, 5 + k, 2, 2, sk); r(g, 11, 5 + (1 - k), 2, 2, sk);
    } else {
      r(g, 1, 10, 2, 3, sh); r(g, 11, 10, 2, 3, sh); r(g, 1, 10, 1, 3, shl);
      r(g, 1, 13 + sw, 2, 2, sk); r(g, 11, 13 - sw, 2, 2, sk);
    }
    face(g, L, o);
    hairFront(g, L, false); headset(g, L, 'front');
    if (o.mug) {       // right hand holds a mug, sip = lifted
      const y = o.sip ? 8 : 12;
      r(g, 10, y, 4, 4, '#f4f1ff'); r(g, 10, y, 4, 1, '#cfcbe6'); r(g, 14, y + 1, 1, 2, '#f4f1ff'); r(g, 11, y + 1, 2, 1, '#7a4a2a');
      r(g, 11, y + 4, 2, 2, sk);
    }
  }
  function back(g, L, o = {}) {
    const sk = L.skin, skd = shade(sk, -0.15), sh = L.shirt, shl = shade(sh, 0.2), shd = shade(sh, -0.22);
    const pn = L.pants, pnd = shade(pn, -0.22), lp = o.leg || 0;
    const l1 = lp === 1 ? 1 : 0, l2 = lp === 2 ? 1 : 0;
    r(g, 3, 16, 3, 5 - l1, pn); r(g, 8, 16, 3, 5 - l2, pn); r(g, 6, 16, 2, 2, pnd); r(g, 3, 16, 8, 1, pnd);
    r(g, 2, 21 - l1, 4, 2, L.shoe); r(g, 8, 21 - l2, 4, 2, L.shoe);
    r(g, 3, 10, 8, 6, sh); r(g, 3, 10, 1, 6, shl); r(g, 10, 10, 1, 6, shd); r(g, 3, 15, 8, 1, shd); r(g, 5, 11, 4, 1, shd);
    r(g, 6, 9, 2, 1, skd);
    const sw = lp === 1 ? 1 : -1;
    r(g, 1, 10, 2, 3, sh); r(g, 11, 10, 2, 3, sh); r(g, 1, 13 + sw, 2, 2, sk); r(g, 11, 13 - sw, 2, 2, sk);
    r(g, 3, 5, 8, 5, sk); hairFront(g, L, true); headset(g, L, 'back');
  }
  function side(g, L, o = {}) {      // facing left
    const sk = L.skin, sh = L.shirt, shl = shade(sh, 0.2), shd = shade(sh, -0.22), pn = L.pants, pnd = shade(pn, -0.22);
    const ph = o.phase || 0;
    // legs: back leg first, front leg over it
    const A = [[8, 4, 10, 4], [6, 5, 7, 5], [3, 5, 4, 4], [6, 5, 7, 5]][ph];
    r(g, 7 + (ph === 0 ? 2 : ph === 2 ? -3 : 0), 16, 3, A[1] + 0, pnd);
    r(g, 7 + (ph === 0 ? 2 : ph === 2 ? -3 : 0) - 1, 16 + A[1], 4, 2, L.shoe);
    r(g, 4 + (ph === 0 ? -2 : ph === 2 ? 3 : 0), 16, 3, 5 - (ph === 2 ? 1 : 0), pn);
    r(g, 3 + (ph === 0 ? -2 : ph === 2 ? 3 : 0), 21 - (ph === 2 ? 1 : 0), 4, 2, L.shoe);
    r(g, 4, 16, 6, 2, pn);
    r(g, 4, 10, 6, 6, sh); r(g, 9, 10, 1, 6, shd); r(g, 4, 15, 6, 1, shd);
    r(g, 4, 5, 7, 5, sk); r(g, 3, 8, 1, 1, sk); r(g, 5, 7, 1, 2, '#2a2035'); r(g, 4, 8, 1, 1, '#f09a9a');
    // hair
    const h = L.hair, hh = shade(h, 0.28);
    r(g, 4, 2, 7, 3, h); r(g, 9, 3, 3, 6, h); r(g, 4, 5, 2, 1, h); r(g, 5, 2, 3, 1, hh);
    if (L.style === 'long') r(g, 9, 9, 3, 5, h);
    if (L.style === 'bob') r(g, 9, 9, 3, 1, h);
    if (L.style === 'bun') r(g, 8, 0, 4, 3, h);
    if (L.style === 'spiky') r(g, 6, 0, 2, 2, h), r(g, 9, 1, 2, 1, h);
    if (L.style === 'cap') { r(g, 4, 2, 7, 3, sh); r(g, 2, 4, 5, 1, shade(sh, -0.25)); r(g, 5, 2, 3, 1, shade(sh, .3)); }
    if (L.acc === 'glasses') { r(g, 3, 6, 4, 1, '#2a2a40'); r(g, 3, 8, 4, 1, '#2a2a40'); r(g, 3, 6, 1, 3, '#2a2a40'); r(g, 6, 6, 1, 3, '#2a2a40'); r(g, 4, 7, 2, 1, '#bfe4ff'); r(g, 5, 7, 1, 1, '#2a2035'); }
    if (L.acc === 'headset') { r(g, 8, 4, 3, 4, '#4a4a66'); r(g, 4, 2, 7, 1, '#4a4a66'); }
    // arm over torso
    const sw = ph === 0 ? -1 : ph === 2 ? 1 : 0;
    r(g, 5 + sw, 10, 3, 3, shl); r(g, 5 + sw, 13, 2, 2, sk);
  }
  // seated at a desk, seen from behind: head/shoulders only (the chair back covers the rest)
  function sitBack(g, L, o = {}) {
    const sk = L.skin, sh = L.shirt, shl = shade(sh, 0.2), shd = shade(sh, -0.22), k = o.k ? 1 : 0;
    r(g, 3, 10, 8, 7, sh); r(g, 3, 10, 1, 7, shl); r(g, 10, 10, 1, 7, shd); r(g, 5, 11, 4, 1, shd);
    r(g, 6, 9, 2, 1, shade(sk, -0.15));
    r(g, 3, 5, 8, 5, sk); hairFront(g, L, true); headset(g, L, 'back');
    // forearms reach forward (up the screen) to the keyboard
    r(g, 1, 10, 2, 3, sh); r(g, 11, 10, 2, 3, sh);
    r(g, 1, 7 + k, 2, 3, sk); r(g, 11, 7 + (1 - k), 2, 3, sk);
    if (o.tilt) { /* head tilt when stuck */ }
  }

  const charCache = {};
  P.charSprite = function (L, pose, f = 0, opt = {}) {
    const key = L.key + '|' + pose + '|' + f + '|' + (opt.k || '');
    if (charCache[key]) return charCache[key];
    let s;
    const wrap = (h, fn) => build(14, h, fn);
    switch (pose) {
      case 'front': s = wrap(23, g => front(g, L, { blink: opt.blink })); break;
      case 'walkF': s = wrap(23, g => front(g, L, { leg: f % 2 === 0 ? 1 : 2, arms: 'swing' })); break;
      case 'back': s = wrap(23, g => back(g, L, {})); break;
      case 'walkB': s = wrap(23, g => back(g, L, { leg: f % 2 === 0 ? 1 : 2 })); break;
      case 'walkL': s = wrap(23, g => side(g, L, { phase: f % 4 })); break;
      case 'walkR': s = flip(wrap(23, g => side(g, L, { phase: f % 4 }))); break;
      case 'sitBack': s = wrap(17, g => sitBack(g, L, { k: f % 2 })); break;
      case 'panic': s = wrap(23, g => front(g, L, { arms: 'up', k: f % 2, mouth: true, leg: f % 2 ? 1 : 0 })); break;
      case 'mug': s = wrap(23, g => front(g, L, { mug: true, sip: f % 2, blink: opt.blink })); break;
      case 'cheer': s = wrap(23, g => front(g, L, { arms: 'up', k: f % 2, mouth: true })); break;
    }
    if (pose === 'walkR') { s.ax = 1 + 7; } else { s.ax = 1 + 7; }
    s.ay = pose === 'sitBack' ? 1 + 17 : 1 + 23;
    return (charCache[key] = s);
  };

  // ---------- furniture ----------
  const F = (P.F = {});
  const wood = '#b9824f';

  F.desk = (seed = 1) => build(44, 24, (g) => {
    const R = rng(seed);
    box(g, 0, 0, 44, 14, wood, 0.18, 0.2);
    for (let i = 0; i < 26; i++) r(g, 1 + Math.floor(R() * 42), 1 + Math.floor(R() * 12), 2 + Math.floor(R() * 3), 1, shade(wood, R() < .5 ? .1 : -.1));
    r(g, 0, 13, 44, 1, '#7a4f2c');
    r(g, 0, 14, 44, 9, '#8a5a33'); r(g, 0, 14, 44, 1, '#a06c3d');
    r(g, 3, 15, 5, 8, '#6b4425'); r(g, 36, 15, 5, 8, '#6b4425');
    r(g, 9, 15, 26, 5, '#4a2e17');
    r(g, 28, 16, 6, 3, '#6b4425'); r(g, 30, 17, 2, 1, '#d9b36a');   // drawer pull
    r(g, 10, 4, 24, 9, '#2c3050'); r(g, 10, 4, 24, 1, '#3a4068'); // desk mat
  });
  F.keyboard = () => build(12, 4, g => { r(g, 0, 0, 12, 4, '#d5d8ea'); r(g, 0, 3, 12, 1, '#9a9eb8'); for (let x = 1; x < 11; x += 2) { r(g, x, 1, 1, 1, '#8a8fa8'); r(g, x, 2, 1, 1, '#8a8fa8'); } }, { noOutline: true });
  F.mug = c => build(4, 5, g => { r(g, 0, 0, 4, 5, c || '#f4f1ff'); r(g, 0, 0, 4, 1, shade(c || '#f4f1ff', -.2)); r(g, 4, 1, 1, 2, c || '#f4f1ff'); });
  F.paper = () => build(8, 6, g => { r(g, 0, 0, 8, 6, '#f3f0e6'); r(g, 1, 1, 5, 1, '#9aa'); r(g, 1, 3, 6, 1, '#9aa'); r(g, 0, 5, 8, 1, '#c9c4b0'); });
  F.monitor = () => build(20, 16, g => {
    box(g, 0, 0, 20, 13, '#2d3042', 0.25, 0.3);
    r(g, 2, 2, 16, 9, '#07120c');
    r(g, 8, 13, 4, 2, '#3b3f55'); r(g, 5, 15, 10, 1, '#4a4f6a');
    r(g, 18, 11, 1, 1, '#5ad17a');
  });
  F.chair = () => build(14, 19, g => {
    box(g, 1, 0, 12, 10, '#40445f', 0.25, 0.3); r(g, 0, 1, 1, 8, '#40445f'); r(g, 13, 1, 1, 8, '#40445f');
    r(g, 3, 2, 8, 1, '#5a6088'); r(g, 3, 5, 8, 1, '#363a52');
    r(g, 0, 10, 14, 3, '#2f3248'); r(g, 0, 10, 14, 1, '#4a4f6a');
    r(g, 6, 13, 2, 3, '#555a78'); r(g, 1, 16, 12, 1, '#555a78');
    r(g, 0, 17, 2, 2, '#2a2d3d'); r(g, 12, 17, 2, 2, '#2a2d3d'); r(g, 6, 17, 2, 2, '#2a2d3d');
  });
  F.couch = (c = '#c0526a') => build(48, 24, g => {
    box(g, 0, 0, 48, 12, shade(c, -0.08), 0.2, 0.25);
    r(g, 2, 2, 44, 2, shade(c, .15));
    box(g, 4, 11, 20, 8, c, 0.22, 0.25); box(g, 24, 11, 20, 8, c, 0.22, 0.25); r(g, 24, 11, 1, 8, shade(c, -.3));
    box(g, 0, 5, 6, 15, shade(c, -0.12), 0.2, 0.25); box(g, 42, 5, 6, 15, shade(c, -0.12), 0.2, 0.25);
    r(g, 2, 20, 3, 3, '#3a2a26'); r(g, 43, 20, 3, 3, '#3a2a26');
  });
  F.table = () => build(26, 14, g => { box(g, 0, 0, 26, 8, '#8a5a33', .2, .2); r(g, 1, 8, 24, 2, '#6b4425'); r(g, 2, 10, 2, 4, '#5d3a1f'); r(g, 22, 10, 2, 4, '#5d3a1f'); r(g, 4, 2, 6, 3, '#f3f0e6'); r(g, 15, 2, 4, 3, '#7bc96f'); });
  F.plant = (kind = 0) => build(22, 36, g => {
    const gs = ['#2f7a45', '#3f9a58', '#5ac06f'];
    r(g, 5, 26, 12, 10, '#a0522d'); r(g, 5, 26, 12, 2, '#c0703d'); r(g, 6, 34, 10, 2, '#6b3a1d'); r(g, 7, 28, 2, 6, '#b9683a');
    r(g, 10, 14, 2, 13, '#4d6a3a');
    const L = [[11, 8, 7], [5, 14, 5], [17, 14, 5], [8, 4, 4], [14, 5, 4], [11, 18, 4]];
    L.forEach(([x, y, rr]) => { disc(g, x, y, rr, gs[0]); });
    L.forEach(([x, y, rr]) => { disc(g, x - 1, y - 1, rr - 2, gs[1]); });
    L.forEach(([x, y, rr]) => { disc(g, x - 2, y - 2, Math.max(1, rr - 4), gs[2]); });
  });
  F.smallPlant = () => build(10, 14, g => { r(g, 2, 8, 6, 6, '#c0703d'); r(g, 2, 8, 6, 1, '#d9894f'); disc(g, 5, 4, 3, '#3f9a58'); r(g, 4, 2, 2, 2, '#5ac06f'); });
  F.lamp = () => build(10, 36, g => { r(g, 4, 6, 2, 26, '#8a8fa8'); box(g, 0, 0, 10, 8, '#ffd98a', .3, .3); r(g, 1, 8, 8, 1, '#c9a050'); r(g, 1, 32, 8, 3, '#555a78'); });
  F.cooler = () => build(14, 32, g => {
    box(g, 3, 0, 8, 10, '#9fdcff', .3, .2); r(g, 4, 2, 2, 6, '#d6f1ff');
    box(g, 1, 10, 12, 20, '#e6e9f5', .15, .25); r(g, 3, 14, 8, 1, '#c9cde0'); r(g, 5, 16, 2, 2, '#4a90e2'); r(g, 8, 16, 2, 2, '#e0566b'); r(g, 4, 21, 6, 3, '#aab0cc');
    r(g, 1, 30, 12, 2, '#9aa0bc');
  });
  F.coffee = () => build(26, 32, g => {
    box(g, 0, 16, 26, 4, '#6b4425', .2, .2); r(g, 1, 20, 24, 12, '#8a5a33'); r(g, 1, 20, 24, 1, '#a06c3d'); r(g, 3, 22, 20, 8, '#6b4425');
    box(g, 4, 2, 12, 15, '#4a4f6a', .25, .3); r(g, 6, 4, 8, 4, '#1a1f2e'); r(g, 7, 5, 3, 1, '#5ad17a'); r(g, 7, 11, 6, 1, '#2a2d3d');
    r(g, 8, 12, 4, 4, '#f4f1ff'); r(g, 9, 13, 2, 1, '#7a4a2a');
    r(g, 18, 8, 6, 8, '#3a3f55'); r(g, 19, 9, 4, 6, '#e0b080');   // grinder/beans
  });
  F.vending = () => build(24, 38, g => {
    box(g, 0, 0, 24, 38, '#3a5bd9', .2, .3);
    r(g, 2, 3, 15, 24, '#12162a');
    const cols = ['#e0566b', '#f2b84b', '#58b868', '#a678e0', '#4ac7c0'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) r(g, 3 + x * 3, 5 + y * 6, 2, 4, cols[(x + y) % 5]);
    r(g, 2, 3, 15, 1, '#3a4070'); r(g, 19, 4, 4, 9, '#24284a'); r(g, 20, 5, 2, 2, '#5ad17a'); r(g, 20, 8, 2, 2, '#ff5d6c');
    r(g, 3, 30, 14, 5, '#12162a'); r(g, 4, 34, 12, 1, '#555a78');
  });
  F.bookshelf = (seed = 3, w = 40) => build(w, 36, g => {
    const R = rng(seed);
    box(g, 0, 0, w, 36, '#7a4f2c', .2, .3);
    for (let s = 0; s < 3; s++) {
      r(g, 2, 2 + s * 11, w - 4, 9, '#3a2412');
      let x = 3;
      while (x < w - 5) {
        const bw = 2 + Math.floor(R() * 2), bh = 5 + Math.floor(R() * 4), cc = ['#e0566b', '#4a90e2', '#f2b84b', '#58b868', '#a678e0', '#e8894a', '#eee'][Math.floor(R() * 7)];
        r(g, x, 10 + s * 11 - bh, bw, bh, cc); r(g, x, 10 + s * 11 - bh, 1, bh, shade(cc, .25)); x += bw;
        if (R() < .12) x += 2;
      }
      r(g, 2, 10 + s * 11, w - 4, 1, '#9a6a3c');
    }
  });
  F.rack = () => build(18, 38, g => {
    box(g, 0, 0, 18, 38, '#2a2d3d', .2, .3);
    for (let i = 0; i < 6; i++) { r(g, 2, 2 + i * 6, 14, 5, '#1a1d2b'); r(g, 3, 3 + i * 6, 8, 1, '#3a3f55'); r(g, 3, 5 + i * 6, 8, 1, '#3a3f55'); }
  });
  F.rackLeds = (seed) => { const R = rng(seed), out = []; for (let i = 0; i < 6; i++) { out.push({ x: 13, y: 3 + i * 6, ph: R() * 6 }); out.push({ x: 13, y: 5 + i * 6, ph: R() * 6 }); } return out; };
  F.whiteboard = (kind, w = 56, h = 34) => build(w, h, g => {
    box(g, 0, 0, w, h, '#cfd3e6', .2, .25); r(g, 2, 2, w - 4, h - 7, '#f6f7fb');
    r(g, 4, h - 4, w - 8, 2, '#aab0cc');
    const px = 4, py = 4;
    if (kind === 'code') {
      const c = ['#e0566b', '#4a90e2', '#58b868', '#a678e0'];
      for (let i = 0; i < 6; i++) { r(g, px + (i % 2) * 4, py + i * 4, 10 + ((i * 7) % 18), 2, c[i % 4]); }
      r(g, 34, 6, 1, 18, '#555'); r(g, 34, 24, 16, 1, '#555'); [[36, 20], [40, 16], [44, 18], [48, 10]].forEach(([x, y]) => r(g, x, y, 2, 24 - y, '#4a90e2'));
    } else if (kind === 'chart') {
      r(g, 6, 5, 1, 20, '#555'); r(g, 6, 24, 40, 1, '#555');
      let py2 = 22; for (let x = 8; x < 46; x += 4) { const ny = 8 + ((x * 13) % 14); r(g, x, ny, 3, 3, '#e0566b'); py2 = ny; }
      r(g, 8, 20, 36, 1, '#4a90e2');
      r(g, 38, 6, 8, 6, '#f2b84b'); r(g, 38, 6, 8, 1, '#d9962a');
    } else {   // kanban
      for (let i = 0; i < 3; i++) { r(g, 4 + i * 17, 4, 15, h - 11, '#e9ebf4'); r(g, 4 + i * 17, 4, 15, 3, ['#e0566b', '#f2b84b', '#58b868'][i]); }
      const cs = ['#ffe27a', '#ff9eb5', '#9ee6b0', '#9ec9ff'];
      for (let i = 0; i < 3; i++) for (let k = 0; k < 2 - (i === 2 ? 0 : (i % 2)); k++) r(g, 6 + i * 17, 9 + k * 8, 10, 6, cs[(i + k * 2) % 4]);
    }
  });
  F.poster = (seed) => build(14, 18, g => {
    const R = rng(seed), c = ['#e0566b', '#4a90e2', '#f2b84b', '#58b868', '#a678e0'][Math.floor(R() * 5)];
    box(g, 0, 0, 14, 18, '#f6f1e4', .1, .2); r(g, 2, 2, 10, 14, c);
    disc(g, 7, 8, 3, shade(c, .3)); r(g, 3, 12, 8, 1, shade(c, -.25)); r(g, 4, 14, 6, 1, shade(c, -.25));
  });
  F.windowFrame = (w, h) => build(w, h, g => {
    const f = '#e8e4f4';
    r(g, 0, 0, w, 2, f); r(g, 0, 0, 2, h, f); r(g, w - 2, 0, 2, h, f); r(g, 0, h - 3, w, 3, '#cfc9e6');
    r(g, 0, h - 1, w, 1, '#9a94b8'); r(g, (w >> 1) - 1, 0, 2, h, f); r(g, 0, (h >> 1), w, 1, f);
    // glass shine
    g.globalAlpha = 0.16; r(g, 5, 3, 4, h - 8, '#fff'); r(g, 11, 3, 2, h - 8, '#fff');
    g.globalAlpha = 1;
  }, { noOutline: false });
  F.trash = () => build(8, 10, g => { box(g, 0, 0, 8, 10, '#5a6088', .2, .3); r(g, 1, 3, 6, 1, '#40445f'); r(g, 1, 6, 6, 1, '#40445f'); });
  F.printer = () => build(18, 14, g => { box(g, 0, 4, 18, 10, '#cfd3e6', .2, .3); r(g, 3, 0, 12, 5, '#f3f0e6'); r(g, 2, 8, 14, 2, '#9aa0bc'); r(g, 14, 6, 2, 1, '#5ad17a'); });
  F.rug = (w, h, c, c2) => build(w, h, g => {
    r(g, 0, 0, w, h, c); r(g, 2, 2, w - 4, h - 4, c2); r(g, 5, 5, w - 10, h - 10, c);
    for (let x = 8; x < w - 8; x += 6) r(g, x, (h >> 1) - 1, 3, 3, c2);
    for (let x = 0; x < w; x += 3) { r(g, x, -0, 1, 1, shade(c, .3)); }
  }, { noOutline: true });

  // ---------- floor / wall textures ----------
  P.floorTex = function (kind, c1, c2, w = 384, h = 216, y0 = 50) {
    const [c, g] = mk(w, h), R = rng(hash(kind + c1));
    r(g, 0, y0, w, h - y0, c1);
    if (kind === 'wood') {
      for (let y = y0, row = 0; y < h; y += 7, row++) {
        let x = -((row * 37) % 56);
        while (x < w) {
          const pw = 40 + Math.floor(R() * 36), tone = R();
          r(g, x, y, pw, 7, tone < .33 ? c1 : tone < .66 ? c2 : shade(c1, -.06));
          for (let i = 0; i < 8; i++) r(g, x + 1 + Math.floor(R() * (pw - 4)), y + 1 + Math.floor(R() * 5), 2 + Math.floor(R() * 4), 1, shade(c1, R() < .5 ? .08 : -.08));
          r(g, x, y, 1, 7, shade(c1, -.28)); x += pw;
        }
        r(g, 0, y + 6, w, 1, shade(c1, -.28)); r(g, 0, y, w, 1, shade(c1, .06));
      }
    } else if (kind === 'carpet') {
      for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) { const n = R(); if (n < .28) r(g, x, y, 1, 1, c2); else if (n > .93) r(g, x, y, 1, 1, shade(c1, .12)); }
      for (let x = 0; x < w; x += 32) r(g, x, y0, 1, h - y0, shade(c1, -.16));
      for (let y = y0 + 6; y < h; y += 32) r(g, 0, y, w, 1, shade(c1, -.16));
    } else {   // tile
      for (let y = y0, ry = 0; y < h; y += 16, ry++) for (let x = 0, rx = 0; x < w; x += 16, rx++) {
        r(g, x, y, 16, 16, (rx + ry) % 2 ? c1 : c2); r(g, x, y, 16, 1, shade(c1, .14)); r(g, x, y, 1, 16, shade(c1, .1));
        r(g, x + 15, y, 1, 16, shade(c1, -.22)); r(g, x, y + 15, 16, 1, shade(c1, -.22));
        if (R() < .25) r(g, x + 3 + Math.floor(R() * 8), y + 3 + Math.floor(R() * 8), 2, 1, shade(c1, .1));
      }
    }
    return c;
  };
  P.wallTex = function (c1, trim, w = 384, h = 50) {
    const [c, g] = mk(w, h), R = rng(hash(c1));
    r(g, 0, 0, w, h, c1);
    for (let x = 0; x < w; x += 8) r(g, x, 0, 1, h, shade(c1, -.06));
    for (let i = 0; i < 120; i++) r(g, Math.floor(R() * w), Math.floor(R() * h), 2, 1, shade(c1, R() < .5 ? .05 : -.05));
    r(g, 0, 0, w, 3, shade(c1, -.3));                      // crown shadow
    r(g, 0, h - 16, w, 16, shade(c1, -.18)); r(g, 0, h - 17, w, 1, shade(c1, .15)); r(g, 0, h - 16, w, 1, trim);  // wainscot
    for (let x = 0; x < w; x += 12) r(g, x, h - 15, 1, 11, shade(c1, -.28));
    r(g, 0, h - 5, w, 5, trim); r(g, 0, h - 5, w, 1, shade(trim, .25)); r(g, 0, h - 1, w, 1, shade(trim, -.3));
    return c;
  };

  // ---------- tiny glyphs for status bubbles ----------
  const GLYPH = {
    '!': ['010', '010', '010', '000', '010'],
    '?': ['110', '001', '010', '000', '010'],
    'v': ['00001', '00010', '10100', '01000', '00000'],
    'z': ['111', '001', '010', '100', '111'],
    '.': ['000', '000', '000', '000', '010'],
    '♪': ['0011', '0010', '0010', '1110', '1100'],
  };
  P.glyph = (g, ch, x, y, col) => { const m = GLYPH[ch]; if (!m) return; m.forEach((row, j) => [...row].forEach((v, i) => { if (v === '1') r(g, x + i, y + j, 1, 1, col); })); };
  P.glyphW = ch => (GLYPH[ch] ? GLYPH[ch][0].length : 3);
  P.bubble = function (g, x, y, w, h, bg = '#fffdf6', bd = '#1c1530') {
    r(g, x + 1, y, w - 2, h, bd); r(g, x, y + 1, w, h - 2, bd);
    r(g, x + 1, y + 1, w - 2, h - 2, bg);
    r(g, x + (w >> 1) - 1, y + h, 3, 1, bd); r(g, x + (w >> 1), y + h + 1, 1, 1, bd);
    r(g, x + (w >> 1), y + h - 1, 1, 1, bg);
  };
})();
