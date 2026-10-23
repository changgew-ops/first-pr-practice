// 시즌 중 선수단 변동 패널: 시장에 남은 FA 영입, 외국인 선수 일시교체·시즌대체. 로스터 화면(우리 구단)이 아래에 붙인다.
// 규칙은 src/inseason.mjs(판정)·src/season-run.mjs(실행), 행동은 세션(session.signFa / replaceForeign)이 한다. 스타일은 css/injury.css(mk- 접두).
import { h, ovrChip, eok, POS_ORDER } from '../lib/dom.js';
import { nameButton } from '../lib/player-info.js';
import { injuryTag, tempTag, injuryMap } from '../lib/injury-view.js';
import { KIND_TEXT, faYearsRange } from '../../src/inseason.mjs';
import { payrollEok, softCapPenaltyEok, domesticOf } from '../../src/valuation.mjs';

const f1 = (v) => Number(v).toFixed(1);
const man = (usd) => `${Math.round(usd / 10000)}만 달러`;

let current = null;
/** 모달 창(방출·연장과 같은 모양: ct-dialog). 바깥 클릭·Esc·닫기로 닫힌다 */
function openModal(id, title, sub, body, foot) {
  if (current) current.close();
  const dlg = h('dialog', { class: 'ct-dialog', 'aria-labelledby': id },
    h('div', { class: 'ct-head' }, h('div', h('h2', { id }, title), h('div', { class: 'note' }, sub)), h('button', { class: 'btn ghost ct-close', type: 'button', 'aria-label': '닫기', onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'ct-body' }, body),
    h('div', { class: 'ct-foot' }, foot(() => dlg.close())));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (current === dlg) current = null; });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  current = dlg;
  return dlg;
}

/** 시즌 중 변동 패널 모음(정규리그 중 우리 구단만). 아니면 null */
export function marketPanels(ctx) {
  const s = ctx.session;
  if (s.stage !== 'regular' || s.regularDone) return null;
  return h('div', { class: 'mk-panels' }, ...(ctx.data.rules.waivers?.enabled ? [waiverPanel(ctx)] : []), faPanel(ctx), foreignPanel(ctx));
}

// ---------- 웨이버 공시 (규약 제101조, src/waivers.mjs) ----------
const WV_RESULT = { claim: '양수', waiver_fa: 'FA로', claim_fail: '양수 실패' };

