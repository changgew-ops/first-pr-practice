// 홈의 "구단 · 경기장" 카드: 경기장, 수용 인원, 관중, 입장 수익, 이번 시즌 수입 구성.
import { h, eok } from '../lib/dom.js';
import { estimateRevenue } from '../../src/funds.mjs';
import { prestigeOf } from '../lib/game.js';

export const PART_LABEL = { gate: '입장 수익', playoffGate: '플레이오프 입장', broadcast: '중계권', sponsor: '모기업 스폰서', merch: '굿즈·기타', playoffBonus: '플레이오프 상금' };
const PART_ORDER = ['gate', 'playoffGate', 'broadcast', 'sponsor', 'merch', 'playoffBonus'];
const num = (n) => Number(n).toLocaleString('ko-KR');

/** 수입 구성 막대 + 범례. parts: { gate, broadcast, … } */
export function partsBar(parts) {
  const items = PART_ORDER.map((k) => [k, parts[k] ?? 0]).filter(([, v]) => v > 0);
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  return h('div', { class: 'fin-parts' },
    h('div', { class: 'fin-bar', role: 'img', 'aria-label': items.map(([k, v]) => `${PART_LABEL[k]} ${eok(v)}`).join(', ') }, items.map(([k, v]) => h('i', { class: `p-${k}`, style: { width: `${(v / total) * 100}%` }, title: `${PART_LABEL[k]} ${eok(v)}` }))),
    h('ul', { class: 'fin-legend' }, items.map(([k, v]) => h('li', h('span', { class: `dot p-${k}` }), `${PART_LABEL[k]} `, h('b', eok(v)), h('span', { class: 'note' }, ` ${Math.round((v / total) * 100)}%`)))));
}

export function financeCard(ctx) {
  const { game, data, session } = ctx;
  const my = game.managerId, team = ctx.team(my);
  const venue = team.venue ?? {};
  const last = game.log.at(-1)?.ledger?.[my];
  const att = last?.attendance;
  const est = estimateRevenue(my, { teamData: data.teams, standings: session.standings(), prestige: prestigeOf(game, data), season: game.league.season }, data.rules);
  const cap = venue.capacity;
  const fact = (label, value, sub) => h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, label), h('b', value), sub ? h('span', { class: 'note' }, sub) : null);
  return h('div', { class: 'card fin-card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '구단 · 경기장'), h('span', { class: 'note' }, `${team.city} · ${team.arena}`)),
    h('div', { class: 'fin-facts' },
      fact('홈 경기장', team.arena, cap ? `수용 ${num(cap)}명` : '수용 인원 자료 없음'),
      fact('경기당 관중', att ? `${num(att.avg)}명` : `${num(est.attendance.avg)}명`, att ? `지난 시즌${att.occupancy != null ? ` · 점유율 ${Math.round(att.occupancy * 100)}%` : ''}${att.sellouts ? ` · 매진 ${att.sellouts}경기` : ''}` : `예상 (인기 ${est.attendance.popularity.toFixed(2)})`),
      fact('1인당 입장료', `${est.attendance.yieldMan.toFixed(2)}만원`, '게임용 추정'),
      fact('입장 수익', eok(att && last?.parts ? last.parts.gate + last.parts.playoffGate : est.parts.gate), att ? '지난 시즌' : '이번 시즌 예상')),
    h('p', { class: 'note', style: { margin: '10px 0 4px' } }, `이번 시즌 예상 수입 ${eok(est.revenue)} (지금 성적 기준)`),
    partsBar(est.parts),
    h('p', { class: 'note fin-foot' }, '관중·입장료·중계권·스폰서·굿즈는 공개 자료를 바탕으로 한 게임용 추정입니다. 구단별 관중은 전통 점수와 승률에서 계산합니다.' + (cap ? '' : ' 경기장 수용 인원은 자료가 확인되면 채웁니다.')));
}
