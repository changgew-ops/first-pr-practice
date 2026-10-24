// 외국인 선수 영입: 과거 시즌 카드(예: "05 리 벤슨") 중에서 빈 자리를 채울 선수를 고른다.
import { h } from '../../lib/dom.js';
import { foreignOf } from '../../../src/valuation.mjs';
import { playerLine, decide, fill } from './common.js';
import { signingImpact } from '../../lib/preview-signing.js';
import { signingPreviewCard } from '../../lib/preview-signing-view.js';

const STAT_LABEL = [['shooting', '슛'], ['passing', '패스'], ['defense', '수비'], ['rebound', '리바'], ['athletic', '운동'], ['stamina', '체력']];
const usdText = (usd) => `${Math.round(usd / 10000).toLocaleString('ko-KR')}만 달러`;

export function render(ctx, pending) {
  const { candidates, maxUsd, team, taken = [], foreignUsd, vacancies, slot, slots, turn, turns, state } = pending.payload;
  const mine = foreignOf(state?.players ?? ctx.session.players, team);
  const sorted = [...candidates].sort((a, b) => Number(b.ok) - Number(a.ok) || b.player.ovr - a.player.ovr);
  const options = sorted.filter((c) => c.ok);
  let pick = options[0]?.player.id ?? null;
  const host = h('div', { class: 'stack' });
  const rules = ctx.data.rules;

  const slotBox = (i) => {
    const p = mine[i];
    return h('div', { class: `os-slot ${p ? 'full' : 'empty'}`, title: p ? `${p.name} · ${usdText(p.contract.salaryUsd)}` : '빈 자리' }, p ? [h('b', p.name), h('span', { class: 'note' }, `${p.position} · OVR ${p.ovr} · ${usdText(p.contract.salaryUsd)}`)] : [h('b', '빈 자리'), h('span', { class: 'note' }, '이번에 채웁니다')]);
  };

  function draw() {
    const chosen = options.find((c) => c.player.id === pick);
    fill(host,
      h('div', { class: 'card' },
        h('h2', '외국인 선수 영입'),
        h('div', { class: 'os-slots', 'aria-label': `외국인 자리 ${mine.length}/${slots}` }, Array.from({ length: slots }, (_, i) => slotBox(i))),
        h('p', {}, h('b', `외국인 자리 ${mine.length} / ${slots}명`), ` · 빈 자리 ${vacancies}개 중 ${slot}번째를 고르는 중입니다. 외국 선수 연봉은 합계 ${usdText(foreignUsd.total)}(1인 ${usdText(foreignUsd.perPlayer)}) 한도 중 ${usdText(foreignUsd.used)}을 쓰고 있어, 이번 계약에 쓸 수 있는 금액은 최대 ${usdText(Math.max(0, maxUsd))}입니다.`),
        h('p', { class: 'note' }, `과거 시즌의 외국인 선수 카드가 후보로 나왔습니다. 카드 이름 앞의 숫자는 그 선수를 뽑은 시즌(시작 연도)이고, 능력치는 그 시즌 기록으로 만든 값입니다. 영입은 하위 팀부터 차례로 하며 우리는 ${turns}개 팀 중 ${turn}번째입니다. 한 선수는 한 팀에만 갈 수 있고 계약은 1~2년입니다.`),
        taken.length ? h('div', { class: 'os-taken' }, h('div', { class: 'note' }, '우리 차례 전에 이미 영입된 선수(그래서 후보가 줄었습니다)'), h('ul', { class: 'plain' }, taken.map((t) => h('li', h('b', ctx.name(t.teamId)), '가 ', h('b', t.playerName), ` 영입 (${usdText(t.usd)}, ${t.years}년)`)))) : h('p', { class: 'note' }, '우리보다 먼저 고르는 팀이 아직 없습니다.')),
      options.length ? null : h('div', { class: 'card os-blocked', role: 'alert' }, h('h3', '한도 때문에 영입할 수 있는 후보가 없습니다'),
        h('p', {}, `이번 계약 최대 ${usdText(Math.max(0, maxUsd))}으로는 아래 후보의 요구 연봉을 맞출 수 없습니다. 기존 외국 선수와의 연봉 합계를 확인하세요(외국 선수 합계 한도 ${usdText(foreignUsd.total)}). 아래 버튼을 누르면 한도에 맞는 가상 외국인으로 자동으로 채웁니다.`)),
      h('div', { class: 'card flush' }, h('div', { class: 'os-draft' }, sorted.map(({ player: p, usd, ok, why }) => h('label', { class: `os-draft-row ${pick === p.id ? 'picked' : ''} ${ok ? '' : 'disabled'}`, 'aria-disabled': String(!ok) },
        h('input', { type: 'radio', name: 'foreign', 'aria-label': `${p.name} 영입`, disabled: !ok, checked: pick === p.id, onchange: () => { pick = p.id; draw(); } }),
        playerLine(p),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, '요구'), h('b', usdText(usd))),
        h('span', { class: 'note' }, STAT_LABEL.map(([k, l]) => `${l} ${p.stats[k]}`).join(' · ')),
        p.card?.minutes ? h('span', { class: 'note' }, `${p.card.gp}경기 ${Math.round(p.card.minutes / Math.max(1, p.card.gp))}분`) : null,
        ok ? null : h('span', { class: 'os-why bad' }, `영입 불가: ${why}`))))),
      chosen ? signingPreviewCard(signingImpact({ roster: state?.players ?? ctx.session.players, cand: chosen.player, offer: { salaryUsd: chosen.usd, years: 1 }, rules, teamId: team, check: { ok: chosen.ok, reason: chosen.why } }), { ctx, title: `${chosen.player.name}을(를) 영입하면`, note: '계약 기간은 1~2년 중 무작위로 정해져서, 다음 시즌 확정 지출에는 이 계약을 넣지 않았습니다.' }) : null,
      h('div', { class: 'os-submit' },
        h('span', { class: 'note' }, chosen ? `${chosen.player.name} · 요구 ${usdText(chosen.usd)}` : '고를 수 있는 후보가 없습니다'),
        options.length
          ? h('button', { class: 'btn primary big', type: 'button', onclick: () => confirm(chosen) }, '영입 확정')
          : h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, pending.key, 'auto') }, '가상 외국인으로 자동 채우기')));
  }

  function confirm(c) {
    if (!c) return;
    if (!decide(ctx, pending.key, c.player.id)) return;
    const now = ctx.session.pending?.payload?.state?.players ?? ctx.session.players;
    const years = now.find((p) => p.id === c.player.id)?.contract?.yearsLeft;
    ctx.toast(`${c.player.name} 영입 완료 (요구 ${usdText(c.usd)}${years ? `, ${years}년` : ''})`);
  }
  draw();
  return host;
}
