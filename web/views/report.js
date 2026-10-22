import { h, table, tabs, link, stat, ovrChip, eok, signed, ORIGIN_LABEL } from '../lib/dom.js';
import { bracket } from './league.js';
import { logToHistory, seasonLabel, playerById } from '../lib/game.js';

export function render(ctx, [tabParam]) {
  const { game, data } = ctx;
  const my = game.managerId;
  const e = game.log.at(-1);
  if (!e) return { title: '시즌 결산', body: h('div', { class: 'card' }, h('h2', '아직 진행한 시즌이 없습니다'), h('p', { class: 'muted' }, '홈에서 시즌을 진행하면 결과가 여기에 쌓입니다.'), h('button', { class: 'btn primary', onclick: () => ctx.go('home') }, '홈으로')) };
  const tab = ['summary', 'games', 'offseason'].includes(tabParam) ? tabParam : 'summary';
  const row = e.standings.find((s) => s.id === my);
  const stage = e.stage[my];
  const led = e.ledger[my];
  const name = (id) => e.playerNames[id] ?? id;
  const next = seasonLabel(game.league.season);

  const resultTag = stage === '우승' ? h('span', { class: 'tag champ' }, '우승') : stage ? h('span', { class: 'tag hot' }, `${stage} 진출`) : h('span', { class: 'tag' }, '플레이오프 탈락');
  const sum = () => {
    const mineLeaders = e.leaders.filter((l) => l.teamId === my).sort((a, b) => b.ppg - a.ppg);
    return h('div', { class: 'stack' },
      h('div', { class: 'grid g4' },
        stat('정규리그', `${row.rank}위`, `${row.wins}승 ${row.losses}패 · 승률 ${(row.wins / (row.wins + row.losses)).toFixed(3)}`),
        stat('플레이오프', stage ?? '진출 실패', e.championId === my ? '챔피언' : `우승 ${ctx.name(e.championId)}`),
        stat('시즌 수입', eok(led.revenue), `선수단 연봉 ${eok(led.payroll)}`),
        stat('순이익', `${led.net >= 0 ? '+' : ''}${led.net.toFixed(1)}억`, `자금 ${eok(e.fundsAfter[my])}${led.penalty ? ` · 기금 ${eok(led.penalty)}` : ''}`)),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', '우리 팀 득점 순위'), h('ul', { class: 'plain' }, mineLeaders.slice(0, 6).map((l) => h('li', h('span', { class: 'grow' }, link(`#/player/${l.id}`, l.name)), h('span', { class: 'note' }, `${l.ppg.toFixed(1)}점 ${l.rpg.toFixed(1)}리 ${l.apg.toFixed(1)}어`))))),
        h('div', { class: 'card' }, h('h3', '리그 득점 TOP 5'), h('ul', { class: 'plain' }, [...e.leaders].sort((a, b) => b.ppg - a.ppg).slice(0, 5).map((l, i) => h('li', h('span', { class: 'note' }, i + 1), h('span', { class: 'grow' }, link(`#/player/${l.id}`, l.name), ' ', h('span', { class: 'note' }, ctx.name(l.teamId))), h('b', l.ppg.toFixed(1))))))),
      h('div', { class: 'card' }, h('h3', '플레이오프'), bracket(ctx, logToHistory(e), my)),
      h('p', {}, link(`#/league/${e.season}`, `${e.season} 순위표 보기 →`)));
  };
  const games = () => h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h3', `${row.wins}승 ${row.losses}패`), h('div', { class: 'timeline' }, e.myGames.map((g) => h('span', { class: `d ${g.win ? 'w' : 'l'}`, title: `${g.day}일차 vs ${ctx.name(g.oppId)} ${g.my}:${g.opp}` }, g.win ? '승' : '패')))),
    h('div', { class: 'card flush' }, table(e.myGames, [
      { key: 'day', label: '일차', get: (g) => g.day, align: 'r' }, { key: 'ha', label: '', get: (g) => (g.home ? '홈' : '원정'), sort: 'str' },
      { key: 'opp', label: '상대', get: (g) => ctx.name(g.oppId), sort: 'str' }, { key: 'sc', label: '스코어', get: (g) => g.my - g.opp, render: (g) => `${g.my} : ${g.opp}${g.ot ? ` (연장 ${g.ot})` : ''}`, align: 'r' },
      { key: 'res', label: '결과', get: (g) => (g.win ? 1 : 0), render: (g) => h('span', { class: g.win ? 'good' : 'bad' }, g.win ? '승' : '패') }
    ], { sort: { key: 'day', dir: 1 } })));
  const list = (items, empty, fn) => (items.length ? h('ul', { class: 'plain' }, items.map(fn)) : h('p', { class: 'muted' }, empty));
  const r = e.report;
  const offseason = () => {
    const myRet = r.retired.filter((x) => x.teamId === my);
    const myDraft = r.drafted.filter((x) => x.teamId === my);
    const mySign = r.signings.filter((x) => x.teamId === my || x.from === my);
    return h('div', { class: 'stack' },
      h('div', { class: 'callout' }, `${next} 시즌을 앞둔 오프시즌입니다. 지금은 자동 단장이 트레이드·재계약·FA·드래프트를 처리했습니다. 직접 결정하는 화면은 다음 단계에서 붙입니다.`),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', '성장·노쇠 (우리 팀)'), list(r.progressed.mine, '변화 없음', (x) => h('li', h('span', { class: 'grow' }, link(`#/player/${x.id}`, x.name), playerById(game, x.id)?.teamId === my ? '' : h('span', { class: 'tag', style: { marginLeft: '6px' } }, '오프시즌에 팀을 떠남')), h('span', { class: 'note' }, `${x.from} → ${x.to}`), h('b', { class: x.delta > 0 ? 'good' : x.delta < 0 ? 'bad' : 'muted' }, signed(x.delta))))),
        h('div', { class: 'card' }, h('h3', '리그 성장 TOP · 하락 TOP'), h('div', { class: 'grid g2' }, h('ul', { class: 'plain' }, r.progressed.risers.slice(0, 5).map((x) => h('li', h('span', { class: 'grow' }, x.name), h('b', { class: 'good' }, signed(x.delta))))), h('ul', { class: 'plain' }, r.progressed.fallers.slice(0, 5).map((x) => h('li', h('span', { class: 'grow' }, x.name), h('b', { class: 'bad' }, signed(x.delta)))))))),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', `재계약 (${r.renewed.filter((x) => x.teamId === my).length})`), list(r.renewed.filter((x) => x.teamId === my), '재계약 없음', (x) => h('li', h('span', { class: 'grow' }, x.name), h('span', { class: 'note' }, `${x.years}년${x.salaryEok != null ? ` · ${eok(x.salaryEok)}` : ''}`))),
          r.refused.some((x) => x.teamId === my) && h('p', { class: 'note' }, '선수가 거절: ', r.refused.filter((x) => x.teamId === my).map((x) => x.name).join(', ')), r.expired.some((x) => x.teamId === my) && h('p', { class: 'note' }, '계약 만료·이적: ', r.expired.filter((x) => x.teamId === my).map((x) => x.name).join(', '))),
        h('div', { class: 'card' }, h('h3', 'FA 이동'), list(mySign, '우리 팀 관련 FA 이동 없음', (x) => h('li', h('span', { class: 'grow' }, x.name), h('span', { class: 'note' }, x.teamId === my ? (x.from ? `${ctx.name(x.from)}에서 영입` : '영입') : `${ctx.name(x.teamId)}로 이적`))))),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', '신인 드래프트'), list(myDraft, '지명 없음', (x) => h('li', ovrChip({ ovr: x.ovr, rarity: x.ovr >= 66 ? 'rare' : 'common' }), h('span', { class: 'grow' }, `${x.name}`), h('span', { class: 'pos' }, x.position), h('span', { class: 'note' }, `${x.pick}순위 · POT ${x.potential}`)))),
        h('div', { class: 'card' }, h('h3', '은퇴'), list(myRet, '우리 팀 은퇴 없음', (x) => h('li', h('span', { class: 'grow' }, x.name), h('span', { class: 'note' }, `${x.age}세 · OVR ${x.ovr}`))), h('p', { class: 'note' }, `리그 전체 ${r.retired.length}명 은퇴`))),
      h('div', { class: 'card' }, h('h3', '트레이드'), list(r.trades, '성사된 트레이드 없음', (t) => h('li', h('span', { class: 'grow' }, h('b', ctx.name(t.with)), h('span', { class: 'note' }, ' 와 트레이드 · '), '받은 선수 ', (t.received ?? []).map(name).join(', '), h('span', { class: 'note' }, ' · '), '보낸 선수 ', (t.sent ?? []).map(name).join(', ')))), h('p', { class: 'note' }, `이번 오프시즌에 받은 제안 ${r.tradeOffers.length}건 (자동 단장이 판단)`)),
      (r.foreignReplaced.length || r.asiaReplaced.length) ? h('div', { class: 'card' }, h('h3', '외국인·아시아쿼터 교체'), h('p', { class: 'note' }, [...r.foreignReplaced, ...r.asiaReplaced].filter((x) => x.teamId === my).map((x) => x.name).join(', ') || '우리 팀 교체 없음')) : null);
  };
  const content = { summary: sum, games, offseason }[tab]();
  return {
    title: `${e.season} 결산`, body: h('div', { class: 'stack' },
      h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '시즌 결산'), h('div', { class: 'title' }, h('h1', `${e.season} 시즌 결산`), resultTag)),
        h('button', { class: 'btn primary big', onclick: ctx.play, disabled: ctx.busy }, `${next} 시즌 진행`)),
      tabs([['summary', '요약'], ['games', '우리 팀 경기'], ['offseason', '오프시즌']], tab, (t) => ctx.go(`report/${t}`)),
      content)
  };
}
