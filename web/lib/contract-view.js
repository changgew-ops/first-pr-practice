// 방출·연장 계약 화면 부품: 비용·문구 계산(순수)과 확인 창(dialog).
// 규칙은 src/contracts.mjs, 행동은 세션(session.releasePlayer / extendContract)이 한다.
import { h, eok, ORIGIN_LABEL } from './dom.js';
import { extensionYears, salaryRanks } from '../../src/contracts.mjs';
import { demandEok, payrollEok, softCapPenaltyEok } from '../../src/valuation.mjs';

const f1 = (v) => Number(v).toFixed(1);

/** 방출 확인 창의 설명 줄들(순수): [{ tone: '' | 'warn' | 'bad', text }] */
export function releaseLines(player, check, funds) {
  const c = check.cost;
  const lines = [];
  if (!check.ok) { lines.push({ tone: 'bad', text: check.reason }); return lines; }
  const frac = c.fraction > 0 && c.fraction < 1 ? ` (이번 시즌 남은 ${Math.round(c.fraction * 100)}% 포함)` : '';
  lines.push({ tone: '', text: `남은 계약 ${c.years}년 × 연봉 ${eok(c.salaryEok)} → 해지 비용 ${eok(c.severance)}을(를) 시즌 정산에서 지급합니다${frac}. 구단 자금 ${eok(funds)} → ${eok(funds - c.severance)}` });
  if (c.earned > 0) lines.push({ tone: '', text: `이미 뛴 만큼의 보수 ${eok(c.earned)}은 평소 연봉 지출로 처리됩니다.` });
  if (funds - c.severance < 0) lines.push({ tone: 'warn', text: '구단 자금이 마이너스가 됩니다.' });
  if (check.waiverGames) {
    lines.push({ tone: '', text: `연봉 ${eok(c.salaryEok)}은 샐러리캡 계산에서 바로 빠지고, 선수는 웨이버로 공시됩니다. 공시기간 ${check.waiverGames}경기일 동안 다른 구단이 남은 계약을 양수할 수 있고(전 시즌 순위의 역순으로 우선권, 규약 제101조), 양수하는 구단이 나오면 위 해지 비용은 사라지고 공시기간까지의 보수만 부담합니다.` });
    lines.push({ tone: '', text: '웨이버 공시 후 아무도 양수하지 않으면 FA 시장으로 나가고(원소속 보상은 없습니다) 위 해지 비용을 그대로 냅니다.' });
  } else lines.push({ tone: '', text: `연봉 ${eok(c.salaryEok)}은 샐러리캡 계산에서 바로 빠지고, 선수는 FA 시장으로 나갑니다(원소속 보상은 없고 다음 오프시즌 FA 시장에서 AI 구단이나 우리가 다시 영입할 수 있습니다).` });
  if (check.warning) lines.push({ tone: 'warn', text: check.warning });
  return lines;
}

/** 연장 계약 입력 상태를 설명하는 한 줄(순수): { tone, text } */
export function extensionLine(check, rules) {
  if (check.ok) return { tone: 'good', text: `수락 예상 (수락 점수 ${check.verdict.score.toFixed(2)}, 기준 ${rules.transactions.freeAgency.acceptScore})` };
  if (check.status === 'refuse' && check.verdict) return { tone: 'bad', text: `거절 예상 — ${check.reason}` };
  return { tone: 'bad', text: check.reason };
}

let current = null;
/** 확인 창 공통: 제목·내용·버튼을 받아 모달로 띄운다. 바깥 클릭·Esc·닫기로 닫힌다 */
function openDialog(titleId, title, sub, body, foot) {
  if (current) current.close();
  const dlg = h('dialog', { class: 'ct-dialog', 'aria-labelledby': titleId },
    h('div', { class: 'ct-head' }, h('div', h('h2', { id: titleId }, title), h('div', { class: 'note' }, sub)), h('button', { class: 'btn ghost ct-close', type: 'button', 'aria-label': '닫기', onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'ct-body' }, body),
    h('div', { class: 'ct-foot' }, foot(() => dlg.close())));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (current === dlg) current = null; });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  current = dlg;
  return dlg;
}

