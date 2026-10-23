// FA 보상 선택: 다른 구단에서 온 FA를 영입했을 때 원소속 구단에 낼 보상을 고른다.
import { h, eok } from '../../lib/dom.js';
import { compensationCandidates } from '../../lib/offseason-view.js';
import { playerLine, salaryText, contractText, decide } from './common.js';

export function render(ctx, pending) {
  const { player, options, state } = pending.payload;
  const { rules } = ctx.data;
  const my = ctx.session.managerId;
  const { protectedIds, eligible } = compensationCandidates(state.players, player.id, my, rules);
  const funds = state.funds[my] ?? 0;
  const choice = { type: 'cash', playerId: null };
  const from = player.prevTeamId ?? null;
  const host = h('div', { class: 'stack' });

  function draw() {
    const cost = choice.type === 'cash' ? options.cashOnly : options.withPlayerCash;
    const needPlayer = choice.type === 'player' && !choice.playerId;
    host.replaceChildren(
      h('div', { class: 'card' },
        h('h2', 'FA 보상 선택'),
        h('p', {}, h('b', player.name), `을(를) 영입했습니다. 전년 보수 ${options.tierMaxRank}위 이내 선수라 원소속 구단${from ? `(${ctx.name(from)})` : ''}에 보상을 해야 합니다.`),
        h('div', { class: 'os-cols' },
          h('div', { class: 'os-side' }, h('div', { class: 'os-side-title' }, '영입한 선수'), h('ul', { class: 'plain' }, h('li', playerLine(player), h('span', { class: 'grow' }), h('span', { class: 'note' }, `${salaryText(player)} · ${contractText(player)}`)))),
          h('div', { class: 'os-side' }, h('div', { class: 'os-side-title' }, '구단 자금'), h('p', { style: { margin: 0 } }, `지금 ${eok(funds)} → 보상 후 ${eok(funds - cost)}`))),
        h('div', { class: 'os-choices', role: 'radiogroup', 'aria-label': '보상 방식' },
          h('label', { class: `os-choice ${choice.type === 'cash' ? 'picked' : ''}` }, h('input', { type: 'radio', name: 'comp', checked: choice.type === 'cash', onchange: () => { choice.type = 'cash'; choice.playerId = null; draw(); } }),
            h('div', h('b', `현금 ${eok(options.cashOnly)}`), h('div', { class: 'note' }, `선수를 내주지 않고 현금만 냅니다(전년 보수의 ${Math.round((ctx.data.rules.transactions.compensation.tiers.find((t) => t.maxRank === options.tierMaxRank)?.cashOnlyRatio ?? 1) * 100)}%).`))),
          options.withPlayerCash != null ? h('label', { class: `os-choice ${choice.type === 'player' ? 'picked' : ''}` }, h('input', { type: 'radio', name: 'comp', checked: choice.type === 'player', onchange: () => { choice.type = 'player'; draw(); } }),
            h('div', h('b', `보상선수 1명 + 현금 ${eok(options.withPlayerCash)}`), h('div', { class: 'note' }, `보호선수 ${protectedIds.size}명(가치 상위 국내 선수)과 방금 영입한 선수는 내줄 수 없습니다. 현금은 전년 보수의 ${Math.round((ctx.data.rules.transactions.compensation.tiers.find((t) => t.maxRank === options.tierMaxRank)?.withPlayerCashRatio ?? 0) * 100)}%.`))) : null)),
      choice.type === 'player' ? h('div', { class: 'card' }, h('h3', '내줄 선수 고르기'),
        eligible.length ? h('ul', { class: 'plain os-pick' }, eligible.map((p) => h('li', h('label', h('input', { type: 'radio', name: 'comp-player', checked: choice.playerId === p.id, onchange: () => { choice.playerId = p.id; draw(); } }), playerLine(p, { extra: h('span', { class: 'note' }, `코스트 ${p.cost} · ${salaryText(p)} · ${contractText(p)}`) }))))) : h('p', { class: 'warn' }, '내줄 수 있는 선수가 없습니다. 현금으로 보상하세요.'),
        h('p', { class: 'note' }, '보호선수(내줄 수 없는 선수): ', [...protectedIds].map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(', '))) : null,
      h('div', { class: 'os-submit' },
        h('span', { class: 'note' }, needPlayer ? '내줄 선수를 골라 주세요' : `보상: ${choice.type === 'cash' ? `현금 ${eok(cost)}` : `선수 ${state.players.find((p) => p.id === choice.playerId)?.name} + 현금 ${eok(cost)}`}`),
        h('button', { class: 'btn primary big', type: 'button', disabled: needPlayer, onclick: () => decide(ctx, pending.key, choice.type === 'cash' ? { type: 'cash' } : { type: 'player', playerId: choice.playerId }) }, '보상 확정')));
  }
  draw();
  return host;
}
