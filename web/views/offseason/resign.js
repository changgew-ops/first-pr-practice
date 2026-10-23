// 재계약 단계: 계약이 끝나는 우리 국내 선수마다 연봉·기간을 제시한다.
import { h, eok } from '../../lib/dom.js';
import { createManagerBot } from '../../../src/manager-bot.mjs';
import { demandEok, preferredYears, resignPlan, minAcceptSalary, round1, valueOf } from '../../lib/offseason-view.js';
import { domesticOf, softCapPenaltyEok } from '../../../src/valuation.mjs';
import { playerLine, decide } from './common.js';

const STATUS = {
  none: ['재계약 안 함 → FA 시장으로', 'muted'],
  ok: ['수락 예상', 'good'],
  refuse: ['거절 예상', 'bad'],
  cap: ['캡 한도 때문에 불가', 'bad']
};

export function render(ctx, pending) {
  const { expiring, league, ctx: ectx } = pending.payload;
  const { rules } = ctx.data;
  const my = ctx.session.managerId;
  const sorted = [...expiring].sort((a, b) => valueOf(b) - valueOf(a));
  const staying = league.players.filter((p) => p.teamId === my && p.contract.yearsLeft > 0);
  const state = {}; // id → { on, salaryEok, years }
  for (const p of sorted) state[p.id] = { on: false, salaryEok: demandEok(p), years: preferredYears(p) };
  const refs = new Map();
  const footer = h('div', { class: 'os-submit' });
  const planBox = h('div', { class: 'note' });

  const chosen = () => Object.fromEntries(sorted.filter((p) => state[p.id].on).map((p) => [p.id, { salaryEok: state[p.id].salaryEok, years: state[p.id].years }]));

  function update() {
    const offers = chosen();
    const plan = resignPlan(expiring, offers, league.players, ectx, rules, my);
    for (const p of sorted) {
      const r = refs.get(p.id), st = plan.byId.get(p.id);
      const [text, cls] = STATUS[st.status];
      r.badge.className = `os-status ${cls}`;
      r.badge.textContent = text;
      r.row.classList.toggle('off', !state[p.id].on);
      r.hint.textContent = '';
      if (st.status === 'refuse') {
        const min = minAcceptSalary(p, my, domesticOf(staying, my), ectx, rules);
        r.hint.textContent = min == null ? `요구액 ${eok(st.verdict.demand)}: 어떤 금액으로도 설득이 어렵습니다` : `최소 ${eok(min)}은 제시해야 수락할 것 같습니다 (요구액 ${eok(st.verdict.demand)})`;
      } else if (st.status === 'ok') r.hint.textContent = `수락 점수 ${st.verdict.score.toFixed(2)} (기준 ${rules.transactions.freeAgency.acceptScore})`;
      else if (st.status === 'cap') r.hint.textContent = `이미 캡을 넘겼거나 한도(${eok(rules.salaryCap.domesticEok * (1 + rules.salaryCap.soft.maxOverRatio), 0)})를 넘습니다`;
    }
    const n = [...plan.byId.values()].filter((x) => x.status === 'ok').length;
    const cap = rules.salaryCap.domesticEok;
    planBox.replaceChildren(...[`재계약 예상 ${n}명 → 재계약 후 국내 연봉 ${eok(plan.payroll)} / 캡 ${eok(cap, 0)}`, plan.payroll > cap ? h('span', { class: 'warn' }, ` · 캡 초과 기금 ${eok(softCapPenaltyEok(plan.payroll, rules))}`) : null].filter(Boolean));
    footerBtn.textContent = n ? `재계약 ${Object.keys(offers).length}건 제시하고 FA로` : '재계약 없이 FA로';
  }

  const rows = sorted.map((p) => {
    const st = state[p.id];
    const on = h('input', { type: 'checkbox', id: `rs-on-${p.id}`, 'aria-label': `${p.name} 재계약 제시`, onchange: (e) => { st.on = e.target.checked; update(); } });
    const salary = h('input', { type: 'number', id: `rs-sal-${p.id}`, step: '0.1', min: '0.3', value: st.salaryEok, 'aria-label': `${p.name} 제시 연봉(억)`, oninput: (e) => { st.salaryEok = round1(Number(e.target.value) || 0); if (!st.on) { st.on = true; on.checked = true; } update(); } });
    const years = h('select', { id: `rs-yr-${p.id}`, 'aria-label': `${p.name} 계약 기간`, onchange: (e) => { st.years = Number(e.target.value); update(); } }, [1, 2, 3, 4].map((y) => h('option', { value: y, selected: y === st.years }, `${y}년${y === preferredYears(p) ? ' (선호)' : ''}`)));
    const badge = h('span', { class: 'os-status' });
    const hint = h('div', { class: 'note' });
    const row = h('div', { class: 'os-resign off' },
      h('div', { class: 'os-resign-head' }, h('label', { for: `rs-on-${p.id}`, class: 'os-check' }, on, playerLine(p)), badge),
      h('div', { class: 'os-resign-body' },
        h('div', { class: 'os-fact' }, h('span', { class: 'note' }, 'POT'), h('b', p.potential)),
        h('div', { class: 'os-fact' }, h('span', { class: 'note' }, '올해 연봉'), h('b', eok(p.contract.salaryEok))),
        h('div', { class: 'os-fact' }, h('span', { class: 'note' }, '요구 연봉'), h('b', eok(demandEok(p)))),
        h('label', { class: 'os-input', for: `rs-sal-${p.id}` }, h('span', { class: 'note' }, '제시 연봉(억)'), salary),
        h('label', { class: 'os-input', for: `rs-yr-${p.id}` }, h('span', { class: 'note' }, '계약 기간'), years)),
      hint);
    refs.set(p.id, { row, badge, hint, on, salary, years });
    return row;
  });

  const footerBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, 'resign', chosen()) });
  footer.append(planBox, footerBtn);

  const bot = createManagerBot(my, rules);
  const tools = h('div', { class: 'row' },
    h('button', { class: 'btn', type: 'button', onclick: () => { const rec = bot.resign({ expiring, league }); for (const p of sorted) { const d = rec[p.id]; state[p.id].on = Boolean(d); if (d) { state[p.id].salaryEok = d.salaryEok; state[p.id].years = d.years; } const r = refs.get(p.id); r.on.checked = state[p.id].on; r.salary.value = state[p.id].salaryEok; r.years.value = state[p.id].years; } update(); } }, '추천대로 채우기'),
    h('button', { class: 'btn', type: 'button', onclick: () => { for (const p of sorted) { state[p.id].on = true; state[p.id].salaryEok = demandEok(p); const r = refs.get(p.id); r.on.checked = true; r.salary.value = demandEok(p); } update(); } }, '모두 요구액으로 제시'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { for (const p of sorted) { state[p.id].on = false; refs.get(p.id).on.checked = false; } update(); } }, '모두 해제'));

  const body = h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h2', `재계약 협상 (계약 만료 ${expiring.length}명)`),
      h('p', { class: 'note' }, '재계약하지 않은 선수는 FA 시장으로 나갑니다. 선수는 제시 금액이 요구액에 얼마나 가까운지, 우리 성적·전통·출전 기회, 선수마다 정해진 기분을 보고 수락합니다(요구액의 90% 미만은 항상 거절). 아래 "수락 예상"은 그 계산을 그대로 미리 돌려 본 것입니다. 외국 선수·아시아쿼터의 재계약은 자동으로 처리됩니다.'),
      expiring.length ? tools : h('p', { class: 'muted' }, '계약이 끝나는 국내 선수가 없습니다.')),
    h('div', { class: 'stack' }, rows), footer);
  update();
  return body;
}
