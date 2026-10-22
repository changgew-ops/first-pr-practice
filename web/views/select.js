import { h, eok } from '../lib/dom.js';
import { newGame, powerRanking, prestigeOf, payrollInfo } from '../lib/game.js';
import { colorOf } from '../lib/team-ui.js';

export function render(ctx) {
  const { data } = ctx;
  const preview = newGame(data, data.teams[0].id, 1);
  const power = new Map(powerRanking(preview, data).map((r) => [r.id, r]));
  const prestige = prestigeOf(preview, data);
  const seed = h('input', { type: 'number', value: Math.floor(Math.random() * 1e6), min: 0, 'aria-label': '시드', style: { width: '110px' } });
  return h('div', { class: 'intro' },
    h('h1', 'KBL 단장 게임'),
    h('p', { class: 'muted' }, `2026-27 시즌, 맡을 구단을 고르세요. 선수와 구단 역사는 실제 KBL 기록에서 옮겼습니다. 선택 후 시즌을 진행하면 정규리그 54경기와 플레이오프가 시뮬레이션됩니다.`),
    h('div', { class: 'callout', style: { margin: '14px 0 20px' } }, '지금은 시즌 진행·선수/구단 열람이 가능한 첫 버전입니다. 트레이드·재계약·FA·드래프트 같은 단장의 결정은 자동 단장이 대신하며, 직접 결정하는 화면은 다음 단계에서 붙입니다.'),
    h('div', { class: 'grid g3' }, [...data.teams].sort((a, b) => power.get(a.id).rank - power.get(b.id).rank).map((t) => {
      const pay = payrollInfo(preview, data, t.id);
      const pr = prestige[t.id];
      return h('button', { class: 'team-card', style: { '--team': colorOf(t.id) }, onclick: () => ctx.start(t.id, Number(seed.value)), 'aria-label': `${t.name}으로 시작` },
        h('h3', t.name),
        h('div', { class: 'note' }, `${t.city} · ${t.arena}`),
        h('dl',
          h('dt', '전력 순위'), h('dd', `${power.get(t.id).rank}위`),
          h('dt', '전통 점수'), h('dd', pr.score.toFixed(2)),
          h('dt', '통산 우승'), h('dd', `${pr.titles}회`),
          h('dt', '국내 연봉'), h('dd', `${eok(pay.domestic)} / ${eok(pay.cap, 0)}`)),
        h('span', { class: 'tag hot', style: { alignSelf: 'flex-start' } }, '이 구단으로 시작'));
    })),
    h('details', { style: { marginTop: '20px' } }, h('summary', { class: 'muted' }, '고급: 시드'), h('p', { class: 'note' }, '같은 시드와 같은 선택이면 항상 같은 결과가 나옵니다.'), seed));
}
