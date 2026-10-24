// "영입하면" 카드: preview-signing.js 의 계산 결과를 보여 준다(계산은 거기, 여기는 표시만).
import { h, eok } from './dom.js';
import { playerLink } from './player-info.js';
import { ROLE_TEXT } from './preview-signing.js';

const man = (usd) => `${Math.round(usd / 10000).toLocaleString('ko-KR')}만 달러`;
const arrow = (a, b) => `${a} → ${b}`;

function capLines(imp) {
  if (imp.domestic) {
    const d = imp.domestic;
    const lines = [h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '국내 캡 여유'),
      h('b', { class: d.roomAfter < 0 ? 'bad' : '' }, arrow(eok(d.roomBefore), eok(d.roomAfter))),
      h('span', { class: 'note' }, `연봉 ${arrow(eok(d.before), eok(d.after))} / 캡 ${eok(d.cap, 0)}`))];
    if (d.over > 0) {
      lines.push(h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '소프트캡 초과'),
        h('b', { class: d.overHard ? 'bad' : 'warn' }, `${eok(d.over)} 초과 · 시즌 말 기금 약 ${eok(d.penaltyAfter)}`),
        h('span', { class: 'note' }, d.penaltyBefore > 0 ? `지금 ${eok(d.penaltyBefore)}` : `한도 ${eok(d.hardLimit)}`)));
    }
    return lines;
  }
  if (imp.foreign) {
    const f = imp.foreign;
    return [h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '외국 선수 연봉 합'),
      h('b', { class: f.afterUsd > f.limitUsd ? 'bad' : '' }, arrow(man(f.beforeUsd), man(f.afterUsd))),
      h('span', { class: 'note' }, `한도 ${man(f.limitUsd)}`))];
  }
  if (imp.asia) {
    return [h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '아시아쿼터 연봉'), h('b', arrow(eok(imp.asia.beforeEok), eok(imp.asia.afterEok))))];
  }
  return [];
}

/**
 * impact: signingImpact() 결과. opts.title 카드 제목, opts.note 아래 덧붙일 설명(예: "다른 제안은 반영하지 않은 단독 기준").
 */
export function signingPreviewCard(imp, { title = '영입하면', note = null, ctx = undefined, blockedLabel = '영입 불가' } = {}) {
  const roleBefore = imp.role.before ? ROLE_TEXT[imp.role.before] : '새 선수';
  const roleAfter = ROLE_TEXT[imp.role.after] ?? '아직 정할 수 없음(선수가 모자라 편성 불가)';
  const rosterText = imp.roster.maxByOrigin != null
    ? `${arrow(imp.roster.countByOrigin.before, imp.roster.countByOrigin.after)}명 / 정원 ${imp.roster.maxByOrigin}명`
    : arrow(imp.roster.before, imp.roster.after);
  const comps = imp.competitors.length
    ? imp.competitors.map((c, i) => h('span', { class: 'sp-comp' }, i ? ' · ' : '',
      playerLink(c.player.id, c.player.name, { ctx, cls: 'sp-link' }), ` (${c.player.ovr}${c.diff === 0 ? ', 동률' : c.diff > 0 ? `, 이 선수가 +${c.diff}` : `, 이 선수가 ${c.diff}`})`))
    : [h('span', { class: 'muted' }, '같은 포지션 선수가 없습니다')];
  return h('div', { class: `sp-card ${imp.ok ? '' : 'blocked'}`, role: 'group', 'aria-label': title },
    h('div', { class: 'sp-head' }, h('b', title), imp.ok ? null : h('span', { class: 'sp-blocked' }, `${blockedLabel}: ${imp.reason ?? '조건 미충족'}`)),
    ...capLines(imp),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '예상 역할'), h('b', imp.role.before && imp.role.before !== imp.role.after ? arrow(roleBefore, roleAfter) : roleAfter), h('span', { class: 'note' }, '자동 편성 기준')),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '같은 포지션 경쟁'), h('span', comps)),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '로스터'), h('b', rosterText)),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '다음 시즌 확정 지출'),
      h('b', eok(imp.next.eok)), h('span', { class: 'note' }, imp.next.thisContractContinues ? `이 계약 포함(${imp.next.years}년)` : '이 계약은 올해로 끝')),
    note ? h('p', { class: 'note sp-note' }, note) : null);
}

/** 목록 행 안에 넣는 접이식 버전: 접힌 상태에서도 핵심 한 줄(캡 여유·역할)이 보인다 */
export function signingPreviewDetails(imp, opts = {}) {
  const title = opts.title ?? '영입하면', bl = opts.blockedLabel ?? '영입 불가';
  const d = imp.domestic, f = imp.foreign, a = imp.asia;
  const cap = d ? `캡 여유 ${eok(d.roomBefore)} → ${eok(d.roomAfter)}` : f ? `외국 연봉 ${man(f.beforeUsd)} → ${man(f.afterUsd)}` : a ? `아시아쿼터 ${eok(a.beforeEok)} → ${eok(a.afterEok)}` : '';
  const sum = `${title} — ${cap} · ${ROLE_TEXT[imp.role.after] ?? '역할 미정'} 예상${imp.ok ? '' : ` · ${bl}`}`;
  return h('details', { class: `sp-details ${imp.ok ? '' : 'blocked'}`, open: opts.open ? '' : null }, h('summary', sum), signingPreviewCard(imp, opts));
}

/** 트레이드 영향 카드 (tradeImpact 결과) */
export function tradePreviewCard(imp, { ctx = undefined, note = null } = {}) {
  const d = imp.domestic;
  const who = (list) => list.map((x, i) => h('span', i ? ' · ' : '', playerLink(x.player.id, x.player.name, { ctx, cls: 'sp-link' }), ` (${ROLE_TEXT[x.role] ?? '역할 미정'})`));
  return h('div', { class: `sp-card ${imp.ok ? '' : 'blocked'}`, role: 'group', 'aria-label': '트레이드하면' },
    h('div', { class: 'sp-head' }, h('b', '트레이드하면'), imp.ok ? null : h('span', { class: 'sp-blocked' }, `성사 불가: ${imp.reason ?? '조건 미충족'}`)),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '국내 캡 여유'), h('b', { class: d.roomAfter < 0 ? 'bad' : '' }, arrow(eok(d.roomBefore), eok(d.roomAfter))), h('span', { class: 'note' }, `연봉 ${arrow(eok(d.before), eok(d.after))} / 캡 ${eok(d.cap, 0)}${d.over > 0 ? ` · 초과 기금 약 ${eok(d.penaltyAfter)}` : ''}`)),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '받는 선수 역할'), h('span', who(imp.incoming))),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '보내는 선수 지금 역할'), h('span', who(imp.outgoing))),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '로스터'), h('b', arrow(imp.roster.before, imp.roster.after))),
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-k' }, '다음 시즌 확정 지출'), h('b', eok(imp.next.eok)), h('span', { class: 'note' }, `거래 전 ${eok(imp.next.before)}`)),
    note ? h('p', { class: 'note sp-note' }, note) : null);
}
