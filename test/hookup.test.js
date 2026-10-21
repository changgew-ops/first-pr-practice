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

// 6. story: the narration follows the pipeline and hits every chapter in order
{
  const HU2 = require('../js/hookup/story.js');
  Object.assign(HU.CONFIG, { seed: 7, defectRate: 0.10 });
  const p = new HU.Pipeline(), beats = []; HU2.createStory(p, b => beats.push(b));
  p.start();
  for (let i = 0; i < 4000 && !p.finished; i++) { p.tick(0.1); if (p.escalations.length && !p.active()) p.approve(p.escalations[0].id); }
  const majors = beats.filter(b => b.major);
  assert(p.finished && majors.length >= 8, 'story has major beats: ' + majors.length);
  assert.strictEqual(beats[0].ch, 1); assert(/의뢰/.test(beats[0].text));
  const firstCh = [1, 2, 3, 4, 5, 6, 7].map(c => beats.findIndex(b => b.ch === c));
  assert(firstCh.every(i => i >= 0), 'every chapter appears: ' + firstCh);
  assert(majors.some(b => /반려/.test(b.text) && /R-0\d/.test(b.text)), 'a reject beat names the rule');
  assert(majors.some(b => b.who === '설계 리드(사람)'), 'human decision beat');
  assert(/최종 리포트/.test(beats[beats.length - 1].text), 'ends with the final report');
  console.log(`story ok · ${beats.length} beats (${majors.length} major)`);
}

// 7. story beats read the finished result (no "undefined", counts are real)
{
  const HU2 = require('../js/hookup/story.js');
  Object.assign(HU.CONFIG, { seed: 7, defectRate: 0.10 });
  const p = new HU.Pipeline(), beats = []; HU2.createStory(p, b => beats.push(b)); p.start();
  for (let i = 0; i < 4000 && !p.finished; i++) { p.tick(0.1); if (p.escalations.length && !p.active()) p.approve(p.escalations[0].id); }
  assert(beats.every(b => !/undefined|NaN/.test(b.text)), 'no undefined in captions');
  assert(beats.some(b => /계기 \d+개 생성/.test(b.text) && !/계기 0개/.test(b.text)), 'instrument counts are real');
  assert(beats.some(b => /재작업 후 통과/.test(b.text)), 'a reworked design passes review');
  console.log('story text ok');
}
