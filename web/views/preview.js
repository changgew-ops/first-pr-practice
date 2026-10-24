// 시즌 프리뷰: 우승 후보 순위(확률·가상 배당), 기자단 예측, 예상 베스트5, 팀별 키 플레이어. 계산은 src/preview.mjs, 세션에서는 session.preview().
// 기자·설문·배당은 모두 게임이 만든 가상 콘텐츠이고 현금을 걸 수 없다.
import { h, table, bar } from '../lib/dom.js';
import { emblem } from '../lib/emblem.js';
import { nameButton } from '../lib/player-info.js';
import { GROUP_LABEL } from '../../src/preview.mjs';
import { colorOf } from '../lib/team-ui.js';

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const oddsText = (v, max = 99) => (v == null ? '-' : v >= max ? `${max}배↑` : `${v.toFixed(1)}배`);

export function render(ctx) {
  const s = ctx.session;
  const pv = s.preview();
  if (!pv) return { title: '시즌 프리뷰', body: h('div', { class: 'stack' }, h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '시즌 프리뷰'), h('h1', '시즌 프리뷰'))), h('div', { class: 'card' }, h('p', { class: 'muted' }, '오프시즌에는 프리뷰가 없습니다. 다음 시즌이 시작되기 전에 다시 열어 보세요.'))) };
  const my = s.managerId;
  const maxOdds = ctx.data.rules.preview?.maxOdds ?? 99;
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const pName = (id, fallback) => { const p = byId.get(id); return p ? nameButton(p, { ctx }) : h('span', fallback ?? id); };
  const teamName = (id) => ctx.name(id);
  const topVotes = Math.max(1, ...pv.rows.map((r) => r.votes.title));
  const maxP = Math.max(0.01, ...pv.rows.map((r) => r.titleP));

  const cols = [
    { key: 'rank', label: '순위', get: (r) => pv.rows.indexOf(r) + 1, sort: 'num', align: 'r' },
    { key: 'name', label: '구단', get: (r) => r.name, sort: 'str', render: (r) => h('span', { class: 'pv-team', style: { '--c': colorOf(r.id) } }, emblem(r.id, { size: 22 }), r.name, r.id === my ? h('span', { class: 'tag' }, '우리 팀') : null) },
    { key: 'power', label: '전력', get: (r) => r.power, sort: 'num', align: 'r', render: (r) => h('span', `${r.power.toFixed(1)} `, h('span', { class: 'note' }, `(${r.powerRank}위)`)) },
    { key: 'titleP', label: '우승 확률', get: (r) => r.titleP, sort: 'num', align: 'r', render: (r) => h('span', { class: 'pv-p' }, h('b', pct(r.titleP)), bar(r.titleP, maxP, { cls: 'pv-bar', label: `우승 확률 ${pct(r.titleP)}` })) },
    { key: 'odds', label: '가상 배당', title: '우승 확률을 바꾼 게임 안의 점수. 현금을 걸 수 없다', get: (r) => r.titleOdds ?? 999, sort: 'num', align: 'r', render: (r) => oddsText(r.titleOdds, maxOdds) },
    { key: 'playoffP', label: '6강 확률', get: (r) => r.playoffP, sort: 'num', align: 'r', render: (r) => `${Math.round(r.playoffP * 100)}%` },
    { key: 'top', label: '1위 배당', title: '정규리그 1위 가상 배당', get: (r) => r.topSeedOdds ?? 999, sort: 'num', align: 'r', render: (r) => oddsText(r.topSeedOdds, maxOdds) },
    { key: 'wins', label: '예상 승수', get: (r) => r.avgWins, sort: 'num', align: 'r', render: (r) => r.avgWins.toFixed(1) },
    { key: 'votes', label: '기자 득표', title: '우승 후보로 꼽은 표 / 6강에 오를 것으로 꼽은 표', get: (r) => r.votes.title * 100 + r.votes.playoff, sort: 'num', align: 'r', render: (r) => h('span', h('b', `${r.votes.title}`), h('span', { class: 'note' }, ` / ${r.votes.playoff}`)) }
  ];

  const voted = [...pv.rows].filter((r) => r.votes.title > 0).sort((a, b) => b.votes.title - a.votes.title || b.titleP - a.titleP);
  const pollCard = h('div', { class: 'card' },
    h('h2', `기자단 예측 (가상 기자 ${pv.reporterCount}명)`),
    h('p', { class: 'note' }, '기자마다 전력·전통·외국 선수 평가를 다르게 중시합니다. 우승 후보 1순위 한 표, 그리고 플레이오프 진출 6팀을 꼽았습니다.'),
    h('div', { class: 'pv-votes' }, voted.map((r) => h('div', { class: `pv-vote ${r.id === my ? 'mine' : ''}` },
      h('span', { class: 'pv-vn' }, r.name), bar(r.votes.title, topVotes, { cls: 'pv-bar', label: `${r.votes.title}표` }), h('b', `${r.votes.title}표`)))),
    h('ul', { class: 'pv-reps' }, pv.reporters.map((rep) => h('li',
      h('div', { class: 'pv-rep-head' }, h('b', rep.name), h('span', { class: 'note' }, ` ${rep.outlet} · 우승 후보 `), h('span', { class: `pv-pick ${rep.titlePick === my ? 'mine' : ''}` }, teamName(rep.titlePick)), h('span', { class: 'note' }, ` · 결승 상대 ${teamName(rep.finalPick)}`)),
      h('div', { class: 'pv-rep-line' }, `"${rep.comment}"`)))));

  const bestCard = h('div', { class: 'card' },
    h('h2', '예상 베스트5'),
    h('p', { class: 'note' }, '기록이 아니라 능력치(OVR)와 코스트로 매긴 시즌 전 지표입니다. 가드 2·포워드 2·센터 1.'),
    h('ul', { class: 'pv-best' }, pv.expectedBest.map((p) => h('li', h('span', { class: 'tag' }, GROUP_LABEL[p.group]), pName(p.id, p.name), h('span', { class: 'note' }, ` ${p.position} · ${teamName(p.teamId)} · OVR ${p.ovr}`)))),
    h('div', { class: 'pv-spot' },
      h('h3', '주목할 선수'),
      h('ul', { class: 'plain' },
        ...pv.spotlight.rookies.map((p) => h('li', h('span', { class: 'tag' }, '젊은 유망주'), pName(p.id, p.name), h('span', { class: 'note' }, ` ${p.age}세 · ${teamName(p.teamId)} · OVR ${p.ovr} / POT ${p.potential ?? '-'}`))),
        ...pv.spotlight.foreign.map((p) => h('li', h('span', { class: 'tag' }, '외국 선수'), pName(p.id, p.name), h('span', { class: 'note' }, ` ${p.position} · ${teamName(p.teamId)} · OVR ${p.ovr}`))),
        ...pv.spotlight.asia.map((p) => h('li', h('span', { class: 'tag' }, '아시아쿼터'), pName(p.id, p.name), h('span', { class: 'note' }, ` ${p.position} · ${teamName(p.teamId)} · OVR ${p.ovr}`))))));

  const keyCard = h('div', { class: 'card' },
    h('h2', '구단별 키 플레이어'),
    h('ul', { class: 'pv-keys' }, [...pv.rows].sort((a, b) => (b.id === my) - (a.id === my) || a.powerRank - b.powerRank).map((r) => h('li', { class: r.id === my ? 'mine' : '' },
      h('span', { class: 'pv-kt' }, r.name), h('span', { class: 'pv-kp' }, pv.keyPlayers[r.id].map((id) => pName(id)))))));

  const body = h('div', { class: 'stack pv' },
    h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'swatch' }), h('div', h('div', { class: 'crumb' }, `${pv.season} 시즌`), h('h1', '시즌 프리뷰')))),
    h('p', { class: 'callout' }, pv.atStart ? '시즌 시작 전 전력 기준입니다.' : '시즌 시작 시점의 전력 기준입니다(저장 후 다시 불러온 경우에는 불러온 시점 로스터 기준). 시즌 중 부상·영입은 반영하지 않습니다.'),
    pv.myLine ? h('div', { class: 'card pv-my' }, h('h2', '우리 팀 전망'), h('p', { style: { margin: 0 } }, pv.myLine)) : null,
    h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h2', '우승 후보 순위'), h('p', { class: 'note', style: { margin: '2px 0 8px' } }, '시즌을 400번 돌려 본 가벼운 모의 결과입니다(시즌마다 부상·영입 같은 변수가 전력에 섞입니다). 제목 줄을 누르면 정렬됩니다.')),
      table(pv.rows, cols, { sort: { key: 'titleP', dir: -1 }, rowClass: (r) => (r.id === my ? 'me' : '') })),
    h('div', { class: 'grid g2 pv-grid' }, pollCard, h('div', { class: 'stack' }, bestCard)),
    keyCard,
    h('p', { class: 'note pv-disclaimer' }, pv.disclaimer));
  return { title: '시즌 프리뷰', body };
}
