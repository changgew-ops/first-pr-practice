// 훈련: 선수마다 집중해서 키울 능력치를 정한다. 정규리그 중 일정 간격마다 훈련이 반영된다.
import { h, ovrChip, link, bar, tabs, STAT_LABELS, STAT_KEYS } from '../lib/dom.js';
import { playerLink } from '../lib/player-info.js';
import { autoFocus } from '../../src/training.mjs';
import { previewGain, projectGain, remainingCheckpoints } from '../lib/training-view.js';
import { renderProgramPanel } from './training-program.js';

let tab = 'plan'; // 'plan' | 'program' (화면을 다시 열어도 마지막 탭을 기억한다)
const fmt = (v) => (v <= 0 ? '+0' : v < 0.1 ? `+${v.toFixed(2)}` : `+${v.toFixed(1)}`);

export function render(ctx) {
  const s = ctx.session, rules = ctx.data.rules;
  const live = s.stage === 'regular' || s.stage === 'playoffs';
  const cfg = rules.training;
  const every = rules.ratingModel.checkpointDays;
  const left = s.stage === 'regular' ? remainingCheckpoints(s.day, s.totalDays, every) : 0;
  const host = h('div', { class: 'stack' });
  const wrap = h('div', { class: 'stack' });

  const draw = () => {
    const mine = s.players.filter((p) => s.focus.has(p.id)).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    const rows = mine.map((p) => {
      const stat = s.focus.get(p.id);
      const rec = autoFocus(p);
      const pg = previewGain(p, stat, rules);
      const proj = projectGain(p, stat, rules, left);
      const select = h('select', { 'aria-label': `${p.name} 훈련 집중 능력치`, disabled: !live, onchange: (e) => { s.setFocus(p.id, e.target.value); draw(); } },
        STAT_KEYS.map((k) => h('option', { value: k, selected: k === stat }, `${STAT_LABELS[k]} ${p.stats[k]}${k === rec ? ' · 추천' : ''}`)));
      return h('tr', { class: 'tr-row' },
        h('td', playerLink(p.id, p.name)), h('td', { class: 'tr-hide-sm' }, h('span', { class: 'pos' }, p.position)), h('td', { class: 'r tr-hide-sm' }, p.age),
        h('td', { class: 'r' }, ovrChip(p)), h('td', { class: 'r tr-hide-sm' }, p.potential),
        h('td', select, stat === rec ? null : h('div', { class: 'note tr-rec' }, `추천: ${STAT_LABELS[rec]}`)),
        h('td', { class: 'tr-once' }, h('b', fmt(pg.perSession)), h('div', { class: 'tr-prog', title: `다음 +1까지 ${(pg.progress * 100).toFixed(0)}%` }, bar(pg.progress, 1))),
        h('td', { class: 'r tr-total' }, left ? h('span', h('b', `${STAT_LABELS[stat]} ${proj.statDelta > 0 ? '+' : ''}${proj.statDelta}`), h('div', { class: 'note' }, proj.ovrDelta ? `OVR ${proj.ovrDelta > 0 ? '+' : ''}${proj.ovrDelta} → ${proj.ovr}` : 'OVR 변화 없음')) : h('span', { class: 'note' }, '-')));
    });
    const auto = () => { for (const p of mine) s.setFocus(p.id, autoFocus(p)); ctx.toast('모든 선수를 추천 능력치로 맞췄습니다'); draw(); };
    host.replaceChildren(...[
      !live ? h('div', { class: 'callout' }, s.stage === 'offseason' ? '지금은 오프시즌이라 훈련을 지정할 수 없습니다. 시즌이 시작되면 선수마다 훈련을 정하세요. 정하지 않으면 자동 추천으로 훈련합니다.' : '지금은 훈련을 지정할 수 없습니다.') : null,
      h('div', { class: 'card tr-rules' },
        h('h2', '훈련 규칙'),
        h('ul', { class: 'tr-rule-list' },
          h('li', `정규리그 ${every}일마다 한 번 훈련이 반영됩니다(훈련 ${cfg.sessionsPerCheckpoint}회분). 지금은 ${s.stage === 'regular' ? `${s.day}일차, 남은 훈련 ${left}번` : '정규리그가 끝났습니다'}.`),
          h('li', '선수마다 집중할 능력치 하나를 정하면 그 능력치에 경험치가 쌓이고, 임계값을 넘을 때마다 +1 오릅니다. 능력치가 높을수록 임계값도 올라갑니다.'),
          h('li', `어릴수록 빠르고(22세 이하 ×${cfg.ageMultipliers[0][1]}, 30대 초반 ×${cfg.ageMultipliers[3][1]}), 성장 한도(POT)와 현재 OVR의 차이가 클수록 빠릅니다(×${cfg.minPotentialMultiplier}~${cfg.maxPotentialMultiplier}).`),
          h('li', '훈련은 난수 없이 정해진 계산이라 같은 선택이면 같은 결과입니다. 정하지 않은 선수는 포지션에 맞는 능력치로 자동 훈련합니다.')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !live || !mine.length, onclick: auto }, '전원 자동 추천'))),
      h('div', { class: 'card flush' },
        h('div', { class: 'table-wrap' }, mine.length ? h('table', { class: 'tr-table' },
          h('thead', h('tr', ['이름', '포지션', '나이', 'OVR', 'POT', '훈련 집중', '훈련 1회 예상', `시즌 끝까지(${left}회)`].map((t, i) => h('th', { class: `${[2, 3, 4, 7].includes(i) ? 'r' : ''} ${[1, 2, 4].includes(i) ? 'tr-hide-sm' : ''}` }, t)))),
          h('tbody', rows)) : h('p', { class: 'muted pad' }, '훈련을 지정할 수 있는 선수가 없습니다.'))),
      h('p', { class: 'note' }, `훈련 1회 예상은 한 번 훈련에서 평균적으로 오르는 능력치(경험치 ÷ 임계값)이고, 아래 막대는 다음 +1까지의 진행입니다. 시즌 끝까지는 남은 ${left}번 훈련을 모두 반영한 예상입니다. 시즌 중 경기 기록에 따른 능력치 갱신은 별도로 반영됩니다.`)].filter(Boolean));
  };
  const show = () => {
    const on = s.programs.length;
    if (tab === 'plan') draw();
    wrap.replaceChildren(
      tabs([['plan', '훈련 계획'], ['program', `육성 프로그램${on ? ` (${on})` : ''}`]], tab, (k) => { tab = k; show(); }),
      tab === 'plan' ? host : renderProgramPanel(ctx, show));
  };
  show();
  return { title: '훈련', body: h('div', { class: 'stack training-view' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '훈련'), h('h1', '훈련 계획'))), wrap) };
}
