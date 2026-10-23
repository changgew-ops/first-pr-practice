// 감독·코치: 우리 구단 스태프(감독 1 + 코치 3), 영입 후보, 리그 감독 현황. 해임하고 영입하면 남은 계약 전부가 위약금으로 시즌 정산에 나간다.
import { h, eok, bar } from '../lib/dom.js';
import { ROLES, ROLE_LABEL, payOf, avgSkill, buyoutEok } from '../../src/coaching.mjs';
import { colorOf } from '../lib/team-ui.js';

let ui = { role: 'head', years: 2 };

const SKILLS = { head: [['tac', '전술 이해'], ['dev', '선수 육성'], ['rot', '로테이션 운영']], off: [['k', '공격(슈팅·패스 훈련)']], def: [['k', '수비(수비·리바운드 훈련)']], cond: [['k', '체력(운동능력·체력 훈련, 컨디션 회복)']] };
const EFFECT = {
  head: '전술 이해: 전술 이득의 배수. 선수 육성: 오프시즌 성장폭. 로테이션 운영: 팀 기대 득점(점수 ±).',
  off: '슈팅·패스 훈련 성장 속도(우리 구단)와 오프시즌 성장에 작게 반영됩니다.',
  def: '수비·리바운드 훈련 성장 속도(우리 구단)와 오프시즌 성장에 작게 반영됩니다.',
  cond: '운동능력·체력 훈련 성장 속도와 컨디션 회복 속도에 반영됩니다.'
};

const skillRow = (label, v) => h('div', { class: 'stf-skill' }, h('span', { class: 'note' }, label), bar(v, 99, { cls: v >= 70 ? '' : v < 40 ? 'warn' : '' }), h('b', v));

function personCard(ctx, role, person, { actions = null, current = false } = {}) {
  const rules = ctx.session.rules;
  return h('div', { class: `stf-person ${current ? 'cur' : ''}` },
    h('div', { class: 'row between' }, h('div', h('b', person.name), h('span', { class: 'note' }, ` ${ROLE_LABEL[role]}`)), h('span', { class: 'tag' }, `평균 ${Math.round(avgSkill(role, person))}`)),
    SKILLS[role].map(([k, label]) => skillRow(label, person[k])),
    h('div', { class: 'note' }, `연봉 ${eok(payOf(person, rules), 2)}${current ? ` · 계약 ${person.yrs}년 남음 (이번 시즌 포함)` : ''}`),
    actions);
}

