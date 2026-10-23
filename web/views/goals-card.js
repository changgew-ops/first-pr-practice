// 목표·시즌 평가·팬 열기 카드: 홈의 "올 시즌 목표"(진행 상황 막대), 시즌 결산의 "시즌 평가".
import { h, eok } from '../lib/dom.js';
import { describeGoal, trustTier } from '../../src/goals.mjs';
import { fanFactor, fanAppeal, moodTier } from '../../src/fans.mjs';
import { liveGoals } from '../lib/goals-view.js';

const ROLE = { main: '주 목표', sub: '보조 목표', extra: '추가 목표' };
const STATE = { ok: ['지금 달성권', 'good'], risk: ['위험', 'bad'], pending: ['진행 중', ''] };

/** 신뢰도 한 줄(막대 + 단계 + 경고 문구) */
function trustLine(ctx, trust, status) {
  const rules = ctx.session.rules;
  const t = rules.goals.trust;
  const notes = [];
  if (status === 'risk') notes.push(rules.goals.firing ? '해임 위험: 다음 시즌에도 이 수준이면 해임 통보가 나옵니다.' : '해임 위험 수준입니다. (해임 규칙은 꺼져 있어 게임은 계속됩니다.)');
  else if (trust < t.warnBelow) notes.push('신뢰도가 낮습니다. 모기업이 성과를 지켜보고 있습니다.');
  else if (trust >= t.rewardAt) notes.push(`신뢰도가 높아 시즌이 끝나면 다음 시즌 예산에 ${t.rewardBonus}억 원(물가 반영)이 보너스로 더해집니다.`);
  return h('div', { class: 'gl-trust' },
    h('div', { class: 'row between' }, h('b', '단장 신뢰도'), h('span', { class: `tag ${status === 'risk' ? 'bad' : trust >= t.rewardAt ? 'champ' : ''}` }, `${trust} · ${trustTier(trust, rules)}`)),
    h('div', { class: `bar gl-bar ${status === 'risk' || trust < t.warnBelow ? 'bad' : ''}`, role: 'img', 'aria-label': `단장 신뢰도 ${trust}점` }, h('i', { style: { width: `${trust}%` } })),
    notes.length ? h('p', { class: `note ${status === 'risk' ? 'bad' : ''}`, style: { margin: '4px 0 0' } }, notes[0]) : null);
}

/** 팬 열기 한 줄: 열기 값과 관중·FA에 주는 효과 */
export function fansLine(ctx) {
  const s = ctx.session, rules = s.rules;
  const mood = s.fans;
  if (mood == null) return null;
  const att = (fanFactor(mood, rules) - 1) * 100, fa = fanAppeal(mood, rules);
  return h('div', { class: 'gl-fans' },
    h('div', { class: 'row between' }, h('b', '팬 열기'), h('span', { class: 'tag' }, `${Math.round(mood)} · ${moodTier(mood)}`)),
    h('div', { class: 'bar gl-bar', role: 'img', 'aria-label': `팬 열기 ${Math.round(mood)}점` }, h('i', { style: { width: `${Math.round(mood)}%` } })),
    h('p', { class: 'note', style: { margin: '4px 0 0' } }, `관중 ${att >= 0 ? '+' : ''}${att.toFixed(1)}% · FA 선수의 호감 ${fa >= 0 ? '+' : ''}${fa.toFixed(2)}점. 성적·플레이오프·스타 보유로 오르고, 스타 이탈·긴 연패로 내립니다. (뉴스의 "팬 심리"는 기사 분위기 표시이고, 팬 열기는 관중·FA에 실제로 반영되는 수치입니다.)`));
}

