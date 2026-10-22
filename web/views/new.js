// 새 게임: 단장 이름과 맡을 구단을 정한다.
import { h, eok } from '../lib/dom.js';
import { Session } from '../lib/session.js';
import { powerRanking, prestigeOf, payrollInfo } from '../lib/game.js';
import { colorOf } from '../lib/team-ui.js';

export function render(ctx) {
  const { data } = ctx;
  const preview = Session.create(data, { managerId: data.teams[0].id, gmName: '-', seed: 1 }).view;
  const power = new Map(powerRanking(preview, data).map((r) => [r.id, r]));
  const prestige = prestigeOf(preview, data);
  const seed = h('input', { type: 'number', id: 'seed', value: Math.floor(Math.random() * 1e6), min: 0, 'aria-label': '시드', style: { width: '110px' } });
  const name = h('input', { type: 'text', id: 'gm-name', maxlength: 10, placeholder: '예: 김단장', autocomplete: 'off', 'aria-describedby': 'gm-hint' });
  let teamId = null;
  const go = h('button', { class: 'btn primary big', disabled: true }, '단장 취임');
  const cards = [];
  const sync = () => { go.disabled = !(name.value.trim() && teamId); go.textContent = teamId && name.value.trim() ? `${name.value.trim()} 단장, ${ctx.name(teamId)}에 취임` : '이름과 구단을 정해 주세요'; };
  name.addEventListener('input', sync);
  go.addEventListener('click', () => ctx.newGame({ gmName: name.value.trim(), teamId, seed: Number(seed.value) }));
  const list = h('div', { class: 'grid g3' }, [...data.teams].sort((a, b) => power.get(a.id).rank - power.get(b.id).rank).map((t) => {
    const pay = payrollInfo(preview, data, t.id);
    const pr = prestige[t.id];
    const card = h('button', { class: 'team-card', type: 'button', 'aria-pressed': 'false', style: { '--team': colorOf(t.id) }, onclick: () => { teamId = t.id; cards.forEach((c) => c.setAttribute('aria-pressed', String(c === card))); sync(); } },
      h('h3', t.name), h('div', { class: 'note' }, `${t.city} · ${t.arena}`),
      h('dl', h('dt', '전력 순위'), h('dd', `${power.get(t.id).rank}위`), h('dt', '전통 점수'), h('dd', pr.score.toFixed(2)), h('dt', '통산 우승'), h('dd', `${pr.titles}회`), h('dt', '국내 연봉'), h('dd', `${eok(pay.domestic)} / ${eok(pay.cap, 0)}`)));
    cards.push(card);
    return card;
  }));
  sync();
  return { title: '새 게임', body: h('div', { class: 'intro stack' },
    h('button', { class: 'btn ghost', onclick: () => ctx.go('intro') }, '← 소개'),
    h('h1', '단장 취임'),
    h('div', { class: 'card stack' }, h('label', { for: 'gm-name', class: 'field-label' }, '단장님의 이름은?'), name, h('p', { class: 'note', id: 'gm-hint' }, '게임 안에서 "OOO 단장"으로 불립니다. 나중에 바꿀 수 없습니다.')),
    h('div', h('h2', '맡을 구단'), h('p', { class: 'note' }, '전력이 약한 구단일수록 어렵지만 키울 재미가 큽니다. 실제 순위와는 관계없이 지금 로스터의 전력 순서입니다.'), list),
    h('details', h('summary', { class: 'muted' }, '고급: 시드'), h('p', { class: 'note' }, '같은 시드와 같은 선택이면 같은 결과가 나옵니다.'), seed),
    h('div', { class: 'row' }, go)) };
}