function waiverPanel(ctx) {
  const s = ctx.session, rules = ctx.data.rules, my = s.managerId, wv = rules.waivers;
  const list = s.waivers;
  const recent = s.rosterLog.filter((e) => ['claim', 'waiver_fa', 'claim_fail'].includes(e.type) && (e.teamId === my || e.fromTeamId === my || e.mineApplied)).slice(-5).reverse();
  const act = (w) => {
    if (w.fromTeamId === my) return h('span', { class: 'note' }, '우리가 공시');
    if (w.mine) return h('button', { class: 'btn mk-btn', type: 'button', 'aria-label': `${w.player.name} 양수 신청 취소`, onclick: () => { const r = s.cancelWaiverClaim(w.player.id); ctx.toast(r.ok ? `${w.player.name} 양수 신청을 취소했습니다` : r.errors[0]); ctx.refresh(); } }, '신청 취소');
    return h('button', { class: 'btn mk-btn primary', type: 'button', disabled: !w.check.ok, title: w.check.ok ? `${w.player.name}의 남은 계약을 이어받는 양수 신청(마감 때 우선권 순서로 결정)` : w.check.reason, 'aria-label': `${w.player.name} 양수 신청`,
      onclick: () => { const r = s.claimWaiver(w.player.id); ctx.toast(r.ok ? `${w.player.name} 양수 신청 — 마감일(${w.left}경기일 뒤)에 결과가 나옵니다` : r.errors[0]); ctx.refresh(); } }, '양수 신청');
  };
  const rows = list.map((w) => h('tr', { class: 'mk-row' },
    h('td', nameButton(w.player)), h('td', h('span', { class: 'pos' }, w.player.position)), h('td', { class: 'r' }, w.player.age), h('td', { class: 'r' }, ovrChip(w.player)),
    h('td', { class: 'r' }, `${eok(w.player.contract.salaryEok)} · ${w.player.contract.yearsLeft}년`),
    h('td', ctx.name(w.fromTeamId)),
    h('td', { class: 'r' }, `${w.left}경기일`),
    h('td', w.mine ? h('span', { class: 'tag hot' }, `신청함 · 우선권 ${w.priority}번째`) : (!w.check.ok && w.fromTeamId !== my ? h('span', { class: 'wv-why' }, w.check.reason) : h('span', { class: 'note' }, w.fromTeamId === my ? '양수 구단 대기 중' : `우선권 ${w.priority}번째`))),
    h('td', { class: 'r' }, act(w))));
  return h('div', { class: 'card wv-panel' },
    h('div', { class: 'mk-head' }, h('h2', { style: { margin: 0 } }, '웨이버 공시'), h('span', { class: 'note' }, `공시 중 ${list.length}명`)),
    h('p', { class: 'note', style: { margin: '4px 0 8px' } }, `방출된 국내 선수는 먼저 웨이버로 공시되고, 공시기간(${wv.periodGames}경기일, 길이는 규정에 없어 게임용 가정) 동안 다른 구단이 남은 계약을 이어받을 수 있습니다. 여러 구단이 원하면 전 시즌 정규리그 순위의 역순으로 우선권을 가집니다(규약 제101조 ①, 우리 구단은 ${list[0]?.priority ?? '-'}번째). 양수한 구단은 영입일로부터 약 ${wv.reWaiverLockGames}경기(30일) 안에는 그 선수를 다시 웨이버 조치할 수 없습니다(② 환산). 신청은 마감 때 우선권 순서로 정해지고, 정원 ${rules.roster.domestic}명이 차 있거나 캡을 넘기면 실패합니다. 아무도 양수하지 않으면 FA 시장으로 나갑니다.`),
    list.length
      ? h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', ['선수', '포지션', '나이', 'OVR', '계약', '공시 구단', '남은 기간', '상태', ''].map((t, i) => h('th', { class: i >= 2 && i <= 6 && i !== 5 ? 'r' : '' }, t)))), h('tbody', rows)))
      : h('p', { class: 'muted' }, '지금 공시 중인 선수가 없습니다. 우리 구단이나 AI 구단이 선수를 방출하면 여기에 나타납니다.'),
    recent.length ? h('div', { class: 'wv-recent' }, h('h3', { style: { margin: '10px 0 4px' } }, '최근 결과'),
      h('ul', recent.map((e) => h('li', { class: 'note' }, `${e.day}일차 · ${e.name} — ${WV_RESULT[e.type]}${e.type === 'claim' ? `(${ctx.name(e.teamId)})` : ''}${e.reason ? ` · ${e.reason}` : ''}`)))) : null);
}

// ---------- 시즌 중 FA ----------
const faUi = { pos: 'all', open: false };

