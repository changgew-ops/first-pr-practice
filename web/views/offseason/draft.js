// 신인 드래프트: 순번 추첨 결과를 보고, 우리 차례마다 한 명을 지명하거나 포기한다.
import { h } from '../../lib/dom.js';
import { draftRanking } from '../../lib/offseason-view.js';
import { domesticOf, payrollEok, hardLimitEok } from '../../../src/valuation.mjs';
import { rookieSalary } from '../../../src/offseason.mjs';
import { signingImpact } from '../../lib/preview-signing.js';
import { signingPreviewCard } from '../../lib/preview-signing-view.js';
import { playerLine, decide, fill, offerResultsCard } from './common.js';

export function render(ctx, pending) {
  const { available, round, pickInRound, overall, lottery, roster, state } = pending.payload;
  const my = ctx.session.managerId;
  const mine = roster ?? domesticOf(ctx.session.game.seasonEnd.league.players, my);
  const ranking = draftRanking(available, mine);
  const dr = ctx.data.rules.offseason.draft;
  let pick = ranking[0].p.id;
  const host = h('div', { class: 'stack' });
  const teamName = (id) => ctx.name(id);
  const myLot = lottery?.find((l) => l.teamId === my);
  const firstDecision = pending.key === 'draft:0';

  // 지명하면: 엔진이 쓰는 신인 보수표(rookieSalary)와 같은 값으로 캡·역할을 미리 계산한다
  const rookiePreview = (p) => {
    const rules = ctx.data.rules, off = rules.offseason;
    const salaryEok = rookieSalary(overall - 1, off.rookieSalaryEok);
    const years = round === 1 ? dr.rookieYears : dr.rookieYearsRound2;
    const players = state?.players ?? ctx.session.game.seasonEnd.league.players;
    const pay = payrollEok(players, my);
    const full = mine.length >= rules.roster.domestic + 2;
    const over = pay + salaryEok > hardLimitEok(rules) + 1e-9;
    const check = full ? { ok: false, reason: `국내 선수가 이미 ${mine.length}명이라 지명할 수 없습니다` } : over ? { ok: false, reason: '캡 한도를 넘어 지명할 수 없습니다' } : { ok: true };
    return signingPreviewCard(signingImpact({ roster: players, cand: p, offer: { salaryEok, years }, rules, teamId: my, check }), { ctx, title: '지명하면', blockedLabel: '지명 불가', note: `신인 보수는 지명 순번(전체 ${overall}번째 칸) 기준 ${salaryEok.toFixed(2)}억, ${years}년입니다. 드래프트로는 국내 정원보다 2명까지 더 지명할 수 있습니다.` });
  };

  function draw() {
    fill(host, 
      h('div', { class: 'card' },
        h('h2', `신인 드래프트 ${round}라운드 ${pickInRound}번째 (전체 ${overall}번째 칸)`),
        h('p', { class: 'note' }, `${dr.rounds}라운드까지 있고, 짝수 라운드는 순서가 거꾸로입니다(뱀 순서). 1·2라운드는 모든 구단이 지명하지만 3라운드부터는 포기하는 구단이 많습니다. 신인 계약은 1라운드 ${dr.rookieYears}년, 2라운드 이하 ${dr.rookieYearsRound2}년이고 캡에서 면제됩니다. 순위는 AI와 같은 식(잠재력 60% + 현재 40% + 비어 있는 포지션 보너스)으로 매긴 참고용입니다. 과거 시즌 카드(이름 앞 숫자)가 섞여 있고, 카드의 잠재력은 그 시즌 능력치와 같습니다.`)),
      firstDecision ? offerResultsCard(ctx, pending.payload.faResults, { title: 'FA에서 우리가 낸 제안의 결과', withRound: true }) : null,
      lottery && (firstDecision || round === 1) ? h('div', { class: 'card' }, h('h3', '순번 추첨 결과'),
        h('p', { class: 'note' }, `직전 시즌 순위가 낮은 팀일수록 공을 많이 받습니다(공 합계 200). 우리 팀은 공 ${myLot?.balls ?? 0}개로 ${myLot?.pick ?? '-'}순위를 받았습니다.`),
        h('ol', { class: 'os-lottery' }, lottery.map((l) => h('li', { class: l.teamId === my ? 'me' : '' }, h('b', `${l.pick}`), ` ${teamName(l.teamId)}`, h('span', { class: 'note' }, ` · 공 ${l.balls}`))))) : null,
      h('div', { class: 'card flush' }, h('div', { class: 'os-draft' }, ranking.map((r) => h('label', { class: `os-draft-row ${pick === r.p.id ? 'picked' : ''}` },
        h('input', { type: 'radio', name: 'draft', 'aria-label': `${r.p.name} 지명`, checked: pick === r.p.id, onchange: () => { pick = r.p.id; draw(); } }),
        h('span', { class: 'os-rank' }, r.rank === 1 ? '추천' : r.rank),
        playerLine(r.p),
        h('span', { class: 'os-fact' }, h('span', { class: 'note' }, 'POT'), h('b', r.p.potential)),
        r.need ? h('span', { class: 'tag hot' }, `${r.p.position} 필요 +${r.need}`) : h('span', { class: 'tag' }, `${r.p.position} 충분`),
        h('span', { class: 'note' }, `점수 ${r.score.toFixed(1)}`))))),
      rookiePreview(available.find((p) => p.id === pick)),
      h('div', { class: 'os-submit' }, h('span', { class: 'note' }, `선택: ${available.find((p) => p.id === pick).name}`),
        h('button', { class: 'btn', type: 'button', onclick: () => decide(ctx, pending.key, 'pass') }, '지명 포기'),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, pending.key, pick) }, '지명 확정')));
  }
  draw();
  return host;
}
