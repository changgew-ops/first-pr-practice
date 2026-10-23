// FA 시장 단계(라운드마다): 영입하고 싶은 선수에게 연봉·기간을 제안한다.
import { h, eok, POS_ORDER } from '../../lib/dom.js';
import { buildCtx, faPlan, minAcceptSalary, round1, valueOf } from '../../lib/offseason-view.js';
import { offerScore, compensationFor, preferredYears, yearsRange } from '../../../src/freeagency.mjs';
import { domesticOf } from '../../../src/valuation.mjs';
import { playerLine, decide, fill, offerResultsCard } from './common.js';

const SORTS = { value: ['가치순', (p) => -valueOf(p)], ovr: ['OVR순', (p) => -p.ovr], pot: ['POT순', (p) => -p.potential], age: ['어린 순', (p) => p.age], price: ['요구액 낮은 순', (p, d) => d(p)] };
const PLAN = { ok: ['제안 가능', 'good'], cap: ['캡·한도에 걸림', 'bad'], full: ['로스터 자리 없음', 'bad'] };

export function render(ctx, pending) {
  const { round, pool: fullPool, state, demandNow, lastResults } = pending.payload;
  const { rules } = ctx.data;
  const my = ctx.session.managerId;
  const fa = rules.transactions.freeAgency;
  const pastCard = (p) => p.card && p.card.season !== rules.season; // 시작 로스터의 카드(26)는 과거 카드가 아니다
  const ectx = buildCtx(ctx.session.game.seasonEnd, ctx.data.teams.length, rules, my);
  const roster = domesticOf(state.players, my);
  const pool = fullPool.filter((p) => p.origin === 'domestic');
  const offers = {}; // id → { salaryEok, years }
  const filter = { pos: 'all', q: '', sort: 'value', needOnly: false };
  const refs = new Map();
  const summary = h('div', { class: 'card os-fa-sum' });
  const submitBar = h('div', { class: 'os-submit' });
  const tableHost = h('div', { class: 'os-fa-list' });

  const defaultSalary = (p) => round1(demandNow(p) * 1.05);
  function update() {
    const plan = faPlan(pool, offers, state.players, rules, my);
    for (const [id, r] of refs) {
      const st = plan.byId.get(id);
      r.row.classList.toggle('picked', Boolean(offers[id]));
      if (!offers[id]) { r.badge.textContent = ''; r.hint.textContent = ''; continue; }
      const [text, cls] = PLAN[st];
      const p = pool.find((x) => x.id === id);
      const v = offerScore(p, offers[id].salaryEok, my, roster, ectx, rules, round);
      r.badge.className = `os-status ${st === 'ok' ? (v.accept ? 'good' : 'warn') : cls}`;
      r.badge.textContent = st === 'ok' ? (v.accept ? '이 선수는 수락할 조건' : '조건 부족(거절 예상)') : text;
      if (st === 'ok' && !v.accept) { const min = minAcceptSalary(p, my, roster, ectx, rules, round, demandNow(p)); r.hint.textContent = min == null ? '이 구단 제안으로는 설득이 어렵습니다' : `최소 ${eok(min)}은 제시해야 수락할 조건입니다`; }
      else r.hint.textContent = st === 'ok' ? '다른 구단의 제안이 더 좋으면 그쪽으로 갑니다' : '';
    }
    const n = Object.keys(offers).length;
    const total = Object.values(offers).reduce((s, o) => s + o.salaryEok, 0);
    const cap = rules.salaryCap.domesticEok;
    fill(summary, 
      h('div', { class: 'os-sum-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '이번 라운드 제안'), h('div', { class: 'stat-value' }, `${n}명`), h('div', { class: 'stat-sub' }, `연봉 합 ${eok(total)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '모두 영입하면 국내 연봉'), h('div', { class: 'stat-value' }, `${eok(plan.payroll)} / ${eok(cap, 0)}`), h('div', { class: 'stat-sub' }, plan.payroll > cap ? `초과 ${eok(plan.payroll - cap)} · 기금 ${eok(plan.penalty)}` : `여유 ${eok(cap - plan.payroll)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '국내 선수 자리'), h('div', { class: 'stat-value' }, `${plan.count} / ${rules.roster.domestic}`), h('div', { class: 'stat-sub' }, `현재 ${roster.length}명, 빈 자리 ${Math.max(0, rules.roster.domestic - roster.length)}`))),
    );
    fill(submitBar, 
      h('span', { class: 'note' }, n ? `제안 ${n}명 · 연봉 합 ${eok(total)}` : '이번 라운드는 제안하지 않습니다'),
      h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, `fa:${round}`, Object.entries(offers).map(([playerId, o]) => ({ playerId, salaryEok: o.salaryEok, years: o.years }))) }, n ? `${n}명에게 제안하고 ${round}라운드 진행` : `제안 없이 ${round}라운드 건너뛰기`));
  }

  function draw() {
    refs.clear();
    const owned = new Map(POS_ORDER.map((pos) => [pos, roster.filter((p) => p.position === pos).length]));
    let list = pool.filter((p) => (filter.pos === 'all' || p.position === filter.pos) && (!filter.q || p.name.includes(filter.q)) && (!filter.needOnly || (owned.get(p.position) ?? 0) < 2));
    const [, key] = SORTS[filter.sort];
    list = [...list].sort((a, b) => key(a, demandNow) - key(b, demandNow) || b.ovr - a.ovr);
    fill(tableHost, list.length ? h('div', { class: 'stack' }, list.map((p) => {
      const comp = compensationFor(p, rules);
      const o = offers[p.id];
      const on = h('input', { type: 'checkbox', id: `fa-on-${p.id}`, 'aria-label': `${p.name} 영입 제안`, checked: Boolean(o), onchange: (e) => { if (e.target.checked) offers[p.id] = { salaryEok: Number(salary.value) || defaultSalary(p), years: Number(years.value) }; else delete offers[p.id]; update(); } });
      const salary = h('input', { type: 'number', id: `fa-sal-${p.id}`, step: '0.1', min: '0.3', value: o?.salaryEok ?? defaultSalary(p), 'aria-label': `${p.name} 제안 연봉(억)`, oninput: (e) => { const v = round1(Number(e.target.value) || 0); offers[p.id] = { salaryEok: v, years: Number(years.value) }; on.checked = true; update(); } });
      const years = h('select', { id: `fa-yr-${p.id}`, 'aria-label': `${p.name} 계약 기간`, onchange: (e) => { if (offers[p.id]) { offers[p.id].years = Number(e.target.value); update(); } } }, (() => { const [lo, hi] = yearsRange(p, rules); const def = Math.max(lo, Math.min(hi, o?.years ?? preferredYears(p))); return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((y) => h('option', { value: y, selected: y === def }, `${y}년`)); })());
      const badge = h('span', { class: 'os-status' });
      const hint = h('span', { class: 'note' });
      const row = h('div', { class: 'os-fa-row' },
        h('div', { class: 'os-resign-head' }, h('label', { for: `fa-on-${p.id}`, class: 'os-check' }, on, playerLine(p)), badge),
        h('div', { class: 'os-resign-body' },
          h('div', { class: 'os-fact' }, h('span', { class: 'note' }, 'POT'), h('b', p.potential)),
          h('div', { class: 'os-fact', title: pastCard(p) ? '과거 시즌 기록으로 만든 카드: 그 시즌 능력치 그대로이고 원소속 구단이 없어 FA 보상이 없습니다' : null }, h('span', { class: 'note' }, pastCard(p) ? '과거 카드' : '이전'), h('b', pastCard(p) ? `${p.card.season}${p.card.teamId ? ` ${ctx.name(p.card.teamId)}` : ''}` : p.prevTeamId ? ctx.name(p.prevTeamId) : '-')),
          h('div', { class: 'os-fact' }, h('span', { class: 'note' }, '요구 연봉'), h('b', eok(demandNow(p)))),
          h('div', { class: 'os-fact', title: '다른 구단에서 온 FA를 영입하면 원소속 구단에 내는 보상' }, h('span', { class: 'note' }, 'FA 보상'), h('b', comp && p.prevTeamId !== my ? `${comp.grade ?? ''}등급 ${eok(comp.cashOnly)}${comp.withPlayerCash != null ? ` / 선수+${eok(comp.withPlayerCash)}` : ''}` : '없음')),
          h('label', { class: 'os-input', for: `fa-sal-${p.id}` }, h('span', { class: 'note' }, '제안 연봉(억)'), salary),
          h('label', { class: 'os-input', for: `fa-yr-${p.id}` }, h('span', { class: 'note' }, '기간'), years)),
        hint);
      refs.set(p.id, { row, badge, hint });
      return row;
    })) : h('p', { class: 'muted' }, '조건에 맞는 FA가 없습니다.'));
    update();
  }

  const bar = h('div', { class: 'row os-filters' });
  function rebuildBar() {
    fill(bar, 
      ...['all', ...POS_ORDER].map((pos) => h('button', { class: `btn ${filter.pos === pos ? 'primary' : ''}`, type: 'button', onclick: () => { filter.pos = pos; rebuildBar(); draw(); } }, pos === 'all' ? '모든 포지션' : pos)),
      h('select', { id: 'fa-sort', 'aria-label': '정렬', onchange: (e) => { filter.sort = e.target.value; draw(); } }, Object.entries(SORTS).map(([k, [name]]) => h('option', { value: k, selected: k === filter.sort }, name))),
      h('input', { type: 'search', id: 'fa-q', placeholder: '이름 검색', 'aria-label': '이름 검색', value: filter.q, oninput: (e) => { filter.q = e.target.value.trim(); draw(); } }),
      h('label', { class: 'os-check' }, h('input', { type: 'checkbox', checked: filter.needOnly, onchange: (e) => { filter.needOnly = e.target.checked; draw(); } }), '자리가 부족한 포지션만'));
  }
  rebuildBar();

  const body = h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h2', `FA 시장 ${round}라운드 / ${fa.rounds}`),
      h('p', { class: 'note' }, `선수는 가치가 높은 순서로 받은 제안 중 가장 마음에 드는 것을 고릅니다. AI 구단들도 같은 라운드에 제안을 내서, 더 좋은 조건을 낸 구단으로 갈 수 있습니다. 라운드가 지날수록 안 팔린 선수의 요구액이 ${(fa.demandDropPerRound * 100).toFixed(0)}%씩 내려가고 AI 구단도 제안을 조금씩 올립니다. 다른 구단에서 온 FA를 영입하면 원소속 구단에 보상금이 나가고(전년 보수 30위 안은 현금 또는 보호선수 ${rules.transactions.compensation.protectedPlayers}명 밖 보상선수), 영입이 성사되면 다음에 선택 화면이 나올 수 있습니다. 캡을 넘겨 영입하면 초과분의 30~50%를 기금으로 냅니다.`)),
    offerResultsCard(ctx, lastResults, { title: `${round - 1}라운드에 낸 우리 제안의 결과` }), summary, bar, tableHost, submitBar);
  draw();
  return body;
}
