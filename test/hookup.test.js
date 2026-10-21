// Run: node test/hookup.test.js
const assert = require('assert');
const HU = require('../js/hookup/core.js');

function run(cfg, approve) {
  Object.assign(HU.CONFIG, { seed: 7, defectRate: 0.10 }, cfg);
  const p = new HU.Pipeline(); const ev = { reject: 0, escalate: 0, handoff: 0 };
  p.on('reject', () => ev.reject++).on('escalate', () => ev.escalate++).on('handoff', () => ev.handoff++);
  p.start();
  for (let i = 0; i < 4000 && !p.finished; i++) {
    p.tick(0.1);
    if (approve && p.escalations.length) p.escalations.slice().forEach(j => p.approve(j.id));
  }
  return { p, ev };
}

// 1. rules are applied only by the design stage: stage 1/2 outputs carry no rule log
{
  const { p } = run({ defectRate: 0 }, true);
  assert(p.instruments.length > 0 && p.instruments.every(i => !('appliedRules' in i)), 'objects must not carry rule results');
  assert(Object.values(p.designs).every(r => r.design.appliedRules.length > 0 || r.design.waivers.length > 0), 'every design logs applied rules or a waiver');
}
// 2. clean run (no injected defects): no rework; the HPS design is parked until a human approves
{
  const { p, ev } = run({ defectRate: 0 }, false);
  assert.strictEqual(ev.reject, 0, 'no rework without injected defects');
  assert.strictEqual(ev.escalate, 3, 'HPS (3 instruments) needs a human decision');
  assert.strictEqual(p.escalations.length, 3);
  assert(!p.finished, 'not finished while a decision is pending');
  assert(p.workers.some(w => p.statusOf(w) === 'blocked'), 'worker shows blocked');
  p.approve(p.escalations[0].id);   // one approval releases the whole system
  assert.strictEqual(p.escalations.length, 0);
  for (let i = 0; i < 2000 && !p.finished; i++) p.tick(0.1);
  assert(p.finished, 'finishes after approval');
  const r = p.lastReport; assert.strictEqual(r.waived, 3); assert.strictEqual(r.finalPass + r.waived, r.expected);
}
// 3. defects are caught by review and fixed by rework
{
  const { p, ev } = run({ defectRate: 0.35 }, true);
  assert(ev.reject > 0, 'review rejects some first-pass designs');
  assert(p.finished, 'pipeline still finishes');
  assert(Object.values(p.designs).every(r => r.status === 'pass' || r.status === 'waived'), 'all designs end passing');
  assert(Object.values(p.designs).some(r => r.attempts > 1), 'some designs were reworked');
}
// 4. deterministic
{
  const a = run({ defectRate: 0.2 }, true).p.lastReport, b = run({ defectRate: 0.2 }, true).p.lastReport;
  assert.deepStrictEqual(a.perRule, b.perRule);
}
// 5. rule checks catch an injected "applied but wrong" slope
{
  const d = { kind: 'pressure', phase: 'gas', components: [], tubing: { length: 5, slope: 0.02, dir: 'down-to-process' }, notes: [] };
  const r6 = HU.RULES.find(r => r.id === 'R-06'); assert(!r6.check(d).ok); r6.apply(d, {}, {}); assert(r6.check(d).ok);
}
const { p } = run({ defectRate: 0.1 }, true), r = p.lastReport;
console.log(`ok · ${r.expected} instruments, ${r.reworks} reworks, ${r.waived} waived, finished at t=${p.clock.toFixed(1)}s`);
