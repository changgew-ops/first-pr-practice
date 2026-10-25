// 오프시즌 화면 공통 부품.
import { h, ovrChip, eok, bar, ORIGIN_LABEL } from '../../lib/dom.js';
import { STEPS, teamSummary, positionCounts } from '../../lib/offseason-view.js';
import { nameButton } from '../../lib/player-info.js';

/** 마지막으로 본 우리 구단 선수·자금(드래프트 단계의 결정 상황에는 선수 목록이 없어 이전 단계 값을 쓴다) */
export const cache = { season: null, players: null, funds: null };

export function snapshotOf(session, pending) {
  const p = pending.payload;
  let snap;
  if (p.league?.players) snap = { players: p.league.players, funds: session.funds };
  else if (p.state?.players) snap = { players: p.state.players, funds: p.state.funds };
  else if (cache.season === session.season && cache.players) return { players: cache.players, funds: cache.funds ?? session.funds, stale: true };
  else return { players: session.game.seasonEnd.league.players, funds: session.funds, stale: true };
  cache.season = session.season; cache.players = snap.players; cache.funds = snap.funds;
  return snap;
}

export const contractText = (p) => (p.contract.yearsLeft <= 0 ? '계약 만료' : `${p.contract.yearsLeft}년 남음`);
export const salaryText = (p) => (p.contract.salaryEok != null ? eok(p.contract.salaryEok) : '-');

/** OVR 칩 + 이름 + 포지션 + 나이 한 줄 */
export function playerLine(p, { extra = null } = {}) {
  return h('span', { class: 'os-pl' }, ovrChip(p), h('b', { class: 'os-name' }, nameButton(p)), h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `${p.age}세`), extra);
}

export function stepBar(currentId) {
  const at = STEPS.findIndex((s) => s.id === currentId);
  return h('ol', { class: 'os-steps', 'aria-label': '오프시즌 단계' }, STEPS.map((s, i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null }, h('span', { class: 'os-step-no' }, i < at ? '✓' : i + 1), h('span', { class: 'os-step-label' }, s.label))));
}

/** 우리 구단 현황 카드. note: 결정 상황이 지난 단계 값이라 부정확할 때 */
export function summaryCard(players, funds, managerId, rules, { stale = false } = {}) {
  const s = teamSummary(players, funds, managerId, rules);
  const over = s.payroll > s.cap + 1e-9;
  return h('div', { class: 'card os-summary' },
    h('div', { class: 'os-sum-grid' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '국내 연봉 / 캡'), h('div', { class: 'stat-value' }, `${eok(s.payroll)} / ${eok(s.cap, 0)}`),
        bar(Math.min(s.payroll, s.hardLimit), s.hardLimit, { cls: over ? 'warn' : '', label: `소프트캡 ${s.cap}억, 한도 ${s.hardLimit.toFixed(0)}억` }),
        h('div', { class: 'stat-sub' }, over ? `${eok(s.payroll - s.cap)} 초과 · 기금 ${eok(s.penalty)}` : `여유 ${eok(s.room)} · 한도 ${eok(s.hardLimit, 0)}`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '구단 자금'), h('div', { class: `stat-value ${s.funds < 0 ? 'bad' : ''}` }, eok(s.funds)), h('div', { class: 'stat-sub' }, s.funds < 0 ? '적자 상태' : '보상금·기금이 여기서 나갑니다')),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '국내 선수'), h('div', { class: 'stat-value' }, `${s.domesticCount} / ${s.domesticMax}명`), h('div', { class: 'stat-sub' }, `${ORIGIN_LABEL.foreign} ${s.foreignCount} · ${ORIGIN_LABEL.asia} ${s.asiaCount}`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '포지션 (현재/목표)'), h('div', { class: 'os-pos' }, positionCounts(players, managerId).map((r) => h('span', { class: `os-pos-chip ${r.count < r.target ? 'short' : ''}`, title: `${r.pos} ${r.count}명, 목표 ${r.target}명` }, `${r.pos} ${r.count}/${r.target}`))))),
    stale ? h('p', { class: 'note' }, '이 단계에서는 직전 단계까지의 로스터로 계산한 값입니다.') : null);
}

