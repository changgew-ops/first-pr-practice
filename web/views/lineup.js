import { h, ovrChip, eok, bar, stat, link } from '../lib/dom.js';
import { teamPower, rosterOf } from '../lib/game.js';

const slot = (p) => h('a', { class: 'slot', href: `#/player/${p.id}` }, h('span', { class: 'pos' }, p.position), h('span', { class: 'nm' }, p.name), ovrChip(p), h('span', { class: 'meta' }, `코스트 ${p.cost}${p.origin === 'foreign' ? ' · 외국' : p.origin === 'asia' ? ' · 아시아쿼터' : ''}`));

export function render(ctx) {
  const { game, data } = ctx;
  const my = game.managerId;
  const { lineup, cost, power } = teamPower(game, data, my);
  const cap = data.rules.lineup.costCap;
  const used = new Set([...lineup.starters, ...lineup.bench].map((p) => p.id));
  const rest = rosterOf(game, my).filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const foreignStart = lineup.starters.filter((p) => p.origin === 'foreign').length;
  return {
    title: '라인업', body: h('div', { class: 'stack' },
      h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '라인업'), h('h1', '라인업 · 코스트'))),
      h('div', { class: 'callout' }, '지금은 코스트 제한(합계 65) 안에서 가장 강한 10명을 자동으로 편성합니다. 직접 편성은 다음 단계에서 붙입니다.'),
      h('div', { class: 'grid g3' }, stat('전력', power.toFixed(1), '스타팅 70% + 벤치 30%'), stat('코스트', `${cost} / ${cap}`, cost > cap ? '제한 초과' : `여유 ${cap - cost}`), stat('스타팅 외국 선수', `${foreignStart}명`, `동시 출전 ${data.rules.foreignPlayers.onCourt}명까지`)),
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'note' }, '코스트 사용'), h('span', { class: 'note' }, `${cost}/${cap}`)), bar(cost, cap, { cls: cost > cap ? 'bad' : cost > cap - 3 ? 'warn' : '' })),
      h('div', { class: 'card' }, h('h2', '스타팅 5'), h('div', { class: 'court' }, lineup.starters.map(slot))),
      h('div', { class: 'card' }, h('h2', '벤치 5'), h('div', { class: 'court' }, lineup.bench.map(slot))),
      h('div', { class: 'card' }, h('h2', '그 밖의 선수'), rest.length ? h('ul', { class: 'plain' }, rest.map((p) => h('li', ovrChip(p), h('span', { class: 'grow' }, link(`#/player/${p.id}`, p.name)), h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `코스트 ${p.cost}`)))) : h('p', { class: 'muted' }, '없음')))
  };
}
