/* Scenario page: a narrated run of the hook-up pipeline for people who just want to watch.
 * Story beats (js/hookup/story.js) drive captions, short pauses and the camera. */
(function () {
  'use strict';
  const P = window.PO, O = window.Office, HU = window.HU, ST = P.STATUS_COLOR, SC = HU.SCENARIO;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LABEL = { working: '작업 중', blocked: '막힘', done: '완료', idle: '대기', offline: '오프라인' };
  const ORDER = ['working', 'blocked', 'done', 'idle'];
  const RSTAT = { pass: ['통과', '#5ad17a'], unapplied: ['누락', '#ff5d6c'], violated: ['오류', '#ff9f43'], waived: ['면제', '#ffd84a'] };
  const DSTAT = { queued: ['설계 대기', '#6a6688'], designed: ['검수 대기', '#6ab0ff'], rework: ['재작업', '#ff5d6c'], pass: ['통과', '#5ad17a'], waived: ['예외 통과', '#ffd84a'] };
  const PHASE = { steam: '스팀', liquid: '액체', gas: '기체' };
  const chipEl = (text, col) => { const c = el('span', 'chip', text); c.style.background = col; return c; };
  const clone = o => JSON.parse(JSON.stringify(o));

  const pipe = new HU.Pipeline();
  const cv = $('c'), vp = $('vp'), tags = $('tags');
  const tagEls = new Map();
  const beats = [], reached = new Set(), decisions = [], spots = { rework: null, waiverSys: null, waiver: null, tab: 'rework' };
  let started = false, userPaused = false, holdUntil = 0, speed = 1, cam = 'auto', overview = false, scale = 2;
  let wantFloor = null, lastSwitch = 0, lastBeatAt = 0, announced = false, approveAt = 0, capFull = '', capStart = 0, capShown = -1;

  O.init(cv, { floors: HU.bridge.pipeFloors(pipe) }, { showDemo: true });

  // ---------- fixed text ----------
  $('ttl').textContent = SC.title; $('lead').textContent = SC.lead;
  $('iTtl').textContent = SC.title; $('iLead').textContent = SC.lead;
  $('foot').textContent = `${SC.note} 폰트: Galmuri, Press Start 2P (OFL)`;

  // ---------- scaling ----------
  function fit() {
    const dpr = window.devicePixelRatio || 1, avail = $('view').clientWidth, sz = O.size(), k = Math.floor(avail * dpr / sz.w);
    scale = k >= (overview ? 1 : 2) ? k / dpr : avail / sz.w;
    vp.classList.toggle('compact', scale < 1.6 && !overview);
    vp.style.width = sz.w * scale + 'px'; vp.style.height = sz.h * scale + 'px';
    $('cap').style.width = vp.style.width; $('cap').style.maxWidth = '100%';
    const rc = document.querySelector('.runctl'); if (rc) rc.style.maxWidth = '100%';
  }
  addEventListener('resize', () => { fit(); syncTags(); });
  fit();

  // ---------- story -> captions, pauses, camera ----------
  function setHold(b) {
    const ms = Math.max(2800, Math.min(6200, 1800 + b.text.length * 75)) / speed, now = performance.now(), h = $('capHold');
    holdUntil = now + ms; h.style.transition = 'none'; h.style.width = '100%'; void h.offsetWidth; h.style.transition = `width ${ms}ms linear`; h.style.width = '0';
  }
  function showCaption(b) {
    const w = $('capWho'); w.textContent = b.who; w.classList.toggle('human', /사람/.test(b.who));
    capFull = b.text; capStart = performance.now(); capShown = -1;
  }
  function onBeat(b) {
    beats.unshift(b); if (beats.length > 60) beats.pop();
    reached.add(b.ch); lastBeatAt = performance.now();
    if (b.ch === 6) decisions.push(b);
    if (b.major) {
      showCaption(b); setHold(b);
      if (b.cam != null) wantFloor = b.cam;
      P.audio.play(/반려/.test(b.text) ? 'reject' : /사람/.test(b.who) ? 'approve' : b.ch === 6 ? 'alert' : 'ding', 0);
    }
  }
  HU.createStory(pipe, onBeat);

  pipe.on('handoff', (from, to, job, w) => { if (w) { O.fly(from - 1, w.id); flashChip(to - 1); P.audio.play('ding', 400); } });
  pipe.on('reject', (w, job) => {
    const rec = pipe.designs[job.tag];
    if (!spots.rework || (spots.rework.after && performance.now() - spots.rework.afterAt > 9000)) {
      spots.rework = { tag: job.tag, before: { design: clone(rec.design), results: clone(rec.results) }, after: null, afterAt: 0 }; spots.tab = 'rework';
    }
  });
  pipe.on('approve', (w, job) => { if (!spots.waiverSys) spots.waiverSys = job.sys; });
  pipe.on('reset', () => { beats.length = 0; reached.clear(); decisions.length = 0; spots.rework = null; spots.waiver = null; spots.waiverSys = null; spots.tab = 'rework'; });

  // ---------- camera ----------
  function flashChip(i) { const b = document.querySelector(`#elev button[data-floor="${i}"]`); if (b) { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 800); } }
  function autoFocus(now) {
    if (cam !== 'auto' || overview) return;
    if (wantFloor != null && O.current() !== wantFloor) { O.setFloor(wantFloor); lastSwitch = now; }
    else if (wantFloor != null) wantFloor = null;
    else if (now - Math.max(lastBeatAt, lastSwitch) > 5000 && started) {      // nothing special for a while: follow the busiest floor
      let best = O.current(), n = -1;
      O.floors().forEach((f, i) => { const c = O.agentsOf(i).filter(a => a.d.status === 'working').length; if (c > n || (c === n && i === O.current())) { n = c; best = i; } });
      if (best !== O.current() && n > 0) { O.setFloor(best); lastSwitch = now; }
    }
  }
  function setCam(v) {
    cam = v; [...$('cam').children].forEach(c => c.classList.toggle('on', c.dataset.v === v));
    const want = v === 'all'; if (want !== overview) setOverview(want);
  }
  function setOverview(v) { overview = v; O.setOverview(v); vp.classList.toggle('ov', v); fit(); syncTags(); sigDirty = true; }
  O.onSwap(() => { O.select(null); syncTags(); sigDirty = true; });

  // ---------- panels ----------
  let sigDirty = true;
  function renderSum() {
    const cnt = {}; O.floors().forEach((f, i) => O.agentsOf(i).forEach(a => { cnt[a.d.status] = (cnt[a.d.status] || 0) + 1; }));
    const s = $('sum'); s.textContent = '';
    ORDER.forEach(k => { if (!cnt[k]) return; const sp = el('span'), d = el('i', 'd'); d.style.background = ST[k]; sp.append(d, document.createTextNode(LABEL[k] + ' '), el('b', '', cnt[k])); s.append(sp); });
  }
  function renderChap() {
    const ol = $('chap'); ol.textContent = ''; const cur = reached.size ? Math.max(...reached) : 0;
    HU.CHAPTERS.forEach(c => { const li = el('li', reached.has(c.id) ? (c.id === cur ? 'now' : 'done') : '', c.title); ol.append(li); });
  }
  function renderElev() {
    const nav = $('elev'); nav.textContent = '';
    O.floors().map((_, i) => i).reverse().forEach(i => {
      const f = O.floors()[i], b = el('button', i === O.current() && !overview ? 'cur' : ''); b.type = 'button'; b.dataset.floor = i; b.title = f.data.name; b.setAttribute('aria-label', `${f.data.id} ${f.data.name}`);
      const pips = el('span', 'pips'); O.agentsOf(i).forEach(a => { const p = el('i'); p.style.background = ST[a.d.status]; pips.append(p); });
      b.append(el('span', '', f.data.id), pips);
      const q = pipe.queues[i + 1].length; if (q) b.append(el('em', 'badge', q));
      b.onclick = () => { setCam('manual'); if (overview) setOverview(false); O.setFloor(i, false); }; nav.append(b);
    });
  }
  function renderBrief() {
    const box = $('brief'); box.textContent = ''; box.append(el('h2', '', '의뢰 브리프'));
    const t = el('table'), hd = el('tr'); ['시스템', '서비스', '압력', '설비', '등급'].forEach(h => hd.append(el('th', '', h))); t.append(hd);
    HU.BRIEF.systems.forEach(s => {
      const live = pipe.systems[s.id], tr = el('tr'), over = live && live.rating > HU.CONFIG.catalogMaxRating;
      tr.append(el('td', 'rid', s.id), el('td', '', `${s.name} (${PHASE[s.phase]})`), el('td', '', `${s.pressure} barg`), el('td', '', s.equipment.map(e => e.tag).join(' ')), el('td', over ? 'hi' : '', live && live.rating ? live.rating + '#' + (over ? ' ⚠' : '') : '—'));
      t.append(tr);
    });
    const w = el('div', 'tw'); w.append(t); box.append(w, el('p', 'note dim', `부품 카탈로그 최대 등급 ${HU.CONFIG.catalogMaxRating}#. 등급은 1층에서 산정돼요.`));
  }
  function renderLive() {
    const box = $('live'); box.textContent = ''; box.append(el('h2', '', '진행 현황'));
    const rep = pipe.report(), k = el('div', 'kpi');
    [['진행', HU.mmss(pipe.clock)], ['설계 완료', `${rep.resolved}/${rep.expected || '-'}`], ['반려', rep.reworks], ['보류', rep.escalations.length]].forEach(([a, b]) => { const c = el('div'); c.append(el('small', '', a), el('b', '', b)); k.append(c); });
    box.append(k);
    const mini = el('div', 'mini');
    HU.STAGES.forEach(s => {
      const pr = pipe.prog[s.n], row = el('div'), bar = el('div', 'bar'), fill = el('i'); fill.style.width = (pr.total ? pr.done / pr.total * 100 : 0) + '%'; bar.append(fill);
      row.append(el('span', '', `${s.id} ${s.name}`), bar, el('span', '', `${pr.done}/${pr.total}`)); mini.append(row);
    });
    box.append(mini);
  }
  function renderTick() {
    const box = $('tick'); box.textContent = ''; box.append(el('h2', '', '진행 기록'));
    const ul = el('ul', 'tick');
    if (!beats.length) ul.append(el('li', '', '시작하면 여기에 기록돼요.'));
    beats.slice(0, 14).forEach(b => { const li = el('li', (b.major ? 'major ' : '') + (/반려|멈췄/.test(b.text) ? 'bad' : '')); li.append(el('time', '', HU.mmss(b.t)), document.createTextNode(`${b.who} · ${b.text}`)); ul.append(li); });
    box.append(ul);
  }
  function diagramPane(title, chips, rec, sysId, note) {
    const p = el('div', 'pane'), h = el('h3', '', title); chips.forEach(c => h.append(c)); p.append(h);
    if (!rec) { p.append(el('div', 'ph', note || '')); return p; }
    const wrap = el('div', 'dg'); wrap.append(HU.diagram(rec, pipe.systems[sysId])); p.append(wrap);
    const rl = el('div', 'rl'); rec.results.forEach(r => { const s = RSTAT[r.status]; rl.append(chipEl(`${r.id} ${s[0]}`, s[1])); }); p.append(rl);
    return p;
  }
  function renderSpot() {
    const box = $('spot'); box.textContent = ''; box.append(el('h2', '', 'SPOTLIGHT'));
    const tabs = el('div', 'tabs');
    [['rework', '반려와 재작업'], ['waiver', '사람의 예외 승인']].forEach(([k, label]) => { const b = el('button', spots.tab === k ? 'on' : '', label); b.type = 'button'; b.onclick = () => { spots.tab = k; sigDirty = true; renderSpot(); }; tabs.append(b); });
    box.append(tabs);
    if (spots.tab === 'rework') {
      const s = spots.rework;
      if (!s) { box.append(el('p', 'note dim', '검수에서 처음 반려되는 설계가 나오면, 반려된 도면과 재작업 후 도면을 나란히 보여줘요.')); return; }
      const sys = pipe.designs[s.tag].inst.system, bad = s.before.results.filter(r => r.status === 'unapplied' || r.status === 'violated');
      box.append(el('p', 'note', `${s.tag}: 설계 담당이 만든 1차 설계에서 ${bad.map(b => `${b.id} ${b.title}(${b.status === 'unapplied' ? '미적용' : '값 오류'})`).join(', ')} 문제가 발견돼 반려됐어요. 빨간 점선이 규칙을 못 지킨 곳이에요.`));
      const g = el('div', 'spot');
      g.append(diagramPane('1차 설계', [chipEl('반려', '#ff5d6c')], s.before, sys), diagramPane('재작업 후', s.after ? [chipEl('통과', '#5ad17a')] : [], s.after, sys, '재작업 중… 3층 담당이 룰을 다시 적용하고 있어요.'));
      box.append(g);
    } else {
      const s = spots.waiver;
      if (!s) { box.append(el('p', 'note dim', '고압 스팀(HPS)이 사람의 결정을 받으면, 예외로 기록된 설계를 여기서 볼 수 있어요.')); return; }
      const rec = pipe.designs[s.tag], sys = rec.inst.system;
      box.append(el('p', 'note', `${s.tag}: ${sys} 요구 등급은 ${pipe.systems[sys].rating}#인데 카탈로그는 최대 ${HU.CONFIG.catalogMaxRating}#. 룰을 지킬 수 없어 설계 리드가 예외를 승인했어요. 이 도면은 R-07이 '면제'로 기록돼요.`));
      const g = el('div', 'spot'); g.append(diagramPane('예외 승인 후 설계', [chipEl('예외 통과', '#ffd84a')], { design: clone(rec.design), results: clone(rec.results) }, sys));
      const side = el('div', 'pane'); side.append(el('h3', '', '기록된 예외'));
      const ul = el('ul', 'tick'); rec.design.waivers.forEach(w => ul.append(el('li', 'major', `${w.rule} · ${w.by} · ${w.reason}`))); rec.design.notes.forEach(n => ul.append(el('li', '', n)));
      side.append(ul); g.append(side); box.append(g);
    }
  }
  function renderAlert() {
    const box = $('alert'), j = pipe.escalations[0]; box.hidden = !j; box.textContent = '';
    if (!j) return;
    const sys = pipe.systems[j.sys], left = approveAt ? Math.max(0, Math.ceil((approveAt - performance.now()) / 1000)) : null, row = el('div', 'al');
    row.append(el('b', '', `⚠ 사람의 결정이 필요해요 · ${sys.id} ${sys.name}`),
      el('span', '', left != null ? `설계 리드가 검토 중이에요. ${left}초 뒤 예외 승인(시나리오 가정).` : `${sys.pressure} barg · 요구 ${sys.rating}# > 카탈로그 ${HU.CONFIG.catalogMaxRating}#`));
    const ok = el('button', 'btn go', '지금 승인'); ok.type = 'button'; ok.onclick = approveNow; row.append(ok); box.append(row);
  }
  function approveNow() { if (pipe.escalations[0]) { pipe.approve(pipe.escalations[0].id); approveAt = 0; sigDirty = true; renderAlert(); } }

  function renderFinal() {
    const f = $('final'); f.hidden = false; f.textContent = '';
    const rep = pipe.report(), recs = Object.values(pipe.designs).sort((a, b) => a.inst.tag.localeCompare(b.inst.tag));
    const nonWaived = recs.filter(r => r.status !== 'waived').length, first = recs.filter(r => r.attempts === 1 && r.status === 'pass').length;
    f.append(el('h2', '', 'FINAL REPORT'));
    f.append(el('p', 'note', `${SC.title}: 계기 ${rep.expected}개의 훅업 설계가 끝났어요. 룰은 3층에서만 적용됐고, 4층은 적용 여부를 확인해 ${rep.reworks}건을 돌려보냈어요.`));
    const k = el('div', 'kpi');
    [['계기', rep.expected], ['1차 통과', `${first}/${nonWaived}`], ['재작업', rep.reworks], ['예외 승인', rep.waived], ['소요', HU.mmss(pipe.clock)]].forEach(([a, b]) => { const c = el('div'); c.append(el('small', '', a), el('b', '', b)); k.append(c); });
    f.append(k);
    f.append(el('h3', '', '룰별 결과 (누락·오류는 1차 검수에서 반려된 횟수)'));
    const t = el('table'), hd = el('tr'); ['룰', '', '통과', '누락', '오류', '면제'].forEach(h => hd.append(el('th', '', h))); t.append(hd);
    rep.perRule.forEach(r => { const tr = el('tr'); tr.append(el('td', 'rid', r.id), el('td', 'nm', r.title), el('td', '', r.pass), el('td', r.unapplied ? 'bad' : '', r.unapplied), el('td', r.violated ? 'bad2' : '', r.violated), el('td', r.waived ? 'wv' : '', r.waived)); t.append(tr); });
    const w1 = el('div', 'tw'); w1.append(t); f.append(w1);
    f.append(el('h3', '', '사람이 개입한 지점'));
    const ul = el('ul', 'tick'); decisions.slice().reverse().forEach(b => ul.append(el('li', 'major', `${HU.mmss(b.t)} · ${b.who} · ${b.text}`))); f.append(ul);
    f.append(el('h3', '', '계기별 결과'));
    const t2 = el('table'), h2 = el('tr'); ['계기', '종류', '시스템', '결과', '시도', '비고'].forEach(h => h2.append(el('th', '', h))); t2.append(h2);
    recs.forEach(r => {
      const tr = el('tr'), s = DSTAT[r.status], td = el('td'); td.append(chipEl(s[0], s[1]));
      const rej = r.history.filter(h => h.bad).map(h => h.bad.map(b => b.id).join('·')), note = [rej.length ? `반려 ${rej.join(', ')}` : '', r.status === 'waived' ? '예외 승인' : ''].filter(Boolean).join(' / ');
      tr.append(el('td', 'rid', r.inst.tag), el('td', '', HU.KIND_LABEL[r.inst.kind]), el('td', '', r.inst.system), td, el('td', '', r.attempts), el('td', 'dim', note)); t2.append(tr);
    });
    const w2 = el('div', 'tw'); w2.append(t2); f.append(w2);
    const act = el('div', 'fin-act'), again = el('button', 'btn go', '↺ 처음부터 다시 보기'); again.type = 'button'; again.onclick = restart; act.append(again, el('span', 'dim', '결함 주입 위치와 룰 값은 코드에서 바꿀 수 있어요.')); f.append(act);
  }

  // ---------- name tags ----------
  function syncTags() {
    tags.textContent = ''; tagEls.clear();
    if (overview) {
      O.floors().forEach((f, i) => { const cols = O.state.cols, e = el('div', 'tag fl'); e.append(el('span', '', `${f.data.id} ${f.data.name}`)); e.style.left = Math.round(((i % cols) * O.W + 6) * scale) + 'px'; e.style.top = Math.round((Math.floor(i / cols) * O.H + 14) * scale) + 'px'; e.style.transform = 'none'; tags.append(e); });
      return;
    }
    O.floors()[O.current()].agents.forEach(a => { const e = el('div', 'tag'); e.append(el('i'), el('span', '', a.d.title)); tags.append(e); tagEls.set(a.d.id, e); });
  }
  function placeTags() {
    if (overview) return;
    O.floors()[O.current()].agents.forEach(a => {
      const e = tagEls.get(a.d.id); if (!e) return;
      e.firstChild.style.background = ST[a.d.status];
      let x, y; if (a.mode === 'sit') { x = a.desk.x + 22; y = a.desk.y - 22; } else if (a.mode === 'couch') { x = a.x; y = a.y + 6; } else { x = a.x; y = a.y + 3; }
      e.style.left = Math.round(x * scale) + 'px'; e.style.top = Math.round(y * scale) + 'px';
    });
  }

  // ---------- controls ----------
  function runBtn() { const b = $('run'); b.textContent = pipe.finished ? '↺ 다시 보기' : userPaused ? '▶ 계속' : '⏸ 일시정지'; b.classList.toggle('go', userPaused || pipe.finished); b.disabled = !started; }
  function restart() {
    pipe.reset(); started = false; userPaused = false; holdUntil = 0; approveAt = 0; announced = false; wantFloor = null;
    $('final').hidden = true; $('alert').hidden = true; $('intro').hidden = false; $('capHold').style.width = '0';
    $('capWho').textContent = '대기'; $('capWho').classList.remove('human'); capFull = '시작 버튼을 누르면 의뢰가 접수돼요.'; capShown = -1; capStart = performance.now() - 5000;
    setCam('auto'); O.setFloor(0, true); syncTags(); sigDirty = true; runBtn(); scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('start').onclick = () => { started = true; $('intro').hidden = true; pipe.start(); runBtn(); };
  $('run').onclick = () => { if (!started) return; if (pipe.finished) restart(); else { userPaused = !userPaused; runBtn(); } };
  $('again').onclick = restart;
  $('spd').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; speed = +b.dataset.v; [...$('spd').children].forEach(c => c.classList.toggle('on', c === b)); });
  $('cam').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) setCam(b.dataset.v); });
  $('snd').onclick = ev => { const on = !P.audio.on; P.audio.set(on); ev.currentTarget.classList.toggle('on', on); ev.currentTarget.textContent = on ? '소리 ON' : '소리 OFF'; ev.currentTarget.setAttribute('aria-pressed', on); };
  cv.addEventListener('click', ev => {
    if (!overview) return;
    const r = cv.getBoundingClientRect(), i = O.cellAt((ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale);
    if (i >= 0) { setCam('manual'); setOverview(false); O.setFloor(i, true); }
  });
  addEventListener('keydown', ev => { if (ev.key === ' ' && started && !(ev.target.closest && ev.target.closest('button'))) { $('run').click(); ev.preventDefault(); } });

  // ---------- loop ----------
  let last = performance.now(), sig = '', spotSig = '', pollAt = 0, sync = 0, lastAlert = '';
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (holdUntil && now >= holdUntil) { holdUntil = 0; }
    if (userPaused && approveAt) approveAt += dt * 1000;
    const want = started && !userPaused && !holdUntil;
    if (want && pipe.state === 'paused') pipe.resume(); else if (!want && pipe.state === 'running') pipe.pause();
    pipe.tick(dt * speed);
    sync += dt; if (sync > 0.15) { sync = 0; O.sync(HU.bridge.pipeFloors(pipe)); }

    // human decision: when everything else is finished, the "design lead" decides after a short wait
    if (started && pipe.escalations.length && !pipe.active() && !holdUntil && !userPaused) { if (!approveAt) approveAt = now + 5000 / speed; if (now >= approveAt) approveNow(); }
    else if (!pipe.escalations.length) approveAt = 0;

    if (now - pollAt > 250) {
      pollAt = now;
      const r = spots.rework;
      if (r && !r.after) { const rec = pipe.designs[r.tag]; if (rec && (rec.status === 'pass' || rec.status === 'waived') && rec.attempts > 1) { r.after = { design: clone(rec.design), results: clone(rec.results) }; r.afterAt = now; } }
      if (spots.waiverSys && !spots.waiver) { const ws = Object.values(pipe.designs).filter(x => x.inst.system === spots.waiverSys && x.status === 'waived'), rec = ws.find(x => x.inst.kind !== 'temperature') || ws[0]; if (rec) { spots.waiver = { tag: rec.inst.tag }; spots.tab = 'waiver'; } }
      const a = pipe.escalations.length ? `${pipe.escalations[0].id}:${approveAt ? Math.ceil((approveAt - now) / 1000) : '-'}` : ''; if (a !== lastAlert) { lastAlert = a; renderAlert(); }
    }
    autoFocus(now);

    // caption typewriter
    const n = Math.min(capFull.length, Math.floor((now - capStart) / 22));
    if (n !== capShown) { capShown = n; $('capTxt').textContent = capFull.slice(0, n); }

    if (P.audio.on && pipe.state === 'running' && !overview && O.agentsOf(O.current()).some(a => a.d.status === 'working') && Math.random() < 0.05) P.audio.play('tick', 60);
    if (pipe.finished && !announced && !holdUntil) { announced = true; renderFinal(); setCam('all'); P.audio.play('done', 0); runBtn(); }

    const s = [pipe.clock | 0, beats.length, reached.size, O.current(), overview, pipe.workers.map(w => pipe.statusOf(w)).join(''), Object.values(pipe.queues).map(q => q.length).join(''), Object.values(pipe.systems).map(x => x.rating).join(','), userPaused, started].join('|');
    if (s !== sig || sigDirty) { sig = s; sigDirty = false; renderSum(); renderChap(); renderElev(); renderBrief(); renderLive(); renderTick(); runBtn(); }
    const ss = [spots.tab, spots.rework && spots.rework.tag, spots.rework && !!spots.rework.after, spots.waiver && spots.waiver.tag].join('|');
    if (ss !== spotSig) { spotSig = ss; renderSpot(); }
    placeTags(); requestAnimationFrame(tick);
  }
  // intro table
  (function () {
    const t = $('iBrief'), hd = el('tr'); ['시스템', '서비스', '압력', '설비'].forEach(h => hd.append(el('th', '', h))); t.append(hd);
    HU.BRIEF.systems.forEach(s => { const tr = el('tr'); tr.append(el('td', 'rid', s.id), el('td', '', `${s.name} (${PHASE[s.phase]})`), el('td', '', `${s.pressure} barg`), el('td', '', s.equipment.map(e => e.tag).join(' '))); t.append(tr); });
  })();
  syncTags(); runBtn(); capStart = performance.now() - 5000; capFull = $('capTxt').textContent;
  requestAnimationFrame(tick);
  window.__pipe = pipe; window.__story = { beats, spots };
})();
