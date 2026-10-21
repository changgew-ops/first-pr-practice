/* HUD + glue between the hook-up pipeline (js/hookup/core.js) and the office scene (js/scene.js). */
(function () {
  'use strict';
  const P = window.PO, O = window.Office, HU = window.HU, ST = P.STATUS_COLOR;
  const $ = id => document.getElementById(id);
  const LABEL = { working: '작업 중', blocked: '막힘', done: '완료', idle: '대기', offline: '오프라인' };
  const ORDER = ['working', 'blocked', 'done', 'idle', 'offline'];
  const RSTAT = { pass: ['통과', '#5ad17a'], unapplied: ['누락', '#ff5d6c'], violated: ['오류', '#ff9f43'], waived: ['면제', '#ffd84a'] };
  const DSTAT = { queued: ['설계 대기', '#6a6688'], designed: ['검수 대기', '#6ab0ff'], rework: ['재작업', '#ff5d6c'], pass: ['통과', '#5ad17a'], waived: ['예외 통과', '#ffd84a'] };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const cv = $('c'), vp = $('vp'), tags = $('tags'), tip = $('tip');
  const pipe = new HU.Pipeline();
  const sessionFloors = window.OFFICE_DATA.floors;
  let scale = 2, overview = false, speed = 1, selTag = null, announced = false;
  const tagEls = new Map(), log = [];

  const pipeFloors = () => HU.bridge.pipeFloors(pipe);

  O.init(cv, { floors: pipeFloors().concat(sessionFloors) }, { showDemo: true });

  // ---------- helpers ----------
  const fmtT = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  function addLog(kind, text) { log.unshift({ kind, text, t: pipe.clock }); if (log.length > 40) log.pop(); }
  function rel(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '-';
    if (s < 90) return '방금'; if (s < 3600) return Math.round(s / 60) + '분 전';
    if (s < 86400) return Math.round(s / 3600) + '시간 전'; return Math.round(s / 86400) + '일 전';
  }
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  const agentsOf = i => O.agentsOf(i);
  const chipEl = (text, col) => { const c = el('span', 'chip', text); c.style.background = col; return c; };
  const chip = st => chipEl(LABEL[st], ST[st]);
  function avatar(a) {
    const s = P.charSprite(a.look, 'front', 0), c = document.createElement('canvas');
    c.width = s.c.width; c.height = s.c.height; c.getContext('2d').drawImage(s.c, 0, 0);
    const w = el('div', 'av'); w.append(c); return w;
  }
  function barOf(a) { const b = a.d.bar || { value: a.d.tokens ? a.d.tokens.used : 0, max: a.d.tokens ? a.d.tokens.max : 1 }; return Math.min(100, b.value / b.max * 100); }

  // ---------- integer scaling ----------
  function fit() {
    const dpr = window.devicePixelRatio || 1, avail = $('view').clientWidth, sz = O.size();
    const k = Math.floor(avail * dpr / sz.w);
    scale = k >= (overview ? 1 : 2) ? k / dpr : avail / sz.w;
    vp.classList.toggle('compact', scale < 1.6 && !overview);
    vp.style.width = sz.w * scale + 'px'; vp.style.height = sz.h * scale + 'px';
  }
  addEventListener('resize', fit); fit();

  // ---------- header / flow strip / alert ----------
  function renderSummary() {
    const cnt = {}; O.floors().forEach((f, i) => agentsOf(i).forEach(a => { cnt[a.d.status] = (cnt[a.d.status] || 0) + 1; }));
    const s = $('sum'); s.textContent = '';
    ORDER.forEach(k => {
      if (!cnt[k]) return;
      const sp = el('span'), d = el('i', 'd'); d.style.background = ST[k]; sp.append(d, document.createTextNode(LABEL[k] + ' '), el('b', '', cnt[k])); s.append(sp);
    });
  }
  function renderFlow() {
    const ol = $('flow'); ol.textContent = '';
    HU.STAGES.forEach((s, i) => {
      if (i) { const ar = el('li', 'ar', '▶'); ar.setAttribute('aria-hidden', 'true'); ar.dataset.to = s.n; ol.append(ar); }
      const li = el('li'), b = el('button', 'st' + (O.current() === i && !overview ? ' cur' : '')); b.type = 'button';
      const pr = pipe.prog[s.n], busy = pipe.workers.filter(w => w.stage === s.n && w.job).length, q = pipe.queues[s.n].length;
      const rule = s.n === 3 ? el('span', 'rb on', '룰 적용') : s.n === 4 ? el('span', 'rb', '적용 검수') : el('span', 'rb off', '룰 없음');
      const bar = el('div', 'bar'), fill = el('i'); fill.style.width = (pr.total ? pr.done / pr.total * 100 : 0) + '%'; bar.append(fill);
      b.append(el('span', 'sid', s.id), el('b', '', s.name), rule, bar, el('span', 'cnt', `작업 ${busy} · 대기 ${q}`));
      b.onclick = () => go(i);
      li.append(b); ol.append(li);
    });
  }
  function renderAlert() {
    const box = $('alert'), bySys = {};
    pipe.escalations.forEach(j => { (bySys[j.sys] = bySys[j.sys] || []).push(j); });
    const ids = Object.keys(bySys); box.hidden = !ids.length; box.textContent = '';
    ids.forEach(sid => {
      const sys = pipe.systems[sid], jobs = bySys[sid], row = el('div', 'al');
      row.append(el('b', '', `⚠ 사람 확인 필요 · ${sid} ${sys.name}`),
        el('span', '', `${sys.pressure} barg → 요구 등급 ${sys.rating}# 이지만 부품 카탈로그 최대는 ${HU.CONFIG.catalogMaxRating}# 예요. 계기 ${jobs.map(j => j.tag).join(', ')} 설계가 보류 중이에요.`));
      const ok = el('button', 'btn go', '예외 승인'); ok.type = 'button';
      ok.onclick = () => { pipe.approve(jobs[0].id); P.audio.play('approve', 0); renderAll(); };
      const to = el('button', 'btn', '3F 보기'); to.type = 'button'; to.onclick = () => go(2);
      row.append(ok, to); box.append(row);
    });
  }

  // ---------- side panels ----------
  function renderBuilding() {
    const ul = $('bld'), nav = $('elev'); ul.textContent = ''; nav.textContent = '';
    const fl = O.floors();
    fl.map((_, i) => i).reverse().forEach(i => {
      const f = fl[i], li = el('li'), b = el('button', i === O.current() && !overview ? 'cur' : ''); b.type = 'button';
      b.setAttribute('aria-label', `${f.data.id} ${f.data.name}`);
      const pips = el('span', 'pips'); agentsOf(i).forEach(a => { const p = el('i'); p.style.background = ST[a.d.status]; pips.append(p); });
      b.append(el('span', 'id', f.data.id), el('span', 'nm', f.data.name), pips); b.onclick = () => go(i); li.append(b); ul.append(li);
      const eb = el('button', i === O.current() && !overview ? 'cur' : ''); eb.type = 'button'; eb.title = f.data.name; eb.dataset.floor = i;
      eb.setAttribute('aria-label', `${f.data.id} ${f.data.name}`);
      const ep = el('span', 'pips'); agentsOf(i).forEach(a => { const p = el('i'); p.style.background = ST[a.d.status]; ep.append(p); });
      eb.append(el('span', '', f.data.id), ep);
      const q = i < 4 ? pipe.queues[i + 1].length : 0; if (q) eb.append(el('em', 'badge', q));
      eb.onclick = () => go(i); nav.append(eb);
    });
  }
  function renderAgents() {
    const i = O.current(), f = O.floors()[i], h = $('agT');
    h.textContent = `AGENTS · ${f.data.id}`; h.append(el('span', '', f.data.name));
    const ul = $('agents'); ul.textContent = '';
    agentsOf(i).forEach(a => {
      const li = el('li'), b = el('button', 'card' + (O.selected() === a ? ' sel' : '')); b.type = 'button';
      const tx = el('div', 'tx'), ti = el('span', 'ti', a.d.title), ro = el('div', 'ro'); ro.append(chip(a.d.status), el('span', '', a.d.role || ''));
      const bar = el('div', 'bar'), fill = el('i'); fill.style.width = barOf(a) + '%'; bar.append(fill);
      const sm = el('div', 'sm1', a.d.summary);
      tx.append(ti, ro, sm, bar); b.append(avatar(a), tx); b.onclick = () => pick(O.selected() === a ? null : a); li.append(b); ul.append(li);
    });
  }
  function renderDetail() {
    const a = O.selected(), d = $('detail');
    if (!a) { d.hidden = true; return; }
    d.hidden = false; d.textContent = '';
    const x = el('button', 'x', 'X'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.onclick = () => pick(null);
    const top = el('div', 'ro'); top.append(chip(a.d.status), el('span', '', a.d.role || ''));
    const dl = el('dl'), row = (k, v) => dl.append(el('dt', '', k), el('dd', '', v));
    d.append(x, el('h2', '', 'DETAIL'), el('h3', '', a.d.title), top, el('p', 'sm', a.d.summary), dl);
    if (a.d.kind === 'worker') {
      const fd = O.floors()[O.current()].data;
      row('층', fd.id + ' ' + fd.name);
      if (a.d.systems) row('담당 시스템', a.d.systems);
      row('처리 건수', a.d.handled + '건');
      row('룰', a.d.stage === 3 ? '이 단계에서만 룰 적용' : a.d.stage === 4 ? '적용 여부만 검수' : '룰 없음');
      if (a.d.parked) {
        const w = pipe.workers.find(x => x.id === a.d.id), jobs = w ? w.parked : [];
        const ok = el('button', 'btn go', `예외 승인 (${a.d.parked.sys})`); ok.type = 'button';
        ok.onclick = () => { if (jobs[0]) pipe.approve(jobs[0].id); P.audio.play('approve', 0); renderAll(); };
        d.append(ok);
      }
    } else {
      row('모델', a.d.model); row('브랜치', a.d.branch || '-');
      row('컨텍스트', `${fmt(a.d.tokens.used)} / ${fmt(a.d.tokens.max)} (${Math.round(a.d.tokens.used / a.d.tokens.max * 100)}%)`);
      row('비용', '$' + a.d.cost.toFixed(2)); row('업데이트', rel(a.d.updated));
      if (/^session_/.test(a.d.id)) { const l = el('a', '', '세션 열기'); l.href = 'https://claude.ai/code/' + a.d.id; l.target = '_blank'; l.rel = 'noopener noreferrer'; d.append(l); }
    }
  }
  function renderRules() {
    const box = $('rules'); box.textContent = '';
    const rep = pipe.report();
    box.append(el('h2', '', 'RULE ENGINE'));
    const note = el('p', 'note'); note.append(document.createTextNode('룰은 '), el('b', '', '3F 배관 설계'), document.createTextNode('에서만 적용돼요. 4F는 적용 여부와 결과만 검수해요. '), el('span', 'sample', 'SAMPLE RULES'));
    box.append(note);
    const k = el('div', 'kpi');
    [['설계 완료', `${rep.resolved}/${rep.expected || '-'}`], ['재작업', rep.reworks], ['예외 승인', rep.waived], ['보류', rep.escalations.length]].forEach(([a, b]) => { const c = el('div'); c.append(el('small', '', a), el('b', '', b)); k.append(c); });
    box.append(k);
    const t = el('table'), hd = el('tr'); ['룰', '', '통과', '누락', '오류', '면제'].forEach(h => hd.append(el('th', '', h))); t.append(hd);
    rep.perRule.forEach(r => {
      const tr = el('tr'), rule = HU.RULES.find(x => x.id === r.id);
      const name = el('td', 'nm', r.title); name.title = rule.desc;
      tr.append(el('td', 'rid', r.id), name, el('td', '', r.pass), el('td', r.unapplied ? 'bad' : '', r.unapplied), el('td', r.violated ? 'bad2' : '', r.violated), el('td', r.waived ? 'wv' : '', r.waived));
      t.append(tr);
    });
    box.append(t);
    box.append(el('p', 'note dim', '누락·오류는 검수에서 1차로 반려된 횟수예요. 값은 규칙 표(js/hookup/core.js)에서 바꿀 수 있어요.'));
  }
  function renderDrawing() {
    const box = $('drawing'); box.textContent = '';
    box.append(el('h2', '', 'HOOK-UP DRAWING'));
    const recs = Object.values(pipe.designs).sort((a, b) => a.inst.tag.localeCompare(b.inst.tag));
    if (!recs.length) { box.append(el('p', 'note dim', '실행하면 계기 객체가 만들어지고, 설계가 끝난 순서대로 도면을 볼 수 있어요.')); return; }
    if (!selTag || !pipe.designs[selTag]) selTag = (recs.find(r => r.status === 'rework') || recs.find(r => r.design) || recs[0]).inst.tag;
    const chips = el('div', 'chips');
    recs.forEach(r => {
      const b = el('button', 'tg' + (r.inst.tag === selTag ? ' sel' : ''), r.inst.tag); b.type = 'button'; b.style.setProperty('--c', DSTAT[r.status][1]); b.title = DSTAT[r.status][0];
      b.onclick = () => { selTag = r.inst.tag; renderDrawing(); }; chips.append(b);
    });
    box.append(chips);
    const rec = pipe.designs[selTag], sys = pipe.systems[rec.inst.system];
    const head = el('div', 'dh'); head.append(el('b', '', rec.inst.tag), el('span', '', `${HU.KIND_LABEL[rec.inst.kind]} · ${rec.inst.system} ${sys.name} (${sys.rating}#)`), chipEl(DSTAT[rec.status][0], DSTAT[rec.status][1]));
    box.append(head);
    if (!rec.design) { box.append(el('p', 'note dim', '아직 설계 전이에요.')); return; }
    const wrap = el('div', 'dg'); wrap.append(HU.diagram(rec, sys)); box.append(wrap);
    if (rec.design.notes.length) box.append(el('p', 'note', rec.design.notes.join(' · ')));
    if (rec.results) {
      const t = el('table'); rec.results.forEach(r => {
        const tr = el('tr'), s = RSTAT[r.status], td = el('td'); td.append(chipEl(s[0], s[1]));
        tr.append(el('td', 'rid', r.id), el('td', 'nm', r.title), td, el('td', 'dim', r.msg)); t.append(tr);
      }); box.append(t);
    }
    const hist = el('ol', 'hist'); rec.history.forEach(h => hist.append(el('li', '', `${fmtT(h.t)} ${h.what}`))); box.append(hist);
  }
  function renderLog() {
    const ul = $('log'); ul.textContent = '';
    if (!log.length) { ul.append(el('li', 'dim', '아직 이벤트가 없어요.')); return; }
    log.slice(0, 12).forEach(l => { const li = el('li', l.kind); li.append(el('time', '', fmtT(l.t)), document.createTextNode(l.text)); ul.append(li); });
  }
  function renderAll() { renderSummary(); renderFlow(); renderAlert(); renderBuilding(); renderAgents(); renderDetail(); renderRules(); renderDrawing(); renderLog(); syncTags(true); runBtn(); }

  function go(i) {
    if (i < 0 || i >= O.floors().length) return;
    if (overview) { setOverview(false); O.setFloor(i, true); pick(null); renderAll(); return; }
    if (i === O.current()) return;
    P.audio.play('floor', 0); O.setFloor(i); pick(null);
  }
  function pick(a) { O.select(a); renderAgents(); renderDetail(); syncTags(false); }
  O.onSwap(() => { O.select(null); renderAll(); });

  // ---------- name tags / floor labels ----------
  function syncTags(rebuild) {
    if (overview) {
      tags.textContent = ''; tagEls.clear();
      O.floors().forEach((f, i) => {
        const cols = O.state.cols, e = el('div', 'tag fl'); e.append(el('span', '', `${f.data.id} ${f.data.name}`));
        e.style.left = Math.round(((i % cols) * O.W + 6) * scale) + 'px'; e.style.top = Math.round((Math.floor(i / cols) * O.H + 14) * scale) + 'px'; e.style.transform = 'none'; tags.append(e);
      });
      return;
    }
    const f = O.floors()[O.current()], ids = new Set(f.agents.map(a => a.d.id));
    if (rebuild) { tags.textContent = ''; tagEls.clear(); }
    tagEls.forEach((e, id) => { if (!ids.has(id)) { e.remove(); tagEls.delete(id); } });
    f.agents.forEach(a => {
      let e = tagEls.get(a.d.id);
      if (!e) { e = el('div', 'tag'); e.append(el('i'), el('span')); tags.append(e); tagEls.set(a.d.id, e); }
      e.className = 'tag' + (O.selected() === a ? ' sel' : '') + (a.d.status === 'offline' ? ' off' : '');
      e.firstChild.style.background = ST[a.d.status];
      const t = e.children[1]; if (t.textContent !== a.d.title) t.textContent = a.d.title;
    });
  }
  function placeTags() {
    if (overview) return;
    O.floors()[O.current()].agents.forEach(a => {
      const e = tagEls.get(a.d.id); if (!e) return;
      let x, y;
      if (a.mode === 'sit' || a.d.status === 'offline') { x = a.desk.x + 22; y = a.desk.y - 22; }
      else if (a.mode === 'couch') { x = a.x; y = a.y + 6; } else { x = a.x; y = a.y + 3; }
      e.style.left = Math.round(x * scale) + 'px'; e.style.top = Math.round(y * scale) + 'px';
    });
  }

  // ---------- pipeline events ----------
  function flash(floorIdx) { const b = document.querySelector(`#elev button[data-floor="${floorIdx}"]`); if (b) { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 800); } }
  function pulse(stage) { const ar = document.querySelector(`#flow .ar[data-to="${stage}"]`); if (ar) { ar.classList.add('pulse'); setTimeout(() => ar.classList.remove('pulse'), 700); } }
  pipe.on('handoff', (from, to, job, w) => {
    if (!w) return;
    addLog(to < from ? 'bad' : '', `${HU.STAGES[from - 1].id} ${w.name} → ${HU.STAGES[to - 1].id}: ${job.label}`);
    O.fly(from - 1, w.id); flash(to - 1); pulse(to); P.audio.play('ding', 120);
  });
  pipe.on('reject', (w, job, bad) => { addLog('bad', `4F ${w.name}: ${job.tag} 반려 (${bad.map(b => b.id).join(', ')})`); P.audio.play('reject', 150); });
  pipe.on('escalate', (w, job) => { addLog('alert', `3F ${w.name}: ${job.tag} 사람 확인 필요 (${job.sys} 등급 ${pipe.systems[job.sys].rating}#)`); P.audio.play('alert', 300); });
  pipe.on('approve', (w, job) => addLog('ok', `사람이 ${job.tag} 예외 승인`));
  pipe.on('report', rep => addLog('ok', `리포트: 통과 ${rep.finalPass} · 예외 ${rep.waived} · 재작업 ${rep.reworks}회`));
  pipe.on('reset', () => { log.length = 0; announced = false; selTag = null; });

  // ---------- controls ----------
  function runBtn() {
    const b = $('run');
    b.textContent = pipe.finished ? '↺ 다시 실행' : pipe.state === 'running' ? '⏸ 일시정지' : pipe.state === 'paused' ? '▶ 계속' : '▶ 실행';
    b.classList.toggle('go', pipe.state !== 'running');
  }
  function toggleRun() {
    if (pipe.finished) { pipe.reset(); pipe.start(); }
    else if (pipe.state === 'ready') pipe.start(); else if (pipe.state === 'running') pipe.pause(); else pipe.resume();
    renderAll();
  }
  $('run').onclick = toggleRun;
  $('reset').onclick = () => { pipe.reset(); renderAll(); };
  $('spd').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; speed = +b.dataset.v; [...$('spd').children].forEach(c => c.classList.toggle('on', c === b)); });
  $('defect').onclick = ev => { const on = HU.CONFIG.defectRate === 0; HU.CONFIG.defectRate = on ? 0.10 : 0; ev.currentTarget.classList.toggle('on', on); ev.currentTarget.textContent = on ? '결함 주입 ON' : '결함 주입 OFF'; ev.currentTarget.setAttribute('aria-pressed', on); };
  $('snd').onclick = ev => { const on = !P.audio.on; P.audio.set(on); ev.currentTarget.classList.toggle('on', on); ev.currentTarget.textContent = on ? '소리 ON' : '소리 OFF'; ev.currentTarget.setAttribute('aria-pressed', on); };
  function setOverview(v) {
    overview = v; O.setOverview(v); vp.classList.toggle('ov', v); $('ov').classList.toggle('on', v); fit(); syncTags(true); renderFlow(); renderBuilding();
  }
  $('ov').onclick = () => setOverview(!overview);
  $('tod').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; [...$('tod').children].forEach(c => c.classList.toggle('on', c === b)); O.setTod(b.dataset.v); });

  // ---------- input ----------
  function logical(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale, px: ev.clientX - r.left, py: ev.clientY - r.top }; }
  cv.addEventListener('mousemove', ev => {
    const p = logical(ev);
    if (overview) { cv.style.cursor = O.cellAt(p.x, p.y) >= 0 ? 'pointer' : 'default'; return; }
    const a = O.agentAt(p.x, p.y);
    O.hover(a); cv.style.cursor = a ? 'pointer' : 'default';
    if (!a) { tip.hidden = true; return; }
    tip.textContent = '';
    const s = el('div', 'ro'); s.append(chip(a.d.status), el('span', '', a.d.role || ''));
    tip.append(el('b', '', a.d.title), s, el('p', '', a.d.summary)); tip.hidden = false;
    const w = vp.clientWidth; tip.style.left = Math.min(w - 236, Math.max(4, p.px + 14)) + 'px'; tip.style.top = Math.max(4, p.py - tip.offsetHeight - 10) + 'px';
  });
  cv.addEventListener('mouseleave', () => { O.hover(null); tip.hidden = true; });
  cv.addEventListener('click', ev => {
    const p = logical(ev);
    if (overview) { const i = O.cellAt(p.x, p.y); if (i >= 0) go(i); return; }
    const a = O.agentAt(p.x, p.y); pick(a && O.selected() !== a ? a : null);
  });
  addEventListener('keydown', ev => {
    if (ev.target.closest && ev.target.closest('input,textarea')) return;
    const n = parseInt(ev.key, 10), cur = O.current(), len = O.floors().length;
    if (n >= 1 && n <= len) go(n - 1);
    else if (ev.key === 'ArrowUp') { go(Math.min(len - 1, cur + 1)); ev.preventDefault(); }
    else if (ev.key === 'ArrowDown') { go(Math.max(0, cur - 1)); ev.preventDefault(); }
    else if (ev.key === 'Escape') pick(null);
    else if (ev.key === 'o' || ev.key === 'O') setOverview(!overview);
    else if (ev.key === ' ' && !(ev.target.closest && ev.target.closest('button'))) { toggleRun(); ev.preventDefault(); }
  });

  // ---------- main loop ----------
  let lastT = performance.now(), sig = '', syncAcc = 0;
  function signature() {
    const a = O.selected();
    return [pipe.state, pipe.clock | 0, pipe.workers.map(w => pipe.statusOf(w) + (w.job ? w.job.id : '') + w.handled).join(','), Object.values(pipe.queues).map(q => q.length).join(''),
      pipe.reworks, pipe.escalations.length, O.current(), overview, a ? a.d.status + a.d.summary : '', selTag, log.length].join('|');
  }
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    pipe.tick(dt * speed);
    syncAcc += dt; if (syncAcc > 0.15) { syncAcc = 0; O.sync(pipeFloors()); }
    if (P.audio.on && pipe.state === 'running' && !overview && agentsOf(O.current()).some(a => a.d.status === 'working') && Math.random() < 0.06) P.audio.play('tick', 60);
    if (pipe.finished && !announced) { announced = true; addLog('ok', '파이프라인 완료'); P.audio.play('done', 0); }
    const s = signature(); if (s !== sig) { sig = s; renderAll(); }
    const t = O.time(), h = Math.floor(t), m = Math.floor((t - h) * 60), str = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    if ($('clock').textContent !== str) $('clock').textContent = str;
    placeTags(); requestAnimationFrame(tick);
  }
  const gen = new Date(window.OFFICE_DATA.generatedAt);
  $('foot').textContent = `5F 세션 기준: ${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-${String(gen.getDate()).padStart(2, '0')} · 훅업 파이프라인은 시뮬레이션이에요(js/hookup/core.js) · 폰트: Galmuri, Press Start 2P (OFL)`;
  renderAll();
  setTimeout(() => { if (pipe.state === 'ready') { pipe.start(); renderAll(); } }, 900);   // auto-start so the office is alive on load
  requestAnimationFrame(tick);
  window.__pipe = pipe;   // handy for poking around in the console
})();
