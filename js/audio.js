/* Tiny WebAudio synth for UI/office sound effects (no audio files). Off by default; needs a click to start. */
(function () {
  'use strict';
  const P = (window.PO = window.PO || {});
  let ctx = null, master = null, on = false;
  const last = {};
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination);
  }
  function tone(freq, dur, type, vol, when, to) {
    const t = ctx.currentTime + (when || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  const SFX = {
    tick: () => tone(1300 + Math.random() * 600, 0.025, 'square', 0.04),
    ding: () => { tone(880, 0.12, 'triangle', 0.22); tone(1318, 0.22, 'triangle', 0.2, 0.09); },
    reject: () => tone(190, 0.26, 'sawtooth', 0.18, 0, 90),
    alert: () => { tone(520, 0.12, 'square', 0.16); tone(390, 0.2, 'square', 0.16, 0.14); },
    approve: () => { tone(660, 0.08, 'square', 0.16); tone(990, 0.16, 'square', 0.16, 0.08); },
    done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.16, i * 0.11)),
    floor: () => tone(300, 0.22, 'sine', 0.2, 0, 640),
  };
  P.audio = {
    get on() { return on; },
    set(v) { on = !!v; if (on) { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); this.play('ding', 0); } },
    play(name, gap) {
      if (!on || !ctx) return;
      const now = performance.now(), g = gap == null ? 90 : gap;
      if (last[name] && now - last[name] < g) return; last[name] = now;
      if (SFX[name]) SFX[name]();
    },
  };
})();
