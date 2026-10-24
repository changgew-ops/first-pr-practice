// 홈 "지금 해야 할 일": 우선순위별 목록을 만드는 순수 함수(DOM·세션 없음). 화면(web/views/todo-card.js)이 세션에서 입력을 모아 넘긴다.
// 필수 = 진행을 막거나 즉시 대응이 필요한 일, 검토 = 곧 판단이 필요한 일, 참고 = 접어 두는 소식.
// 목록은 상태를 읽어 매번 다시 만들기 때문에 해소된 일은 저절로 사라지고, 같은 사건은 id가 같아 한 번만 나온다. 임계값은 rules.todo.
//
// 입력(전부 선택, 없으면 그 항목이 비어 있다):
//  stage('regular'|'playoffs'|'offseason'), day, season(표시용 시즌 라벨), rules(rules.todo와 rules.lineup),
//  roster(우리 선수들), starters(지금 실제로 뛰는 스타팅 선수 객체들), injuries([{ playerId, name, left, kind, part }], 우리 구단),
//  cond(id → 컨디션 | null), alerts(아직 해소 안 된 중요 사건 [{ id, kind, day, text, replaceable? }]), waivers([{ player, expires, left, mine }]),
//  pendingLabel(오프시즌에 결정을 기다리는 단계 이름), news([{ headline, when }]), achievements([{ id, name }]), healthyMin(출전 최소 인원)
// 항목: { id, kind, level('must'|'review'|'info'), text, to(해시 경로), playerId?, weight(검토 정렬용, 클수록 먼저) }
const DEFAULTS = { conditionLow: 55, maxReview: 5, expiringYears: 1, waiverLeftDays: 1, infoNews: 2, infoAchievements: 3 };

export function buildTodo(input = {}) {
  const r = { ...DEFAULTS, ...(input.rules ?? {}) };
  const roster = input.roster ?? [];
  const injuries = input.injuries ?? [];
  const starters = input.starters ?? [];
  const stage = input.stage ?? null;
  const inSeason = stage === 'regular' || stage === 'playoffs';
  const hurt = new Map(injuries.map((i) => [i.playerId, i]));
  const must = [], review = [], info = [];
  const seen = new Set();
  const add = (list, it) => { if (seen.has(it.id)) return; seen.add(it.id); list.push(it); };

  // ---- 필수 ----
  if (stage === 'offseason' && input.pendingLabel) add(must, { id: 'pending', kind: 'pending', level: 'must', text: `오프시즌 결정이 기다립니다: ${input.pendingLabel}`, to: '#/offseason', weight: 100 });
  if (inSeason) {
    const healthy = roster.filter((p) => !hurt.has(p.id)).length;
    const min = input.healthyMin ?? 0;
    const shortage = (input.alerts ?? []).find((a) => a.kind === 'shortage');
    if (shortage || (min && roster.length && healthy < min)) add(must, { id: 'shortage', kind: 'shortage', level: 'must', text: shortage?.text ?? `건강한 선수가 ${healthy}명뿐입니다(최소 ${min}명). 영입이나 교체가 필요합니다`, to: '#/roster', weight: 90 });
  }

  // ---- 검토 ----
  if (inSeason) {
    // 주전의 중상(진행 중단 알림과 같은 사건) · 일반 부상은 스타팅이 2경기 이상 빠질 때만
    const majorIds = new Set((input.alerts ?? []).filter((a) => a.kind === 'injury').map((a) => a.playerId));
    for (const inj of injuries) {
      const isStarter = starters.some((p) => p.id === inj.playerId);
      if (!majorIds.has(inj.playerId) && !(isStarter && (inj.left ?? 0) >= 2)) continue;
      add(review, { id: `injury:${inj.playerId}`, kind: 'injury', level: 'review', playerId: inj.playerId, text: `${inj.name} 부상(${inj.part ?? '부상'}) ${inj.kind === 'season' ? '시즌 아웃' : `${inj.left}경기 결장`} — 대체·교체를 확인하세요`, to: '#/roster', weight: 80 + Math.min(inj.left ?? 0, 20) / 100 });
    }
    // 스타팅 피로
    if (typeof input.cond === 'function') {
      const tired = starters.map((p) => ({ p, c: input.cond(p.id) })).filter((x) => x.c != null && x.c < r.conditionLow && !hurt.has(x.p.id)).sort((a, b) => a.c - b.c);
      for (const { p, c } of tired.slice(0, 3)) add(review, { id: `tired:${p.id}`, kind: 'tired', level: 'review', playerId: p.id, text: `${p.name} 컨디션 ${Math.round(c)} — 쉬게 하거나 교체를 검토하세요`, to: `#/lineup/${p.id}`, weight: 60 + (r.conditionLow - c) / 100 });
      if (tired.length > 3) add(review, { id: 'tired:more', kind: 'tired', level: 'review', text: `컨디션이 낮은 스타팅이 ${tired.length - 3}명 더 있습니다`, to: '#/lineup', weight: 59 });
    }
    // 웨이버 마감 임박(우리 신청 또는 양수 가능한 공시)
    for (const w of input.waivers ?? []) {
      if ((w.left ?? 99) > r.waiverLeftDays) continue;
      const name = w.player?.name ?? '선수';
      add(review, { id: `waiver:${w.player?.id ?? name}`, kind: 'waiver', level: 'review', playerId: w.player?.id, text: w.mine ? `웨이버 공시 마감 임박(${name}) — 곧 결과가 나옵니다` : `${name} 웨이버 공시 마감 임박 — 양수 신청은 지금까지`, to: '#/roster', weight: 50 });
    }
    // 플레이오프권 경계
    const bubble = (input.alerts ?? []).find((a) => a.kind === 'bubble');
    if (bubble) add(review, { id: 'bubble', kind: 'bubble', level: 'review', text: bubble.text, to: '#/lineup', weight: 40 });
    // 계약 만료 예정 요약(시즌 중)
    if (stage === 'regular' && roster.length) {
      const exp = roster.filter((p) => (p.contract?.yearsLeft ?? 99) <= r.expiringYears && (p.contract?.yearsLeft ?? 99) >= 0);
      if (exp.length) add(review, { id: 'expiring', kind: 'expiring', level: 'review', text: `이번 시즌 끝에 계약이 만료되는 선수 ${exp.length}명 (${exp.slice(0, 3).map((p) => p.name).join(', ')}${exp.length > 3 ? ' 외' : ''})`, to: '#/roster', weight: 30 });
    }
  }
  review.sort((a, b) => b.weight - a.weight);

  // ---- 참고 ----
  for (const a of (input.achievements ?? []).slice(0, r.infoAchievements)) add(info, { id: `ach:${a.id}`, kind: 'achievement', level: 'info', text: `업적 달성: ${a.name}`, to: '#/achievements', weight: 0 });
  for (const n of (input.news ?? []).slice(0, r.infoNews)) add(info, { id: `news:${n.headline}`, kind: 'news', level: 'info', text: `${n.when ? `${n.when} · ` : ''}${n.headline}`, to: '#/news', weight: 0 });

  const shown = review.slice(0, r.maxReview);
  return { must, review: shown, reviewMore: review.length - shown.length, reviewAll: review, info, counts: { must: must.length, review: review.length, info: info.length } };
}