const subOf = (ctx, p) => `${p.position} · ${p.age}세 · ${ORIGIN_LABEL[p.origin] ?? p.origin} · OVR ${p.ovr} · POT ${p.potential} · 코스트 ${p.cost} · ${ctx.name(p.teamId)}`;

/** 방출 확인 창. onDone: 방출이 끝난 뒤(화면 갱신) */
export function openReleaseDialog(ctx, player, { onDone = () => ctx.refresh() } = {}) {
  const s = ctx.session;
  const check = s.releaseCheck(player.id);
  const lines = releaseLines(player, check, s.funds[s.managerId]);
  const inLineup = s.lineup && [...s.lineup.starters, ...s.lineup.bench].includes(player.id);
  if (check.ok && inLineup) lines.push({ tone: 'warn', text: '직접 편성한 라인업에 들어 있어서, 방출하면 라인업이 자동 편성으로 돌아갑니다.' });
  return openDialog(`ct-rel-${player.id}`, `${player.name} 방출`, subOf(ctx, player),
    h('div', { class: 'stack' }, lines.map((l) => h('p', { class: l.tone ? `ct-line ${l.tone}` : 'ct-line' }, l.text))),
    (close) => [
      h('button', { class: 'btn', type: 'button', onclick: close }, '취소'),
      h('button', { class: 'btn danger', type: 'button', disabled: !check.ok, onclick: () => {
        const r = s.releasePlayer(player.id);
        if (!r.ok) { ctx.toast(r.errors[0]); return; }
        close(); ctx.toast(check.waiverGames ? `${player.name} 웨이버 공시 — 양수 구단이 없으면 해지 비용 ${eok(r.cost.severance)}` : `${player.name} 방출 — 해지 비용 ${eok(r.cost.severance)}`); onDone(r);
      } }, '방출 확정')
    ]);
}

/** 연장 계약 창: 연봉·총 기간을 넣으면 수락 예상이 바로 보인다. 수락될 때만 확정할 수 있다 */
export function openExtendDialog(ctx, player, { onDone = () => ctx.refresh() } = {}) {
  const s = ctx.session, { rules } = ctx.data;
  const cur = player.contract;
  const rank = salaryRanks(s.players).get(player.id);
  const range = extensionYears(player, rank, rules);
  const demand = demandEok(player);
  const state = { salaryEok: Math.round(Math.max(demand, cur.salaryEok) * 10) / 10, years: range ? range[0] : cur.yearsLeft };
  const salaryIn = h('input', { type: 'number', step: '0.1', min: '0.3', value: state.salaryEok, id: `ct-sal-${player.id}`, 'aria-label': '새 연봉(억)', oninput: (e) => { state.salaryEok = Math.round((Number(e.target.value) || 0) * 10) / 10; update(); } });
  const yearsIn = range
    ? h('select', { id: `ct-yr-${player.id}`, 'aria-label': '총 계약 기간', onchange: (e) => { state.years = Number(e.target.value); update(); } }, Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i).map((y) => h('option', { value: y, selected: y === state.years }, `${y}년`)))
    : null;
  const status = h('p', { class: 'ct-line' });
  const info = h('p', { class: 'note' });
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    const r = s.extendContract(player.id, { salaryEok: state.salaryEok, years: state.years });
    if (!r.ok) { ctx.toast(r.errors[0]); update(); return; }
    dlg.close(); ctx.toast(`${player.name} 연장 계약 — 연봉 ${eok(state.salaryEok)}, 총 ${state.years}년`); onDone(r);
  } }, '연장 계약 제안');
  function update() {
    const chk = range ? s.extendCheck(player.id, { salaryEok: state.salaryEok, years: state.years }) : { ok: false, status: 'years', reason: '이미 최대 계약 기간(5년)이라 더 늘릴 수 없습니다' };
    const line = extensionLine(chk, rules);
    status.className = `ct-line ${line.tone}`;
    status.textContent = line.text;
    ok.disabled = !chk.ok;
    const payroll = payrollEok(s.players, s.managerId) - cur.salaryEok + state.salaryEok;
    info.textContent = `연장 후 국내 연봉 ${eok(payroll)} / 캡 ${eok(rules.salaryCap.domesticEok, 0)}${payroll > rules.salaryCap.domesticEok ? ` · 초과 기금 ${eok(softCapPenaltyEok(payroll, rules))}` : ''}`;
  }
  const dlg = openDialog(`ct-ext-${player.id}`, `${player.name} 연장 계약`, subOf(ctx, player),
    h('div', { class: 'stack' },
      h('div', { class: 'ct-grid' },
        h('div', h('span', { class: 'note' }, '현재 계약'), h('b', `${eok(cur.salaryEok)} · ${cur.yearsLeft}년 남음`)),
        h('div', h('span', { class: 'note' }, '선수 요구 연봉(추정)'), h('b', eok(demand))),
        h('label', { for: `ct-sal-${player.id}` }, h('span', { class: 'note' }, '새 연봉(억)'), salaryIn),
        range ? h('label', { for: `ct-yr-${player.id}` }, h('span', { class: 'note' }, `총 계약 기간(${range[0]}~${range[1]}년)`), yearsIn) : h('div', h('span', { class: 'note' }, '총 계약 기간'), h('b', '최대'))),
      status, info,
      h('p', { class: 'note' }, `선수는 새 연봉이 요구액에 얼마나 가까운지(${Math.round(rules.transactions.freeAgency.minOfferRatio * 100)}% 이상), 우리 성적·전통·출전 기회, 선수마다 정해진 기분을 보고 수락합니다. 결과는 같은 상태·같은 제안이면 항상 같습니다. 총 기간은 남은 기간을 포함하며, 전년도 보수 30위 이내 선수는 3~5년(만 32세 이상 예외)입니다. 시즌 중 연장은 새 연봉이 바로 캡에 반영되고, 이미 지난 경기 비율만큼은 예전 연봉으로 정산합니다.`)),
    (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, '취소'), ok]);
  update();
  return dlg;
}

