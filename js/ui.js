/* HUD: header, building / agent panels, tooltip, name tags and input. */
(function () {
  'use strict';
  const P = window.PO, O = window.Office, ST = P.STATUS_COLOR;
  const $ = id => document.getElementById(id);
  const LABEL = { working: '작업 중', blocked: '막힘', done: '완료', idle: '대기', offline: '오프라인' };
  const ORDER = ['working', 'blocked', 'done', 'idle', 'offline'];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const cv = $('c'), vp = $('vp'), tags = $('tags'), tip = $('tip');
  const data = window.OFFICE_DATA;
  let showDemo = true, scale = 2;
  const tagEls = new Map();

  O.init(cv, data, { showDemo });

  // ---------- integer scaling ----------
  function fit() {
    const dpr = window.devicePixelRatio || 1, avail = $('view').clientWidth;
    const k = Math.max(1, Math.floor(avail * dpr / O.W));
    scale = k >= 2 ? k / dpr : avail / O.W;   // phones: fill the width instead of a tiny 1x canvas
    vp.classList.toggle('compact', scale < 1.6);
    vp.style.width = O.W * scale + 'px'; vp.style.height = O.H * scale + 'px';
  }
  addEventListener('resize', fit); fit();

  // ---------- helpers ----------
  function rel(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '-';
    if (s < 90) return '방금'; if (s < 3600) return Math.round(s / 60) + '분 전';
    if (s < 86400) return Math.round(s / 3600) + '시간 전'; return Math.round(s / 86400) + '일 전';
  }
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  const visible = i => O.agentsOf(i);

  function avatar(a) {
    const s = P.charSprite(a.look, 'front', 0), c = document.createElement('canvas');
    c.width = s.c.width; c.height = s.c.height; c.getContext('2d').drawImage(s.c, 0, 0);
    const w = el('div', 'av'); w.append(c); return w;
  }
  function chip(st) { const c = el('span', 'chip', LABEL[st]); c.style.background = ST[st]; return c; }

  // ---------- panels ----------
  function renderSummary() {
    const cnt = {}; O.floors().forEach((f, i) => visible(i).forEach(a => cnt[a.d.status] = (cnt[a.d.status] || 0) + 1));
    const s = $('sum'); s.textContent = '';
    ORDER.forEach(k => {
      if (!cnt[k]) return;
      const sp = el('span'); const d = el('i', 'd'); d.style.background = ST[k]; sp.append(d, document.createTextNode(LABEL[k] + ' '), el('b', '', cnt[k]));
      s.append(sp);
    });
  }
  function renderBuilding() {
    const ul = $('bld'); ul.textContent = '';
    const fl = O.floors(), nav = $('elev'); nav.textContent = '';
    fl.map((_, i) => i).reverse().forEach(i => {
      const f = fl[i], li = el('li'), b = el('button', i === O.current() ? 'cur' : '');
      b.type = 'button'; b.setAttribute('aria-label', `${f.data.id} ${f.data.name}`);
      const pips = el('span', 'pips');
      visible(i).forEach(a => { const p = el('i'); p.style.background = ST[a.d.status]; pips.append(p); });
      b.append(el('span', 'id', f.data.id), el('span', 'nm', f.data.name), pips);
      b.onclick = () => go(i);
      li.append(b); ul.append(li);
      const eb = el('button', i === O.current() ? 'cur' : ''); eb.type = 'button'; eb.title = f.data.name; eb.setAttribute('aria-label', `${f.data.id} ${f.data.name}`);
      const ep = el('span', 'pips'); visible(i).forEach(a => { const p = el('i'); p.style.background = ST[a.d.status]; ep.append(p); });
      eb.append(el('span', '', f.data.id), ep); eb.onclick = () => go(i); nav.append(eb);
    });
  }
  function renderAgents() {
    const i = O.current(), f = O.floors()[i];
    const h = $('agT'); h.textContent = `AGENTS · ${f.data.id}`; h.append(el('span', '', f.data.name));
    const ul = $('agents'); ul.textContent = '';
    visible(i).forEach(a => {
      const li = el('li'), b = el('button', 'card' + (O.selected() === a ? ' sel' : '')); b.type = 'button';
      const tx = el('div', 'tx'), ti = el('span', 'ti', a.d.title);
      if (a.d.demo) ti.append(el('span', 'sample', 'SAMPLE'));
      const ro = el('div', 'ro'); ro.append(chip(a.d.status), el('span', '', a.d.role || ''));
      const bar = el('div', 'bar'), fill = el('i'); fill.style.width = Math.min(100, (a.d.tokens.used / a.d.tokens.max) * 100) + '%'; bar.append(fill);
      tx.append(ti, ro, bar); b.append(avatar(a), tx);
      b.onclick = () => pick(O.selected() === a ? null : a);
      li.append(b); ul.append(li);
    });
    if (!visible(i).length) ul.append(el('li', 'ro', '이 층에는 에이전트가 없어요.'));
  }
  function renderDetail() {
    const a = O.selected(), d = $('detail');
    if (!a) { d.hidden = true; return; }
    d.hidden = false; d.textContent = '';
    const x = el('button', 'x', 'X'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.onclick = () => pick(null);
    const h = el('h3', '', a.d.title); if (a.d.demo) h.append(el('span', 'sample', 'SAMPLE'));
    const top = el('div', 'ro'); top.append(chip(a.d.status), el('span', '', a.d.role || ''));
    const dl = el('dl');
    const row = (k, v) => { dl.append(el('dt', '', k), el('dd', '', v)); };
    row('모델', a.d.model); row('브랜치', a.d.branch || '-');
    row('컨텍스트', `${fmt(a.d.tokens.used)} / ${fmt(a.d.tokens.max)} (${Math.round(a.d.tokens.used / a.d.tokens.max * 100)}%)`);
    row('비용', '$' + a.d.cost.toFixed(2)); row('업데이트', rel(a.d.updated));
    d.append(x, el('h2', '', 'DETAIL'), h, top, el('p', 'sm', a.d.summary), dl);
    if (!a.d.demo && /^session_/.test(a.d.id)) {
      const l = el('a', '', '세션 열기'); l.href = 'https://claude.ai/code/' + a.d.id; l.target = '_blank'; l.rel = 'noopener noreferrer'; d.append(l);
    }
  }
  function renderAll() { renderSummary(); renderBuilding(); renderAgents(); renderDetail(); syncTags(true); }

  function go(i) { if (i < 0 || i >= O.floors().length) return; O.setFloor(i); pick(null); }
  function pick(a) { O.select(a); renderAgents(); renderDetail(); syncTags(false); }
  O.onSwap(() => { O.select(null); renderAll(); });

  // ---------- name tags ----------
  function syncTags(rebuild) {
    const f = O.floors()[O.current()], ids = new Set(f.agents.map(a => a.d.id));
    if (rebuild) { tags.textContent = ''; tagEls.clear(); }
    tagEls.forEach((e, id) => { if (!ids.has(id)) { e.remove(); tagEls.delete(id); } });
    f.agents.forEach(a => {
      let e = tagEls.get(a.d.id);
      if (!e) { e = el('div', 'tag'); const i = el('i'), s = el('span'); e.append(i, s); tags.append(e); tagEls.set(a.d.id, e); }
      e.className = 'tag' + (O.selected() === a ? ' sel' : '') + (a.d.status === 'offline' ? ' off' : '');
      e.firstChild.style.background = ST[a.d.status];
      const t = e.children[1]; if (t.textContent !== a.d.title) t.textContent = a.d.title;
    });
  }
  function placeTags() {
    const f = O.floors()[O.current()];
    f.agents.forEach(a => {
      const e = tagEls.get(a.d.id); if (!e) return;
      let x, y;
      if (a.mode === 'sit' || a.d.status === 'offline') { x = a.desk.x + 22; y = a.desk.y - 22; }
      else if (a.mode === 'couch') { x = a.x; y = a.y + 6; } else { x = a.x; y = a.y + 3; }
      e.style.left = Math.round(x * scale) + 'px'; e.style.top = Math.round(y * scale) + 'px';
    });
  }

  // ---------- input ----------
  function logical(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale, px: ev.clientX - r.left, py: ev.clientY - r.top }; }
  cv.addEventListener('mousemove', ev => {
    const p = logical(ev), a = O.agentAt(p.x, p.y);
    O.hover(a); cv.style.cursor = a ? 'pointer' : 'default';
    if (!a) { tip.hidden = true; return; }
    tip.textContent = '';
    const b = el('b', '', a.d.title); const s = el('div', 'ro'); s.append(chip(a.d.status), el('span', '', a.d.role || ''));
    tip.append(b, s, el('p', '', a.d.summary));
    tip.hidden = false;
    const w = vp.clientWidth; tip.style.left = Math.min(w - 236, Math.max(4, p.px + 14)) + 'px'; tip.style.top = Math.max(4, p.py - tip.offsetHeight - 10) + 'px';
  });
  cv.addEventListener('mouseleave', () => { O.hover(null); tip.hidden = true; });
  cv.addEventListener('click', ev => { const p = logical(ev), a = O.agentAt(p.x, p.y); pick(a && O.selected() !== a ? a : null); });
  addEventListener('keydown', ev => {
    if (ev.target.closest && ev.target.closest('input,textarea')) return;
    const n = parseInt(ev.key, 10), cur = O.current(), len = O.floors().length;
    if (n >= 1 && n <= len) go(n - 1);
    else if (ev.key === 'ArrowUp') { go(Math.min(len - 1, cur + 1)); ev.preventDefault(); }
    else if (ev.key === 'ArrowDown') { go(Math.max(0, cur - 1)); ev.preventDefault(); }
    else if (ev.key === 'Escape') pick(null);
  });

  $('tod').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    [...$('tod').children].forEach(c => c.classList.toggle('on', c === b)); O.setTod(b.dataset.v);
  });
  $('demo').addEventListener('click', ev => {
    showDemo = !showDemo; ev.currentTarget.classList.toggle('on', showDemo); ev.currentTarget.setAttribute('aria-pressed', showDemo);
    O.setDemo(showDemo); renderAll();
  });

  // ---------- loop ----------
  function tick() {
    const t = O.time(), h = Math.floor(t), m = Math.floor((t - h) * 60);
    const s = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    if ($('clock').textContent !== s) $('clock').textContent = s;
    placeTags(); requestAnimationFrame(tick);
  }
  const gen = new Date(data.generatedAt);
  $('foot').textContent = `에이전트 데이터 기준: ${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-${String(gen.getDate()).padStart(2, '0')} · data.js 를 수정하면 층과 에이전트를 바꿀 수 있어요 · 폰트: Galmuri, Press Start 2P (OFL)`;
  renderAll(); tick();
})();
