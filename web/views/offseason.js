// 오프시즌 결정 화면: 단계 표시줄 + 단계별 화면(트레이드 → 재계약 → FA 5라운드 → 드래프트).
// 결정은 ctx.session.decide(key, value)로 내린다. 끝나면 시즌 결산(오프시즌 탭)으로 보낸다.
import { h } from '../lib/dom.js';
import { seasonLabel } from '../lib/game.js';
import { currentStep } from '../lib/offseason-view.js';
import { bindInfoCtx } from '../lib/player-info.js';
import { stepBar, summaryCard, autoButton, snapshotOf } from './offseason/common.js';
import * as trade from './offseason/trade.js';
import * as resign from './offseason/resign.js';
import * as fa from './offseason/fa.js';
import * as comp from './offseason/comp.js';
import * as draft from './offseason/draft.js';
import * as foreign from './offseason/foreign.js';

const VIEWS = { trade, resign, freeAgency: fa, compensation: comp, draft, foreign };
const TITLE = { trade: '트레이드', resign: '재계약', freeAgency: 'FA', compensation: 'FA 보상', draft: '드래프트', foreign: '외국인 영입' };

export function render(ctx) {
  bindInfoCtx(ctx);
  const s = ctx.session;
  const notice = (title, text, to, label) => ({ title: '오프시즌', body: h('div', { class: 'card' }, h('h2', title), h('p', { class: 'muted' }, text), h('button', { class: 'btn primary', onclick: () => ctx.go(to) }, label)) });
  if (s.stage !== 'offseason' || !s.pending) {
    return s.stage === 'offseason' ? notice('오프시즌', '처리할 결정이 없습니다.', 'report', '시즌 결산')
      : notice('지금은 오프시즌이 아닙니다', '시즌이 끝나면 이곳에서 트레이드·재계약·FA·드래프트를 결정합니다.', s.game.log.length ? 'report/offseason' : 'season', s.game.log.length ? '지난 오프시즌 결과 보기' : '시즌 화면으로');
  }
  const pending = s.pending;
  const snap = snapshotOf(s, pending);
  const step = currentStep(pending, s.game.decisions);
  const body = h('div', { class: 'stack os', 'data-key': pending.key },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '오프시즌'), h('h1', `${seasonLabel(s.season)} 오프시즌 · ${TITLE[pending.kind]}`)), autoButton(ctx)),
    stepBar(step),
    summaryCard(snap.players, snap.funds, s.managerId, ctx.data.rules, { stale: snap.stale }),
    VIEWS[pending.kind].render(ctx, pending));
  return { title: `오프시즌 ${TITLE[pending.kind]}`, body };
}
