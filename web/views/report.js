import { h, table, tabs, link, stat, ovrChip, eok, signed, ORIGIN_LABEL } from '../lib/dom.js';
import { bracket, awardsCard } from './league.js';
import { logToHistory, seasonLabel, playerById } from '../lib/game.js';
import { partsBar, PART_LABEL } from './finance-card.js';

const BT_LABEL = { shooting: '슛', passing: '패스', defense: '수비', rebound: '리바운드', athletic: '운동능력' };

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
      led.parts ? h('div', { class: 'card fin-card' }, h('h3', '재정 내역'),
        h('div', { class: 'fin-facts' },
          ...(led.attendance ? [
            h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, '경기당 관중'), h('b', `${led.attendance.avg.toLocaleString('ko-KR')}명`), h('span', { class: 'note' }, `홈 ${led.attendance.homeGames}경기 합계 ${led.attendance.total.toLocaleString('ko-KR')}명${led.attendance.occupancy != null ? ` · 점유율 ${Math.round(led.attendance.occupancy * 100)}%` : ''}${led.attendance.sellouts ? ` · 매진 ${led.attendance.sellouts}경기` : ''}`)),
            h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, '1인당 입장료'), h('b', `${led.attendance.yieldMan.toFixed(2)}만원`), h('span', { class: 'note' }, `물가 ×${(led.attendance.priceIndex ?? 1).toFixed(2)} 반영 · 게임용 추정`))] : []),
          h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, '총수입'), h('b', eok(led.revenue)), h('span', { class: 'note' }, `연봉 ${eok(led.payroll)}${led.penalty ? ` · 기금 ${eok(led.penalty)}` : ''}${led.program ? ` · 육성 ${eok(led.program)}` : ''}${led.severance ? ` · 방출 비용 ${eok(led.severance)}` : ''}`)),
          h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, '순이익'), h('b', `${led.net >= 0 ? '+' : ''}${led.net.toFixed(1)}억`), h('span', { class: 'note' }, `시즌 뒤 자금 ${eok(e.fundsAfter[my])}`))),
        partsBar(led.parts),
        h('p', { class: 'note fin-foot' }, '2023-24 KBL 집계(관중·입장 수입)에 맞춘 추정 모델입니다. 중계권·스폰서·굿즈는 자료가 없어 지은 값이고, 객단가·중계권·스폰서·굿즈는 해마다 물가만큼 오릅니다.')) : null,
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', '우리 팀 득점 순위'), h('ul', { class: 'plain' }, mineLeaders.slice(0, 6).map((l) => h('li', h('span', { class: 'grow' }, link(`#/player/${l.id}`, l.name)), h('span', { class: 'note' }, `${l.ppg.toFixed(1)}점 ${l.rpg.toFixed(1)}리 ${l.apg.toFixed(1)}어`))))),
        h('div', { class: 'card' }, h('h3', '리그 득점 TOP 5'), h('ul', { class: 'plain' }, [...e.leaders].sort((a, b) => b.ppg - a.ppg).slice(0, 5).map((l, i) => h('li', h('span', { class: 'note' }, i + 1), h('span', { class: 'grow' }, link(`#/player/${l.id}`, l.name), ' ', h('span', { class: 'note' }, ctx.name(l.teamId))), h('b', l.ppg.toFixed(1))))))),
      awardsCard(ctx, e, my),
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
      r.breakthroughs?.length ? h('div', { class: 'card' }, h('h3', `깨달음 (${r.breakthroughs.length}명)`),
        h('p', { class: 'note' }, '오프시즌에 낮은 확률로 한 능력치가 크게 오른 선수입니다. 우리 팀 선수를 먼저 보여 줍니다.'),
        h('ul', { class: 'plain' }, [...r.breakthroughs].sort((a, b) => (b.teamId === my) - (a.teamId === my) || (b.to - b.from) - (a.to - a.from)).slice(0, 8).map((x) => h('li', h('span', { class: 'grow' }, link(`#/player/${x.id}`, x.name), x.teamId === my ? '' : h('span', { class: 'note' }, ` · ${ctx.name(x.teamId)}`)), h('span', { class: 'note' }, `${BT_LABEL[x.stat] ?? x.stat} ${x.from} → `), h('b', { class: 'good' }, x.to), h('span', { class: 'good' }, ` (+${x.to - x.from})`))))) : null,
      (r.waived?.length || r.extended?.length || r.extendRefused?.length) ? h('div', { class: 'card' }, h('h3', '방출·연장 계약'),
        h('ul', { class: 'plain' },
          ...(r.waived ?? []).map((x) => h('li', h('span', { class: 'grow' }, `${x.name} 방출`), h('span', { class: 'note' }, `남은 ${x.yearsLeft}년 × ${eok(x.salaryEok)} = 해지 비용 ${eok(x.severance)}`))),
          ...(r.extended ?? []).map((x) => h('li', h('span', { class: 'grow' }, `${x.name} 연장 계약`), h('span', { class: 'note' }, `${eok(x.from.salaryEok)}·${x.from.yearsLeft}년 → ${eok(x.to.salaryEok)}·${x.to.yearsLeft}년`))),
          ...(r.extendRefused ?? []).map((x) => h('li', h('span', { class: 'grow' }, `${x.name} 연장 제안 거절`), h('span', { class: 'note' }, x.reason))))) : null,
      (r.foreignReplaced.length || r.asiaReplaced.length) ? h('div', { class: 'card' }, h('h3', '외국인·아시아쿼터 교체'), h('p', { class: 'note' }, [...r.foreignReplaced, ...r.asiaReplaced].filter((x) => x.teamId === my).map((x) => x.name).join(', ') || '우리 팀 교체 없음')) : null);
  };
  const content = { summary: sum, games, offseason }[tab]();
  return {
    title: `${e.season} 결산`, body: h('div', { class: 'stack' },
      h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '시즌 결산'), h('div', { class: 'title' }, h('h1', `${e.season} 시즌 결산`), resultTag)),
        h('button', { class: 'btn primary big', onclick: () => ctx.go('season') }, `${next} 시즌으로`)),
      tabs([['summary', '요약'], ['games', '우리 팀 경기'], ['offseason', '오프시즌']], tab, (t) => ctx.go(`report/${t}`)),
      content)
  };
}
