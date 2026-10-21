/* Pipeline workers -> office floor data (shared by the operations page and the scenario page). */
(function () {
  'use strict';
  const HU = (window.HU = window.HU || {});
  function workerData(pipe, w) {
    const st = pipe.statusOf(w), pr = pipe.prog[w.stage], sys = w.systems ? w.systems.join(' · ') : '';
    const summary = w.job ? w.job.label : w.parked.length ? `${w.parked[0].sys} 설계 · 사람 확인 필요` : st === 'done' ? `${w.handled}건 처리 완료` : pipe.state === 'ready' ? '실행 대기 중' : '다음 작업 대기 중';
    return { id: w.id, title: w.name, role: w.role, status: st, summary, kind: 'worker', stage: w.stage, handled: w.handled, systems: sys,
      bar: { value: pr.done, max: Math.max(pr.total, 1) }, parked: w.parked.length ? { id: w.parked[0].id, sys: w.parked[0].sys, count: w.parked.length } : null };
  }
  HU.bridge = {
    workerData,
    pipeFloors: pipe => HU.STAGES.map(s => ({ id: s.id, name: s.name, theme: s.theme, sign: s.sign, stage: s.n, agents: pipe.workers.filter(w => w.stage === s.n).map(w => workerData(pipe, w)) })),
  };
})();
