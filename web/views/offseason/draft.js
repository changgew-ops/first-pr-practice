// 신인 드래프트: 우리 차례마다 한 명을 지명한다.
import { h } from '../../lib/dom.js';
import { draftRanking } from '../../lib/offseason-view.js';
import { domesticOf } from '../../../src/valuation.mjs';
import { playerLine, snapshotOf, decide } from './common.js';

// 엔진은 우리 지명 한 번에 policy.draft를 여러 번(선수 목록을 훑으며) 부른다. 결정 키가 호출마다 늘어나므로,
// 같은 선수 목록으로 다시 묻는 것은 방금 고른 선수를 그대로 다시 내서 넘긴다(사람이 다시 고르지 않는다).
const memo = { season: null, sig: null, pick: null, n: 0 };

export function render(ctx, pending) {
  const { available } = pending.payload;
  const sig = available.map((p) => p.id).join(',');
  if (pending.key === 'draft:0' || memo.season !== ctx.session.season) { memo.season = ctx.session.season; memo.sig = null; memo.n = 0; }
  if (memo.sig === sig && memo.pick) {
    setTimeout(() => decide(ctx, pending.key, memo.pick), 0);
    return h('div', { class: 'card' }, h('p', { class: 'muted' }, '지명 처리 중…'));
  }
  memo.sig = sig; memo.pick = null; memo.n += 1;
  const my = ctx.session.managerId;
  const { players, stale } = snapshotOf(ctx.session, pending);
  const roster = domesticOf(players, my);
  const ranking = draftRanking(available, roster);
  const n = memo.n;
  let pick = ranking[0].p.id;
  const rookie = ctx.data.rules.offseason;
  const host = h('div', { class: 'stack' });

  function draw() {
    host.replaceChildren(
      h('div', { class: 'card' },
        h('h2', `신인 드래프트: 우리 ${n}번째 지명`),
        h('p', { class: 'note' }, `하위 팀부터 라운드마다 지명합니다(${rookie.draft.rounds}라운드). 신인 계약은 1라운드 ${rookie.draft.rookieYears}년, 2라운드 ${rookie.draft.rookieYearsRound2}년이고 캡에서 면제됩니다. 순위는 AI와 같은 식(잠재력 60% + 현재 40% + 비어 있는 포지션 보너스)으로 매겼고, 1위가 추천입니다.${stale ? ' 포지션 보너스는 직전 단계까지의 로스터로 계산했습니다.' : ''}`)),
      h('div', { class: 'card flush' }, h('div', { class: 'os-draft' }, ranking.map((r) => h('label', { class: `os-draft-row ${pick === r.p.id ? 'picked' : ''}` },
        h('input', { type: 'radio', name: 'draft', 'aria-label': `${r.p.name} 지명`, checked: pick === r.p.id, onchange: () => { pick = r.p.id; draw(); } }),
        h('span', { class: 'os-rank' }, r.rank === 1 ? '추천' : r.rank),
        playerLine(r.p),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, 'POT'), h('b', r.p.potential)),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, '코스트'), h('b', r.p.cost)),
        r.need ? h('span', { class: 'tag hot' }, `${r.p.position} 필요 +${r.need}`) : h('span', { class: 'tag' }, `${r.p.position} 충분`),
        h('span', { class: 'note' }, `점수 ${r.score.toFixed(1)}`))))),
      h('div', { class: 'os-submit' }, h('span', { class: 'note' }, `선택: ${available.find((p) => p.id === pick).name}`),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => { memo.pick = pick; decide(ctx, pending.key, pick); } }, '지명 확정')));
  }
  draw();
  return host;
}
