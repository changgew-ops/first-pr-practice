// 트레이드 단계: 성장·은퇴 결과 → 받은 제안(수락) → 내가 먼저 제안 → 제출.
import { h, signed, link, eok } from '../../lib/dom.js';
import { validateTrade, proposeTrade } from '../../../src/trade.mjs';
import { domesticOf } from '../../../src/valuation.mjs';
import { offerHint, usedPlayerIds } from '../../lib/offseason-view.js';
import { playerLine, salaryText, contractText, decide, fill } from './common.js';
import { releaseCost } from '../../../src/contracts.mjs';

const TONE = { good: ['우리에게 이득', 'good'], even: ['비슷한 거래', ''], bad: ['우리에게 손해', 'bad'] };

function changesCard(ctx) {
  const ch = ctx.session.offseasonChanges();
  if (!ch) return null;
  const my = ctx.session.managerId;
  const mine = ch.progressed.filter((x) => x.teamId === my).sort((a, b) => b.delta - a.delta);
  const myRetired = ch.retired.filter((x) => x.teamId === my);
  const top = [...ch.progressed].sort((a, b) => b.delta - a.delta);
  return h('div', { class: 'card' },
    h('h2', '시즌이 끝났습니다: 성장·노쇠와 은퇴'),
    h('p', { class: 'note' }, '나이를 한 살 먹으며 능력치가 오르내리고 일부 선수는 은퇴했습니다. 아래는 그 결과입니다.'),
    h('div', { class: 'grid g2' },
      h('div', h('h3', '우리 선수 변화'),
        mine.length ? h('ul', { class: 'plain' }, mine.map((x) => h('li', h('span', { class: 'grow' }, `${x.name} · ${x.age}세`), h('span', { class: 'note' }, `${x.from} → ${x.to}`), h('b', { class: x.delta > 0 ? 'good' : x.delta < 0 ? 'bad' : 'muted' }, x.delta ? signed(x.delta) : '0')))) : h('p', { class: 'muted' }, '없음'),
        myRetired.length ? h('p', { class: 'warn' }, `우리 은퇴: ${myRetired.map((x) => `${x.name}(${x.age}세, OVR ${x.ovr})`).join(', ')}`) : h('p', { class: 'note' }, '우리 구단 은퇴 선수는 없습니다.')),
      h('div', h('h3', '리그 전체'),
        h('p', {}, `은퇴 ${ch.retired.length}명`),
        h('div', { class: 'grid g2' }, h('ul', { class: 'plain' }, top.slice(0, 5).map((x) => h('li', h('span', { class: 'grow' }, `${x.name}`), h('span', { class: 'note' }, ctx.name(x.teamId)), h('b', { class: 'good' }, signed(x.delta))))),
          h('ul', { class: 'plain' }, top.slice(-5).reverse().map((x) => h('li', h('span', { class: 'grow' }, `${x.name}`), h('span', { class: 'note' }, ctx.name(x.teamId)), h('b', { class: 'bad' }, signed(x.delta)))))))));
}

const sideList = (title, list) => h('div', { class: 'os-side' }, h('div', { class: 'os-side-title' }, title),
  h('ul', { class: 'plain' }, list.map((p) => h('li', playerLine(p), h('span', { class: 'grow' }), h('span', { class: 'note' }, `${salaryText(p)} · ${contractText(p)}`)))));

