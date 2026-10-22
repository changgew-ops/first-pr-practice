import { h, stat, bar, ovrChip, rankChart, link, eok, table } from '../lib/dom.js';
import { seasonLabel, powerRanking, payrollInfo, prestigeOf, fundsOf, rosterOf, fullHistory } from '../lib/game.js';
import { colorOf } from '../lib/team-ui.js';

export function recentRanks(hist, teamId, n = 16) {
  return hist.seasons.slice(-n).map((s) => {
    const r = s.teams.find((t) => t.franchiseId === teamId);
    return { label: s.season, rank: r?.rank ?? null, champion: s.championId === teamId };
  });
}

export function render(ctx) {
  const { game, data } = ctx;
  const my = game.managerId, team = ctx.team(my);
  const season = seasonLabel(game.league.season);
  const ranking = powerRanking(game, data);
  const myPower = ranking.find((r) => r.id === my);
  const pay = payrollInfo(game, data, my);
  const pr = prestigeOf(game, data)[my];
  const hist = fullHistory(game, data);
  const top = [...rosterOf(game, my)].sort((a, b) => b.ovr - a.ovr).slice(0, 5);
  const last = game.log.at(-1);
  const lastSeason = hist.seasons.at(-1);
  const lastRow = lastSeason.teams.find((t) => t.franchiseId === my);

  const capRatio = pay.domestic / pay.cap;
  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'swatch' }), h('div', h('div', { class: 'crumb' }, '홈'), h('h1', team.name)))),
    h('div', { class: 'card hero' },
      h('div', { class: 'row between' },
        h('div', h('h2', `${season} 시즌 시작 전`), h('p', { class: 'muted', style: { margin: 0 } }, `정규리그 ${data.rules.regularSeasonGames}경기 → 상위 6팀 플레이오프. 전 시즌: ${lastSeason.season} ${lastRow ? `${lastRow.rank}위 (${lastRow.wins}승 ${lastRow.losses}패)` : '-'}${lastSeason.championId === my ? ' · 우승' : ''}`)),
        h('button', { class: 'btn primary big', onclick: () => ctx.go(ctx.session.stage === 'offseason' ? 'offseason' : 'season') }, ctx.session.stage === 'offseason' ? '오프시즌 진행' : ctx.session.day === 0 ? `${season} 시즌 시작` : '시즌 계속'))),
    h('div', { class: 'grid g4' },
      stat('전력 순위', `${myPower.rank}위`, `10개 구단 중 · 전력 ${myPower.power.toFixed(1)}`),
      stat('국내 선수 연봉', eok(pay.domestic), `캡 ${eok(pay.cap, 0)}${pay.over ? ` · ${eok(pay.over)} 초과` : ` · 여유 ${eok(pay.cap - pay.domestic)}`}`),
      stat('구단 자금', eok(fundsOf(game, data, my)), last ? `지난 시즌 ${last.ledger[my].net >= 0 ? '+' : ''}${last.ledger[my].net.toFixed(1)}억` : '시작 자금'),
      stat('전통 점수', pr.score.toFixed(2), `통산 우승 ${pr.titles}회 · 정규 1위 ${pr.regularTitles}회`)),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'note' }, '캡 사용률'), h('span', { class: 'note' }, `${(capRatio * 100).toFixed(0)}%`)), bar(Math.min(pay.domestic, pay.hardLimit), pay.hardLimit, { cls: capRatio > 1 ? 'warn' : '', label: `소프트캡 ${pay.cap}억, 한도 ${pay.hardLimit.toFixed(0)}억` })),
    h('div', { class: 'grid split' },
      h('div', { class: 'card' }, h('h2', '최근 순위 흐름'), rankChart(recentRanks(hist, my)), h('p', { class: 'note' }, '노란 점은 우승. 2019-20은 코로나로 조기 종료, 이후 시즌은 게임에서 진행한 결과가 이어집니다.')),
      h('div', { class: 'card' }, h('h2', '핵심 선수'), h('ul', { class: 'plain' }, top.map((p) => h('li', ovrChip(p), h('span', { class: 'grow' }, link(`#/player/${p.id}`, p.name)), h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `${p.age}세`)))), h('p', {}, link('#/roster', '로스터 전체 보기 →')))),
    h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '리그 전력')),
      table(ranking, [
        { key: 'rank', label: '순위', get: (r) => r.rank, sort: false },
        { key: 'name', label: '구단', get: (r) => ctx.name(r.id), sort: false },
        { key: 'power', label: '전력', get: (r) => r.power, render: (r) => r.power.toFixed(1), align: 'r', sort: false },
        { key: 'pr', label: '전통', get: (r) => prestigeOf(game, data)[r.id].score, render: (r) => prestigeOf(game, data)[r.id].score.toFixed(2), align: 'r', sort: false },
        { key: 'pay', label: '국내 연봉', get: (r) => payrollInfo(game, data, r.id).domestic, render: (r) => eok(payrollInfo(game, data, r.id).domestic), align: 'r', sort: false }
      ], { rowClass: (r) => (r.id === my ? 'me' : ''), onRow: (r) => ctx.go(`history/${r.id}`) })));
  body.style.setProperty('--team', colorOf(my));
  return { title: '홈', body };
}
