/* Office scene: rooms, sky + lighting, agent behaviour and rendering (384x216 logical pixels). */
(function () {
  'use strict';
  const P = window.PO, F = P.F, r = P.r, shade = P.shade, mix = P.mix;
  const W = 384, H = 216, WALL = 50, BASE = 56;
  const DESK_X = [26, 114, 202, 290], ROW_Y = [70, 128];
  const GAPS = [12, 92, 180, 268, 358];
  const LANE_WALL = 62, LANE_MID = 118, LANE_LOW = 190;
  const ST = { working: '#5ad17a', blocked: '#ff5d6c', done: '#6ab0ff', idle: '#c9c4e8', offline: '#6a6688' };
  P.STATUS_COLOR = ST;

  // ---------- themes ----------
  const THEMES = {
    dev: {
      wall: '#4b4f7d', trim: '#34375c', floor: 'wood', fc1: '#7a5a46', fc2: '#6c4f3d', rug: ['#2d3a63', '#3f4f86'], accent: '#6ab0ff',
      windows: [{ x: 86, w: 52 }, { x: 214, w: 52 }],
      props: [
        { t: 'rack', x: 8 }, { t: 'rack', x: 28 }, { t: 'poster', x: 54, s: 2 }, { t: 'board', k: 'code', x: 146 },
        { t: 'clock', x: 278 }, { t: 'vending', x: 296 }, { t: 'cooler', x: 326 }, { t: 'plant', x: 350 },
      ],
    },
    research: {
      wall: '#3f6b73', trim: '#2a4a52', floor: 'carpet', fc1: '#40556b', fc2: '#384c60', rug: ['#2d4a5a', '#4a7a8a'], accent: '#7bdcb5',
      windows: [{ x: 100, w: 52 }, { x: 224, w: 52 }],
      props: [
        { t: 'shelf', x: 6, s: 3 }, { t: 'shelf', x: 50, s: 4 }, { t: 'board', k: 'chart', x: 160 },
        { t: 'shelf', x: 286, s: 5 }, { t: 'coffee', x: 330 }, { t: 'cooler', x: 360 }, { t: 'clock', x: 84 },
      ],
    },
    ops: {
      wall: '#8a6f55', trim: '#5a4630', floor: 'tile', fc1: '#c9c2b0', fc2: '#bdb5a0', rug: ['#4f6e3b', '#6f9a52'], accent: '#ffb454',
      windows: [{ x: 96, w: 52 }, { x: 232, w: 52 }],
      props: [
        { t: 'board', k: 'kanban', x: 10, w: 74 }, { t: 'clock', x: 170 }, { t: 'poster', x: 196, s: 7 },
        { t: 'coffee', x: 292 }, { t: 'vending', x: 324 }, { t: 'plant', x: 354 }, { t: 'printer', x: 156, floor: true },
      ],
    },
  };

  // ---------- sprite cache ----------
  const SPR = {};
  const S = (k, fn) => SPR[k] || (SPR[k] = fn());
  const propSpr = p => {
    switch (p.t) {
      case 'rack': return S('rack', F.rack);
      case 'poster': return S('poster' + p.s, () => F.poster(p.s));
      case 'board': return S('board' + p.k + (p.w || ''), () => F.whiteboard(p.k, p.w || 56, 34));
      case 'vending': return S('vend', F.vending);
      case 'cooler': return S('cool', F.cooler);
      case 'plant': return S('plant', () => F.plant());
      case 'shelf': return S('shelf' + p.s, () => F.bookshelf(p.s, 40));
      case 'coffee': return S('coffee', F.coffee);
      case 'printer': return S('printer', F.printer);
      case 'clock': return null;
    }
  };

  // ---------- time of day / sky ----------
  const SKY = [
    [0, '#070b24', '#141a4a'], [5, '#141a4a', '#2c2c6a'], [6.5, '#5a5aa0', '#f4a261'], [8, '#6fb4f0', '#cdeaff'],
    [12, '#4fa3f0', '#a9dcff'], [17, '#6fb4f0', '#ffd9a0'], [18.8, '#6a4a90', '#f0805a'], [20, '#1a1f52', '#35306e'],
    [22, '#070b24', '#141a4a'], [24, '#070b24', '#141a4a'],
  ];
  function skyColors(T) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const a = SKY[i], b = SKY[i + 1];
      if (T >= a[0] && T <= b[0]) { const t = (T - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
    }
    return [SKY[0][1], SKY[0][2]];
  }
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function nightness(T) { return T < 6 ? 1 - sm(4.5, 6.5, T) : T > 18 ? sm(18.2, 20.5, T) : 0; }

  function drawSky(g, w, T, t) {
    const [top, bot] = skyColors(T), N = nightness(T);
    for (let y = 0; y < w.h; y += 1) r(g, w.x, w.y + y, w.w, 1, mix(top, bot, Math.floor((y / w.h) * 5) / 4));
    g.save(); g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip();
    // stars
    if (N > 0.15) {
      const R = P.rng(w.x * 7 + 3);
      for (let i = 0; i < 16; i++) {
        const sx = w.x + 2 + Math.floor(R() * (w.w - 4)), sy = w.y + 2 + Math.floor(R() * (w.h * 0.55));
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i * 1.7);
        g.globalAlpha = N * (0.4 + 0.6 * tw); r(g, sx, sy, 1, 1, '#fff');
      }
      g.globalAlpha = 1;
    }
    // sun / moon
    const sunT = (T - 6) / 13, moonT = ((T + 6) % 24) / 12;
    const arc = (u) => [w.x + 4 + u * (w.w - 8), w.y + w.h * 0.78 - Math.sin(Math.PI * u) * w.h * 0.62];
    if (T > 5.5 && T < 19.5) { const [x, y] = arc(sunT); P.disc(g, Math.round(x), Math.round(y), 4, '#ffe9a0'); P.disc(g, Math.round(x), Math.round(y), 3, '#fff6d0'); }
    if (N > 0.2 && moonT >= 0 && moonT <= 1) { const [x, y] = arc(moonT); P.disc(g, Math.round(x), Math.round(y), 4, '#f4f1ff'); P.disc(g, Math.round(x) + 2, Math.round(y) - 1, 3, mix(top, bot, 0.3)); }
    // clouds
    if (N < 0.8) {
      g.globalAlpha = 0.85 * (1 - N);
      for (let i = 0; i < 2; i++) {
        const cx = w.x + ((t * 2.2 + i * 38 + w.x) % (w.w + 24)) - 12, cy = w.y + 6 + i * 8;
        r(g, Math.round(cx), cy + 2, 14, 3, '#fff'); r(g, Math.round(cx) + 3, cy, 8, 3, '#fff');
      }
      g.globalAlpha = 1;
    }
    // skyline (two layers) with lit windows at night
    const R2 = P.rng(w.x * 13 + 5), far = mix(bot, '#2a2f5a', 0.55), near = mix('#232845', '#0d1020', N);
    let x = 0; while (x < w.w) { const bw = 5 + Math.floor(R2() * 7), bh = 8 + Math.floor(R2() * 10); r(g, w.x + x, w.y + w.h - bh, bw, bh, far); x += bw + 1; }
    x = -3; const R3 = P.rng(w.x * 3 + 9);
    while (x < w.w) {
      const bw = 6 + Math.floor(R3() * 8), bh = 5 + Math.floor(R3() * 9);
      r(g, w.x + x, w.y + w.h - bh, bw, bh, near); r(g, w.x + x, w.y + w.h - bh, bw, 1, shade(near, .2));
      for (let yy = 2; yy < bh - 1; yy += 3) for (let xx = 1; xx < bw - 1; xx += 3) {
        const lit = R3() < 0.55; if (lit && N > 0.3) r(g, w.x + x + xx, w.y + w.h - bh + yy, 1, 2, '#ffd98a');
        else if (!lit || N <= 0.3) { /* dark window */ }
      }
      x += bw + 2;
    }
    g.restore();
  }

  // ---------- floors ----------
  function buildFloor(data) {
    const th = THEMES[data.theme] || THEMES.dev;
    const f = { data, th, dyn: [], pois: [], agents: [], desks: [], bg: null, windows: [] };
    f.windows = th.windows.map(w => ({ x: w.x, y: 8, w: w.w, h: 34 }));
    const [bg, g] = P.mk(W, H);
    g.drawImage(P.floorTex(th.floor, th.fc1, th.fc2, W, H, WALL), 0, 0);
    g.drawImage(P.wallTex(th.wall, th.trim, W, WALL), 0, 0);
    g.globalCompositeOperation = 'destination-out';
    f.windows.forEach(w => r(g, w.x, w.y, w.w, w.h, '#000'));
    g.globalCompositeOperation = 'source-over';
    f.windows.forEach(w => P.drawSpr(g, F.windowFrame(w.w, w.h), w.x, w.y));
    // wall-standing props
    th.props.forEach(p => {
      if (p.t === 'clock') { f.dyn.push({ t: 'clock', x: p.x + 6, y: 16 }); r(g, p.x, 10, 13, 13, '#e8e4f4'); r(g, p.x + 1, 11, 11, 11, '#fbfaff'); r(g, p.x, 10, 13, 1, '#9a94b8'); f.pois.push({ x: p.x + 6, y: LANE_WALL, face: 'back' }); return; }
      const s = propSpr(p); if (!s) return;
      const onWall = p.t === 'poster' || p.t === 'board';
      const y = onWall ? (p.t === 'poster' ? 12 : 10) : BASE - s.h;
      if (!onWall) { r(g, p.x - 1, BASE - 2, s.w + 3, 4, 'rgba(0,0,0,.22)'); }
      P.drawSpr(g, s, p.x, y);
      if (p.t === 'rack') f.dyn.push({ t: 'leds', x: p.x, y, list: F.rackLeds(p.x) });
      if (p.t === 'coffee') f.dyn.push({ t: 'steam', x: p.x + 12, y: y + 10 });
      if (['cooler', 'coffee', 'vending', 'shelf', 'board', 'printer'].includes(p.t)) f.pois.push({ x: p.x + (s.w >> 1), y: LANE_WALL + (p.t === 'board' ? 2 : 0), face: 'back', kind: p.t });
    });
    f.windows.forEach(w => f.pois.push({ x: w.x + (w.w >> 1), y: LANE_WALL + 2, face: 'back', kind: 'window' }));
    // lounge rug + static lounge props
    P.drawSpr(g, F.rug(92, 36, th.rug[0], th.rug[1]), 18, 180);
    r(g, 100, 213, 28, 2, 'rgba(0,0,0,.2)');
    f.lounge = { couch: { x: 28, y: 184 }, table: { x: 88, y: 200 } };
    f.pois.push({ x: 104, y: 208, face: 'front', kind: 'table' });
    // desks
    DESK_X.forEach((dx, i) => ROW_Y.forEach((dy, j) => f.desks.push({ x: dx, y: dy, seed: i * 3 + j * 11 + 1 })));
    f.desks.sort((a, b) => a.y - b.y || a.x - b.x);
    // floor decor on the right of the lounge
    r(g, 330, 206, 28, 3, 'rgba(0,0,0,.22)');
    f.bg = bg;
    return f;
  }

  // ---------- routing ----------
  function nearestGap(x) { return GAPS.reduce((b, g) => Math.abs(g - x) < Math.abs(b - x) ? g : b, GAPS[0]); }
  function laneOf(y) { return y < 90 ? LANE_WALL : y < 170 ? LANE_MID : y; }
  function route(from, to) {
    const pts = [];
    const lf = from.lane != null ? from.lane : laneOf(from.y), lt = to.lane != null ? to.lane : laneOf(to.y);
    if (from.y !== lf) pts.push({ x: from.x, y: lf });
    if (lf !== lt && !(lf >= 170 && lt >= 170)) {
      let g = GAPS.reduce((b, c) => (Math.abs(c - from.x) + Math.abs(c - to.x) < Math.abs(b - from.x) + Math.abs(b - to.x) ? c : b), GAPS[0]);
      if (from.x === g) g = nearestGap(from.x);
      pts.push({ x: g, y: lf }); pts.push({ x: g, y: lt });
    }
    if (lt !== to.y) { pts.push({ x: to.x, y: lt }); }
    pts.push({ x: to.x, y: to.y });
    return pts;
  }

  // ---------- agents ----------
  function targetFor(f, a, idx, used) {
    const st = a.d.status;
    if (st === 'working' || st === 'offline' || (st === 'blocked')) {
      const desk = f.desks[used.desk++ % f.desks.length]; a.desk = desk;
      if (st === 'blocked') return { x: desk.x + 54, y: desk.y + 32, lane: laneOf(desk.y + 32), mode: 'panic' };
      if (st === 'offline') return { x: desk.x + 22, y: desk.y + 34, mode: 'away' };
      return { x: desk.x + 22, y: desk.y + 34, lane: desk.y < 100 ? LANE_MID : LANE_LOW, mode: 'sit' };
    }
    a.desk = null;
    if (st === 'done' && used.couch < 2) { const cx = f.lounge.couch.x + (used.couch++ ? 31 : 17); return { x: cx, y: f.lounge.couch.y + 19, mode: 'couch' }; }
    const p = f.pois[(idx * 5 + 3) % f.pois.length];
    return { x: p.x + (idx % 3 - 1) * 4, y: p.y, mode: 'stand', face: p.face, poi: p };
  }
  function layoutAgents(f, keepPos) {
    const used = { desk: 0, couch: 0 };
    const list = f.data.agents.filter(a => !a.demo || S_.showDemo);
    const old = new Map(f.agents.map(a => [a.d.id, a]));
    f.agents = list.map((d, i) => {
      const a = old.get(d.id) || { d, look: P.makeLook(d.id), x: 0, y: 0, path: [], dir: 'down', t0: Math.random() * 50, timer: 2 + Math.random() * 4, seed: P.hash(d.id) % 97, spawned: false, bubbleT: 0 };
      a.d = d; a.target = targetFor(f, a, i, used);
      if (!a.spawned) { a.x = a.target.x; a.y = a.target.y; a.spawned = true; a.mode = a.target.mode; a.path = []; }
      else { a.path = route({ x: a.x, y: a.y, lane: a.mode === 'sit' ? (a.desk && a.desk.y < 100 ? LANE_MID : LANE_LOW) : undefined }, a.target); a.mode = 'walk'; }
      return a;
    });
  }

  function stepAgent(f, a, dt, t) {
    if (a.path.length) {
      const p = a.path[0], dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), sp = 34 * dt;
      if (d <= sp) { a.x = p.x; a.y = p.y; a.path.shift(); } else { a.x += dx / d * sp; a.y += dy / d * sp; }
      if (Math.abs(dx) > Math.abs(dy)) a.dir = dx < 0 ? 'left' : 'right'; else a.dir = dy < 0 ? 'up' : 'down';
      a.walking = true; a.mode = 'walk';
      if (!a.path.length) { a.mode = a.target.mode; a.walking = false; a.arrivedAt = t; }
      return;
    }
    a.walking = false;
    if (a.target.mode === 'stand' || (a.d.status === 'idle')) {
      a.timer -= dt;
      if (a.timer <= 0) {
        a.timer = 4 + Math.random() * 7;
        const poi = f.pois[Math.floor(Math.random() * f.pois.length)];
        a.target = { x: poi.x + (Math.random() * 8 - 4), y: poi.y, mode: 'stand', face: poi.face, poi };
        a.path = route({ x: a.x, y: a.y }, a.target);
      }
    }
  }

  // ---------- screens ----------
  function drawScreen(g, x, y, status, t, seed) {
    const w = 16, h = 9;
    if (status === 'working') {
      r(g, x, y, w, h, '#06130d');
      const sc = Math.floor(t * 3 + seed);
      for (let i = 0; i < 4; i++) {
        const hs = P.hash('l' + (i + sc) + seed), len = 3 + (hs % 9), ind = ((hs >> 4) % 3) * 2;
        r(g, x + 1 + ind, y + 1 + i * 2, Math.min(len, w - 2 - ind), 1, ['#5ad17a', '#6ad3ff', '#ffd85a', '#c58bff'][(hs >> 8) % 4]);
      }
      if (Math.floor(t * 2) % 2) r(g, x + 10, y + 7, 2, 1, '#fff');
    } else if (status === 'blocked') {
      r(g, x, y, w, h, '#2a0a10');
      for (let i = 0; i < 3; i++) r(g, x + 1, y + 1 + i * 2, 4 + ((i * 5 + seed) % 8), 1, '#ff8c96');
      if (Math.floor(t * 2.5) % 2) { r(g, x + 11, y + 1, 4, 7, '#ff5d6c'); P.glyph(g, '!', x + 11, y + 2, '#fff'); }
    } else if (status === 'done') {
      r(g, x, y, w, h, '#0a1630'); P.glyph(g, 'v', x + 5, y + 2, '#6ab0ff'); r(g, x + 2, y + 7, 12, 1, '#27406e');
    } else if (status === 'idle') {
      r(g, x, y, w, h, '#0b0d18');
      const px = Math.abs(((t * 6 + seed * 3) % 24) - 12), py = Math.abs(((t * 4 + seed) % 14) - 7);
      r(g, x + 1 + Math.floor(px * 14 / 12), y + 1 + Math.floor(py * 7 / 7), 2, 2, '#8c86e8');
    } else { r(g, x, y, w, h, '#09090d'); r(g, x + 2, y + 1, 1, 7, 'rgba(255,255,255,.05)'); }
    r(g, x, y, w, 1, 'rgba(255,255,255,.07)');
  }

  // ---------- state ----------
  const S_ = { floors: [], cur: 0, showDemo: true, tod: 'auto', hover: null, sel: null, parts: [], trans: null, clickCb: null, hoverCb: null, lm: null };
  const [LM, lmg] = P.mk(W, H);
  S_.lm = LM;
  let cv, g, last = 0, T = 12;
  const timeNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  const curT = () => S_.tod === 'day' ? 13 : S_.tod === 'night' ? 23 : timeNow();

  function emit(x, y, vx, vy, life, col, size = 1) { if (S_.parts.length < 160) S_.parts.push({ x, y, vx, vy, life, max: life, col, size }); }

  function chairFor(f, desk, away) {
    return { y: desk.y + (away ? 40 : 36), draw: g2 => P.drawSpr(g2, S('chair', F.chair), desk.x + 15, desk.y + (away ? 31 : 27)) };
  }

  // ---------- frame ----------
  function frame(ms) {
    const t = ms / 1000, dt = Math.min(0.1, t - last); last = t;
    T = curT();
    S_.floors.forEach(f => f.agents.forEach(a => stepAgent(f, a, dt, t)));
    render(t);
    requestAnimationFrame(frame);
  }

  function render(t) {
    const f = S_.floors[S_.cur]; if (!f) return;
    const N = nightness(T);
    g.clearRect(0, 0, W, H);
    f.windows.forEach(w => drawSky(g, w, T, t));
    g.drawImage(f.bg, 0, 0);
    // dynamic wall bits
    f.dyn.forEach(d => {
      if (d.t === 'leds') d.list.forEach(l => { const on = Math.sin(t * (3 + (l.ph % 3)) + l.ph) > -0.2; r(g, d.x + l.x, d.y + l.y, 2, 1, on ? (l.ph > 3 ? '#ffb454' : '#5ad17a') : '#244a30'); });
      if (d.t === 'clock') {
        const dt = new Date(), hm = dt.getHours() % 12 + dt.getMinutes() / 60, mn = dt.getMinutes() + dt.getSeconds() / 60;
        const ang = (v, n) => v / n * Math.PI * 2 - Math.PI / 2;
        const hand = (a, l, c) => { for (let i = 0; i <= l; i++) r(g, Math.round(d.x + Math.cos(a) * i), Math.round(d.y + Math.sin(a) * i), 1, 1, c); };
        hand(ang(hm, 12), 3, '#2a2540'); hand(ang(mn, 60), 4, '#2a2540'); r(g, d.x, d.y, 1, 1, '#e0566b');
      }
      if (d.t === 'steam') { for (let i = 0; i < 3; i++) { const p = (t * 0.6 + i / 3) % 1; g.globalAlpha = 0.5 * (1 - p); r(g, Math.round(d.x - 1 + Math.sin(t * 2 + i * 2) * 1.5), Math.round(d.y - p * 12), 2, 2, '#fff'); } g.globalAlpha = 1; }
    });
    // sun shafts on the floor in daytime
    if (N < 0.5) {
      g.globalAlpha = 0.07 * (1 - N * 2);
      f.windows.forEach(w => { g.fillStyle = '#fff6d8'; g.beginPath(); g.moveTo(w.x + 4, WALL + 6); g.lineTo(w.x + w.w - 4, WALL + 6); g.lineTo(w.x + w.w + 40, 150); g.lineTo(w.x + 30, 150); g.closePath(); g.fill(); });
      g.globalAlpha = 1;
    }

    // ----- entities -----
    const ents = [];
    f.desks.forEach((desk, di) => {
      const ag = f.agents.find(a => a.desk === desk);
      const status = ag ? ag.d.status : 'offline';
      ents.push({ y: desk.y + 24, draw: g2 => {
        P.drawSpr(g2, S('desk' + (desk.seed % 4), () => F.desk(desk.seed % 4 + 1)), desk.x, desk.y);
        if (desk.seed % 2) P.drawSpr(g2, S('paper', F.paper), desk.x + 3, desk.y + 3);
        else P.drawSpr(g2, S('plantS', F.smallPlant), desk.x + 2, desk.y - 6);
        P.drawSpr(g2, S('mon', F.monitor), desk.x + 12, desk.y - 7);
        drawScreen(g2, desk.x + 14, desk.y - 5, ag ? status : 'offline', t, desk.seed);
        P.drawSpr(g2, S('kb', F.keyboard), desk.x + 16, desk.y + 9);
        P.drawSpr(g2, S('mug' + desk.seed % 3, () => F.mug(['#f4f1ff', '#ffd85a', '#ff9eb5'][desk.seed % 3])), desk.x + 36, desk.y + 4);
        if (ag && ag.d.status === 'blocked' && Math.floor(t * 3) % 2) r(g2, desk.x + 40, desk.y - 4, 3, 3, '#ff5d6c');   // alarm lamp
      } });
      const away = !ag || ag.d.status === 'offline' || ag.d.status === 'blocked';
      ents.push(chairFor(f, desk, away && !(ag && ag.d.status === 'blocked')));
    });
    // couch halves + table
    const cs = S('couch', () => F.couch(f.th.accent === '#ffb454' ? '#d08040' : f.th.accent === '#7bdcb5' ? '#3fa08a' : '#c0526a'));
    const cc = f.lounge.couch;
    ents.push({ y: cc.y + 1, draw: g2 => g2.drawImage(cs.c, 0, 0, cs.c.width, 14, cc.x - 1, cc.y - 1, cs.c.width, 14) });
    ents.push({ y: cc.y + 23, draw: g2 => g2.drawImage(cs.c, 0, 14, cs.c.width, cs.c.height - 14, cc.x - 1, cc.y + 13, cs.c.width, cs.c.height - 14) });
    ents.push({ y: f.lounge.table.y + 12, draw: g2 => P.drawSpr(g2, S('table', F.table), f.lounge.table.x, f.lounge.table.y) });
    ents.push({ y: 212, draw: g2 => { P.drawSpr(g2, S('plantL', () => F.plant()), 336, 176); P.drawSpr(g2, S('lamp', F.lamp), 8, 164); P.drawSpr(g2, S('trash', F.trash), 318, 200); } });

    f.agents.forEach(a => {
      if (a.d.status === 'offline') return;
      const spr = agentSprite(a, t), bob = a.mode === 'stand' && !a.walking ? (Math.floor(t * 1.4 + a.seed) % 2) * 0 : 0;
      const sortY = a.mode === 'sit' ? a.desk.y + 35 : a.mode === 'couch' ? cc.y + 5 : a.y;
      const yy = a.y + bob, isSel = S_.sel === a, isHov = S_.hover === a;
      const bx = Math.round(a.x - spr.ax), by = Math.round(yy - spr.ay);
      a.box = { x0: bx + 1, y0: by + 1, x1: bx + spr.c.width - 1, y1: by + spr.c.height - 1 };
      ents.push({ y: sortY, draw: g2 => {
        if (a.mode !== 'sit' && a.mode !== 'couch') { g2.globalAlpha = 0.28; r(g2, Math.round(a.x) - 5, Math.round(a.y) - 2, 11, 3, '#000'); g2.globalAlpha = 1; }
        if (isSel || isHov) { const col = isSel ? '#ffd84a' : '#ffffff'; g2.globalAlpha = 0.9; r(g2, Math.round(a.x) - 7, Math.round(a.y) - 1, 15, 1, col); r(g2, Math.round(a.x) - 5, Math.round(a.y), 11, 1, col); g2.globalAlpha = 1; }
        g2.drawImage(spr.c, bx, by);
      } });
    });
    ents.sort((u, v) => u.y - v.y).forEach(e => e.draw(g));

    // ----- particles & bubbles -----
    f.agents.forEach(a => {
      const st = a.d.status; if (st === 'offline' || !a.box) return;
      const cx = Math.round(a.x);
      if (st === 'working' && a.mode === 'sit' && Math.random() < 0.06) emit(a.desk.x + 14 + Math.random() * 16, a.desk.y - 8, (Math.random() - .5) * 4, -10 - Math.random() * 6, 1.2, ['#5ad17a', '#6ad3ff', '#ffd85a'][Math.floor(Math.random() * 3)], 1);
      if (st === 'blocked' && Math.random() < 0.08) emit(cx + (Math.random() - .5) * 10, a.box.y0 + 2, (Math.random() - .5) * 8, -14, 0.8, '#ff5d6c', 2);
      if (st === 'done' && a.mode === 'couch' && Math.random() < 0.04) emit(cx - 6 + Math.random() * 12, a.box.y0 + 2, 0, -8, 1.3, '#bfe0ff', 1);
      if (a.mode === 'stand' && f.pois.length && a.target.poi && a.target.poi.kind === 'coffee' && Math.random() < 0.02) emit(cx + 6, a.box.y0 + 8, 0, -6, 1, '#fff', 1);
      // status bubble
      const bw = 11, bh = 9, bx = cx - 5, by = a.box.y0 - bh - 3 + (a.mode === 'sit' ? 0 : 0);
      let gl = null, col = null;
      if (st === 'blocked') { gl = '!'; col = '#e0344b'; } else if (st === 'done') { gl = 'v'; col = '#3a7fe0'; }
      else if (st === 'idle' && !a.walking) { gl = 'z'; col = '#6a6688'; }
      else if (st === 'working') { gl = 'dots'; col = '#3aa85a'; }
      if (gl && !a.walking) {
        const bob = Math.round(Math.sin(t * 3 + a.seed) * 1);
        P.bubble(g, bx, by + bob, bw, bh);
        if (gl === 'dots') { const k = Math.floor(t * 4 + a.seed) % 4; for (let i = 0; i < 3; i++) r(g, bx + 2 + i * 3, by + bob + 4 - (k === i ? 1 : 0), 2, 2, col); }
        else if (gl === 'v') P.glyph(g, 'v', bx + 3, by + bob + 2, col);
        else P.glyph(g, gl, bx + (gl === '!' ? 4 : 4), by + bob + 2, col);
      }
      if (S_.sel === a) { const aw = Math.round(Math.sin(t * 6) * 1); r(g, cx - 1, a.box.y0 - 15 + aw - (gl ? 0 : -9), 3, 1, '#ffd84a'); r(g, cx, a.box.y0 - 14 + aw - (gl ? 0 : -9), 1, 1, '#ffd84a'); }
    });
    S_.parts = S_.parts.filter(p => (p.life -= 1 / 60) > 0);
    S_.parts.forEach(p => { p.x += p.vx / 60; p.y += p.vy / 60; g.globalAlpha = Math.max(0, p.life / p.max); r(g, Math.round(p.x), Math.round(p.y), p.size, p.size, p.col); });
    g.globalAlpha = 1;

    lighting(f, t, N);
    drawElevator(t);
  }

  function agentSprite(a, t) {
    const L = a.look, st = a.d.status, fr = Math.floor(t * 8);
    if (a.walking) {
      if (a.dir === 'up') return P.charSprite(L, 'walkB', fr);
      if (a.dir === 'down') return P.charSprite(L, 'walkF', fr);
      return P.charSprite(L, a.dir === 'left' ? 'walkL' : 'walkR', fr);
    }
    if (a.mode === 'sit') return P.charSprite(L, 'sitBack', Math.floor(t * 9 + a.seed) % 2);
    if (a.mode === 'panic') return P.charSprite(L, 'panic', Math.floor(t * 3 + a.seed) % 2);
    if (a.mode === 'couch') return P.charSprite(L, 'mug', ((t * 0.45 + a.seed) % 4) < 0.7 ? 1 : 0, { blink: ((t + a.seed) % 4) < 0.15 ? 1 : 0 });
    if (a.target && a.target.face === 'back' && a.mode === 'stand') return P.charSprite(L, 'back', 0);
    return P.charSprite(L, 'front', 0, { blink: ((t + a.seed) % 3.6) < 0.14 ? 1 : 0 });
  }

  // ---------- lighting ----------
  function lighting(f, t, N) {
    const A = 0.04 + 0.58 * N;
    lmg.globalCompositeOperation = 'source-over'; lmg.clearRect(0, 0, W, H);
    lmg.fillStyle = `rgba(${Math.round(14 + 20 * (1 - N))},${Math.round(14 + 16 * (1 - N))},${Math.round(44 + 10 * (1 - N))},${A})`;
    lmg.fillRect(0, 0, W, H);
    lmg.globalCompositeOperation = 'destination-out';
    const pool = (x, y, rad, a) => { const gr = lmg.createRadialGradient(x, y, 2, x, y, rad); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); lmg.fillStyle = gr; lmg.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
    [[70, 100], [180, 100], [290, 100], [70, 160], [180, 160], [290, 160], [100, 198], [330, 190]].forEach(([x, y]) => pool(x, y, 78, 0.85));
    pool(14, 176, 40, 0.8);                                  // floor lamp
    f.desks.forEach(d => { const ag = f.agents.find(a => a.desk === d); if (ag && ag.d.status !== 'offline') pool(d.x + 22, d.y + 4, 34, 0.9); });
    f.windows.forEach(w => pool(w.x + w.w / 2, 30, 60, 0.6 * N));
    g.drawImage(LM, 0, 0);
    // additive monitor glows
    g.globalCompositeOperation = 'lighter';
    f.desks.forEach(d => {
      const ag = f.agents.find(a => a.desk === d); if (!ag) return;
      const col = { working: '90,209,122', blocked: '255,93,108', done: '106,176,255', idle: '140,134,232' }[ag.d.status]; if (!col) return;
      const pulse = ag.d.status === 'blocked' ? 0.55 + 0.45 * Math.sin(t * 6) : 1, base = 0.1 + 0.2 * N;
      const gr = g.createRadialGradient(d.x + 22, d.y + 6, 1, d.x + 22, d.y + 6, 36);
      gr.addColorStop(0, `rgba(${col},${base * pulse})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(d.x - 14, d.y - 30, 80, 80);
    });
    g.globalCompositeOperation = 'source-over';
    // vignette
    const v = g.createRadialGradient(W / 2, H / 2, 90, W / 2, H / 2, 260); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  // ---------- elevator transition ----------
  function drawElevator(t) {
    const tr = S_.trans; if (!tr) return;
    const e = (performance.now() - tr.t0) / 1000;
    let p;
    if (e < 0.35) p = e / 0.35; else if (e < 0.6) { p = 1; if (!tr.swapped) { S_.cur = tr.to; tr.swapped = true; S_.afterSwap && S_.afterSwap(); } } else if (e < 0.95) p = 1 - (e - 0.6) / 0.35; else { S_.trans = null; return; }
    p = p * p * (3 - 2 * p);
    const w = Math.round(W / 2 * p);
    [[0, w], [W - w, w]].forEach(([x, ww], i) => {
      r(g, x, 0, ww, H, '#aab0c8'); r(g, x, 0, ww, H, 'rgba(255,255,255,.08)');
      for (let y = 0; y < H; y += 6) r(g, x, y, ww, 1, 'rgba(0,0,0,.08)');
      r(g, i ? x : x + ww - 1, 0, 1, H, '#5a6088'); r(g, i ? x + 1 : x + ww - 2, 0, 1, H, '#e8ebf8');
    });
    if (p > 0.85) { const id = S_.floors[tr.to].data.id; r(g, W / 2 - 18, 8, 36, 16, '#0b0d18'); g.fillStyle = '#ffd84a'; g.font = '8px "Press Start 2P", monospace'; g.textBaseline = 'top'; g.textAlign = 'center'; g.fillText(id, W / 2, 12); }
  }

  // ---------- public API ----------
  const Office = (window.Office = {
    W, H,
    init(canvas, data, opts = {}) {
      cv = canvas; g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      S_.floors = data.floors.map(buildFloor); S_.showDemo = opts.showDemo !== false;
      S_.floors.forEach(f => layoutAgents(f));
      requestAnimationFrame(frame);
    },
    state: S_,
    floors: () => S_.floors,
    current: () => S_.cur,
    setFloor(i, instant) {
      if (i === S_.cur || S_.trans) return;
      if (instant) { S_.cur = i; return; }
      S_.trans = { to: i, t0: performance.now(), swapped: false };
    },
    onSwap(fn) { S_.afterSwap = fn; },
    setTod(m) { S_.tod = m; },
    setDemo(v) { S_.showDemo = v; S_.floors.forEach(f => layoutAgents(f)); if (S_.sel && !S_.floors[S_.cur].agents.includes(S_.sel)) S_.sel = null; },
    time: () => T,
    agentAt(px, py) {
      const f = S_.floors[S_.cur]; if (!f) return null; let best = null, bd = 1e9;
      f.agents.forEach(a => { if (!a.box || a.d.status === 'offline') return; const b = a.box; if (px >= b.x0 - 2 && px <= b.x1 + 2 && py >= b.y0 - 2 && py <= b.y1 + 2) { const d = Math.abs(a.y - py); if (d < bd) { bd = d; best = a; } } });
      if (!best) f.desks.forEach(dk => { const a = f.agents.find(x => x.desk === dk); if (a && px >= dk.x && px <= dk.x + 44 && py >= dk.y - 7 && py <= dk.y + 24) best = best || a; });
      return best;
    },
    select(a) { S_.sel = a; }, hover(a) { S_.hover = a; },
    selected: () => S_.sel,
    agentsOf: i => S_.floors[i].agents,
    labelPos(a) { return a.box ? { x: a.x, y: a.box.y0 } : { x: a.desk ? a.desk.x + 22 : a.x, y: a.desk ? a.desk.y - 8 : a.y - 20 }; },
  });
})();
