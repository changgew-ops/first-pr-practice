// 외국인 선수 영입: 과거 시즌 카드(예: "05 리 벤슨") 중에서 빈 자리를 채울 선수를 고른다.
import { h, eok } from '../../lib/dom.js';
import { foreignOf } from '../../../src/valuation.mjs';
import { playerLine, snapshotOf, decide } from './common.js';

const STAT_LABEL = [['shooting', '슛'], ['passing', '패스'], ['defense', '수비'], ['rebound', '리바'], ['athletic', '운동'], ['stamina', '체력']];
const usdText = (usd) => `${(usd / 10000).toLocaleString('ko-KR')}만 달러`;

export function render(ctx, pending) {
  const { candidates, maxUsd, team } = pending.payload;
  const { players } = snapshotOf(ctx.session, pending);
  const mine = foreignOf(players, team);
  const sorted = [...candidates].sort((a, b) => b.player.ovr - a.player.ovr);
  let pick = sorted[0].player.id;
  const host = h('div', { class: 'stack' });
  const rules = ctx.data.rules;

  function draw() {
    const chosen = sorted.find((c) => c.player.id === pick);
    host.replaceChildren(
      h('div', { class: 'card' },
        h('h2', '외국인 선수 영입'),
        h('p', { class: 'note' }, `빈 자리가 있습니다. 과거 시즌의 외국인 선수 카드가 영입 후보로 나왔습니다. 카드 이름 앞의 숫자는 그 선수를 뽑은 시즌(시작 연도)이고, 능력치는 그 시즌 기록으로 만든 값입니다. 하위 팀부터 고르며, 한 선수는 한 팀에만 갈 수 있습니다. 계약은 1~2년이고, 이번 계약에 쓸 수 있는 금액은 최대 ${usdText(maxUsd)}입니다(외국 선수 합계 ${usdText(rules.salaryCap.foreignUsdTotal)}, 1인 ${usdText(rules.salaryCap.foreignUsdPerPlayer)} 한도).`),
        mine.length ? h('p', { class: 'note' }, '지금 외국인: ', mine.map((p) => `${p.name}(${p.position}, OVR ${p.ovr})`).join(', ')) : null),
      h('div', { class: 'card flush' }, h('div', { class: 'os-draft' }, sorted.map(({ player: p, usd }) => h('label', { class: `os-draft-row ${pick === p.id ? 'picked' : ''}` },
        h('input', { type: 'radio', name: 'foreign', 'aria-label': `${p.name} 영입`, checked: pick === p.id, onchange: () => { pick = p.id; draw(); } }),
        playerLine(p),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, '요구'), h('b', usdText(usd))),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, '코스트'), h('b', p.cost)),
        h('span', { class: 'note' }, STAT_LABEL.map(([k, l]) => `${l} ${p.stats[k]}`).join(' · ')),
        p.card?.minutes ? h('span', { class: 'note' }, `${p.card.gp}경기 ${Math.round(p.card.minutes / Math.max(1, p.card.gp))}분`) : null)))),
      h('div', { class: 'os-submit' },
        h('span', { class: 'note' }, chosen ? `${chosen.player.name} · ${usdText(chosen.usd)}` : ''),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, pending.key, pick) }, '영입 확정')));
  }
  draw();
  return host;
}