function faPanel(ctx) {
  const s = ctx.session, rules = ctx.data.rules, my = s.managerId;
  const host = h('div', { class: 'card mk-fa' });
  const draw = () => {
    const market = s.faMarket();
    const domestic = domesticOf(s.players, my).length;
    const full = domestic >= rules.roster.domestic;
    const pay = payrollEok(s.players, my);
    const shown = market.filter((m) => faUi.pos === 'all' || m.player.position === faUi.pos).slice(0, 15);
    const chip = (val, label) => h('button', { type: 'button', class: `btn ${faUi.pos === val ? 'primary' : ''}`, onclick: () => { faUi.pos = val; draw(); } }, label);
    const rows = shown.map(({ player: p, asking }) => h('tr', { class: 'mk-row' },
      h('td', nameButton(p)), h('td', h('span', { class: 'pos' }, p.position)), h('td', { class: 'r' }, p.age), h('td', { class: 'r' }, ovrChip(p)), h('td', { class: 'r' }, p.potential), h('td', { class: 'r' }, p.cost), h('td', { class: 'r' }, eok(asking)),
      h('td', { class: 'r' }, h('button', { class: 'btn mk-btn primary', type: 'button', disabled: full, title: full ? `국내 선수가 이미 ${rules.roster.domestic}명입니다. 로스터 표에서 한 명을 먼저 방출하세요` : `${p.name} 영입 협상`, 'aria-label': `${p.name} 영입`, onclick: () => openSignDialog(ctx, p, asking, draw) }, '영입'))));
    host.replaceChildren(...[
      h('div', { class: 'mk-head' }, h('h2', { style: { margin: 0 } }, '시즌 중 FA 시장'),
        h('span', { class: 'note' }, `국내 선수 ${domestic}/${rules.roster.domestic}명 · 국내 연봉 ${eok(pay)} / 캡 ${eok(rules.salaryCap.domesticEok, 0)} · 시장 ${market.length}명`)),
      h('p', { class: 'note', style: { margin: '4px 0 0' } }, `오프시즌 FA에서 계약하지 못한 선수와 시즌 중 방출된 선수가 남아 있습니다(실제 규정은 이런 선수의 시즌 중 계약을 막지만 게임은 확장했습니다). 요구 연봉은 오프시즌 요구액의 ${Math.round(rules.inSeason.fa.askingFactor * 100)}%이고 최저 연봉(${rules.salaryCap.minSalaryEok}억) 아래로는 내려가지 않습니다. 계약은 이번 시즌 포함 ${faYearsRange(rules).join('~')}년이며, 보수는 합류한 날부터 경기 비율만큼만 정산합니다.${full ? ' 국내 선수 자리가 모두 찼습니다. 영입하려면 먼저 방출하세요.' : ''}`),
      h('div', { class: 'mk-filters' }, chip('all', '모든 포지션'), POS_ORDER.map((p) => chip(p, p))),
      shown.length
        ? h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', ['선수', '포지션', '나이', 'OVR', 'POT', '코스트', '요구 연봉', ''].map((t, i) => h('th', { class: i >= 2 && i < 7 ? 'r' : '' }, t)))), h('tbody', rows)))
        : h('p', { class: 'muted' }, market.length ? '조건에 맞는 선수가 없습니다.' : '시장에 남은 선수가 없습니다.'),
      market.length > shown.length ? h('p', { class: 'note' }, `가치가 높은 순으로 ${shown.length}명만 보입니다(포지션 필터로 좁혀 보세요).`) : null].filter(Boolean)); // replaceChildren은 null을 글자로 바꾸므로 걸러 낸다
  };
  draw();
  return host;
}

function openSignDialog(ctx, p, asking, onDone) {
  const s = ctx.session, rules = ctx.data.rules;
  const [yLo, yHi] = faYearsRange(rules);
  const st = { salaryEok: asking, years: yLo };
  const salaryIn = h('input', { type: 'number', step: '0.1', min: String(rules.salaryCap.minSalaryEok), value: st.salaryEok, id: `mk-sal-${p.id}`, 'aria-label': '연봉(억)', oninput: (e) => { st.salaryEok = Math.round((Number(e.target.value) || 0) * 10) / 10; update(); } });
  const yearsIn = h('select', { id: `mk-yr-${p.id}`, 'aria-label': '계약 기간', onchange: (e) => { st.years = Number(e.target.value); update(); } }, Array.from({ length: yHi - yLo + 1 }, (_, i) => yLo + i).map((y) => h('option', { value: y, selected: y === st.years }, `${y}년`)));
  const status = h('p', { class: 'ct-line' });
  const info = h('p', { class: 'note' });
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    const r = s.signFa(p.id, { salaryEok: st.salaryEok, years: st.years });
    if (!r.ok) { ctx.toast(r.errors[0]); update(); return; }
    dlg.close(); ctx.toast(`${p.name} 영입 — 연봉 ${eok(st.salaryEok)}, ${st.years}년`); onDone(); ctx.refresh();
  } }, '영입 확정');
  function update() {
    const c = s.faCheck(p.id, { salaryEok: st.salaryEok, years: st.years });
    status.className = `ct-line ${c.ok ? 'good' : 'bad'}`;
    status.textContent = c.ok ? '계약 가능합니다.' : c.reason;
    ok.disabled = !c.ok;
    const payroll = payrollEok(s.players, s.managerId) + st.salaryEok;
    const frac = Math.max(0, 1 - s.day / s.totalDays);
    info.textContent = `영입 후 국내 연봉 ${eok(payroll)} / 캡 ${eok(rules.salaryCap.domesticEok, 0)}${payroll > rules.salaryCap.domesticEok ? ` · 초과 기금 ${eok(softCapPenaltyEok(payroll, rules))}` : ''} · 이번 시즌 남은 ${Math.round(frac * 100)}%만큼의 보수(${eok(st.salaryEok * frac)})를 정산합니다.`;
  }
  const dlg = openModal(`mk-sign-${p.id}`, `${p.name} 영입`, `${p.position} · ${p.age}세 · OVR ${p.ovr} · POT ${p.potential} · 코스트 ${p.cost}`,
    h('div', { class: 'stack' },
      h('div', { class: 'ct-grid' },
        h('div', h('span', { class: 'note' }, '요구 연봉'), h('b', eok(asking))),
        h('div', h('span', { class: 'note' }, '최저 연봉'), h('b', eok(rules.salaryCap.minSalaryEok))),
        h('label', { for: `mk-sal-${p.id}` }, h('span', { class: 'note' }, '연봉(억)'), salaryIn),
        h('label', { for: `mk-yr-${p.id}` }, h('span', { class: 'note' }, '계약 기간(이번 시즌 포함)'), yearsIn)),
      status, info,
      h('p', { class: 'note' }, '요구 연봉 이상이면 선수는 바로 수락합니다. 샐러리캡을 넘기면 소프트캡 규정에 따라 초과분의 일부를 시즌 말 기금으로 내며, 한도(캡의 120%)를 넘는 계약은 할 수 없습니다.')),
    (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, '취소'), ok]);
  update();
  return dlg;
}

