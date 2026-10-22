import { h, table, tabs, link, pct, stat } from '../lib/dom.js';
import { fullHistory } from '../lib/game.js';

export function seriesCard(ctx, s, my) {
  const win = (id) => s.winner === id;
  const row = (id, w) => h('div', { class: `t ${win(id) ? 'win' : 'lose'}` }, h('span', {}, link(`#/history/${id}`, ctx.name(id)), id === my ? ' ★' : ''), h('b', w));
  return h('div', { class: 'series' }, row(s.a, s.winsA), row(s.b, s.winsB));
}

export function bracket(ctx, season, my) {
  const po = season.playoffs;
  if (!po) return h('p', { class: 'muted pad' }, '이 시즌은 플레이오프 기록이 없습니다.');
  return h('div', { class: 'bracket' }, po.rounds.map((r) => h('div', h('h3', `${r.name} (${r.bestOf}전 ${Math.ceil(r.bestOf / 2)}선승)`), r.series.map((s) => seriesCard(ctx, s, my)))));
}

export function render(ctx, [seasonParam, tabParam]) {
  const { game, data } = ctx;
  const my = game.managerId;
  const hist = fullHistory(game, data);
  const seasons = [...hist.seasons].reverse();
  const season = seasons.find((s) => s.season === seasonParam) ?? seasons[0];
  const tab = ['standings', 'playoffs', 'leaders'].includes(tabParam) ? tabParam : 'standings';
  const entry = game.log.find((e) => e.season === season.season);
  const top = season.teams[0];
  const nav = (t) => ctx.go(`league/${season.season}/${t}`);

  let content;
  if (tab === 'standings') {
    const rows = season.teams.map((t) => ({ ...t, gb: ((top.wins - t.wins) + (t.losses - top.losses)) / 2 }));
    content = h('div', { class: 'card flush' }, table(rows, [
      { key: 'rank', label: '순위', get: (r) => r.rank, align: 'r' },
      { key: 'team', label: '구단', get: (r) => ctx.name(r.franchiseId), sort: 'str', render: (r) => link(`#/history/${r.franchiseId}`, ctx.name(r.franchiseId)) },
      { key: 'w', label: '승', get: (r) => r.wins, align: 'r' }, { key: 'l', label: '패', get: (r) => r.losses, align: 'r' },
      { key: 'pct', label: '승률', get: (r) => r.wins / (r.wins + r.losses), render: (r) => (r.wins / (r.wins + r.losses)).toFixed(3), align: 'r' },
      { key: 'gb', label: '게임차', get: (r) => r.gb, render: (r) => (r.gb === 0 ? '-' : r.gb.toFixed(1)), align: 'r' },
      ...(top.pointsFor != null ? [{ key: 'diff', label: '득실', get: (r) => r.pointsFor - r.pointsAgainst, render: (r) => { const d = r.pointsFor - r.pointsAgainst; return h('span', { class: d > 0 ? 'good' : 'bad' }, `${d > 0 ? '+' : ''}${(d / (r.wins + r.losses)).toFixed(1)}`); }, align: 'r', title: '경기당 득실 마진' }] : []),
      ...(season.teams[0].home ? [{ key: 'home', label: '홈', get: (r) => r.home ?? '', sort: 'str', align: 'r' }, { key: 'away', label: '원정', get: (r) => r.away ?? '', sort: 'str', align: 'r' }] : [])
    ], { sort: { key: 'rank', dir: 1 }, rowClass: (r) => `${r.franchiseId === my ? 'me' : ''} ${r.rank === 6 && season.playoffs ? 'cut' : ''}` }));
  } else if (tab === 'playoffs') {
    const champ = season.championId;
    content = h('div', { class: 'card' }, champ && h('p', {}, h('span', { class: 'tag champ' }, '우승'), ' ', h('b', ctx.name(champ))), bracket(ctx, season, my));
  } else if (entry) {
    const board = (key, label, fmt = (v) => v.toFixed(1)) => h('div', { class: 'card' }, h('h3', label), h('ol', { class: 'plain', style: { paddingLeft: '0' } }, [...entry.leaders].sort((a, b) => b[key] - a[key]).slice(0, 7).map((l, i) => h('li', h('span', { class: 'note', style: { width: '1.5em' } }, i + 1), h('span', { class: 'grow' }, link(`#/player/${l.id}`, l.name), ' ', h('span', { class: 'note' }, ctx.name(l.teamId))), h('b', fmt(l[key]))))));
    content = h('div', { class: 'grid g3' }, board('ppg', '득점'), board('rpg', '리바운드'), board('apg', '어시스트'), board('spg', '스틸'), board('bpg', '블록'));
  } else if (season.awards) {
    const a = season.awards;
    content = h('div', { class: 'card' }, h('h3', '시즌 수상'), h('ul', { class: 'plain' }, Object.entries(a).map(([k, v]) => h('li', h('span', { class: 'grow note' }, k), h('b', Array.isArray(v) ? v.join(', ') : v)))));
  } else content = h('p', { class: 'muted' }, '이 시즌은 개인 기록이 없습니다.');

  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '리그'), h('h1', `${season.season} 시즌`), season.simulated && h('span', { class: 'tag hot' }, '게임에서 진행')),
      h('select', { 'aria-label': '시즌 선택', onchange: (e) => ctx.go(`league/${e.target.value}/${tab}`) }, seasons.map((s) => h('option', { value: s.season, selected: s.season === season.season }, `${s.season}${s.simulated ? ' (게임)' : ''}`)))),
    tabs([['standings', '순위'], ['playoffs', '플레이오프'], ['leaders', entry ? '개인 기록' : '수상']], tab, nav),
    content);
  return { title: `리그 ${season.season}`, body };
}
