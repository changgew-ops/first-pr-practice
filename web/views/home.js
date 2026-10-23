import { h, stat, bar, ovrChip, rankChart, link, eok, table } from '../lib/dom.js';
import { seasonLabel, powerRanking, payrollInfo, prestigeOf, fundsOf, rosterOf, fullHistory } from '../lib/game.js';
import { colorOf } from '../lib/team-ui.js';
import { getNews } from '../lib/news-view.js';
import { moodCard } from './news.js';
import { financeCard } from './finance-card.js';

export function recentRanks(hist, teamId, n = 16) {
  return hist.seasons.slice(-n).map((s) => {
    const r = s.teams.find((t) => t.franchiseId === teamId);
    return { label: s.season, rank: r?.rank ?? null, champion: s.championId === teamId };
  });
}

const PENDING = { trade: '트레이드 제안', resign: '재계약 협상', freeAgency: 'FA 영입', compensation: 'FA 보상 선택', draft: '신인 드래프트', foreign: '외국인 선수 영입' };

/** 지금 단계에서 할 일을 알려 주는 카드: 시즌 시작 전 / 정규리그 중 / 플레이오프 / 오프시즌 */
function heroCard(ctx, season, lastSeason, lastRow) {
  const s = ctx.session, my = s.managerId;
  const mine = s.standings().find((r) => r.id === my);
  const go = (path, label, primary = true) => h('button', { class: `btn ${primary ? 'primary big' : ''}`, onclick: () => ctx.go(path) }, label);
  let title, text, actions;
  if (s.stage === 'offseason') {
    const p = s.pending;
    title = `${season} 시즌 종료 · 오프시즌`;
    text = p ? `지금 결정할 일: ${PENDING[p.kind] ?? p.kind}. 트레이드 → 재계약 → FA 5라운드 → 드래프트 → 외국인 영입 순서로 진행됩니다.` : '오프시즌 정리 중입니다.';
    actions = [go('offseason', '오프시즌 진행')];
  } else if (s.stage === 'playoffs') {
    const st = { alive: '우리 팀이 진출 중입니다', out: '우리 팀은 탈락했습니다', champion: '우리 팀이 우승했습니다', notQualified: '우리 팀은 플레이오프에 오르지 못했습니다' }[s.playoffStatus()];
    title = `${season} 플레이오프`;
    text = `${st}. 정규리그 ${mine.rank}위 (${mine.wins}승 ${mine.losses}패)`;
    actions = [go('season', '플레이오프 진행')];
  } else if (s.day === 0) {
    title = `${season} 시즌 시작 전`;
    text = `정규리그 ${ctx.data.rules.regularSeasonGames}경기 → 상위 6팀 플레이오프. 전 시즌: ${lastSeason.season} ${lastRow ? `${lastRow.rank}위 (${lastRow.wins}승 ${lastRow.losses}패)` : '-'}${lastSeason.championId === my ? ' · 우승' : ''}. 라인업과 훈련을 정하고 시작하세요.`;
    actions = [go('season', `${season} 시즌 시작`), go('lineup', '라인업', false), go('training', '훈련', false)];
  } else {
    const next = s.nextGame();
    title = `${season} 정규리그 ${s.day}/${s.totalDays}일차`;
    text = `${mine.wins}승 ${mine.losses}패 · ${mine.rank}위${next ? ` · 다음 경기: ${next.home ? '홈' : '원정'} vs ${ctx.name(next.oppId)}` : ' · 정규리그가 끝났습니다'}`;
    actions = [go('season', next ? '시즌 계속' : '플레이오프로'), go('lineup', '라인업', false), go('training', '훈련', false)];
  }
  return h('div', { class: 'card hero' }, h('div', { class: 'row between' }, h('div', h('h2', title), h('p', { class: 'muted', style: { margin: 0, maxWidth: '62ch' } }, text)), h('div', { class: 'row' }, actions)));
}

/** 최근 뉴스 3건과 팬 심리. 뉴스 쪽에 문제가 생겨도 홈은 열리도록 감싼다 */
function newsCard(ctx) {
  try {
    const news = getNews(ctx.session, ctx.data);
    return h('div', { class: 'card news-home' },
      h('div', h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '최근 뉴스'), link('#/news', '뉴스 전체 →')),
        h('ul', { style: { marginTop: '10px' } }, news.items.slice(0, 3).map((it) => h('li', h('span', { class: 'note' }, it.when), link('#/news', it.headline), h('span', { class: 'news-sum' }, it.summary))))),
      moodCard(news.mood, { compact: true }));
  } catch (e) { console.error(e); return null; }
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
  const gm = ctx.session.game.gm.name;
  const lastSeason = hist.seasons.at(-1);
  const lastRow = lastSeason.teams.find((t) => t.franchiseId === my);

  const capRatio = pay.domestic / pay.cap;
  const body = h('div', { class: 'stack' },
    h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'swatch' }), h('div', h('div', { class: 'crumb' }, `${gm} 단장`), h('h1', team.name)))),
    heroCard(ctx, season, lastSeason, lastRow),
    newsCard(ctx),
    financeCard(ctx),
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