// ---------- 외국인 선수 일시교체·시즌대체 ----------
function foreignPanel(ctx) {
  const s = ctx.session, rules = ctx.data.rules, my = s.managerId;
  const inj = injuryMap(s);
  const foreigners = s.players.filter((p) => p.teamId === my && p.origin === 'foreign').sort((a, b) => b.ovr - a.ovr);
  const th = s.foreignThresholds, other = s.otherReplacements;
  const market = s.foreignMarket();
  const reasonFor = (p, kind) => {
    if (!market.length) return '교체 후보가 없습니다(카드 시장 후보가 모두 영입되었거나 시즌 카드가 없습니다)';
    let first = null;
    for (const c of market) { const r = s.foreignCheck(p.id, kind, c.player.id); if (r.ok) return null; first ??= r.reason; }
    return first;
  };
  const btn = (p, kind, label) => {
    const why = reasonFor(p, kind);
    return h('button', { class: 'btn mk-btn', type: 'button', disabled: Boolean(why), title: why ?? `${KIND_TEXT[kind]}: 후보를 골라 등록`, 'aria-label': `${p.name} ${KIND_TEXT[kind]}`, onclick: () => openForeignDialog(ctx, p, kind) }, label);
  };
  const row = (p) => {
    const i = inj.get(p.id);
    const status = p.temp ? [tempTag(), h('span', { class: 'note' }, ` ${ctx.session.players.find((x) => x.id === p.temp.forId)?.name ?? '부상 선수'} 대신 뛰는 중 · 부상 선수가 돌아오면 팀을 떠납니다`)]
      : i ? [injuryTag(i, { full: true }), h('span', { class: 'note' }, ` 진단 ${i.kind === 'season' ? '시즌 아웃' : `${i.total}경기`}${i.temp ? ' · 일시교체 선수가 대신 뜁니다' : ''}`)]
        : h('span', { class: 'note' }, '건강');
    return h('div', { class: 'mk-foreign-row' },
      h('div', h('div', nameButton(p), ' ', ovrChip(p)), h('div', { class: 'note' }, `${p.position} · ${p.age}세 · 연봉 ${man(p.contract.salaryUsd)}`)),
      h('div', status),
      p.temp ? h('div') : h('div', { class: 'mk-foreign-actions' }, btn(p, 'temp', '일시교체'), btn(p, 'season', '시즌대체(부상)'), btn(p, 'other', `기타 사유 교체 ${other.used}/${other.limit}`)));
  };
  return h('div', { class: 'card mk-foreign' },
    h('div', { class: 'mk-head' }, h('h2', { style: { margin: 0 } }, '외국인 선수 교체'), h('span', { class: 'note' }, `외국 선수 연봉 합계 ${man(foreigners.filter((p) => !p.temp && !inj.get(p.id)?.temp).reduce((a, p) => a + p.contract.salaryUsd, 0))} / 한도 ${man(rules.salaryCap.foreignUsdTotal)}`)),
    h('p', { class: 'note', style: { margin: '4px 0 8px' } }, `외국선수 관리규정(제8조): 2주 이상(약 ${th.temporary}경기) 진단이면 일시교체, 8주 이상(약 ${th.season}경기)이면 시즌대체를 할 수 있고 부상·질병 사유는 횟수 제한이 없습니다. 기타 사유 시즌대체는 구단당 ${other.limit}회까지입니다(3회째부터는 이사회 승인이 필요해 게임에서는 할 수 없습니다). 경기 수 환산은 정규리그 54경기를 약 24주로 본 게임용 값입니다.`),
    foreigners.length ? foreigners.map(row) : h('p', { class: 'muted' }, '외국인 선수가 없습니다.'));
}

