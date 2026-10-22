// 시즌 중 트레이드: AI 구단이 보낸 제안을 받거나, 직접 제안을 건다. 시즌 중에는 같은 인원 교환만, 국내 선수만 가능하다.
import { h, stat, ovrChip, eok } from '../lib/dom.js';
import { windowStatus, tradablePlayers, valueComparison, precheck, rejectionText, payrollAfter, salaryOf, byOvr } from '../lib/trades-view.js';
import { payrollInfo } from '../lib/game.js';

const playerLine = (p, extra = null) => h('div', { class: 'tr-player' },
  ovrChip(p), h('a', { href: `#/player/${p.id}`, class: 'tr-name' }, p.name), h('span', { class: 'pos' }, p.position),
  h('span', { class: 'note' }, `${p.age}세 · POT ${p.potential} · ${eok(p.contract.salaryEok)} · ${p.contract.yearsLeft <= 0 ? '계약 만료' : `${p.contract.yearsLeft}년`}`), extra);

export function render(ctx) {
  const s = ctx.session, { rules } = ctx.data, my = s.managerId;
  const win = windowStatus(s);
  const pay = payrollInfo(ctx.game, ctx.data, my);
  const league = () => ({ ...s.game.league, players: s.players });

  const status = h('div', { class: 'card tr-status' },
    h('div', { class: 'row between' }, h('div', h('h2', { style: { margin: 0 } }, win.headline), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, win.detail)),
      h('span', { class: `tag ${win.open ? 'hot' : ''}` }, win.open ? '창 열림' : '창 닫힘')),
    h('div', { class: 'grid g3', style: { marginTop: '12px' } },
      stat('국내 선수 연봉', eok(pay.domestic), `캡 ${eok(pay.cap, 0)}`),
      stat('캡 여유', pay.over ? `${eok(pay.over)} 초과` : eok(pay.cap - pay.domestic), pay.over ? '캡을 넘으면 연봉이 늘어나는 거래 불가' : `한도 ${eok(pay.hardLimit, 0)}`),
      stat('국내 선수', `${pay.counts.domestic}명`, '인원이 같은 교환만 가능')));

  const rules1 = h('p', { class: 'note' }, `시즌 중 트레이드 규칙: 같은 인원끼리 교환, 국내 선수만(외국인·아시아쿼터 불가), ${s.tradeDeadline}일차까지. 캡을 넘은 상태에서는 연봉이 늘어나는 거래를 할 수 없습니다.`);

  if (!win.open) {
    return { title: '트레이드', body: h('div', { class: 'stack' }, header(), status, rules1, h('div', {}, h('button', { class: 'btn', onclick: () => ctx.go(s.stage === 'offseason' ? 'offseason' : 'season') }, s.stage === 'offseason' ? '오프시즌으로' : '시즌 화면으로'))) };
  }

  // ----- 받은 제안 -----
  const offers = s.tradeOffers();
  const tctx = s.run.tradeContext();
  const offerCards = offers.map((o) => {
    const cmp = valueComparison(o.give, o.get, my, league(), tctx, rules);
    const err = h('div', { class: 'tr-error', role: 'alert', hidden: true });
    const accept = h('button', { class: 'btn primary', onclick: () => {
      const r = s.acceptOffer(o.trade);
      if (r.ok) { ctx.toast(`${ctx.name(o.teamId)}와 트레이드했습니다`); ctx.refresh(); } else { err.hidden = false; err.textContent = r.errors.join(' / '); }
    } }, '수락');
    return h('div', { class: 'card tr-offer' },
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, ctx.name(o.teamId)), h('span', { class: `tr-hint ${cmp.tone}` }, `${cmp.label} · 가치 ${cmp.ratio.toFixed(2)}배`)),
      h('div', { class: 'tr-sides' },
        h('div', { class: 'tr-side' }, h('div', { class: 'tr-side-title good' }, '받는 선수'), o.give.map((p) => playerLine(p))),
        h('div', { class: 'tr-arrow', 'aria-hidden': 'true' }, '⇄'),
        h('div', { class: 'tr-side' }, h('div', { class: 'tr-side-title bad' }, '보내는 선수'), o.get.map((p) => playerLine(p)))),
      h('div', { class: 'row between' }, h('span', { class: 'note' }, `연봉 ${eok(salaryOf(o.give))} 받고 ${eok(salaryOf(o.get))} 보냄${o.expiringTarget ? ' · 계약 만료 선수를 노린 제안' : ''}`), accept), err);
  });

  // ----- 내가 먼저 제안 -----
  const others = ctx.data.teams.filter((t) => t.id !== my);
  let teamB = others[0].id;
  const pickA = new Set();
  const pickB = new Set();
  const form = h('div', { class: 'card tr-propose' });
  const result = h('div', { class: 'tr-result', role: 'status' });
  const trade = () => ({ teamA: my, teamB, giveA: [...pickA], giveB: [...pickB] });

  const column = (title, list, picked) => h('fieldset', { class: 'tr-col' }, h('legend', title),
    h('div', { class: 'tr-list' }, byOvr(list).map((p) => {
      const id = `tr-${picked === pickA ? 'a' : 'b'}-${p.id}`;
      const box = h('input', { type: 'checkbox', id, checked: picked.has(p.id), onchange: (e) => { if (e.target.checked) picked.add(p.id); else picked.delete(p.id); result.replaceChildren(); drawSummary(); } });
      return h('label', { class: `tr-pick ${picked.has(p.id) ? 'on' : ''}`, for: id }, box, playerLine(p));
    })));

  const summary = h('div', { class: 'tr-summary' });
  const submit = h('button', { class: 'btn primary', disabled: true }, '제안하기');
  function drawSummary() {
    form.querySelectorAll('.tr-pick').forEach((el) => el.classList.toggle('on', el.querySelector('input').checked));
    const t = trade();
    const chk = precheck(league(), t, rules, s.day);
    const nodes = [];
    if (chk.idle) nodes.push(h('p', { class: 'note' }, '양쪽에서 같은 수의 선수를 골라 주세요.'));
    else {
      const pa = payrollAfter(s.players, t, rules);
      if (t.giveA.length === t.giveB.length) nodes.push(h('p', { class: 'note' }, `거래 뒤 우리 국내 연봉 ${eok(pa.mine)} (캡 ${eok(pa.cap, 0)}${pa.overCap ? ', 초과' : ''}) · ${ctx.name(teamB)} ${eok(pa.theirs)}`));
      for (const e of chk.errors) nodes.push(h('p', { class: 'tr-error' }, e));
      if (!chk.errors.length) nodes.push(h('p', { class: 'note good' }, '규칙상 제안할 수 있습니다. 받아들일지는 상대 구단이 가치를 따져 정합니다.'));
    }
    summary.replaceChildren(...nodes);
    submit.disabled = chk.idle || chk.errors.length > 0;
  }
  submit.addEventListener('click', () => {
    const t = trade();
    const r = s.proposeTrade(t);
    if (r.executed) { ctx.toast(`${ctx.name(teamB)}와 트레이드가 성사됐습니다`); ctx.refresh(); return; }
    result.replaceChildren(h('div', { class: 'callout' }, rejectionText(r, rules, ctx.name(teamB))));
  });

  function drawForm() {
    pickA.clear(); pickB.clear();
    const sel = h('select', { id: 'tr-team', 'aria-label': '상대 구단', onchange: (e) => { teamB = e.target.value; result.replaceChildren(); drawForm(); } }, others.map((t) => h('option', { value: t.id, selected: t.id === teamB }, t.name)));
    form.replaceChildren(
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '내가 먼저 제안'), h('label', { class: 'row', for: 'tr-team' }, h('span', { class: 'note' }, '상대 구단'), sel)),
      h('div', { class: 'tr-cols' }, column(`우리가 보낼 선수 (${ctx.name(my)})`, tradablePlayers(s.players, my), pickA), column(`받을 선수 (${ctx.name(teamB)})`, tradablePlayers(s.players, teamB), pickB)),
      summary, result, h('div', { class: 'row' }, submit));
    drawSummary();
  }
  drawForm();

  return { title: '트레이드', body: h('div', { class: 'stack' }, header(), status, rules1,
    h('section', { class: 'stack' }, h('h2', `받은 제안 (${offers.length})`), offers.length ? h('div', { class: 'tr-offers' }, offerCards) : h('div', { class: 'card' }, h('p', { class: 'muted', style: { margin: 0 } }, '지금 받은 제안이 없습니다. 경기를 진행하면 새 제안이 올 수 있습니다.'))),
    form) };

  function header() { return h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '트레이드'), h('h1', '시즌 중 트레이드'))); }
}