/** 홈: 올 시즌 목표 카드. 오프시즌에는 지난 시즌 평가 요약을 보여 준다 */
export function goalsCard(ctx) {
  const s = ctx.session;
  if (s.trust == null) return null;
  const last = s.lastEval;
  if (s.stage === 'offseason') {
    return h('div', { class: 'card gl-card' }, h('h2', '모기업 평가'),
      last ? h('p', { class: 'note', style: { margin: '0 0 8px' } }, `지난 시즌 목표 ${last.goals.filter((g) => g.met).length}/${last.goals.length} 달성 · 신뢰도 ${last.delta >= 0 ? '+' : ''}${last.delta}. 새 목표는 다음 시즌 시작 때 발표됩니다.`) : null,
      trustLine(ctx, s.trust, last?.status ?? 'ok'), fansLine(ctx));
  }
  const view = liveGoals(ctx);
  if (!view) return null;
  return h('div', { class: 'card gl-card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '올 시즌 목표'), h('span', { class: 'note' }, '모기업이 정한 목표 · 달성하면 신뢰도가 오릅니다')),
    h('ul', { class: 'gl-list' }, view.goals.map((g) => {
      const [stateLabel, cls] = STATE[g.state];
      return h('li', { class: 'gl-goal' },
        h('div', { class: 'row between' }, h('span', h('span', { class: 'note' }, `${ROLE[g.role]} · `), h('b', g.title)), h('span', { class: `tag ${cls}` }, stateLabel)),
        h('div', { class: `bar gl-bar ${g.state === 'risk' ? 'warn' : ''}`, role: 'img', 'aria-label': `${g.title} 진행 ${Math.round(g.ratio * 100)}%` }, h('i', { style: { width: `${Math.round(g.ratio * 100)}%` } })),
        h('div', { class: 'note' }, g.now));
    })),
    trustLine(ctx, s.trust, last?.status ?? 'ok'),
    fansLine(ctx),
    h('p', { class: 'note fin-foot' }, '목표와 점수는 게임용 가정입니다. 기대 순위(직전 시즌 순위와 지금 전력 순위의 평균)로 난이도가 정해지며 약팀은 목표가 낮습니다.'));
}

/** 시즌 결산: 시즌 평가 카드(목표별 결과와 신뢰도 변화). 이전 저장(평가 없음)이면 null */
export function evalCard(ctx, entry) {
  const ev = entry.eval;
  if (!ev) return null;
  const rules = ctx.session.rules;
  const met = ev.goals.filter((g) => g.met).length;
  const shown = (g) => {
    if (g.kind === 'rank') return `${g.shown}위`;
    if (g.kind === 'stage') return g.shown;
    if (g.kind === 'winPct') return `승률 ${(g.shown * 100).toFixed(1)}%`;
    if (g.kind === 'profit') return `순이익 ${g.shown >= 0 ? '+' : ''}${Number(g.shown).toFixed(1)}억`;
    if (g.kind === 'payroll') return `캡의 ${(g.shown * 100).toFixed(0)}%`;
    if (g.kind === 'youth') return `${g.shown}분`;
    return '';
  };
  return h('div', { class: 'card gl-card' },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, '시즌 평가 (모기업)'), h('span', { class: `tag ${met === ev.goals.length ? 'champ' : met === 0 ? 'bad' : 'hot'}` }, `목표 ${met}/${ev.goals.length} 달성`)),
    h('ul', { class: 'gl-list' }, ev.goals.map((g) => h('li', { class: 'gl-goal' },
      h('div', { class: 'row between' }, h('span', h('span', { class: 'note' }, `${ROLE[g.role]} · `), h('b', describeGoal(g).title)), h('b', { class: g.met ? 'good' : 'bad' }, g.met ? '달성' : '미달')),
      h('div', { class: 'note' }, `결과: ${shown(g)}`)))),
    h('div', { class: 'gl-delta' },
      h('span', { class: 'note' }, '단장 신뢰도 '), h('b', { class: ev.delta >= 0 ? 'good' : 'bad' }, `${ev.delta >= 0 ? '+' : ''}${ev.delta}`), h('span', { class: 'note' }, ` → ${ev.trust}점 (${trustTier(ev.trust, rules)})`),
      ev.bonus ? h('span', { class: 'tag champ', style: { marginLeft: '8px' } }, `다음 시즌 예산 +${eok(ev.bonus)}`) : null),
    ev.status === 'risk' ? h('p', { class: 'bad', style: { margin: '6px 0 0' } }, ev.fired ? '해임 통보: 신뢰도가 위험선 이하로 이어졌습니다. 새 게임을 시작하거나 이 결과를 감수하고 계속할 수 있습니다.' : '해임 위험 수준입니다. (해임 규칙은 꺼져 있어 게임은 계속됩니다.)')
      : ev.status === 'warn' ? h('p', { class: 'warn', style: { margin: '6px 0 0' } }, '신뢰도가 낮아 모기업이 경고했습니다.') : null);
}