function openForeignDialog(ctx, out, kind) {
  const s = ctx.session, rules = ctx.data.rules;
  const market = [...s.foreignMarket()].sort((a, b) => b.player.ovr - a.player.ovr || a.usd - b.usd);
  const checks = new Map(market.map((c) => [c.player.id, s.foreignCheck(out.id, kind, c.player.id)]));
  const st = { pick: market.find((c) => checks.get(c.player.id).ok)?.player.id ?? null };
  const toEok = (usd) => usd * rules.transactions.funds.foreignUsdToEok;
  const host = h('div', { class: 'stack' });
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    const r = s.replaceForeign(out.id, kind, st.pick);
    if (!r.ok) { ctx.toast(r.errors[0]); return; }
    dlg.close(); ctx.toast(`${KIND_TEXT[kind]} — ${r.player.name} 등록`); ctx.refresh();
  } }, `${KIND_TEXT[kind]} 확정`);
  const draw = () => {
    const pick = market.find((c) => c.player.id === st.pick);
    ok.disabled = !pick;
    const frac = Math.max(0, 1 - s.day / s.totalDays);
    const payLine = kind === 'temp'
      ? `일시교체 선수는 뛴 기간만큼만 보수를 받고, ${out.name}이(가) 돌아오면 팀을 떠납니다. 외국 선수 연봉 합계는 ${out.name}을(를) 뺀 나머지와 후보의 합이 한도 안이어야 합니다.`
      : `${out.name}이(가) 팀을 떠나지만 이번 시즌 보수(${eok(toEok(out.contract.salaryUsd))})는 계속 지급합니다. 새 선수는 합류한 뒤 남은 ${Math.round(frac * 100)}%만큼만 보수(${pick ? eok(toEok(pick.usd) * frac) : '-'})를 받습니다.`;
    host.replaceChildren(
      h('p', { class: 'ct-line' }, `${KIND_TEXT[kind]}: ${out.name}(OVR ${out.ovr}, 연봉 ${man(out.contract.salaryUsd)})을(를) 대신할 후보를 고르세요.`),
      market.length ? h('div', { class: 'mk-cands', role: 'radiogroup', 'aria-label': '교체 후보' }, market.map((c) => {
        const chk = checks.get(c.player.id);
        const on = st.pick === c.player.id;
        const el = h('label', { class: `mk-cand ${chk.ok ? '' : 'off'} ${on ? 'picked' : ''}` },
          h('input', { type: 'radio', name: 'mk-cand', checked: on, disabled: !chk.ok, 'aria-label': `${c.player.name} 선택`, onchange: () => { st.pick = c.player.id; draw(); } }),
          h('span', h('b', c.player.name), ' ', ovrChip(c.player), h('span', { class: 'note' }, ` ${c.player.position} · ${c.player.age}세 · POT ${c.player.potential} · 코스트 ${c.player.cost}`)),
          h('span', { class: 'r' }, man(c.usd)),
          chk.ok ? null : h('span', { class: 'mk-why bad' }, chk.reason));
        return el;
      })) : h('p', { class: 'muted' }, '교체 후보가 없습니다.'),
      h('p', { class: 'note' }, payLine),
      h('p', { class: 'note' }, '후보는 시즌 시작 때 정해지는 과거 시즌 외국인 카드 몇 장입니다. 등록하면 그 시즌 카드 능력치로 뜁니다. 등록 기한(부상 공시 15일 이내)과 급여지원 삭감은 게임에서 단순화했습니다.'));
  };
  const dlg = openModal(`mk-for-${out.id}-${kind}`, `${out.name} ${KIND_TEXT[kind]}`, `${out.position} · ${out.age}세 · OVR ${out.ovr}`, host, (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, '취소'), ok]);
  draw();
  return dlg;
}