export function render(ctx, pending) {
  const { offers, league, ctx: ectx } = pending.payload;
  const { rules } = ctx.data;
  const my = ctx.session.managerId;
  const accepted = new Set();
  const proposals = [];
  const release = new Set(); // 방출할 우리 국내 선수(계약 중도 해지: 남은 보수를 구단이 낸다)
  const builder = { teamId: null, mine: new Set(), theirs: new Set(), result: null };
  const root = h('div', { class: 'stack' });

  const hints = new Map(offers.map((o) => [o.id, offerHint(o, league, ectx, rules, my)]));
  const validity = new Map(offers.map((o) => [o.id, validateTrade(league, o.trade, rules, { window: 'offseason' })]));
  const aiTeams = ctx.data.teams.filter((t) => t.id !== my);

  function offerCard(o, used) {
    const hint = hints.get(o.id), valid = validity.get(o.id);
    const picked = accepted.has(o.id);
    const conflict = !picked && [...o.give, ...o.get].some((p) => used.has(p.id));
    const [tone, cls] = TONE[hint.tone];
    return h('div', { class: `os-offer ${picked ? 'picked' : ''} ${conflict || !valid.ok ? 'blocked' : ''}` },
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, link(`#/history/${o.teamId}`, ctx.name(o.teamId)), '의 제안'), h('div', { class: 'row' }, o.expiringTarget ? h('span', { class: 'tag hot', title: '곧 계약이 끝나는 선수를 노린 제안' }, '계약 만료 선수를 노림') : null, h('span', { class: `tag ${cls}` }, tone))),
      h('div', { class: 'os-cols' }, sideList('우리가 받는 선수', o.give), sideList('우리가 보내는 선수', o.get)),
      h('div', { class: 'os-offer-foot' },
        h('span', { class: 'note' }, `가치 ${hint.incoming.toFixed(1)} 받고 ${hint.outgoing.toFixed(1)} 보냄 (${hint.ratio.toFixed(2)}배) · 연봉 ${hint.payrollDelta > 0 ? '+' : ''}${hint.payrollDelta.toFixed(1)}억 · 인원 ${hint.countDelta > 0 ? '+' : ''}${hint.countDelta}`),
        !valid.ok ? h('span', { class: 'bad' }, `성사 불가: ${valid.errors.join(' / ')}`) : conflict ? h('span', { class: 'warn' }, '다른 선택과 같은 선수가 겹칩니다') : null,
        h('button', { class: `btn ${picked ? 'primary' : ''}`, type: 'button', disabled: !valid.ok || conflict, 'aria-pressed': String(picked), onclick: () => { if (picked) accepted.delete(o.id); else accepted.add(o.id); draw(); } }, picked ? '수락함 (취소)' : '수락')));
  }

  function builderCard(used) {
    const mineRoster = domesticOf(league.players, my).sort((a, b) => b.ovr - a.ovr);
    const theirRoster = builder.teamId ? domesticOf(league.players, builder.teamId).sort((a, b) => b.ovr - a.ovr) : [];
    const pickList = (list, set, side) => h('ul', { class: 'plain os-pick' }, list.map((p) => {
      const taken = used.has(p.id);
      return h('li', h('label', { class: taken ? 'taken' : '' }, h('input', { type: 'checkbox', checked: set.has(p.id), disabled: taken, onchange: (e) => { if (e.target.checked) set.add(p.id); else set.delete(p.id); builder.result = null; draw(); } }), playerLine(p, { extra: h('span', { class: 'note' }, `${salaryText(p)} · ${contractText(p)}`) }), taken ? h('span', { class: 'note' }, ' (다른 제안에 사용)') : null));
    }));
    const trade = builder.teamId ? { teamA: my, teamB: builder.teamId, giveA: [...builder.mine], giveB: [...builder.theirs] } : null;
    const ready = trade && trade.giveA.length && trade.giveB.length;
    const r = builder.result;
    return h('div', { class: 'card' },
      h('h2', '내가 먼저 제안하기'),
      h('p', { class: 'note' }, '구단을 고르고 서로 주고받을 선수를 고른 뒤 "AI 반응 보기"로 수락 여부를 미리 확인합니다. 수락할 제안만 목록에 추가되고, 결정을 제출할 때 실행됩니다. 외국 선수·아시아쿼터는 트레이드할 수 없습니다. 오프시즌에는 거래 후 국내 선수가 10~14명이어야 합니다.'),
      h('div', { class: 'row' }, h('label', { for: 'os-team', class: 'field-label', style: { margin: 0 } }, '상대 구단'),
        h('select', { id: 'os-team', onchange: (e) => { builder.teamId = e.target.value || null; builder.mine.clear(); builder.theirs.clear(); builder.result = null; draw(); } },
          h('option', { value: '' }, '구단 선택'), aiTeams.map((t) => h('option', { value: t.id, selected: t.id === builder.teamId }, t.name)))),
      builder.teamId ? h('div', { class: 'os-cols' }, h('div', { class: 'os-side' }, h('div', { class: 'os-side-title' }, '우리가 보낼 선수'), pickList(mineRoster, builder.mine)), h('div', { class: 'os-side' }, h('div', { class: 'os-side-title' }, `${ctx.name(builder.teamId)}에게 받을 선수`), pickList(theirRoster, builder.theirs))) : null,
      builder.teamId ? h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', disabled: !ready, onclick: () => { builder.result = proposeTrade(league, trade, ectx, rules, { window: 'offseason' }); draw(); } }, 'AI 반응 보기'),
        r ? h('span', { class: r.executed ? 'good' : 'bad' }, r.executed ? `수락합니다 (가치 비율 ${r.verdict.margin.toFixed(2)}배, 필요 ${rules.transactions.trade.acceptMargin}배)` : `거절: ${r.reason.replaceAll(builder.teamId, ctx.name(builder.teamId))}`) : null,
        r?.executed ? h('button', { class: 'btn primary', type: 'button', onclick: () => { proposals.push(trade); builder.mine = new Set(); builder.theirs = new Set(); builder.result = null; draw(); } }, '제안 목록에 추가') : null) : null,
      proposals.length ? h('div', h('h3', '내가 제안할 트레이드'), h('ul', { class: 'plain' }, proposals.map((t, i) => {
        const find = (id) => league.players.find((p) => p.id === id);
        return h('li', h('span', { class: 'grow' }, `${ctx.name(t.teamB)} ← ${t.giveA.map((id) => find(id).name).join(', ')} / → ${t.giveB.map((id) => find(id).name).join(', ')}`), h('button', { class: 'btn ghost', type: 'button', onclick: () => { proposals.splice(i, 1); draw(); } }, '삭제'));
      }))) : null);
  }

  /** 방출 구역: 체크한 선수는 이 단계 제출 때 FA 시장으로 나가고, 남은 계약 보수(연봉 × 남은 연수)가 구단 자금에서 빠진다 */
  function releaseCard(used) {
    const roster = domesticOf(league.players, my).sort((a, b) => b.ovr - a.ovr);
    const funds = ctx.session.funds[my];
    const cost = (p) => releaseCost(p, { phase: 'offseason' }).severance;
    const total = roster.filter((p) => release.has(p.id)).reduce((s, p) => s + cost(p), 0);
    const left = roster.length - release.size;
    return h('div', { class: 'card ct-sec' },
      h('h2', '방출 (계약 중도 해지)'),
      h('p', { class: 'note' }, '계약이 남은 선수를 내보낼 수 있습니다. 규정(자유계약선수 관리 규정 제5조)에 따라 남은 계약 기간의 보수를 구단이 모두 지급하고, 선수는 FA 시장으로 나갑니다(원소속 보상 없음, 다른 구단이 영입할 수 있고 우리도 FA 단계에서 다시 영입할 수 있습니다). 외국인·아시아쿼터 선수는 교체 규정이 따로 있어 아직 방출할 수 없습니다. 계약이 이미 끝난 선수는 재계약 단계에서 정하면 됩니다.'),
      h('div', roster.map((p) => {
        const expiring = p.contract.yearsLeft <= 0, taken = used.has(p.id);
        const c = cost(p);
        return h('div', { class: `ct-row ${release.has(p.id) ? '' : 'off'}` },
          h('label', { class: 'os-check', for: `rel-${p.id}` }, h('input', { type: 'checkbox', id: `rel-${p.id}`, checked: release.has(p.id), disabled: expiring || taken, 'aria-label': `${p.name} 방출`, onchange: (e) => { if (e.target.checked) release.add(p.id); else release.delete(p.id); draw(); } }), playerLine(p)),
          h('span', { class: 'note' }, `${salaryText(p)} · ${contractText(p)}`),
          h('span', { class: 'ct-cost' }, expiring ? '계약 만료 예정' : taken ? '트레이드에 포함됨' : `해지 비용 ${eok(c)}`));
      })),
      h('p', { class: release.size ? 'warn' : 'note' }, release.size
        ? `방출 ${release.size}명 · 해지 비용 합계 ${eok(total)} → 구단 자금 ${eok(funds)} → ${eok(funds - total)}${funds - total < 0 ? ' (마이너스)' : ''}${left < rules.roster.domestic ? ` · 국내 선수 ${left}명(마지막 로스터 확정 단계에서 ${rules.roster.domestic}명까지 채웁니다)` : ''}`
        : '방출할 선수를 체크하세요.'));
  }

  function draw() {
    const used = usedPlayerIds(offers, accepted, proposals);
    fill(root, 
      changesCard(ctx),
      h('div', { class: 'card' }, h('h2', `받은 트레이드 제안 ${offers.length}건`),
        offers.length ? h('p', { class: 'note' }, '곧 계약이 끝나는 선수를 노린 제안이 많습니다. 재계약 협상 전에 팔면 연봉 부담 없이 대가를 받을 수 있습니다. 가치는 우리 구단 기준 추정입니다.') : h('p', { class: 'muted' }, '이번에는 받은 제안이 없습니다.'),
        h('div', { class: 'stack' }, offers.map((o) => offerCard(o, used))),
      ),
      builderCard(used),
      releaseCard(used),
      h('div', { class: 'os-submit' },
        h('span', { class: 'note' }, `제안 ${accepted.size}건 수락 · 내가 건 제안 ${proposals.length}건${release.size ? ` · 방출 ${release.size}명` : ''}`),
        h('button', { class: 'btn primary big', type: 'button', onclick: () => decide(ctx, 'trade', { accept: [...accepted], proposals: proposals.map((t) => ({ teamA: t.teamA, teamB: t.teamB, giveA: t.giveA, giveB: t.giveB })), ...(release.size ? { release: [...release] } : {}) }) }, accepted.size || proposals.length || release.size ? '확정하고 재계약으로' : '트레이드 없이 재계약으로')));
  }
  draw();
  return root;
}