/** "남은 결정을 자동 단장에게" 버튼: 실수로 누르지 않도록 두 번 눌러야 한다 */
export function autoButton(ctx) {
  const btn = h('button', { class: 'btn ghost', type: 'button' }, '남은 결정 전부 자동 단장에게 맡기기');
  let armed = false;
  btn.addEventListener('click', () => {
    if (!armed) { armed = true; btn.textContent = '정말 맡길까요? 한 번 더 누르면 오프시즌이 끝까지 자동으로 진행됩니다'; btn.classList.add('armed'); setTimeout(() => { armed = false; btn.textContent = '남은 결정 전부 자동 단장에게 맡기기'; btn.classList.remove('armed'); }, 5000); return; }
    try { ctx.session.autoOffseason(); } catch (e) { ctx.toast(e.message); return; }
    ctx.go('report/offseason');
  });
  return btn;
}

/** 결정을 내리고 화면을 갱신한다. 오프시즌이 끝났으면 시즌 결산(오프시즌 탭)으로 */
export function decide(ctx, key, value) {
  try { ctx.session.decide(key, value); } catch (e) { ctx.toast(e.message); return false; }
  if (ctx.session.stage !== 'offseason') ctx.go('report/offseason'); else ctx.refresh();
  return true;
}

/** host.replaceChildren의 안전판: null·false·빈 값을 걸러서 넣는다(그냥 넘기면 "null" 글자가 찍힌다) */
export function fill(host, ...nodes) {
  host.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
}

const RESULT = {
  accepted: (r) => ['수락', 'good', `연봉 ${eok(r.salaryEok)}, ${r.years}년 계약을 맺었습니다.`],
  lost: (r, ctx) => ['다른 구단과 계약', 'bad', `${ctx.name(r.teamId)}가 더 좋은 조건(연봉 ${eok(r.theirSalaryEok)})을 내서 선수가 그쪽을 골랐습니다${r.myScore != null ? ` (선수의 평가 점수: 우리 ${r.myScore.toFixed(2)} / 그쪽 ${r.theirScore.toFixed(2)})` : ''}.`],
  low: (r) => ['제안이 너무 낮음', 'bad', `이번 라운드 요구액 ${eok(r.demandEok)}의 ${Math.round(r.minRatio * 100)}% 미만(우리 제안은 ${Math.round(r.ratio * 100)}%)이라 항상 거절됩니다. 최소 ${eok(r.minSalaryEok)} 이상은 제시해야 합니다.`],
  score: (r) => ['조건이 부족', 'warn', `수락 점수 ${r.score.toFixed(2)}가 기준 ${r.need}에 못 미쳤습니다. 점수는 제시액이 요구액에 가까운 정도와 우리 성적·전통·출전 기회·선수의 기분으로 정해지니 연봉을 올리거나 다음 라운드(요구액이 조금씩 내려갑니다)를 노려 보세요.`],
  cap: () => ['캡·한도에 걸림', 'bad', '이 계약을 하면 국내 연봉이 소프트캡 한도(캡의 115%)를 넘어 계약이 성사되지 않았습니다.'],
  roster: () => ['로스터 자리 없음', 'bad', '국내 선수 자리가 가득 차 있어 계약할 수 없었습니다.']
};

/** FA에서 우리가 낸 제안의 결과 목록 카드. results: freeagency.mjs offerResults의 항목들 */
export function offerResultsCard(ctx, results, { title, withRound = false } = {}) {
  if (!results?.length) return null;
  return h('div', { class: 'card os-results' }, h('h3', title),
    h('ul', { class: 'plain' }, results.map((r) => {
      const [label, cls, why] = (RESULT[r.status] ?? (() => [r.status, '', '']))(r, ctx);
      return h('li', h('span', { class: 'grow' }, withRound ? `${r.round}라운드 · ` : '', h('b', r.name), ` · 제안 ${eok(r.salaryEok)} ${r.years}년`), h('b', { class: cls }, label), h('div', { class: 'note os-why' }, why));
    })));
}