export function render(ctx) {
  const s = ctx.session, my = s.managerId, rules = s.rules;
  const staff = s.staff;
  const body = h('div', { class: 'stack staff-view' }, h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '감독·코치'), h('h1', '감독·코치진'))));
  if (!staff) { body.append(h('div', { class: 'callout' }, '감독·코치 기능이 꺼져 있습니다.')); return { title: '감독·코치', body }; }
  const mine = staff[my];
  const live = s.stage === 'regular';
  const pool = s.staffPool;
  const host = h('div', { class: 'stack' });

  const draw = () => {
    const role = ui.role;
    const cands = pool?.[role] ?? [];
    const cur = mine[role];
    const covered = rules.coaching.covered * (rules.econ?.index ?? 1);
    const total = ROLES.reduce((sum, r) => sum + payOf(mine[r], rules), 0);
    const hire = (cand) => {
      const chk = s.staffCheck(role, cand.id, ui.years);
      if (!chk.ok) { ctx.toast(chk.reason); return; }
      if (!window.confirm(`${ROLE_LABEL[role]} ${cur.name}을(를) 해임하고 ${cand.name}을(를) ${ui.years}년 계약으로 영입합니다.\n해임 위약금 ${eok(chk.buyout, 2)}(남은 계약 ${cur.yrs}년 전부)는 시즌 정산에서 나가고, 새 연봉은 ${eok(chk.pay, 2)}입니다. 진행할까요?`)) return;
      const r = s.replaceStaff(role, cand.id, ui.years);
      if (!r.ok) { ctx.toast(r.errors[0]); return; }
      ctx.toast(`${cand.name} ${ROLE_LABEL[role]} 영입`);
      ctx.refresh();
    };
    host.replaceChildren(...[
      !live ? h('div', { class: 'callout' }, s.stage === 'offseason' ? '오프시즌에는 감독·코치를 바꿀 수 없습니다. 새 시즌이 시작되기 전(0일차)부터 바꿀 수 있습니다. 계약이 끝난 스태프는 같은 연봉으로 1년 자동 재계약됩니다.' : '플레이오프가 시작된 뒤에는 바꿀 수 없습니다.') : null,
      h('div', { class: 'card' }, h('h2', '우리 구단 스태프'),
        h('div', { class: 'grid g4 stf-grid' }, ROLES.map((r) => h('div', { class: `stf-slot ${ui.role === r ? 'sel' : ''}` }, personCard(ctx, r, mine[r], { current: true, actions: h('button', { type: 'button', class: 'btn', onclick: () => { ui.role = r; draw(); } }, ui.role === r ? '후보 보는 중' : '교체 후보 보기') })))),
        h('p', { class: 'note' }, `스태프 인건비 합계 ${eok(total, 2)} / 구단 운영비에 이미 들어 있는 몫 ${eok(covered, 2)} — 이 몫을 넘는 만큼만 구단 자금에서 더 나가고, 아끼면 그만큼 남습니다. 효과는 모두 작게 잡은 게임용 가정입니다: 감독 로테이션 운영 99는 팀 기대 득점 최대 +${rules.coaching.rotationEdge}점(승률 약 +${(rules.coaching.rotationEdge * 3).toFixed(1)}%p)입니다.`)),
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, `${ROLE_LABEL[role]} 영입 후보`), live ? h('label', { class: 'row' }, h('span', { class: 'note' }, '계약 기간'), h('select', { onchange: (e) => { ui.years = Number(e.target.value); draw(); } }, Array.from({ length: rules.coaching.contractYears[1] - rules.coaching.contractYears[0] + 1 }, (_, i) => rules.coaching.contractYears[0] + i).map((y) => h('option', { value: y, selected: y === ui.years }, `${y}년`)))) : null),
        h('p', { class: 'note' }, `${EFFECT[role]} 지금 ${ROLE_LABEL[role]}는 ${cur.name}(평균 ${Math.round(avgSkill(role, cur))}), 해임하면 위약금 ${eok(buyoutEok(cur, rules), 2)}입니다.`),
        cands.length ? h('div', { class: 'stf-cands' }, cands.map((c) => {
          const better = avgSkill(role, c) - avgSkill(role, cur);
          return personCard(ctx, role, c, { actions: h('div', { class: 'row' }, h('span', { class: `note ${better > 0 ? 'good' : ''}` }, `지금보다 ${better >= 0 ? '+' : ''}${Math.round(better)}`), h('button', { type: 'button', class: 'btn primary', disabled: !live, onclick: () => hire(c) }, '해임하고 영입')) });
        })) : h('p', { class: 'muted' }, live ? '영입할 수 있는 후보가 없습니다.' : '새 시즌이 시작되면 후보가 나타납니다.')),
      h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '리그 감독 현황'), h('p', { class: 'note', style: { margin: '4px 0 0' } }, 'AI 구단은 시즌이 끝날 때 하위권이면 감독을 바꾸기도 합니다. 감독·코치는 모두 가상 인물입니다.')),
        h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', ['구단', '감독', '전술', '육성', '로테', '계약', '공격', '수비', '체력'].map((t, i) => h('th', { class: i >= 2 ? 'r' : '' }, t)))),
          h('tbody', ctx.data.teams.map((t) => { const st = staff[t.id]; return h('tr', { class: t.id === my ? 'me' : '' }, h('td', ctx.name(t.id)), h('td', st.head.name), h('td', { class: 'r' }, st.head.tac), h('td', { class: 'r' }, st.head.dev), h('td', { class: 'r' }, st.head.rot), h('td', { class: 'r' }, `${st.head.yrs}년`), h('td', { class: 'r' }, st.off.k), h('td', { class: 'r' }, st.def.k), h('td', { class: 'r' }, st.cond.k)); })))))].filter(Boolean));
  };
  draw();
  body.append(host);
  body.style.setProperty('--team', colorOf(my));
  return { title: '감독·코치', body };
}
