// 전술·컨디션·감독 화면 부품. 규칙은 src/tactics.mjs·condition.mjs·coaching.mjs, 상태는 세션(session.tactics / conditions / rest / staff)이 준다.
import { h } from './dom.js';
import { playerLink } from './player-info.js';
import { recommend, BALANCED, tacticList } from '../../src/tactics.mjs';
import { condTier } from '../../src/condition.mjs';
import { ROLE_LABEL } from '../../src/coaching.mjs';

const sign = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

/** 컨디션 막대(색은 단계별, css/tactics.css). value는 0~100 */
export function condBar(value, { compact = false } = {}) {
  const v = Math.round(value);
  const tier = condTier(v);
  return h('span', { class: `cond cond-${tier.key} ${compact ? 'compact' : ''}`, title: `컨디션 ${v} · ${tier.label}`, role: 'img', 'aria-label': `컨디션 ${v} ${tier.label}` },
    h('span', { class: 'cond-track', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(3, v)}%` } })), h('b', v));
}

/** 선수 id → 컨디션(없으면 100). 컨디션 기능이 꺼져 있으면 null을 돌려 화면이 열을 숨긴다 */
export function conditionOf(session, rules) {
  if (!rules.condition?.enabled || !session.run) return null;
  return (id) => session.conditions.get(id) ?? rules.condition.start ?? 100;
}

/** 적합도 막대: -1~1을 가운데 기준 좌우로 */
function fitBar(fit) {
  const w = Math.round(Math.abs(fit) * 50);
  return h('span', { class: `fit ${fit >= 0 ? 'pos' : 'neg'}`, role: 'img', 'aria-label': `구성 적합도 ${sign(fit, 2)}`, title: `구성 적합도 ${sign(fit, 2)} (리그 평균 대비)` },
    h('span', { class: 'fit-track', 'aria-hidden': 'true' }, h('i', { style: fit >= 0 ? { left: '50%', width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` } })), h('b', sign(fit, 2)));
}

/**
 * 전술 카드. lineup: 지금 편집 중인 편성의 선수 객체 { starters, bench }(없으면 지금 적용된 편성 기준 s.tactics.list).
 * 전술을 고르면 바로 적용된다(다음 경기부터). 추천 따르기는 AI와 같은 방식으로 구성에 맞는 전술을 자동으로 쓴다.
 */
export function tacticsCard(ctx, { lineup = null, onChange = null } = {}) {
  const s = ctx.session, rules = ctx.data.rules;
  const info = s.tactics;
  if (!info) return null;
  const live = s.stage === 'regular' || (s.stage === 'playoffs' && !s.playoffs?.done); // 플레이오프에서도 경기 사이에 바꿀 수 있다
  const list = lineup && lineup.starters.length && lineup.bench.length ? recommend(lineup, rules, info.refs) : info.list;
  const mod = s.teamMods?.[s.managerId];
  const mult = s.staff?.[s.managerId] ? 1 + (rules.coaching?.tacticsUnderstanding ?? 0) * (s.staff[s.managerId].head.tac - 50) / 50 : 1;
  const pick = (id) => { const r = s.setTactic(id); if (!r.ok) { ctx.toast(r.errors[0]); return; } ctx.toast(id ? `전술: ${tacticList(rules).find((t) => t.id === id).name}` : '추천 따르기로 바꿨습니다'); (onChange ?? ctx.refresh)(); };
  const best = list.find((r) => r.id !== BALANCED);
  const rows = list.map((t) => {
    const def = tacticList(rules).find((x) => x.id === t.id);
    const chosen = info.choice === t.id, using = info.current === t.id;
    const edge = t.id === BALANCED ? 0 : rules.tactics.edgeMax * t.fit * mult;
    return h('label', { class: `tac-row ${chosen ? 'picked' : ''} ${t.id === best?.id && t.fit >= rules.tactics.minFit ? 'rec' : ''}` },
      h('input', { type: 'radio', name: 'tactic', checked: chosen, disabled: !live, 'aria-label': `${t.name} 전술`, onchange: () => pick(t.id) }),
      h('span', { class: 'tac-main' }, h('b', t.name), t.id === best?.id && t.fit >= rules.tactics.minFit ? h('span', { class: 'tag hot' }, '추천') : null, using && !chosen ? h('span', { class: 'tag' }, '자동 적용 중') : null,
        h('span', { class: 'note' }, def?.desc ?? '')),
      h('span', { class: 'tac-fit' }, t.id === BALANCED ? h('span', { class: 'note' }, '이득·손해 없음') : [fitBar(t.fit), h('span', { class: `tac-edge ${edge >= 0 ? 'good' : 'bad'}` }, `기대 득점 ${sign(edge)}점`)]));
  });
  return h('div', { class: 'card tac-card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '전술'),
      h('div', { class: 'row' }, info.choice ? h('span', { class: 'tag hot' }, `직접 선택: ${tacticList(rules).find((t) => t.id === info.choice)?.name}`) : h('span', { class: 'tag' }, '추천 따르기'),
        h('button', { type: 'button', class: 'btn ghost', disabled: !live || !info.choice, onclick: () => pick(null) }, '추천 따르기'))),
    h('p', { class: 'note' }, '전술은 팀 구성에 맞을 때만 이득입니다. 적합도는 지금 편성이 그 전술이 요구하는 능력치에서 리그 평균보다 얼마나 나은지(+)·못한지(−)를 나타내고, 기대 득점 이득은 적합도 × ', rules.tactics.edgeMax, '점에 감독의 전술 이해를 곱한 값입니다. ',
      mod ? h('b', `이번 경기 팀 보정: 감독 ${sign(mod.parts.coach, 2)} · 전술 ${sign(mod.parts.tactic, 2)} · 컨디션 ${sign(mod.parts.cond, 2)} = ${sign(mod.edge, 2)}점`) : null,
      s.stage === 'playoffs' ? ' 플레이오프에서도 경기 사이에 바꿀 수 있습니다(다음 경기부터 적용).' : ''),
    h('div', { class: 'tac-list' }, rows));
}

