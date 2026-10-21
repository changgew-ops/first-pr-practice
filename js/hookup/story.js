/* Narration for the scenario page: turns pipeline events into "beats" (captions).
 * major beats get a caption + a short pause so viewers can read; minor beats only go to the ticker.
 * Pure JS (no DOM) so it can be tested in node. */
(function (root) {
  'use strict';
  const HU = (root.HU = root.HU || {});

  HU.SCENARIO = {
    title: 'A-Plant U-100 유틸리티 패키지 훅업 설계',
    lead: '가상의 플랜트 A-Plant에서 유틸리티 패키지(스팀·냉각수·계장용 공기)를 증설합니다. 계기 훅업 설계 의뢰가 들어왔어요. 에이전트 팀이 의뢰를 받아 설계를 끝내기까지를 지켜보세요.',
    note: '이 시나리오는 임의로 만든 가상 사례예요. 룰은 예시이고, 에이전트는 시뮬레이션이에요.',
  };
  // chapter = the first moment the story reaches that stage
  HU.CHAPTERS = [
    { id: 1, title: '의뢰 접수', floor: 0 }, { id: 2, title: '시스템 구성', floor: 0 }, { id: 3, title: '객체 생성', floor: 1 },
    { id: 4, title: '배관 설계', floor: 2 }, { id: 5, title: '룰 검수', floor: 3 }, { id: 6, title: '사람의 결정', floor: 2 }, { id: 7, title: '최종 리포트', floor: 3 },
  ];
  const mmss = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  HU.mmss = mmss;

  HU.createStory = function (pipe, push) {
    let seen = {}; const once = k => (seen[k] ? false : (seen[k] = true));
    pipe.on('reset', () => { seen = {}; });   // a restarted run tells its story again
    const beat = (ch, major, who, text, cam) => push({ ch, major, who, text, cam: cam == null ? null : cam, t: pipe.clock });
    const B = HU.BRIEF, eq = B.systems.reduce((n, s) => n + s.equipment.length, 0);
    const bad2txt = b => `${b.id} ${b.title} ${b.status === 'unapplied' ? '미적용' : '값 오류'}`;

    pipe.on('state', st => {
      if (st === 'running' && once('start')) beat(1, true, '의뢰', `${B.project} 의뢰가 들어왔어요. 시스템 ${B.systems.length}개, 설비 ${eq}기. 1층부터 4층까지 4단계로 처리해요.`, 0);
    });
    pipe.on('jobStart', (w, job) => {
      if (job.type === 'define' && once('define')) beat(2, true, `1F ${w.name}`, '의뢰서를 읽고 시스템을 정의해요. 이 단계에는 룰이 없어요.', 0);
      if (job.type === 'equip' && once('equip')) beat(3, true, '2F 객체 생성', '설비 담당과 계기 담당이 설비와 계기를 만들어요. 여기에도 룰은 없어요.', 1);
      if (job.type === 'design' && once('design')) beat(4, true, '3F 배관 설계', '룰이 적용되는 유일한 층이에요. 시스템별 담당이 계기마다 R-01~R-07을 적용해 훅업을 설계해요.', 2);
      if (job.type === 'review' && once('review')) beat(5, true, '4F 룰 검수', '룰이 적용됐는지, 결과가 맞는지 확인해요. 설계한 에이전트가 아닌 다른 에이전트가 봐요.', 3);
    });
    pipe.on('jobDone', (w, job) => {
      if (job.type === 'class') {
        const s = pipe.systems[job.sys];
        if (s.rating > HU.CONFIG.catalogMaxRating) beat(2, true, `1F ${w.name}`, `${s.id} ${s.name}: ${s.pressure} barg → ${s.rating}# 등급. 부품 카탈로그 최대(${HU.CONFIG.catalogMaxRating}#)를 넘어요. 3층에서 문제가 될 거예요.`, 0);
        else beat(2, false, `1F ${w.name}`, `${s.id} ${s.name}: ${s.pressure} barg → ${s.rating}# 등급`, null);
      }
      if (job.type === 'inst') {
        const list = pipe.instruments.filter(i => i.system === job.sys);
        beat(3, false, `2F ${w.name}`, `${job.sys}: 계기 ${list.length}개 생성 (${list.slice(0, 4).map(i => i.tag).join(', ')}${list.length > 4 ? ' …' : ''})`, null);
      }
      if (job.type === 'design' && job.attempt > 0) beat(4, false, `3F ${w.name}`, `${job.tag} 재작업 완료 → 다시 검수로`, null);
      if (job.type === 'review') {
        const rec = pipe.designs[job.tag];
        if (job.attempt > 0 && (rec.status === 'pass' || rec.status === 'waived')) {
          if (once('fixed')) beat(5, true, `4F ${w.name}`, `${job.tag}: 재작업 후 통과. 검수가 없었다면 그대로 나갔을 설계예요.`, 3);
          else beat(5, false, `4F ${w.name}`, `${job.tag} 재작업 후 통과`, null);
        }
      }
    });
    pipe.on('reject', (w, job, bad) => {
      const txt = `${job.tag} 반려: ${bad.map(bad2txt).join(', ')}.`;
      if (once('reject')) beat(5, true, `4F ${w.name}`, `${txt} 3층으로 돌려보내요.`, 3);
      else beat(5, false, `4F ${w.name}`, txt, null);
    });
    pipe.on('escalate', (w, job) => {
      const s = pipe.systems[job.sys];
      if (once('esc-' + job.sys)) beat(6, true, `3F ${w.name}`, `멈췄어요. ${s.id}(${s.pressure} barg)는 요구 등급 ${s.rating}#인데 부품 카탈로그는 ${HU.CONFIG.catalogMaxRating}#까지예요. 룰을 만족시킬 방법이 없어 사람의 결정이 필요해요.`, 2);
    });
    pipe.on('approve', (w, job) => {
      if (once('appr-' + job.sys)) beat(6, true, '설계 리드(사람)', `${job.sys} 예외를 승인했어요. 승인된 계기는 R-07 예외로 기록되고, 설계·검수를 거쳐 '예외 통과'가 돼요.`, 2);
    });
    pipe.on('report', rep => {
      if (rep.escalations.length) beat(7, true, '4F 리포터', `중간 리포트: ${rep.resolved}/${rep.expected}건 완료, ${rep.escalations.length}건은 사람의 결정을 기다려요.`, 3);
      else beat(7, true, '4F 리포터', `최종 리포트: 통과 ${rep.finalPass} · 예외 ${rep.waived} · 재작업 ${rep.reworks}회 · 소요 ${mmss(pipe.clock)}`, 3);
    });
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HU;
})(typeof window !== 'undefined' ? window : globalThis);
