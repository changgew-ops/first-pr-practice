import { h, table, ovrChip, eok, ORIGIN_LABEL, POS_ORDER, stat, bar, RARITY_LABEL } from '../lib/dom.js';
import { rosterOf, payrollInfo, teamPower } from '../lib/game.js';
import { contractButtons } from '../lib/contract-view.js';
import { avatarEl } from '../lib/avatar.js';
import { colorOf } from '../lib/team-ui.js';
import { injuryMap, injuryTag, tempTag } from '../lib/injury-view.js';
import { marketPanels } from './market.js';

export function render(ctx, [teamParam]) {
  const { game, data } = ctx;
  const teamId = teamParam && ctx.team(teamParam) ? teamParam : game.managerId;
  const mine = teamId === game.managerId;
  const roster = rosterOf(game, teamId);
  const pay = payrollInfo(game, data, teamId);
  const { lineup } = teamPower(game, data, teamId);
  const starters = new Set(lineup.starters.map((p) => p.id)), bench = new Set(lineup.bench.map((p) => p.id));
  const hurt = injuryMap(ctx.session); // 지금 결장 중인 선수(전 구단)
  const f = { origin: 'all', pos: 'all', q: '' };
  const host = h('div');
  const draw = () => {
    const rows = roster.filter((p) => (f.origin === 'all' || p.origin === f.origin) && (f.pos === 'all' || p.position === f.pos) && (!f.q || p.name.includes(f.q)));
    host.replaceChildren(table(rows, [
      { key: 'number', label: '#', get: (p) => p.number, align: 'r' },
      { key: 'name', label: '이름', get: (p) => p.name, sort: 'str', render: (p) => h('span', { class: 'name-with-avatar' }, avatarEl(p, { size: 28, teamColor: colorOf(teamId), cls: 'avatar-row' }), h('a', { href: `#/player/${p.id}` }, p.name, p.real ? '' : h('span', { class: 'tag', style: { marginLeft: '6px' } }, '신인·가상'))) },
      { key: 'pos', label: '포지션', get: (p) => POS_ORDER.indexOf(p.position), render: (p) => h('span', { class: 'pos' }, p.position) },
      { key: 'age', label: '나이', get: (p) => p.age, align: 'r' },
      { key: 'ovr', label: 'OVR', get: (p) => p.ovr, render: ovrChip, align: 'r' },
      { key: 'pot', label: 'POT', get: (p) => p.potential, align: 'r', title: '성장 한도' },
      { key: 'cost', label: '코스트', get: (p) => p.cost, align: 'r', title: '라인업 코스트 합 제한 65' },
      { key: 'sal', label: '연봉', get: (p) => (p.contract.salaryUsd ? p.contract.salaryUsd / 1e5 : p.contract.salaryEok), render: (p) => (p.origin === 'foreign' ? `$${(p.contract.salaryUsd / 1000).toFixed(0)}k` : eok(p.contract.salaryEok)), align: 'r' },
      { key: 'yrs', label: '계약', get: (p) => p.contract.yearsLeft, render: (p) => (p.contract.yearsLeft <= 0 ? h('span', { class: 'warn' }, '만료') : `${p.contract.yearsLeft}년`), align: 'r' },
      { key: 'origin', label: '구분', get: (p) => p.origin, sort: 'str', render: (p) => ORIGIN_LABEL[p.origin] },
      { key: 'role', label: '편성', get: (p) => (starters.has(p.id) ? 2 : bench.has(p.id) ? 1 : 0), render: (p) => h('span', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } }, hurt.get(p.id) ? injuryTag(hurt.get(p.id)) : starters.has(p.id) ? h('span', { class: 'tag hot' }, '스타팅') : bench.has(p.id) ? h('span', { class: 'tag' }, '벤치') : '', p.temp ? tempTag() : null) },
      ...(mine ? [{ key: 'act', label: '계약', get: () => 0, sort: false, render: (p) => contractButtons(ctx, p) }] : [])
    ], { sort: { key: 'ovr', dir: -1 }, onRow: (p) => ctx.go(`player/${p.id}`), empty: '조건에 맞는 선수가 없습니다' }));
  };
  const chip = (key, val, label) => h('button', { class: `btn ${f[key] === val ? 'primary' : ''}`, onclick: (e) => { f[key] = val; e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('primary')); e.target.classList.add('primary'); draw(); } }, label);
  draw();
  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, mine ? '로스터' : '다른 구단 로스터'), h('h1', `${ctx.name(teamId)} 로스터`)),
      h('select', { 'aria-label': '구단 선택', onchange: (e) => ctx.go(`roster/${e.target.value === game.managerId ? '' : e.target.value}`) }, data.teams.map((t) => h('option', { value: t.id, selected: t.id === teamId }, t.name)))),
    h('div', { class: 'grid g4' },
      stat('선수단', `${roster.length}명`, `국내 ${pay.counts.domestic} · 외국 ${pay.counts.foreign} · 아시아쿼터 ${pay.counts.asia}`),
      stat('국내 연봉', eok(pay.domestic), `캡 ${eok(pay.cap, 0)}`),
      stat('평균 OVR', (roster.reduce((s, p) => s + p.ovr, 0) / roster.length).toFixed(1), `평균 ${(roster.reduce((s, p) => s + p.age, 0) / roster.length).toFixed(1)}세`),
      stat('계약 만료 예정', `${roster.filter((p) => p.contract.yearsLeft <= 1).length}명`, '올 시즌 뒤 재계약 대상')),
    h('div', { class: 'card flush' },
      h('div', { class: 'pad row' }, ['all', ...POS_ORDER].map((p) => chip('pos', p, p === 'all' ? '모든 포지션' : p)), h('span', { class: 'note' }, '|'), [['all', '전체'], ['domestic', '국내'], ['foreign', '외국'], ['asia', '아시아쿼터']].map(([k, l]) => chip('origin', k, l)),
        h('input', { type: 'search', placeholder: '이름 검색', 'aria-label': '이름 검색', oninput: (e) => { f.q = e.target.value.trim(); draw(); } })),
      host),
    mine ? marketPanels(ctx) : null);
  return { title: `${ctx.name(teamId)} 로스터`, body };
}