/** 컨디션·휴식 카드: 우리 선수의 컨디션과 "이번 경기 쉬기" 지정 */
export function conditionCard(ctx, roster, { onChange = null } = {}) {
  const s = ctx.session, rules = ctx.data.rules;
  const condOf = conditionOf(s, rules);
  if (!condOf) return null;
  const po = s.stage === 'playoffs';
  const live = po ? Boolean(rules.playoffs.condition?.enabled !== false && !s.playoffs?.done) : s.stage === 'regular' && !s.regularDone;
  const rest = new Set(s.rest);
  const hurtIds = new Set((s.injuries ?? []).map((i) => i.playerId));
  const toggle = (id) => { rest.has(id) ? rest.delete(id) : rest.add(id); const r = s.setRest([...rest]); if (!r.ok) { ctx.toast(r.errors[0]); rest.has(id) ? rest.delete(id) : rest.add(id); } (onChange ?? ctx.refresh)(); };
  const lowest = [...roster].filter((p) => !hurtIds.has(p.id)).sort((a, b) => condOf(a.id) - condOf(b.id)).slice(0, 10);
  const tired = lowest.filter((p) => condOf(p.id) < rules.condition.thr);
  return h('div', { class: 'card cond-card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '컨디션과 휴식'), rest.size ? h('span', { class: 'tag hot' }, `다음 경기 휴식 ${rest.size}명`) : null),
    h('p', { class: 'note' }, `뛴 시간만큼 컨디션이 떨어지고 ${po ? '경기가 끝나면' : '하루가 지나면'} 조금 회복합니다${po ? '(플레이오프는 같은 시간을 뛰어도 더 지칩니다. 라운드가 끝나면 이틀치 휴식으로 회복)' : ''}. ${rules.condition.thr} 아래로 내려간 선수가 많이 뛰면 팀 기대 득점이 깎이고, 컨디션이 낮을수록 부상 확률도 오릅니다. 쉬게 하면 그 경기만 라인업에서 빠지고(건강한 선수가 대신 섭니다) ${po ? '그 경기를 치르면' : '하루 지나면'} 지정이 풀립니다.`),
    tired.length ? h('p', { class: 'cond-alert' }, `지친 선수: ${tired.slice(0, 4).map((p) => `${p.name} ${Math.round(condOf(p.id))}`).join(', ')}`) : h('p', { class: 'note' }, '지금은 지친 선수가 없습니다.'),
    h('div', { class: 'cond-grid' }, lowest.map((p) => h('div', { class: `cond-row ${rest.has(p.id) ? 'resting' : ''}` },
      playerLink(p.id, p.name, { cls: 'cond-name' }), h('span', { class: 'pos' }, p.position), condBar(condOf(p.id)),
      h('button', { type: 'button', class: `btn ${rest.has(p.id) ? 'primary' : 'ghost'} cond-rest`, disabled: !live, 'aria-pressed': String(rest.has(p.id)), onclick: () => toggle(p.id) }, rest.has(p.id) ? '쉬는 중' : '이번 경기 쉬기')))),
    h('p', { class: 'note' }, '컨디션이 낮은 순 상위 10명입니다. 전체 선수의 컨디션은 로스터 화면에서 볼 수 있습니다.'));
}

/** 홈 화면 한 줄: 우리 감독과 코치진 요약 */
export function staffLine(ctx) {
  const s = ctx.session;
  const st = s.staff?.[s.managerId];
  if (!st) return null;
  const rules = ctx.data.rules;
  const fmt = (r) => `${ROLE_LABEL[r].replace(' 코치', '')} ${st[r].k}`;
  return h('div', { class: 'card staff-line' },
    h('div', { class: 'row between' },
      h('div', h('b', `${st.head.name} 감독`), h('span', { class: 'note' }, ` 전술 ${st.head.tac} · 육성 ${st.head.dev} · 로테이션 ${st.head.rot} · 계약 ${st.head.yrs}년 남음`),
        h('div', { class: 'note' }, `코치진: ${['off', 'def', 'cond'].map(fmt).join(' · ')}`)),
      h('a', { class: 'btn', href: '#/staff' }, '감독·코치 보기')));
}

