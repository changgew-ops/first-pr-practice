/* 아이돌 매니저: 서바이벌 — 게임 엔진 (UI 비의존)
 * 사용: const s = Engine.newGame('hayeon', seed); Engine.next(s) → scene
 * scene.type: text | event | actions | rank | ending
 */
(function (root) {
  const GLOBAL = typeof window !== 'undefined' ? window : global;
  const D = () => GLOBAL.GameData;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const SKILLS = ['vocal', 'dance', 'rap', 'charm', 'variety'];
  const SKILL_KO = { vocal: '보컬', dance: '댄스', rap: '랩', charm: '매력', variety: '끼' };

  // 상태를 저장/복원할 수 있는 시드 난수
  function mulberry32(seed) {
    let a = seed | 0;
    const f = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.get = () => a;
    f.set = (v) => { a = v | 0; };
    return f;
  }
  const VERSION = '1.0.0';
  const SAVE_VERSION = 1;

  // 이름 + 조사 치환: {friend:이가} {rival:와과} {friend:은는} {rival:을를}
  function josa(name, pair) {
    const code = name.charCodeAt(name.length - 1) - 0xac00;
    const batchim = code >= 0 && code <= 11171 && code % 28 !== 0;
    return pair === '이가' ? (batchim ? '이' : '가') : pair === '은는' ? (batchim ? '은' : '는') : pair === '와과' ? (batchim ? '과' : '와') : batchim ? '을' : '를';
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const between = (rng, [a, b]) => a + rng() * (b - a);

  // ───────────────────────── 일정 ─────────────────────────
  function weekInfo(w) {
    const M = D().missions;
    if (w === 1) return { week: 1, kind: 'open', round: 0, phase: 'prep', mission: M[0], title: '1주차 · 첫 등급 평가' };
    if (w === 12) return { week: 12, kind: 'final', round: 6, phase: 'broadcast', mission: M[6], title: '12주차 · 최종 생방송' };
    const round = Math.floor((w - 2) / 2) + 1;
    const phase = w % 2 === 0 ? 'prep' : 'broadcast';
    return { week: w, kind: 'round', round, phase, mission: M[round],
      title: `${w}주차 · R${round} ${phase === 'prep' ? '준비 주간' : '방송 주간'}` };
  }
  const voteCfg = (state) => D().voting[weekInfo(state.week).round];

  // ───────────────────────── 생성 ─────────────────────────
  function newGame(protagonistId, seed) {
    const data = D();
    seed = seed == null ? Date.now() : seed;
    const rng = mulberry32(seed);
    const protas = data.protagonists;
    const pdef = protas.find((p) => p.id === protagonistId);
    if (!pdef) throw new Error('unknown protagonist: ' + protagonistId);

    const contestants = [];
    const usedNames = new Set(protas.map((p) => p.name));
    let n = 0;
    const mkName = () => {
      for (let i = 0; i < 200; i++) {
        const nm = pick(rng, data.names.surname) + pick(rng, data.names.given) + pick(rng, data.names.given);
        if (!usedNames.has(nm)) { usedNames.add(nm); return nm; }
      }
      return '참가자' + (++n);
    };

    data.labels.forEach((lb) => {
      const fixed = protas.filter((p) => p.label === lb.id);
      fixed.forEach((p) => contestants.push(fromProtagonist(p, lb, p.id === pdef.id)));
      for (let i = fixed.length; i < lb.slots; i++) contestants.push(generate(rng, mkName(), lb, data, ++n));
    });
    contestants.forEach((c, i) => { c.id = c.id || 'c' + i; });
    // 관계 (친구/라이벌)
    contestants.forEach((c) => {
      const same = contestants.filter((o) => o !== c && o.label === c.label);
      c.rel = {
        friend: (same.length && rng() < 0.7 ? pick(rng, same) : pick(rng, contestants.filter((o) => o !== c))).id,
        rival: pick(rng, contestants.filter((o) => o !== c && o.label !== c.label)).id,
      };
    });
    if (contestants.length !== 101) throw new Error('참가자 수 오류: ' + contestants.length);

    const player = contestants.find((c) => c.player);
    const state = {
      seed, rng, week: 0, over: false, queue: [], scene: null,
      contestants, playerId: player.id, pdef,
      mgr: { funds: pdef.funds, trust: pdef.trust },
      teamPen: (pdef.traits.teamPenalty || 0), seriousPen: (pdef.traits.seriousPenalty || 0),
      chain: null, cooldown: 0, forceConflict: false, brightNext: false,
      usedDaily: [], arcPoints: 0, arcDone: 0, slotPenalty: 0, recover: 0,
      crisis: { level: 0, weeks: 0 }, analyzedWeek: -1, slotsLeft: 2, trained: 0,
      period: 0, log: [], hist: [], withdrew: false, final: null, version: VERSION,
    };
    rank(state, false);
    return state;
  }

  function fromProtagonist(p, lb, isPlayer) {
    return {
      id: p.id, name: p.name, age: p.age, label: lb.id, labelName: lb.name, tier: lb.tier, color: lb.color,
      star: p.star, concept: p.concept, player: isPlayer, protagonist: true,
      skills: { ...p.skills }, stamina: p.stamina, mental: p.mental, maxStamina: 100,
      awareness: p.awareness, favor: p.favor, fans: p.fans, coh: p.coh,
      growth: p.growth, aiGrowth: 0.9 + p.growth * 0.1, aiStar: p.star >= 3, ready: 0, part: null, alive: true, rank: 0, prevRank: 0, d: {}, reasons: [],
    };
  }

  function generate(rng, name, lb, data, idx) {
    const t = lb.tier, bonus = data.tier.skillBonus[t];
    const skills = {};
    const spec = pick(rng, SKILLS);
    SKILLS.forEach((k) => {
      skills[k] = clamp(Math.round(50 + bonus + (rng() + rng() + rng() - 1.5) * 18 + (k === spec ? 9 : 0)), 22, 92);
    });
    const star = rng() < 0.12;
    if (star) SKILLS.forEach((k) => { skills[k] = clamp(skills[k] + 10, 22, 95); });
    return {
      aiGrowth: 0.8 + rng() * 0.5, aiStar: star,
      id: 'c' + idx, name, age: 16 + Math.floor(rng() * 8), label: lb.id, labelName: lb.name, tier: t, color: lb.color,
      star: 0, concept: spec ? SKILL_KO[spec] + ' 특기' : '', player: false, protagonist: false,
      skills, stamina: 60 + rng() * 30, mental: 50 + rng() * 35, maxStamina: 100,
      awareness: between(rng, data.tier.awareness[t]) + (star ? 12 : 0), favor: 35 + rng() * 25 + (star ? 8 : 0), fans: between(rng, data.tier.fans[t]),
      coh: 30 + rng() * 30, growth: 1, ready: 0, part: null, alive: true, rank: 0, prevRank: 0, d: {}, reasons: [],
    };
  }

  const player = (s) => s.contestants.find((c) => c.id === s.playerId);
  const byId = (s, id) => s.contestants.find((c) => c.id === id);
  const alive = (s) => s.contestants.filter((c) => c.alive);

  // ───────────────────────── 투표 모델 ─────────────────────────
  // 투표수 = 고정 팬 투표 + 일반 시청자 선택 + 미션 베네핏 (+ 작은 무작위)
  function votes(state, official) {
    const list = alive(state);
    const k = voteCfg(state).k;
    const ws = list.map((c) => 0.02 + (c.awareness / 100) * Math.pow(c.favor / 100, 1.6));
    const sum = ws.reduce((a, b) => a + b, 0);
    const GP = 300000;
    const fanMult = k >= 11 ? 0.8 : k >= 5 ? 1.1 : k >= 3 ? 1.3 : 1.6;
    const rows = list.map((c, i) => {
      const gen = Math.min(GP * 0.5, (GP * k * ws[i]) / sum);
      const fan = c.fans * (0.25 + 0.75 * (c.coh / 100)) * fanMult;
      const noise = 1 + (state.rng() - 0.5) * (official ? 0.05 : 0.1);
      return { c, gen: gen * noise, fan: fan * noise, bonus: 0 };
    });
    if (official && rows.some((r) => r.c.qrank)) {
      const tops = [...rows].sort((a, b) => b.gen + b.fan - (a.gen + a.fan)).slice(0, 10);
      const unit = (tops.reduce((a, r) => a + r.gen + r.fan, 0) / tops.length) * 0.15;
      const table = [1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];
      rows.forEach((r) => { if (r.c.qrank && r.c.qrank <= 10) r.bonus = unit * table[r.c.qrank - 1]; });
    }
    rows.forEach((r) => { r.total = r.gen + r.fan + r.bonus; });
    return rows;
  }

  function rank(state, official) {
    const rows = votes(state, official).sort((a, b) => b.total - a.total);
    rows.forEach((r, i) => {
      const c = r.c;
      c.prevRank = official ? (c.officialRank || c.rank || i + 1) : (c.rank || i + 1);
      c.rank = i + 1;
      if (official) c.officialRank = i + 1;
      c.votes = Math.round(r.total);
      c.vparts = { gen: Math.round(r.gen), fan: Math.round(r.fan), bonus: Math.round(r.bonus) };
      c.reasons = reasonsFor(c);
    });
    state.rankMode = official ? 'official' : 'trend';
    return rows;
  }

  function reasonsFor(c) {
    const out = [];
    const d = c.d || {};
    if (c.qrank && c.qpct != null) {
      if (c.qpct > 0.8) out.push(`무대 평가 상위권 (${c.qrank}위)`);
      else if (c.qpct < 0.3) out.push('무대 평가 부진');
    }
    if (d.favor > 3) out.push('호감도 상승');
    if (d.favor < -3) out.push('호감도 하락 (편집·반응)');
    if (d.fans > 0 && d.fansBase && d.fans / d.fansBase > 0.08) out.push('고정 팬 유입');
    if (d.fans < 0 && d.fansBase && -d.fans / d.fansBase > 0.04) out.push('팬 이탈');
    if (d.aw > 4) out.push('인지도 상승');
    if (c.vparts && c.vparts.bonus > 0) out.push('미션 베네핏');
    if (c.note) out.push(c.note);
    return out.slice(0, 3);
  }

  // ───────────────────────── 무대 점수 ─────────────────────────
  function quality(state, c, m, noisy) {
    let q = 0;
    Object.keys(m.w).forEach((k) => { q += c.skills[k] * m.w[k]; });
    q += c.ready;
    if (c.part === 'main') q += noisy === false ? 0 : (state.rng() < 0.5 ? 5 : -4);
    else if (c.part === 'safe') q += 2;
    if (c.stamina < 50) q -= (50 - c.stamina) * 0.25;
    if (c.mental < 40) q -= (40 - c.mental) * 0.3;
    if (c.player) {
      if (m.team) q -= state.teamPen;
      if (m.serious) q -= state.seriousPen;
      if (state.crisis.level >= 2) q -= 6;
    }
    if (noisy !== false) q += (state.rng() - 0.5) * 8;
    return q;
  }

  // ───────────────────────── 효과 적용 ─────────────────────────
  function applyFx(state, fx, tag) {
    const p = player(state);
    const out = [];
    const add = (label, v, unit) => out.push(`${label} ${v > 0 ? '+' : ''}${round1(v)}${unit || ''}`);
    if (!fx) return out;
    if (fx.skill) Object.keys(fx.skill).forEach((k) => {
      const v = fx.skill[k] * (tag === 'train' ? 1 : p.growth);
      p.skills[k] = clamp(p.skills[k] + v, 0, 100); add(SKILL_KO[k], v);
    });
    if (fx.stamina) { p.stamina = clamp(p.stamina + fx.stamina, 0, 100); add('체력', fx.stamina); }
    if (fx.mental) { p.mental = clamp(p.mental + fx.mental, 0, 100); add('멘탈', fx.mental); }
    if (fx.trust) { state.mgr.trust = clamp(state.mgr.trust + fx.trust, 0, 100); add('신뢰', fx.trust); }
    if (fx.favor) { p.favor = clamp(p.favor + fx.favor, 0, 100); add('호감도', fx.favor); }
    if (fx.aw) { p.awareness = clamp(p.awareness + fx.aw, 0, 100); add('인지도', fx.aw); }
    if (fx.coh) { p.coh = clamp(p.coh + fx.coh, 0, 100); add('결속', fx.coh); }
    if (fx.funds) { state.mgr.funds = Math.max(0, round1(state.mgr.funds + fx.funds)); add('자금', fx.funds); }
    if (fx.fans) { p.fans = Math.max(0, p.fans + fx.fans); add('팬', fx.fans); }
    if (fx.ready) { p.ready = clamp(p.ready + fx.ready, 0, 12); add('준비도', fx.ready); }
    if (fx.risk && state.chain) state.chain.risk = clamp(state.chain.risk + fx.risk, 0, 1);
    if (fx.guard) {
      if (state.chain) state.chain.guard = clamp(state.chain.guard + fx.guard, 0, 0.5);
      else state.pendingGuard = clamp((state.pendingGuard || 0) + fx.guard, 0, 0.5);
      out.push('편집 위험 ↓');
    }
    return out;
  }

  // ───────────────────────── 장면 도우미 ─────────────────────────
  const text = (title, lines, extra) => Object.assign({ type: 'text', title, lines: [].concat(lines) }, extra || {});
  const hook = (fn) => ({ type: 'hook', run: fn });
  const pushFront = (s, scenes) => s.queue.unshift(...scenes);
  const pushBack = (s, scenes) => s.queue.push(...scenes);
  const pushLog = (s, t) => { s.log.push({ week: s.week, text: t }); };
  const fxLine = (arr) => (arr.length ? '▸ ' + arr.join(' · ') : '');

  function standingLine(state) {
    const p = player(state);
    const n = alive(state).length;
    const tag = state.rankMode === 'official' ? '공식 순위' : '예상 순위 (추세)';
    const diff = p.prevRank - p.rank;
    const arrow = diff > 0 ? `▲${diff}` : diff < 0 ? `▼${-diff}` : '–';
    return `${tag}: ${p.rank}위 / ${n}명 (${arrow})`;
  }

  // ───────────────────────── 진행 ─────────────────────────
  function next(state) {
    state.scene = null;
    for (let guard = 0; guard < 200; guard++) {
      if (!state.queue.length) {
        if (state.over) return state.scene;
        if (api.onWeekBoundary) api.onWeekBoundary(state);
        beginWeek(state);
        continue;
      }
      const s = state.queue.shift();
      if (s.type === 'hook') { s.run(state); continue; }
      state.scene = s;
      if (s.type === 'actions') { s.slots = state.slotsLeft; s.lines = [`이번 주 집중 행동을 ${state.slotsLeft}개 고르세요. 정규 훈련·식사·수면은 자동으로 진행됩니다.`]; }
      return s;
    }
    throw new Error('scene loop');
  }

  function beginWeek(state) {
    state.week += 1;
    const info = weekInfo(state.week);
    state.info = info;
    // 기본 일정(자동 훈련·식사·수면): 전원 소폭 성장
    alive(state).forEach((c) => {
      const g = c.player ? 0.4 * c.growth : (c.aiGrowth || 1);
      SKILLS.forEach((k) => { c.skills[k] = clamp(c.skills[k] + g, 0, 100); });
      c.stamina = clamp(c.stamina + 6, 0, 100);
      c.mental = clamp(c.mental + 2, 0, 100);
      if (!c.player) { c.ready = 0; }
    });
    state.slotsLeft = clamp(2 - state.slotPenalty, 1, 2);
    state.slotPenalty = 0;
    state.chosenActions = [];
    const q = [];
    q.push(briefing(state, info));
    if (info.kind === 'open') {
      q.push(hook(crisisCheck), actionsScene(state, info), hook(runStage), hook(announce));
    } else if (info.phase === 'prep') {
      q.push(hook(chainTrigger), hook(crisisCheck), hook(dailyEvent), hook(arcBeat), actionsScene(state, info), hook(prepEnd));
    } else if (info.kind === 'final') {
      q.push(hook(crisisCheck), actionsScene(state, info), hook(runStage), hook(announce));
    } else {
      q.push(hook(editResolve), hook(crisisCheck), hook(dailyEvent), actionsScene(state, info), hook(runStage), hook(announce));
    }
    pushBack(state, q);
  }

  function briefing(state, info) {
    const p = player(state);
    const m = info.mission;
    const lines = [];
    if (info.kind === 'open') {
      lines.push('Mnet 걸그룹 서바이벌 시즌 1. 101명의 연습생이 한 자리에 모였다. 첫 등급 평가가 시작된다.');
    } else if (info.phase === 'prep') {
      lines.push(`이번 라운드 미션: ${m.name} (${m.kind}).`);
      lines.push('준비 주간: 파트·훈련·인터뷰를 준비하는 시간. 연습 영상과 중간 평가가 공개되고, 순위는 예상 추세로만 보인다.');
    } else if (info.kind === 'final') {
      lines.push('드디어 최종 생방송. 이 한 번의 무대와 마지막 투표로 데뷔 멤버 11명이 결정된다.');
    } else {
      lines.push(`방송 주간: ${m.name} 무대가 방송된다. 투표가 마감되면 공식 순위와 탈락자가 발표된다.`);
    }
    const v = voteCfg(state);
    lines.push(`투표 방식: ${v.text} — ${v.note}`);
    const cut = D().cuts[info.round];
    if (cut && info.round > 0 && (info.phase === 'broadcast' || info.kind === 'final')) lines.push(`이번 발표 후 ${cut}명 생존${info.kind === 'final' ? ' (데뷔)' : ''}.`);
    lines.push(standingLine(state));
    lines.push(`${p.name} — 체력 ${Math.round(p.stamina)} · 멘탈 ${Math.round(p.mental)} · 자금 ${state.mgr.funds} · 매니저 신뢰 ${Math.round(state.mgr.trust)}`);
    return text(info.title, lines, { bg: info.phase === 'prep' ? 'practice' : 'stage', phase: info.phase, briefing: true });
  }

  // ───────────────────────── 일상/서사 이벤트 ─────────────────────────
  function fillTokens(state, str) {
    const me = player(state);
    return str.replace(/\{(friend|rival)(?::([^}]+))?\}/g, (m, who, pair) => {
      const o = byId(state, me.rel[who]);
      return o.name + (pair ? josa(o.name, pair) : '');
    });
  }

  function eligibleDaily(state, e) {
    const me = player(state);
    if (e.only && e.only !== me.id) return false;
    if (e.tiers && !e.tiers.includes(me.tier)) return false;
    if (e.needs && !byId(state, me.rel[e.needs]).alive) return false;
    return true;
  }

  function dailyEvent(state) {
    const all = D().daily.filter((e) => eligibleDaily(state, e));
    const pool = all.filter((e) => !state.usedDaily.includes(e.id));
    // 주인공 전용 이벤트는 우선순위를 높여 시즌 중 반드시 한 번은 만나게 한다
    const only = pool.filter((e) => e.only);
    let cand = state.brightNext ? pool.filter((e) => e.bright) : pool;
    if (only.length && !state.brightNext && state.rng() < 0.35) cand = only;
    if (!cand.length) cand = pool.length ? pool : all;
    const ev = pick(state.rng, cand);
    state.brightNext = false;
    state.usedDaily.push(ev.id);
    pushFront(state, [eventScene(state, ev.title, fillTokens(state, ev.text), ev.bg, ev.choices)]);
  }

  function arcBeat(state) {
    const w = state.week;
    const idx = w === 4 ? 0 : w === 8 ? 1 : w === 10 ? 2 : -1;
    if (idx < 0) return;
    const beat = state.pdef.arc.beats[idx];
    if (!beat) return;
    const choices = beat.choices.map((c) => ({ ...c, arcTag: true }));
    pushFront(state, [eventScene(state, `[${state.pdef.arc.name}] ${beat.title}`, beat.text, 'dorm', choices, { arc: true })]);
  }

  function eventScene(state, title, body, bg, choices, extra) {
    return Object.assign({
      type: 'event', title, lines: [body], bg: bg || 'practice',
      choices: choices.map((c) => ({
        label: c.label, fx: c.fx, result: c.result, arc: c.arc, run: c.run, resolved: c.resolved, honest: c.honest,
        disabled: !!(c.cost && state.mgr.funds < c.cost),
      })),
    }, extra || {});
  }

  function choose(state, idx) {
    const s = state.scene;
    if (!s || s.type !== 'event') return;
    const c = s.choices[idx];
    if (!c || c.disabled) return;
    const lines = [c.result || ''];
    const eff = applyFx(state, c.fx);
    if (c.arc != null) state.arcPoints += c.arc;
    if (s.arc) { state.arcDone += 1; pushLog(state, `[서사] ${s.title.replace(/^\[[^\]]*\]\s*/, '')} — ${c.label}`); }
    if (c.resolved && state.chain) state.chain.resolved = true;
    if (c.honest && state.chain) state.chain.honest = true;
    if (c.run) { const extra = c.run(state); if (extra) lines.push(...[].concat(extra)); }
    if (eff.length) lines.push(fxLine(eff));
    state.scene = null;
    pushFront(state, [text(s.title, lines, { bg: s.bg, result: true })]);
  }

  // ───────────────────────── 위기 단계 ─────────────────────────
  function crisisCheck(state) {
    const p = player(state);
    const cr = state.crisis;
    const lvl = p.mental < 20 || p.stamina < 15 ? 2 : p.mental < 35 || p.stamina < 30 ? 1 : 0;
    cr.weeks = lvl >= 2 ? cr.weeks + 1 : 0;
    cr.level = lvl;
    const C = D().crisis;
    if (lvl >= 2 && cr.weeks === 1) pushLog(state, '[위기] 체력/멘탈 위기 단계 진입');
    if (lvl === 1) { pushFront(state, [text('⚠ 컨디션 경고', [C.warn, `체력 ${Math.round(p.stamina)} / 멘탈 ${Math.round(p.mental)}`], { bg: 'dorm', warn: true })]); return; }
    if (lvl < 2) return;
    const trust = state.mgr.trust;
    if (cr.weeks >= 3 && trust < 55) {
      pushFront(state, [text('말없이 떠난 자리', [`${p.name}의 짐이 정리되어 있었다. 아무에게도 털어놓지 못한 채 버티다 한계에 이른 것이다.`], { bg: 'dorm' }), hook((s) => endGame(s, 'withdraw'))]);
      return;
    }
    if (cr.weeks >= 2) {
      if (trust >= 55) {
        pushFront(state, [eventScene(state, '하차 이야기', `${p.name}가 조용히 입을 열었다. "…저, 이제 그만해도 될까요."\n${C.talkIntro}`, 'dorm', [
          { label: '끝까지 이야기를 들어주고 설득한다', fx: {}, run: (s) => {
            const ok = s.rng() < 0.45 + (s.mgr.trust - 55) * 0.012;
            if (ok) { applyFx(s, { mental: 14, stamina: 8, trust: 3 }); s.crisis.weeks = 0; return '"…조금만 더 해볼게요." 눈물을 닦으며 대답했다. (멘탈 +14 · 체력 +8)'; }
            pushFront(s, [hook((st) => endGame(st, 'withdraw'))]); return '마음이 이미 돌아서 있었다. 설득은 닿지 않았다.';
          } },
          { label: '이번 주는 모든 걸 멈추고 쉬게 한다 (이번 주 슬롯 -1)', fx: { stamina: 25, mental: 25, trust: 3 }, run: (s) => { s.slotsLeft = Math.max(1, s.slotsLeft - 1); s.crisis.weeks = 0; return '모든 일정을 비우고 하루 종일 쉬었다.'; } },
          { label: '뜻을 존중해 하차를 받아들인다', fx: {}, run: (s) => { pushFront(s, [hook((st) => endGame(st, 'withdraw'))]); return '긴 침묵 끝에 고개를 끄덕였다.'; } },
        ])]);
        return;
      }
      pushFront(state, [text('"괜찮아요"', [`${p.name}는 아무 일 없다는 듯 웃어 보였다. 하지만 눈 밑이 어둡다. 속마음을 털어놓을 만큼의 신뢰는 아직 쌓이지 않았다.`], { bg: 'dorm', warn: true })]);
      applyFx(state, { mental: -4 });
      return;
    }
    // level 2 첫 주: 휴식/상담/강행 선택
    pushFront(state, [eventScene(state, '⚠ 위기: 수행 능력 저하', `${C.low}\n(이번 주 무대 점수에 큰 감점이 붙는다)`, 'dorm', [
      { label: '강제 휴식 (이번 주 슬롯 -1)', fx: { stamina: 22, mental: 10 }, run: (s) => { s.slotsLeft = Math.max(1, s.slotsLeft - 1); return null; }, result: '일정을 줄이고 숙면을 시켰다.' },
      { label: '상담에 집중한다 (이번 주 슬롯 -1)', fx: { mental: 20, trust: 3, stamina: 6 }, run: (s) => { s.slotsLeft = Math.max(1, s.slotsLeft - 1); return null; }, result: '길게 이야기를 나눴다. 연습생의 표정이 조금 풀렸다.' },
      { label: '그래도 강행한다', fx: { mental: -5, ready: 4, trust: -4 }, result: '"할 수 있어요." 하지만 목소리가 가늘게 떨렸다.' },
    ])]);
  }

  // ───────────────────────── 억까 연쇄 ─────────────────────────
  // 파트 갈등 → 제작진 주목 → 인터뷰 → 편집 방향 → 방송 → 대응
  function chainTrigger(state) {
    if (state.chain || state.cooldown > 0) { if (state.cooldown > 0) state.cooldown -= 1; return; }
    const p = state.pdef;
    if (state.rng() < 0.1 + p.hostile * 0.45) startChain(state);
  }
  function startChain(state, forced) {
    state.chain = { risk: 0, guard: state.pendingGuard || 0, resolved: false, honest: false, outcome: null, round: state.info.round };
    state.pendingGuard = 0;
    const rival = byId(state, player(state).rel.rival);
    const T = D().chain.conflict;
    const body = `${rival.name}(${rival.labelName})와(과) 파트 배분을 두고 의견이 엇갈렸다. 목소리가 높아진 순간, 카메라가 이쪽을 향했다. 제작진이 이 장면에 관심을 보이는 눈치다.`;
    pushFront(state, [eventScene(state, T.title, forced ? '메인 파트 협상이 틀어졌다.\n' + body : body, 'practice', T.choices)]);
  }

  function prepEnd(state) {
    const q = [];
    if (state.forceConflict && !state.chain) { state.forceConflict = false; startChainLate(state, q); }
    if (state.chain && !state.chain.interviewDone) {
      state.chain.interviewDone = true;
      const T = D().chain.interview;
      const hint = state.analyzedWeek === state.week || state.mgr.trust >= 60;
      const lines = [T.text];
      if (hint) lines.push(`🔎 매니저의 감: ${state.pdef.edit.hint}.`);
      q.push(eventScene(state, T.title, lines.join('\n'), 'office', T.choices));
    }
    state.pendingGuard = 0;
    q.push(hook(prepRelease));
    pushFront(state, q);
  }
  function startChainLate(state, q) {
    state.chain = { risk: 0, guard: state.pendingGuard || 0, resolved: false, honest: false, outcome: null, round: state.info.round };
    state.pendingGuard = 0;
    const T = D().chain.conflict;
    const rival = byId(state, player(state).rel.rival);
    q.push(eventScene(state, T.title, `메인 파트 협상이 틀어졌다. ${rival.name}(${rival.labelName})와(과) 의견이 갈렸고, 제작진이 이 장면에 관심을 보이는 눈치다.`, 'practice', T.choices));
  }

  function editResolve(state) {
    const ch = state.chain;
    if (!ch) return;
    const p = player(state);
    const hostile = state.pdef.hostile;
    const negProb = clamp(hostile * 0.5 + ch.risk * 0.6 + (ch.resolved ? -0.05 : 0.08) - ch.guard, 0.05, 0.95);
    const r = state.rng();
    const outcome = r < negProb ? 'bad' : r > 1 - (1 - negProb) * 0.3 ? 'good' : 'neutral';
    ch.outcome = outcome; ch.negProb = negProb;
    const lines = [];
    if (outcome === 'bad') {
      const big = negProb > 0.55;
      const dF = -(8 + state.rng() * 4) * (big ? 1.4 : 1);
      ch.loss = -dF;
      const eff = applyFx(state, { favor: dF, aw: 6, coh: -4, mental: -6 });
      p.note = '편집 이슈';
      lines.push(`방송이 나갔다. ${state.pdef.edit.bad}`, `📺 편집 위험도 ${Math.round(negProb * 100)}% — ${big ? '큰 타격' : '타격'}`, fxLine(eff));
      state.cooldown = 1; state.brightNext = true;
      pushLog(state, `[억까] ${state.pdef.edit.kind} — 편집 위험 ${Math.round(negProb * 100)}%로 불리한 편집이 방송됨`);
      pushFront(state, [text('📺 방송 반응: 억까 발생', lines, { bg: 'stage', bad: true }), responseScene(state)]);
    } else if (outcome === 'good') {
      const eff = applyFx(state, { favor: 6, aw: 4, coh: 2 });
      lines.push('방송이 나갔다. 제작진은 이번 갈등을 호의적으로 편집했다. 진심이 전해졌다는 반응이 이어진다.', fxLine(eff));
      pushLog(state, '[편집] 갈등 장면이 호의적으로 편집됨');
      state.chain = null; pushFront(state, [text('📺 방송 반응: 호의적 편집', lines, { bg: 'stage' })]);
    } else {
      lines.push('방송이 나갔다. 다행히 큰 왜곡 없이 지나갔다. 분량도 무난했다.');
      state.chain = null; pushFront(state, [text('📺 방송 반응: 무난', lines, { bg: 'stage' })]);
    }
  }

  function responseScene(state) {
    const ch = state.chain;
    const p = player(state);
    const T = D().chain.response;
    const guarded = ch.guard > 0.15;
    return eventScene(state, T.title, T.text + (guarded ? '\n(사전에 발언을 점검해 둔 덕에 증빙 자료가 있다.)' : ''), 'office', [
      { label: '[회복] 대응하지 않고 다음 무대에 집중한다', fx: { mental: 3 }, run: (s) => { s.recover = 2; s.chain = null; return '이번 라운드가 끝날 때까지 침묵. 이후 두 번의 무대에서 천천히 신뢰가 돌아올 것이다.'; } },
      { label: '[수습] 입장문·해명 영상 (자금 1)', cost: 1, fx: { funds: -1 }, run: (s) => {
        const ok = s.rng() < 0.5 + s.mgr.trust * 0.003 + (guarded ? 0.15 : 0);
        const pl = player(s);
        if (ok) { const back = s.chain.loss * 0.55; pl.favor = clamp(pl.favor + back, 0, 100); s.chain = null; pushLog(s, '[수습] 해명이 받아들여져 호감도 일부 회복'); return `해명이 받아들여졌다. 호감도 +${round1(back)}`; }
        pl.favor = clamp(pl.favor - 3, 0, 100); s.chain = null; pushLog(s, '[수습 실패] 해명 영상이 오히려 논란을 키움'); return '해명 영상이 오히려 논란을 키웠다. 호감도 -3';
      } },
      { label: '[수습·역전] 동료 증언 요청 (다음 주 슬롯 -1)', fx: {}, run: (s) => {
        s.slotPenalty = 1;
        const pl = player(s);
        const ok = s.rng() < 0.3 + s.mgr.trust * 0.004 + (pl.coh / 100) * 0.2 + (s.chain.resolved ? 0.2 : 0);
        if (ok) {
          const back = s.chain.loss * 0.8 + 4; pl.favor = clamp(pl.favor + back, 0, 100); pl.fans += 6000 + pl.fans * 0.05; s.arcPoints += 1; s.chain = null; pushLog(s, '[역전] 동료의 증언으로 여론이 뒤집힘 — 팬 대폭 증가');
          return `동료의 진심 어린 증언이 화제가 됐다. 역전 서사 완성! 호감도 +${round1(back)} · 팬 증가`;
        }
        s.chain = null; applyFx(s, { mental: -3 }); return '증언 영상은 크게 주목받지 못했다. 멘탈 -3';
      } },
    ]);
  }

  // ───────────────────────── 매니저 행동 ─────────────────────────
  function actionsScene(state, info) {
    const phase = info.phase;
    const menu = D().actions
      .filter((a) => a.phase.includes(phase))
      .filter((a) => !(info.kind === 'open' && a.special && a.special.startsWith('negotiate')))
      .map((a) => ({ id: a.id, label: a.label, desc: a.desc, cost: a.cost || 0 }));
    return { type: 'actions', title: '매니저 집중 행동', bg: phase === 'prep' ? 'practice' : 'backstage', menu, log: [], lines: [`이번 주 집중 행동을 ${state.slotsLeft}개 고르세요. 정규 훈련·식사·수면은 자동으로 진행됩니다.`] };
  }

  function doAction(state, id) {
    const s = state.scene;
    if (!s || s.type !== 'actions' || state.slotsLeft <= 0) return;
    const a = D().actions.find((x) => x.id === id);
    if (!a) return;
    if (a.cost && state.mgr.funds < a.cost) { s.log.push('자금이 부족합니다.'); return; }
    const p = player(state);
    const out = [];
    if (a.cost) state.mgr.funds = round1(state.mgr.funds - a.cost);
    if (a.train) {
      const gain = (1.8 + state.rng() * 1.2) * p.growth;
      p.skills[a.train] = clamp(p.skills[a.train] + gain, 0, 100);
      out.push(`${SKILL_KO[a.train]} +${round1(gain)} (${Math.round(p.skills[a.train])})`);
      state.trained += 1;
    }
    if (a.fx) {
      const fx = { ...a.fx };
      if (a.cost) delete fx.funds;
      out.push(...applyFx(state, fx));
    }
    switch (a.special) {
      case 'negotiate_main': {
        const okP = 0.45 + state.mgr.trust * 0.003 + (p.tier <= 2 ? 0.08 : 0) - state.pdef.hostile * 0.1;
        if (state.rng() < okP) { p.part = 'main'; out.push('협상 성공: 메인 파트 확보 (노출 ↑ · 점수 변동 큼)'); }
        else { p.part = 'safe'; state.forceConflict = true; pushLog(state, '[협상] 메인 파트 협상 결렬 → 갈등'); out.push('협상 결렬: 안정적인 파트로 밀려났다. 갈등 장면이 제작진 눈에 띌 수 있다.'); }
        break;
      }
      case 'negotiate_safe': p.part = 'safe'; out.push('안정적인 파트 확보 (점수 +2, 노출 보통)'); break;
      case 'analyze': state.analyzedWeek = state.week; out.push(...analyzeReport(state)); break;
      case 'mediate':
        if (state.teamPen > 0) { state.teamPen = Math.max(0, state.teamPen - 1.5); out.push('팀 소통 문제 완화 (팀 미션 감점 -1.5)'); }
        if (state.chain) { state.chain.risk = clamp(state.chain.risk - 0.1, 0, 1); state.chain.resolved = true; out.push('갈등 완화: 편집 위험 ↓'); }
        out.push(...applyFx(state, { trust: 2, mental: 3 }));
        break;
      default:
    }
    state.slotsLeft -= 1;
    state.chosenActions.push(id);
    s.log.push(`▶ ${a.label}`, ...out.map((o) => '   ' + o));
    s.slots = state.slotsLeft;
    if (state.slotsLeft <= 0) { s.done = true; }
  }

  function analyzeReport(state) {
    const p = player(state);
    const info = state.info;
    const m = info.mission;
    const list = alive(state);
    const avg = {};
    SKILLS.forEach((k) => { avg[k] = list.reduce((a, c) => a + c.skills[k], 0) / list.length; });
    const keys = Object.keys(m.w);
    const lines = [];
    const weights = keys.filter((k) => k in m.w).sort((a, b) => m.w[b] - m.w[a]).slice(0, 2).map((k) => `${SKILL_KO[k]} ${Math.round(m.w[k] * 100)}%`);
    lines.push(`📋 ${m.name}은 ${weights.join(' · ')} 비중이 높은 미션이다.`);
    const rows = keys.map((k) => ({ k, w: m.w[k], v: p.skills[k], diff: p.skills[k] - avg[k], need: m.w[k] * Math.max(0, 85 - p.skills[k]) }));
    const best = [...rows].sort((a, b) => b.need - a.need)[0];
    const worst = [...rows].sort((a, b) => a.need - b.need)[0];
    rows.sort((a, b) => b.w - a.w).slice(0, 3).forEach((r) => {
      lines.push(`   ${SKILL_KO[r.k]} ${Math.round(r.v)} (참가자 평균 ${Math.round(avg[r.k])}, ${r.diff >= 0 ? '+' : ''}${Math.round(r.diff)})`);
    });
    if (best.k !== worst.k) lines.push(`➜ 추가 ${SKILL_KO[worst.k]} 훈련보다 ${SKILL_KO[best.k]} 훈련이 이번 무대 점수에 더 도움이 된다.`);
    else lines.push(`➜ ${SKILL_KO[best.k]} 훈련이 이번 무대 점수에 가장 효율적이다.`);
    if (m.team && state.teamPen > 0) lines.push(`⚠ 팀 미션: 협업 문제로 약 -${round1(state.teamPen)}점. 관계 중재로 줄일 수 있다.`);
    if (m.serious && state.seriousPen > 0) lines.push(`⚠ 진지한 무대: 약 -${round1(state.seriousPen)}점의 부담이 있다.`);
    if (p.stamina < 50 || p.mental < 40) lines.push(`⚠ 컨디션: 체력 ${Math.round(p.stamina)} / 멘탈 ${Math.round(p.mental)} — 무대 점수가 깎인다.`);
    if (p.awareness > 50 && p.favor < 40) lines.push('📊 관심은 높지만 호감이 낮아 팬으로 전환되지 않고 있다. 좋은 무대와 호감 이벤트가 필요하다.');
    else if (p.favor > 60 && p.awareness < 30) lines.push('📊 호감은 높지만 아는 사람이 적다. 노출과 홍보가 필요하다.');
    else if (p.fans > 0 && p.coh < 35) lines.push('📊 고정 팬은 있으나 결속이 약해 투표로 이어지지 않는다. 팬 소통이 효과적이다.');
    if (state.chain) lines.push(`🔎 ${state.pdef.edit.hint}.`);
    return lines;
  }

  // ───────────────────────── 준비 주간 결과 ─────────────────────────
  function prepRelease(state) {
    const p = player(state);
    const m = state.info.mission;
    alive(state).forEach((c) => {
      c.awareness = clamp(c.awareness + state.rng() * 1.5, 0, 100);
      c.favor = clamp(c.favor + (state.rng() - 0.5) * 3, 0, 100);
    });
    const lines = [];
    const eff = {};
    if (state.trained > 0 || p.ready > 0) { eff.favor = 1.5; eff.aw = 1.5; }
    const e = applyFx(state, eff);
    lines.push(state.trained > 0 ? '연습 영상이 공개됐다. 꾸준한 노력이 눈에 띈다는 반응이 있다.' : '연습 영상이 공개됐다. 반응은 평이하다.');
    if (state.chain && state.chain.interviewDone) lines.push('인터뷰 촬영이 끝났다. 어떻게 편집될지는 방송에서 확인할 수 있다.');
    // 중간 평가 (트레이너 코멘트): 노이즈 없는 점수의 예상 순위권
    const list = alive(state);
    const qs = list.map((c) => ({ c, q: quality(state, c, m, false) })).sort((a, b) => b.q - a.q);
    const qr = qs.findIndex((x) => x.c.id === p.id) + 1;
    const pct = Math.ceil((qr / qs.length) * 100);
    lines.push(`📝 중간 평가: 이번 미션 기준 예상 실력은 상위 ${pct}% (${qr}/${qs.length}위권).`);
    state.lastQ = qr;
    rank(state, false);
    recordHist(state, false);
    lines.push(`📈 ${standingLine(state)}`);
    if (e.length) lines.push(fxLine(e));
    pushFront(state, [text('준비 주간 결산', lines, { bg: 'studio', release: true }), rankScene(state, false)]);
    state.trained = 0;
  }

  // ───────────────────────── 방송 무대 ─────────────────────────
  function runStage(state) {
    const info = state.info;
    const m = info.mission;
    const list = alive(state);
    const p = player(state);
    list.forEach((c) => {
      if (!c.player) c.part = state.rng() < 0.4 ? 'main' : 'safe';
      c.Q = quality(state, c, m);
    });
    const sorted = [...list].sort((a, b) => b.Q - a.Q);
    sorted.forEach((c, i) => { c.qrank = i + 1; c.qpct = 1 - i / (sorted.length - 1 || 1); });
    const exposureT = D().tier.exposure;
    list.forEach((c) => {
      const before = { aw: c.awareness, favor: c.favor, fans: c.fans };
      const expo = exposureT[c.tier] * (c.part === 'main' ? 1.4 : 0.85);
      let gain = 2 + expo * 4 + (c.qpct - 0.5) * 5;
      if (c.qpct > 0.92) gain += 3;
      c.note = '';
      if (!c.player) {
        const ev = state.rng();
        if (ev < 0.15) { gain += 5; c.note = '화제의 무대'; }
        else if (ev < 0.25) { c.favor = clamp(c.favor - 6, 0, 100); gain += 4; c.note = '논란'; }
      }
      c.awareness = clamp(c.awareness + gain * (1 - c.awareness / 115), 0, 100);
      let dF = (c.qpct - 0.5) * 9 * (c.qpct > 0.5 ? 1 + (1 - c.favor / 100) * 0.9 : 1) + (c.Q - 65) * 0.05;
      if (c.player && state.recover > 0) dF += 3;
      c.favor = clamp(c.favor + dF, 0, 100);
      const conv = clamp((c.favor - 30) / 70, 0, 1);
      const fanGain = Math.max(0, gain) * 2600 * Math.pow(conv, 1.5) * (1 + (c.coh / 100) * 0.3);
      const churn = c.fans * (0.01 + (Math.max(0, 40 - c.favor) / 40) * 0.08 + (1 - c.coh / 100) * 0.015);
      c.fans = Math.max(0, c.fans + fanGain - churn);
      c.coh = clamp(c.coh + (c.qpct - 0.5) * 3, 0, 100);
      c.d = { aw: c.awareness - before.aw, favor: c.favor - before.favor, fans: c.fans - before.fans, fansBase: Math.max(1, before.fans) };
      c.ready = 0;
    });
    if (state.recover > 0) state.recover -= 1;
    // 연출 텍스트
    const lines = [];
    const part = p.part === 'main' ? '메인 파트' : p.part === 'safe' ? '안정 파트' : '기본 파트';
    lines.push(`${m.name} 무대. ${p.name}은 ${part}를 맡았다.`);
    const pct = Math.ceil((p.qrank / list.length) * 100);
    lines.push(`🎤 무대 평가: ${p.qrank}위 / ${list.length}명 (상위 ${pct}%)`);
    const topS = Object.keys(m.w).sort((a, b) => m.w[b] * p.skills[b] - m.w[a] * p.skills[a])[0];
    lines.push(p.qpct > 0.7 ? `${SKILL_KO[topS]} 파트에서 특히 빛났다. 관객석이 술렁였다.` : p.qpct > 0.35 ? '무난하게 소화했지만 눈에 띄는 임팩트는 부족했다.' : '컨디션과 준비 부족이 무대에서 드러났다.');
    const why = [];
    if (state.crisis.level >= 2) why.push('위기 상태로 수행 능력 저하');
    if (m.team && state.teamPen > 0) why.push(`팀 미션 협업 감점 -${round1(state.teamPen)}`);
    if (m.serious && state.seriousPen > 0) why.push(`진지한 무대 부담 -${round1(state.seriousPen)}`);
    if (p.stamina < 50) why.push('체력 저하');
    if (p.mental < 40) why.push('멘탈 저하');
    if (state.chosenActions.includes('rehearse')) why.push('리허설 효과');
    if (why.length) lines.push(`🔍 점수에 영향을 준 요인: ${why.join(' · ')}`);
    lines.push(`📊 인지도 ${p.d.aw >= 0 ? '+' : ''}${round1(p.d.aw)} · 호감도 ${p.d.favor >= 0 ? '+' : ''}${round1(p.d.favor)} · 고정 팬 ${p.d.fans >= 0 ? '+' : ''}${Math.round(p.d.fans).toLocaleString()}명`);
    const topN = sorted.slice(0, 3).map((c) => c.name).join(', ');
    lines.push(`이번 무대 상위: ${topN}`);
    lines.push(...snsLines(state, p));
    p.stamina = clamp(p.stamina - 8, 0, 100);
    p.mental = clamp(p.mental - (p.qpct < 0.3 ? 5 : 0) + (p.qpct > 0.8 ? 4 : 0), 0, 100);
    p.part = null;
    pushFront(state, [text('🎬 무대 결과', lines, { bg: 'stage', stage: true })]);
  }

  function snsLines(state, p) {
    const hi = ['"%n 이번 무대 진짜 레전드다"', '"직캠 100번 봤다 ㅠㅠ"', '"이 정도면 센터도 가능한 거 아님?"'];
    const mid = ['"무난하게 잘했는데 임팩트가 좀…"', '"%n 파트 더 줘라 제발"', '"다음 무대가 기대된다"'];
    const lo = ['"오늘 컨디션 안 좋아 보이던데…"', '"%n 힘내라, 다음엔 잘할 거야"'];
    const pool = p.qpct > 0.7 ? hi : p.qpct > 0.35 ? mid : lo;
    const picks = [pick(state.rng, pool).replace('%n', p.name), pick(state.rng, pool).replace('%n', p.name)];
    if (p.favor < 25) picks.push('"솔직히 이미지가 좀…" (호감도가 낮아 악플이 섞여 있다)');
    return ['💬 반응: ' + [...new Set(picks)].join('  ')];
  }

  // ───────────────────────── 순위 발표 ─────────────────────────
  function announce(state) {
    const info = state.info;
    const p = player(state);
    rank(state, true);
    recordHist(state, true);
    const q = [];
    const rows = alive(state).sort((a, b) => a.rank - b.rank);
    // 서하연/유나: 발표 충격
    const shock = state.pdef.traits.announceShock;
    if (shock && p.rank > p.prevRank) { applyFx(state, { mental: -shock }); }
    q.push(rankScene(state, true));
    const cut = D().cuts[info.round];
    const out = [];
    if (cut && info.round > 0) {
      const gone = rows.filter((c) => c.rank > cut);
      gone.forEach((c) => { c.alive = false; });
      out.push(...gone);
      const safe = p.rank <= cut;
      pushLog(state, `[발표] ${info.round === 6 ? '최종' : 'R' + info.round} ${p.rank}위 — ${safe ? '생존' : '탈락'}`);
      const lines = [`${info.round === 6 ? '최종 데뷔' : 'R' + info.round + ' 순위 발표'}: ${cut}명이 남았다. ${out.length}명이 탈락했다.`,
        `탈락자 중 눈에 띄는 이름: ${out.slice(0, 5).map((c) => c.name + '(' + c.rank + '위)').join(', ')}…`,
        `${p.name}: ${p.rank}위 — ${safe ? (info.round === 6 ? '데뷔 확정!' : '생존!') : '탈락'}`];
      if (p.reasons.length) lines.push('순위 변동 요인: ' + p.reasons.join(' · '));
      q.push(text('📣 순위 발표', lines, { bg: 'stage', announce: true }));
      if (!safe) q.push(hook((s) => endGame(s, info.round === 6 || info.round === 5 ? 'final' : 'out')));
      else if (info.round === 6) q.push(hook((s) => endGame(s, p.rank === 1 ? 'center' : 'debut')));
    } else if (info.kind === 'open') {
      const g = grade(state, p);
      q.push(text('등급 평가 결과', [`${p.name}의 등급은 ${g}. 시청자가 처음 만난 ${p.name}에 대한 반응이 순위로 나왔다.`, `${p.rank}위 — ${p.reasons.join(' · ') || '평가 결과 반영'}`], { bg: 'stage' }));
    } else {
      const lines = [`${p.name}: ${p.rank}위 (${p.prevRank - p.rank >= 0 ? '▲' : '▼'}${Math.abs(p.prevRank - p.rank)})`];
      if (p.reasons.length) lines.push('순위 변동 요인: ' + p.reasons.join(' · '));
      q.push(text('순위 요약', lines, { bg: 'stage' }));
    }
    pushFront(state, q);
    state.prevAnnounceRank = p.rank;
  }

  function recordHist(state, official) {
    const p = player(state);
    state.hist = state.hist.filter((h) => !(h.week === state.week && h.official === official));
    state.hist.push({ week: state.week, rank: p.rank, official, alive: alive(state).length });
  }

  function grade(state, p) {
    const sorted = alive(state).sort((a, b) => a.qrank - b.qrank);
    const idx = sorted.findIndex((c) => c.id === p.id);
    const pc = idx / sorted.length;
    return pc < 0.1 ? 'A' : pc < 0.3 ? 'B' : pc < 0.55 ? 'C' : pc < 0.8 ? 'D' : 'F';
  }

  function rankScene(state, official) {
    return { type: 'rank', title: official ? '📣 공식 순위' : '📈 예상 순위 (지지 추세)', official, bg: 'stage', rows: null, week: state.week };
  }

  // ───────────────────────── 엔딩 ─────────────────────────
  function endGame(state, kind) {
    if (state.over) return;
    state.over = true;
    state.queue = [];
    const E = D().endings;
    const p = player(state);
    const arcOk = state.arcPoints >= 1;
    const bondKey = state.mgr.trust >= 70 ? 'deep' : state.mgr.trust >= 40 ? 'work' : 'broke';
    let head, body;
    if (kind === 'withdraw') {
      head = { title: '자진 하차' }; body = E.withdraw;
    } else { head = E.result[kind]; body = head.text; }
    const lines = [body];
    lines.push(`개인 서사 [${state.pdef.arc.name}]: ${arcOk ? state.pdef.arc.resolved : state.pdef.arc.unresolved}`);
    lines.push(E.bond[bondKey]);
    if ((kind === 'out' || kind === 'final') && arcOk && p.favor >= 40) lines.push(E.comeback);
    let tag = '';
    if (kind === 'center') tag = '해피 엔딩';
    else if (kind === 'debut') tag = arcOk ? '서사 엔딩' : '일반 엔딩';
    else if (kind === 'final') tag = arcOk ? '서사 엔딩' : '아쉬운 엔딩';
    else if (kind === 'out') tag = arcOk ? '서사 엔딩' : '아쉬운 엔딩';
    else tag = '배드 엔딩';
    const finalRank = p.rank;
    state.final = { kind, rank: finalRank, arcOk, bondKey, tag };
    state.scene = null;
    state.queue = [{
      type: 'ending', title: `${tag} — ${head.title}`, bg: 'stage', lines,
      summary: { name: p.name, rank: finalRank, week: state.week, trust: Math.round(state.mgr.trust), arc: state.pdef.arc.name, arcOk, tag, kind },
    }];
  }

  // ───────────────────────── 조회 ─────────────────────────
  function view(state) {
    const p = player(state);
    const info = state.info || weekInfo(Math.max(1, state.week));
    return {
      player: p, info, mgr: state.mgr, alive: alive(state).length, vote: voteCfg(state),
      rankMode: state.rankMode, crisis: state.crisis.level, teamPen: state.teamPen, seriousPen: state.seriousPen,
      arc: { name: state.pdef.arc.name, points: state.arcPoints },
      chain: state.chain ? { stage: state.chain.interviewDone ? '인터뷰 완료' : '갈등 진행', risk: Math.round(state.chain.risk * 100) } : null,
    };
  }
  function ranking(state) {
    return alive(state).sort((a, b) => a.rank - b.rank);
  }
  function detail(state, id) {
    const c = byId(state, id);
    const rel = (rid) => { const o = byId(state, rid); return { id: o.id, name: o.name, label: o.labelName, rank: o.alive ? o.rank : null }; };
    return { c, friend: rel(c.rel.friend), rival: rel(c.rel.rival), reasons: c.reasons, delta: c.prevRank - c.rank };
  }

  // ───────────────────────── 저장/불러오기 ─────────────────────────
  // 주 경계(큐가 비어 있을 때)에서만 저장한다: 장면 큐에는 함수가 들어 있기 때문.
  function serialize(state) {
    const o = Object.assign({}, state);
    delete o.rng; delete o.queue; delete o.scene; delete o.pdef;
    o.pdefId = state.pdef.id;
    o.rngState = state.rng.get();
    o.saveVersion = SAVE_VERSION;
    return JSON.stringify(o);
  }
  function deserialize(json) {
    const o = JSON.parse(json);
    if (o.saveVersion !== SAVE_VERSION) throw new Error('저장 데이터 버전이 맞지 않습니다.');
    const pdef = D().protagonists.find((p) => p.id === o.pdefId);
    if (!pdef) throw new Error('저장 데이터의 주인공을 찾을 수 없습니다.');
    const rng = mulberry32(0);
    rng.set(o.rngState);
    delete o.rngState; delete o.pdefId;
    return Object.assign(o, { rng, queue: [], scene: null, pdef });
  }
  function saveInfo(json) {
    try {
      const o = JSON.parse(json);
      const pdef = D().protagonists.find((p) => p.id === o.pdefId);
      const me = o.contestants.find((c) => c.id === o.playerId);
      return { name: pdef.name, star: pdef.star, week: o.week, rank: me.rank, alive: o.contestants.filter((c) => c.alive).length };
    } catch (e) { return null; }
  }

  const api = { VERSION, newGame, next, choose, doAction, view, ranking, detail, weekInfo, player, byId, SKILLS, SKILL_KO, rank, votes, alive, serialize, deserialize, saveInfo, onWeekBoundary: null };
  root.Engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