/** 선수가 "우리 구단 국내 선수"인지, 아니라면 버튼을 못 쓰는 이유(순수). 반환: null이면 쓸 수 있음 */
export function contractBlock(session, p) {
  if (p.teamId !== session.managerId) return '우리 구단 선수가 아닙니다';
  if (p.origin !== 'domestic') return p.origin === 'foreign' ? '외국인 선수는 방출·연장 규정이 따로 있어 아직 할 수 없습니다' : '아시아쿼터 선수의 방출·교체는 제공된 규정에 절차가 없어 게임에서 지원하지 않습니다';
  if (session.stage === 'offseason') return '오프시즌에는 첫 단계(방출)와 재계약 단계(연장)에서 합니다';
  if (session.stage === 'playoffs') return '플레이오프 중에는 할 수 없습니다';
  return null;
}

/** 방출·연장 버튼 두 개(로스터 행·선수 상세 공용). 쓸 수 없으면 비활성 + 이유 툴팁 */
export function contractButtons(ctx, p, { onDone } = {}) {
  const block = contractBlock(ctx.session, p);
  const extendBlock = block ?? (p.contract.yearsLeft <= 0 ? '계약이 끝나는 선수는 재계약 단계에서 합니다' : null);
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return h('span', { class: 'ct-btns' },
    h('button', { class: 'btn ct-btn', type: 'button', disabled: Boolean(extendBlock), title: extendBlock ?? '계약이 남아 있어도 새 연봉·기간으로 연장 협상', 'aria-label': `${p.name} 연장 계약`, onclick: stop(() => openExtendDialog(ctx, p, { onDone })) }, '연장'),
    h('button', { class: 'btn ct-btn danger', type: 'button', disabled: Boolean(block), title: block ?? '계약 중도 해지(남은 보수를 지급)', 'aria-label': `${p.name} 방출`, onclick: stop(() => openReleaseDialog(ctx, p, { onDone })) }, '방출'));
}

