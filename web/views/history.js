import { h, table, tabs, link, rankChart, stat, pct } from '../lib/dom.js';
import { fullHistory } from '../lib/game.js';
import { stageOfHistory } from '../../src/legacy.mjs';
import { colorOf } from '../lib/team-ui.js';

function teamPage(ctx, hist, id) {
  const f = hist.franchises.find((x) => x.id === id);
  const sum = hist.summary.find((x) => x.id === id);
  const rows = hist.seasons.map((s) => ({ s, r: s.teams.find((t) => t.franchiseId === id) })).filter((x) => x.r);
  const body = h('div', { class: 'stack', style: { '--team': colorOf(id) } },
    h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'swatch' }), h('div', h('div', { class: 'crumb' }, link('#/history', '구단 역사'), ' / ', ctx.name(id)), h('h1', ctx.name(id)))), link(`#/roster/${id}`, '현재 로스터 →')),
    h('div', { class: 'grid g4' },
      stat('우승', `${sum.titles.length}회`, sum.titles.slice(-3).join(', ') || '-'), stat('결승', `${sum.finals}회`, `플레이오프 ${sum.playoffAppearances}회 진출`),
      stat('통산 승률', pct(sum.winPct), `${sum.seasons}시즌 ${sum.wins}승 ${sum.losses}패`), stat('최고 순위', `${sum.bestRank}위`, `정규 1위 ${sum.firstPlaces}회 · 최저 ${sum.worstRank}위`)),
    h('div', { class: 'card' }, h('h2', '순위 흐름'), rankChart(rows.map(({ s, r }) => ({ label: s.season, rank: r.rank, champion: s.championId === id })), { width: 900, height: 170 }), h('p', { class: 'note' }, '우승·결승 횟수는 플레이오프 화면이 있는 시즌(2007-08부터, 2019-20 제외)만 셉니다. 노란 점은 우승.')),
    f?.names?.length > 1 && h('div', { class: 'card' }, h('h2', '구단 이름 변천'), h('div', { class: 'row' }, f.names.map((n) => h('span', { class: 'tag' }, `${n.name} ${n.from}${n.to && n.to !== n.from ? `~${n.to}` : ''}`)))),
    h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '시즌별 기록')),
      table(rows.map(({ s, r }) => ({ season: s.season, simulated: s.simulated, rank: r.rank, w: r.wins, l: r.losses, pct: r.wins / (r.wins + r.losses), stage: stageOfHistory(s, id), name: r.displayName })), [
        { key: 'season', label: '시즌', get: (r) => r.season, sort: 'str', render: (r) => h('a', { href: `#/league/${r.season}` }, r.season, r.simulated ? h('span', { class: 'tag hot', style: { marginLeft: '6px' } }, '게임') : '') },
        { key: 'name', label: '당시 이름', get: (r) => r.name ?? '' , sort: 'str' },
        { key: 'rank', label: '순위', get: (r) => r.rank, align: 'r' }, { key: 'w', label: '승', get: (r) => r.w, align: 'r' }, { key: 'l', label: '패', get: (r) => r.l, align: 'r' },
        { key: 'pct', label: '승률', get: (r) => r.pct, render: (r) => r.pct.toFixed(3), align: 'r' },
        { key: 'stage', label: '플레이오프', get: (r) => r.stage ?? '', sort: 'str', render: (r) => (r.stage === '우승' ? h('span', { class: 'tag champ' }, '우승') : r.stage ?? '') }
      ], { sort: { key: 'season', dir: -1 } })));
  return { title: ctx.name(id), body };
}

export function render(ctx, [param, tabParam]) {
  const { game, data } = ctx;
  const hist = fullHistory(game, data);
  if (param && hist.franchises.some((f) => f.id === param)) return teamPage(ctx, hist, param);
  const tab = param === 'titles' ? 'titles' : 'teams';
  const my = game.managerId;
  const champions = [...hist.seasons].filter((s) => s.championId).reverse().map((s) => ({ season: s.season, simulated: s.simulated, champ: s.championId, runner: s.playoffs?.runnerUpId ?? null, first: s.teams.find((t) => t.rank === 1)?.franchiseId, sponsor: s.titleSponsor }));
  const content = tab === 'teams'
    ? h('div', { class: 'card flush' }, table(hist.summary, [
      { key: 'name', label: '구단', get: (r) => ctx.name(r.id), sort: 'str', render: (r) => link(`#/history/${r.id}`, ctx.name(r.id)) },
      { key: 'titles', label: '우승', get: (r) => r.titles.length, align: 'r' }, { key: 'finals', label: '결승', get: (r) => r.finals, align: 'r' },
      { key: 'po', label: '플레이오프', get: (r) => r.playoffAppearances, align: 'r' }, { key: 'first', label: '정규 1위', get: (r) => r.firstPlaces, align: 'r' },
      { key: 'pct', label: '통산 승률', get: (r) => r.winPct, render: (r) => r.winPct.toFixed(3), align: 'r' }, { key: 'best', label: '최고 순위', get: (r) => -r.bestRank, render: (r) => `${r.bestRank}위`, align: 'r' }
    ], { sort: { key: 'titles', dir: -1 }, rowClass: (r) => (r.id === my ? 'me' : ''), onRow: (r) => ctx.go(`history/${r.id}`) }))
    : h('div', { class: 'card flush' }, table(champions, [
      { key: 'season', label: '시즌', get: (r) => r.season, sort: 'str', render: (r) => h('a', { href: `#/league/${r.season}/playoffs` }, r.season, r.simulated ? h('span', { class: 'tag hot', style: { marginLeft: '6px' } }, '게임') : '') },
      { key: 'champ', label: '우승', get: (r) => ctx.name(r.champ), sort: 'str', render: (r) => h('b', ctx.name(r.champ)) },
      { key: 'runner', label: '준우승', get: (r) => (r.runner ? ctx.name(r.runner) : '-'), sort: 'str' },
      { key: 'first', label: '정규 1위', get: (r) => (r.first ? ctx.name(r.first) : '-'), sort: 'str' }
    ], { sort: { key: 'season', dir: -1 }, rowClass: (r) => (r.champ === my ? 'me' : '') }));
  return {
    title: '구단 역사', body: h('div', { class: 'stack' },
      h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '구단 역사'), h('h1', 'KBL 역대 기록'))),
      tabs([['teams', '구단별'], ['titles', '우승 기록']], tab, (t) => ctx.go(t === 'titles' ? 'history/titles' : 'history')),
      content, h('p', { class: 'note' }, '1997년부터의 순위, 2007-08부터의 플레이오프는 KBL 화면에서 옮긴 실제 기록입니다. “게임” 표시는 이 게임에서 진행한 시즌입니다.'))
  };
}
