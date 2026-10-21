/* Hook-up design pipeline: 시스템 구성 -> 객체 생성 -> 배관 설계(룰 적용) -> 룰 검수.
 *
 * Pure JS (no DOM) so it runs in the browser and in node (see test/hookup.test.js).
 * The workers are deterministic simulations, not LLM calls: swap `process()` for a real agent
 * call to make them live.
 *
 * IMPORTANT: the rules below are SAMPLE rules (generic instrument hook-up practice) so the
 * pipeline has something to chew on. Replace the values/logic with your company or project
 * standard before relying on any output.
 */
(function (root) {
  'use strict';
  const HU = (root.HU = root.HU || {});

  // ---------- util ----------
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const has = (d, type) => d.components.some(c => c.type === type);
  const ok = () => ({ ok: true });
  const fail = msg => ({ ok: false, msg });

  HU.CONFIG = {
    seed: 7,
    defectRate: 0.10,        // chance that the design worker "forgets" an applicable rule (for demonstrating the review loop)
    catalogMaxRating: 600,   // highest pressure class in the component catalog
    maxImpulseLen: 15,       // m   (sample value)
    minSlope: 1 / 12,        // sample value
  };
  const C = () => HU.CONFIG;
  HU.ratingFor = p => (p <= 19 ? 150 : p <= 50 ? 300 : p <= 100 ? 600 : p <= 150 ? 900 : 1500);   // barg -> class (illustrative)

  // ---------- rules (applied ONLY by the piping-design stage) ----------
  const DP = ['dp-flow', 'dp-level', 'dp'];
  const imp = d => d.kind !== 'temperature';
  HU.RULES = [
    { id: 'R-01', title: '루트(차단) 밸브', desc: '프로세스 탭에 루트 밸브를 설치한다.',
      applies: imp, apply(d) { if (!has(d, 'root_valve')) d.components.unshift({ type: 'root_valve' }); },
      check: d => (has(d, 'root_valve') ? ok() : fail('프로세스 탭에 루트 밸브가 없음')) },
    { id: 'R-02', title: '스팀 사이펀', desc: '스팀 서비스는 루트 밸브와 계기 사이에 사이펀(응축 포트)을 둔다.',
      applies: d => imp(d) && d.phase === 'steam',
      apply(d) { if (!has(d, 'siphon')) d.components.splice(has(d, 'root_valve') ? 1 : 0, 0, { type: 'siphon' }); },
      check: d => (has(d, 'siphon') ? ok() : fail('스팀 서비스인데 사이펀이 없음')) },
    { id: 'R-03', title: 'DP 3-밸브 매니폴드', desc: '차압 계기는 3-밸브 매니폴드를 사용한다.',
      applies: d => DP.includes(d.kind),
      apply(d) { if (!has(d, 'manifold')) d.components.push({ type: 'manifold' }); },
      check: d => (has(d, 'manifold') ? ok() : fail('차압 계기에 매니폴드가 없음')) },
    { id: 'R-04', title: '드레인/벤트', desc: '액체·스팀은 드레인, 기체는 벤트 밸브를 둔다.',
      applies: imp,
      apply(d) { const t = d.phase === 'gas' ? 'vent' : 'drain'; if (!has(d, t)) d.components.push({ type: t }); },
      check: d => { const t = d.phase === 'gas' ? 'vent' : 'drain'; return has(d, t) ? ok() : fail(`${t === 'vent' ? '벤트' : '드레인'} 밸브가 없음`); } },
    { id: 'R-05', title: '임펄스 라인 최대 길이', desc: '임펄스 라인은 최대 길이 이내로 한다(초과 시 계기 위치를 이동).',
      applies: imp,
      apply(d, sys, o) {
        const max = C().maxImpulseLen;
        if (o && o.wrong) { return; }                               // injected defect: claims applied but left as is
        if (d.tubing.length > max) { d.tubing.length = max; d.notes.push('R-05: 계기 위치를 탭 쪽으로 이동'); }
      },
      check: d => (d.tubing.length <= C().maxImpulseLen + 1e-9 ? ok() : fail(`임펄스 길이 ${d.tubing.length.toFixed(1)} m > ${C().maxImpulseLen} m`)) },
    { id: 'R-06', title: '임펄스 경사', desc: '최소 경사를 확보하고 서비스별 방향을 맞춘다(기체: 프로세스 쪽 하향, 그 외: 계기 쪽 하향).',
      applies: imp,
      apply(d, sys, o) {
        d.tubing.dir = d.phase === 'gas' ? 'down-to-process' : 'down-to-instrument';
        d.tubing.slope = (o && o.wrong) ? C().minSlope * 0.4 : Math.max(d.tubing.slope, C().minSlope);
      },
      check: d => {
        const dir = d.phase === 'gas' ? 'down-to-process' : 'down-to-instrument';
        if (d.tubing.dir !== dir) return fail('경사 방향이 서비스와 맞지 않음');
        return d.tubing.slope + 1e-9 >= C().minSlope ? ok() : fail(`경사 ${(d.tubing.slope * 100).toFixed(1)}% < ${(C().minSlope * 100).toFixed(1)}%`);
      } },
    { id: 'R-07', title: '압력 등급', desc: '모든 부품의 압력 등급은 시스템 등급 이상이어야 한다.',
      applies: () => true,
      apply(d, sys) { d.components.forEach(c => { c.rating = sys.rating; }); d.rating = sys.rating; },
      check: (d, sys) => (d.components.length && d.components.every(c => (c.rating || 0) >= sys.rating) ? ok() : fail(`부품 등급이 시스템 등급(${sys.rating}#)에 미달`)) },
  ];
  const WRONG_VALUE = ['R-05', 'R-06'];   // defects of the "applied but wrong" kind

  // ---------- brief (input) ----------
  HU.BRIEF = {
    project: '유틸리티 패키지 U-100 훅업',
    systems: [
      { id: 'STM', name: '저압 스팀', phase: 'steam', pressure: 8, temp: 175,
        equipment: [{ kind: 'vessel', tag: 'V-101', name: '스팀 헤더 드럼' }, { kind: 'exchanger', tag: 'E-101', name: '스팀 가열기' }] },
      { id: 'CWS', name: '냉각수', phase: 'liquid', pressure: 10, temp: 45,
        equipment: [{ kind: 'pump', tag: 'P-201A', name: '냉각수 펌프 A' }, { kind: 'pump', tag: 'P-201B', name: '냉각수 펌프 B' }, { kind: 'exchanger', tag: 'E-201', name: '냉각수 쿨러' }] },
      { id: 'IAS', name: '계장용 공기', phase: 'gas', pressure: 9, temp: 50,
        equipment: [{ kind: 'vessel', tag: 'V-301', name: '공기 수기' }] },
      { id: 'HPS', name: '고압 스팀', phase: 'steam', pressure: 110, temp: 520,
        equipment: [{ kind: 'vessel', tag: 'V-401', name: '과열기 드럼' }] },
    ],
  };

  const INST_TEMPLATES = {
    vessel: [['PT', 'pressure'], ['LT', 'dp-level'], ['TT', 'temperature']],
    exchanger: [['TT', 'temperature'], ['PDT', 'dp']],
    pump: [['PT', 'pressure'], ['FT', 'dp-flow']],
  };
  HU.KIND_LABEL = { pressure: '압력', 'dp-flow': '차압 유량', 'dp-level': '차압 레벨', dp: '차압', temperature: '온도' };

  // ---------- stage definitions ----------
  HU.STAGES = [
    { n: 1, id: '1F', name: '시스템 구성', theme: 'ops', sign: { text: 'NO RULES', color: '#9d97c4' },
      workers: [{ id: 'W1A', name: '시스템 아키텍트', role: '시스템 정의', types: ['define'] }, { id: 'W1B', name: '라인클래스 담당', role: '등급 산정', types: ['class'] }] },
    { n: 2, id: '2F', name: '객체 생성', theme: 'dev', sign: { text: 'NO RULES', color: '#9d97c4' },
      workers: [{ id: 'W2A', name: '설비 객체 담당', role: '설비 생성', types: ['equip'] }, { id: 'W2B', name: '계기 객체 담당', role: '계기 생성', types: ['inst'] }] },
    { n: 3, id: '3F', name: '배관 설계', theme: 'research', sign: { text: 'RULES ON', color: '#5ad17a' },
      workers: [{ id: 'W3A', name: '스팀 배관 설계', role: 'STM·HPS', types: ['design'], systems: ['STM', 'HPS'] },
                { id: 'W3B', name: '냉각수 배관 설계', role: 'CWS', types: ['design'], systems: ['CWS'] },
                { id: 'W3C', name: '계장공기 배관 설계', role: 'IAS', types: ['design'], systems: ['IAS'] }] },
    { n: 4, id: '4F', name: '룰 검수', theme: 'review', sign: { text: 'AUDIT', color: '#ffd84a' },
      workers: [{ id: 'W4A', name: '룰 검수 A', role: '적용 여부 검수', types: ['review'] }, { id: 'W4B', name: '룰 검수 B', role: '적용 여부 검수', types: ['review'] },
                { id: 'W4C', name: '리포터', role: '결과 보고', types: ['report'] }] },
  ];
  const DUR = { define: 3.0, class: 2.0, equip: 3.2, inst: 3.4, design: 2.4, rework: 1.8, review: 1.5, report: 3.0 };
  const STAGE_OF = { define: 1, class: 1, equip: 2, inst: 2, design: 3, review: 4, report: 4 };

  // ---------- pipeline ----------
  class Pipeline {
    constructor() { this.listeners = {}; this.reset(); }
    on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return this; }
    emit(type, ...a) { (this.listeners[type] || []).forEach(fn => fn(...a)); }

    reset() {
      this.state = 'ready';            // ready | running | paused
      this.clock = 0; this.jid = 0;
      this.queues = { 1: [], 2: [], 3: [], 4: [] };
      this.workers = [];
      HU.STAGES.forEach(s => s.workers.forEach(w => this.workers.push({ ...w, stage: s.n, job: null, handled: 0, parked: [], summary: '' })));
      this.systems = {}; this.equipment = []; this.instruments = [];
      this.designs = {};               // tag -> {design, status, attempts, results, history}
      this.log = []; this.reportRuns = 0; this.lastReport = null; this.dirtyReport = false;
      this.expected = 0; this.resolved = 0; this.reworks = 0; this.escalations = [];
      this.prog = { 1: { done: 0, total: 0 }, 2: { done: 0, total: 0 }, 3: { done: 0, total: 0 }, 4: { done: 0, total: 0 } };
      this.curWorker = null;
      this.emit('reset');
    }
    setConfig(o) { Object.assign(HU.CONFIG, o); }

    start() {
      if (this.state !== 'ready') return;
      this.state = 'running';
      this.enqueue({ type: 'define', label: `${HU.BRIEF.project} 브리프 분석`, payload: { brief: HU.BRIEF } });
      this.emit('state', this.state);
    }
    pause() { if (this.state === 'running') { this.state = 'paused'; this.emit('state', this.state); } }
    resume() { if (this.state === 'paused') { this.state = 'running'; this.emit('state', this.state); } }

    enqueue(job, from) {
      job.id = ++this.jid; job.stage = STAGE_OF[job.type]; job.attempt = job.attempt || 0;
      const dur = job.type === 'design' && job.attempt > 0 ? DUR.rework : DUR[job.type];
      const r = rng(hash(job.type + (job.label || '') + job.attempt + C().seed))();
      job.dur = dur * (0.85 + r * 0.4); job.remaining = job.dur;
      this.queues[job.stage].push(job); this.prog[job.stage].total++;
      if (from && from !== job.stage) this.emit('handoff', from, job.stage, job, this.curWorker);
      return job;
    }
    workerFor(job) {   // idle worker that can take this job
      return this.workers.find(w => !w.job && w.stage === job.stage && w.types.includes(job.type) && (!w.systems || w.systems.includes(job.sys)));
    }
    needsHuman(job) { const s = this.systems[job.sys]; return job.type === 'design' && s && s.rating > C().catalogMaxRating && !job.waived; }

    tick(dt) {
      if (this.state !== 'running') return;
      this.clock += dt;
      // assign work
      for (let st = 1; st <= 4; st++) {
        const q = this.queues[st];
        for (let i = 0; i < q.length;) {
          const job = q[i], w = this.workerFor(job);
          if (!w) { i++; continue; }
          if (this.needsHuman(job)) {            // park it: the worker cannot proceed without a decision
            q.splice(i, 1); job.parked = true; w.parked.push(job); w.summary = `${job.label} · 사람 확인 필요`;
            this.escalations.push(job); this.emit('escalate', w, job); continue;
          }
          q.splice(i, 1); w.job = job; w.summary = job.label; this.emit('jobStart', w, job);
        }
      }
      // progress
      this.workers.forEach(w => {
        if (!w.job) return;
        w.job.remaining -= dt;
        if (w.job.remaining <= 0) { const job = w.job; w.job = null; w.handled++; w.summary = ''; this.finish(w, job); }
      });
      this.maybeReport();
    }

    finish(w, job) {
      this.curWorker = w; this.prog[job.stage].done++;
      this.emit('jobDone', w, job);
      const next = (j, from) => this.enqueue(j, from || job.stage);
      switch (job.type) {
        case 'define': {
          job.payload.brief.systems.forEach(s => { this.systems[s.id] = { ...s, equipment: undefined, src: s }; next({ type: 'class', sys: s.id, label: `${s.id} ${s.name} 등급 산정`, payload: {} }); });
          break;
        }
        case 'class': {
          const s = this.systems[job.sys];
          s.rating = HU.ratingFor(s.pressure); s.lineClass = `${s.rating}#-${s.phase.toUpperCase()}`;
          s.index = Object.keys(this.systems).indexOf(s.id) + 1;
          next({ type: 'equip', sys: s.id, label: `${s.id} 설비 객체 생성`, payload: {} });
          break;
        }
        case 'equip': {
          const s = this.systems[job.sys], R = rng(hash(s.id + C().seed));
          s.equipment = s.src.equipment.map(e => ({ ...e, system: s.id, elev: +(1 + R() * 5).toFixed(1), nozzles: e.kind === 'pump' ? ['S', 'D'] : e.kind === 'exchanger' ? ['IN', 'OUT'] : ['N1', 'N2', 'N3'] }));
          this.equipment.push(...s.equipment);
          next({ type: 'inst', sys: s.id, label: `${s.id} 계기 객체 생성`, payload: {} });
          break;
        }
        case 'inst': {
          const s = this.systems[job.sys], R = rng(hash('inst' + s.id + C().seed)), count = {}, list = [];
          s.equipment.forEach(e => (INST_TEMPLATES[e.kind] || []).forEach(([pfx, kind]) => {
            count[pfx] = (count[pfx] || 0) + 1;
            const tapElev = +(e.elev + R() * 2).toFixed(1), dist = +(2 + R() * 16).toFixed(1);
            list.push({ tag: `${pfx}-${s.index}${String(count[pfx]).padStart(2, '0')}`, kind, system: s.id, phase: s.phase, on: e.tag, tapElev, locElev: +(tapElev + (s.phase === 'gas' ? 1 : -1) * (0.6 + R() * 1.2)).toFixed(1), dist });
          }));
          this.instruments.push(...list); this.expected += list.length;
          list.forEach(inst => { this.designs[inst.tag] = { inst, status: 'queued', attempts: 0, history: [] }; next({ type: 'design', sys: s.id, tag: inst.tag, label: `${inst.tag} 훅업 설계`, payload: { inst } }); });
          break;
        }
        case 'design': {
          const rec = this.designs[job.tag]; rec.attempts = job.attempt + 1;
          rec.design = this.design(job, rec); rec.status = 'designed';
          rec.history.push({ t: +this.clock.toFixed(1), what: job.attempt ? `재작업 ${job.attempt}회차` : '최초 설계', applied: rec.design.appliedRules.slice() });
          next({ type: 'review', sys: job.sys, tag: job.tag, label: `${job.tag} 룰 적용 검수`, attempt: job.attempt, payload: {} });
          break;
        }
        case 'review': {
          const rec = this.designs[job.tag], res = this.review(rec.design, this.systems[job.sys]);
          rec.results = res; const bad = res.filter(r => r.status === 'unapplied' || r.status === 'violated');
          if (bad.length) {
            rec.status = 'rework'; this.reworks++;
            rec.history.push({ t: +this.clock.toFixed(1), what: `검수 반려: ${bad.map(b => b.id).join(', ')}`, bad });
            this.emit('reject', w, job, bad);
            this.enqueue({ type: 'design', sys: job.sys, tag: job.tag, label: `${job.tag} 재작업`, attempt: job.attempt + 1, payload: { inst: rec.inst, notes: bad } }, 4);
          } else {
            rec.status = res.some(r => r.status === 'waived') ? 'waived' : 'pass'; this.resolved++; this.dirtyReport = true;
            rec.history.push({ t: +this.clock.toFixed(1), what: rec.status === 'waived' ? '예외 승인 후 통과' : '검수 통과' });
          }
          break;
        }
        case 'report': this.lastReport = this.report(); this.reportRuns++; this.emit('report', this.lastReport); break;
      }
    }

    // --- design stage: the ONLY place rules are applied ---
    design(job, rec) {
      const inst = job.payload.inst, sys = this.systems[job.sys];
      const d = { tag: inst.tag, kind: inst.kind, system: inst.system, phase: inst.phase, on: inst.on, tapElev: inst.tapElev, locElev: inst.locElev, dist: inst.dist,
        components: inst.kind === 'temperature' ? [{ type: 'thermowell' }] : [], tubing: { length: +(inst.dist * 1.15).toFixed(1), slope: 0, dir: null },
        appliedRules: [], waivers: [], notes: [], attempt: job.attempt };
      const R = rng(hash(inst.tag + 'defect' + C().seed));
      HU.RULES.forEach(rule => {
        if (!rule.applies(d)) return;
        if (rule.id === 'R-07' && job.waived) { d.waivers.push({ rule: 'R-07', by: '사람 승인', reason: `카탈로그 최대 ${C().catalogMaxRating}# < 요구 ${sys.rating}#` }); d.components.forEach(c => { c.rating = C().catalogMaxRating; }); d.notes.push('R-07: 예외 승인(등급 미달)'); return; }
        const slip = job.attempt === 0 && R() < C().defectRate;
        if (slip && !WRONG_VALUE.includes(rule.id)) { d.notes.push(`(주입 결함) ${rule.id} 누락`); return; }   // forgot it: not logged
        rule.apply(d, sys, { wrong: slip });
        d.appliedRules.push(rule.id);
        if (slip) d.notes.push(`(주입 결함) ${rule.id} 값 오류`);
      });
      return d;
    }

    // --- review stage: did the design apply each rule, and is the result right? ---
    review(d, sys) {
      return HU.RULES.filter(r => r.applies(d)).map(r => {
        const waived = d.waivers.find(x => x.rule === r.id), logged = d.appliedRules.includes(r.id), chk = r.check(d, sys);
        let status;
        if (waived) status = 'waived'; else if (chk.ok) status = 'pass'; else status = logged ? 'violated' : 'unapplied';
        return { id: r.id, title: r.title, status, logged, msg: chk.msg || '' };
      });
    }

    // A human decision is per system: approving one parked job releases every parked job of that system.
    approve(jobId) {
      const owner = this.workers.find(x => x.parked.some(j => j.id === jobId)); if (!owner) return false;
      const sys = owner.parked.find(j => j.id === jobId).sys;
      this.workers.forEach(w => {
        w.parked.filter(j => j.sys === sys).forEach(job => {
          job.parked = false; job.waived = true; job.label = `${job.tag} 훅업 설계(예외 승인)`;
          this.escalations = this.escalations.filter(j => j !== job); this.queues[3].unshift(job); this.emit('approve', w, job);
        });
        w.parked = w.parked.filter(j => j.sys !== sys);
      });
      return true;
    }

    active() { return this.workers.some(w => w.job) || Object.values(this.queues).some(q => q.length); }
    maybeReport() {
      if (!this.dirtyReport || this.active()) { return; }
      if (this.workers.some(w => w.job && w.job.type === 'report')) return;
      this.dirtyReport = false;
      this.enqueue({ type: 'report', label: this.escalations.length ? '중간 결과 리포트' : '최종 결과 리포트', payload: {} });
    }
    get finished() { return this.state !== 'ready' && this.resolved === this.expected && this.expected > 0 && !this.active() && !this.escalations.length && this.reportRuns > 0; }

    statusOf(w) {
      if (w.job) return 'working';
      if (w.parked.length) return 'blocked';
      if (this.state === 'ready') return 'idle';
      // done once nothing at or before this worker's stage can still send it work
      const busy = (st) => this.queues[st].length || this.workers.some(x => x.stage === st && x.job);
      for (let s = 1; s <= (w.stage === 4 ? 4 : w.stage === 3 ? 4 : w.stage); s++) if (busy(s) && !(w.stage === 3 && s === 3)) return 'idle';
      if (busy(w.stage)) return 'idle';
      return w.handled > 0 ? 'done' : 'idle';
    }

    report() {
      const per = {}; HU.RULES.forEach(r => { per[r.id] = { id: r.id, title: r.title, pass: 0, unapplied: 0, violated: 0, waived: 0, firstTry: 0 }; });
      const rows = Object.values(this.designs).map(rec => ({ tag: rec.inst.tag, system: rec.inst.system, kind: rec.inst.kind, status: rec.status, attempts: rec.attempts, history: rec.history }));
      // first-pass results show how often rules were missed before review
      Object.values(this.designs).forEach(rec => {
        rec.history.forEach(h => { if (h.bad) h.bad.forEach(b => { per[b.id][b.status]++; }); });
        if (rec.results) rec.results.forEach(r => { if (r.status === 'pass') per[r.id].pass++; if (r.status === 'waived') per[r.id].waived++; });
      });
      return { clock: this.clock, expected: this.expected, resolved: this.resolved, reworks: this.reworks, escalations: this.escalations.map(j => ({ id: j.id, tag: j.tag, sys: j.sys })),
        perRule: Object.values(per), rows, finalPass: rows.filter(r => r.status === 'pass').length, waived: rows.filter(r => r.status === 'waived').length };
    }
  }
  HU.Pipeline = Pipeline;
  if (typeof module !== 'undefined' && module.exports) module.exports = HU;
})(typeof window !== 'undefined' ? window : globalThis);
