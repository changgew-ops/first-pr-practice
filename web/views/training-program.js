// 훈련 화면의 "육성 프로그램" 구역: 유망주를 D리그(교육리그)나 해외 유학에 보낸다. 규칙은 src/devprogram.mjs(수치는 게임용 가정).
import { h, ovrChip, link, bar, STAT_LABELS, STAT_KEYS, eok } from '../lib/dom.js';
import { playerLink } from '../lib/player-info.js';
import { autoFocus } from '../../src/training.mjs';
import { checkpointsPerSeason, preview, programCost, PROGRAM_LABEL } from '../../src/devprogram.mjs';
import { remainingCheckpoints } from '../lib/training-view.js';

const ui = { stat: new Map() }; // 후보별로 고른 집중 능력치(화면을 다시 그려도 유지)
const plus = (v) => (v < 0.05 ? '+0' : `+${v.toFixed(1)}`);
const OUTCOME = { success: ['성공', 'good'], normal: ['무난', ''], struggle: ['적응 실패', 'bad'] };

function intro(rules) {
  const c = rules.devProgram, d = c.dleague, a = c.abroad;
  return h('div', { class: 'card dp-intro' },
    h('h2', '육성 프로그램'),
    h('p', { class: 'muted' }, `${c.maxAge}세 이하 국내 선수를 동시에 ${c.maxPlayers}명까지 보낼 수 있습니다. 보낸 선수는 등록 명단(라인업·트레이드·캡 계산)에서 빠집니다. KBL의 실제 제도 세부는 확인하지 못해, 아래 수치는 게임용 가정입니다.`),
    h('div', { class: 'dp-kinds' },
      h('div', { class: 'dp-kind' }, h('h3', 'D리그(교육리그)'),
        h('ul', { class: 'dp-list' },
          h('li', `훈련 경험치 ×${d.trainingMultiplier}. 시즌 중 언제든 보내고, 언제든 소환할 수 있습니다.`),
          h('li', `비용: 시즌 전체 ${eok(d.costEok)}(참가한 날수만큼). 연봉은 그대로 냅니다.`),
          h('li', '소환하면 그 시점부터 라인업에 다시 쓸 수 있고, 쌓은 성장은 그대로 남습니다.'))),
      h('div', { class: 'dp-kind' }, h('h3', '해외 유학'),
        h('ul', { class: 'dp-list' },
          h('li', `시즌 시작 전(0일차)에만 보내고, 시즌이 끝나야 돌아옵니다. 시즌 내내 경기에 나올 수 없습니다.`),
          h('li', `성장: 한 시즌 훈련 경험치 ×${a.trainingMultiplier}에 ±${Math.round(a.spread * 100)}% 편차. ${Math.round(a.failChance * 100)}% 확률로 적응에 실패해 성장이 ×${a.failMultiplier}로 줄고, 잘 풀리면 ${Math.round(a.potentialChance * 100)}% 확률로 잠재력이 +${a.potentialGain[0]}~${a.potentialGain[1]} 오릅니다.`),
          h('li', `비용: 유학비 ${eok(a.feeEok)} + 연봉의 ${Math.round(a.salaryShare * 100)}%. 유학 중에는 캡 계산에서 빠집니다.`),
          h('li', `계약이 ${a.minContractYears}년 이상 남은 선수만 갈 수 있습니다(돌아온 해에 계약이 끝나는 선수는 보낼 수 없습니다).`)))));
}

function lastReport(s) {
  const rep = s.lastProgramReport;
  if (!rep.length) return null;
  return h('div', { class: 'card' }, h('h3', '지난 시즌 결과'),
    h('ul', { class: 'plain' }, rep.map((r) => {
      const [label, cls] = OUTCOME[r.outcome] ?? ['', ''];
      const dOvr = r.after.ovr - r.before.ovr, dPot = r.after.potential - r.before.potential;
      return h('li', h('b', r.name), h('span', { class: 'tag' }, PROGRAM_LABEL[r.program]),
        h('span', { class: 'grow' }, `${STAT_LABELS[r.stat]} 집중 · OVR ${r.before.ovr} → ${r.after.ovr} (${dOvr >= 0 ? '+' : ''}${dOvr}) · POT ${r.before.potential} → ${r.after.potential}${dPot ? ` (+${dPot})` : ''}`),
        r.program === 'abroad' ? h('span', { class: cls }, label) : null, h('span', { class: 'note' }, `비용 ${eok(r.costEok, 2)}`));
    })));
}

function currentCards(ctx, s, redraw) {
  const rules = ctx.data.rules, live = s.stage === 'regular';
  if (!s.programs.length) return h('div', { class: 'card' }, h('h3', '지금 파견 중인 선수'), h('p', { class: 'muted' }, '파견 중인 선수가 없습니다.'));
  return h('div', { class: 'card' }, h('h3', `지금 파견 중인 선수 (${s.programs.length}/${rules.devProgram.maxPlayers})`),
    h('div', { class: 'dp-current' }, s.programs.map((x) => {
      const p = x.player, d = Math.max(0, s.day - x.fromDay);
      const grown = p.ovr - x.before.ovr;
      const stat = x.stat;
      const select = h('select', { 'aria-label': `${p.name} 집중 능력치`, disabled: !live, onchange: (e) => { s.setFocus(p.id, e.target.value); redraw(); } },
        STAT_KEYS.map((k) => h('option', { value: k, selected: k === stat }, `${STAT_LABELS[k]} ${p.stats[k]}`)));
      const action = x.program === 'dleague'
        ? h('button', { class: 'btn', disabled: !live, onclick: () => { const r = s.setProgram(p.id, null); ctx.toast(r.ok ? `${p.name} 선수를 소환했습니다` : r.errors[0]); redraw(); } }, '소환')
        : x.locked ? h('button', { class: 'btn', disabled: true, title: '시즌이 끝나면 돌아옵니다' }, '시즌 끝까지 유학 중')
          : h('button', { class: 'btn', disabled: !live, onclick: () => { const r = s.setProgram(p.id, null); ctx.toast(r.ok ? `${p.name} 선수의 유학을 취소했습니다` : r.errors[0]); redraw(); } }, '유학 취소(시즌 전)');
      return h('div', { class: 'dp-cur' },
        h('div', { class: 'row between' }, h('div', playerLink(p.id, p.name), ' ', h('span', { class: 'pos' }, p.position), ' ', h('span', { class: 'note' }, `${p.age}세`)), h('span', { class: `tag ${x.program === 'abroad' ? 'hot' : ''}` }, PROGRAM_LABEL[x.program])),
        h('div', { class: 'dp-kv' },
          h('span', '집중'), select,
          h('span', 'OVR'), h('b', x.program === 'dleague' ? `${x.before.ovr} → ${p.ovr}${grown ? ` (${grown > 0 ? '+' : ''}${grown})` : ''}` : `${x.before.ovr} (돌아올 때 확정)`),
          h('span', '기간'), h('span', x.program === 'dleague' ? `${x.fromDay}일차부터 ${d}일째 · 정규리그 ${Math.max(0, s.totalDays - s.day)}일 남음` : `시즌이 끝나면 복귀`),
          h('span', '비용'), h('span', x.program === 'dleague' ? `${eok(programCost('dleague', p, d, s.totalDays, rules), 2)} (지금까지)` : `${eok(programCost('abroad', p, s.totalDays, s.totalDays, rules), 2)} (유학비 + 연봉 일부)`)),
        x.program === 'dleague' ? bar(grown + (p.xp?.[stat] ?? 0) / 8, 6, { label: '파견 중 쌓인 성장(대략)' }) : null,
        h('div', { class: 'row' }, action));
    })));
}

function candidates(ctx, s, redraw) {
  const rules = ctx.data.rules, cfg = rules.devProgram, live = s.stage === 'regular';
  const every = rules.ratingModel.checkpointDays;
  const left = live ? remainingCheckpoints(s.day, s.totalDays, every) : 0;
  const full = checkpointsPerSeason(s.totalDays, every);
  const list = s.players.filter((p) => s.focus.has(p.id) && p.origin === 'domestic' && p.age <= cfg.maxAge)
    .sort((a, b) => (b.potential - b.ovr) - (a.potential - a.ovr) || b.potential - a.potential || a.id.localeCompare(b.id));
  if (!live) return h('div', { class: 'callout' }, s.stage === 'offseason' ? '지금은 오프시즌이라 새로 보낼 수 없습니다. 새 시즌이 시작되기 전(0일차)에 유학을, 시즌 중에 D리그를 보낼 수 있습니다.' : '플레이오프 중에는 새로 보낼 수 없습니다.');
  if (!list.length) return h('div', { class: 'card' }, h('h3', '보낼 수 있는 후보'), h('p', { class: 'muted' }, `${cfg.maxAge}세 이하 국내 선수가 없습니다.`));
  return h('div', { class: 'card' }, h('h3', '보낼 수 있는 후보'),
    s.day > 0 ? h('p', { class: 'note' }, '시즌이 시작되어 유학은 보낼 수 없습니다. D리그만 가능합니다.') : null,
    h('div', { class: 'dp-cands' }, list.map((p) => {
      const stat = ui.stat.get(p.id) ?? s.focus.get(p.id) ?? autoFocus(p);
      const dl = s.programCheck(p.id, 'dleague'), ab = s.programCheck(p.id, 'abroad');
      const pv = preview(p, stat, 'dleague', left, full, rules);
      const pa = preview(p, stat, 'abroad', left, full, rules);
      const select = h('select', { 'aria-label': `${p.name} 집중 능력치`, onchange: (e) => { ui.stat.set(p.id, e.target.value); redraw(); } },
        STAT_KEYS.map((k) => h('option', { value: k, selected: k === stat }, `${STAT_LABELS[k]} ${p.stats[k]}${k === autoFocus(p) ? ' · 추천' : ''}`)));
      const send = (program) => () => { const r = s.setProgram(p.id, program, stat); ctx.toast(r.ok ? `${p.name} 선수를 ${PROGRAM_LABEL[program]}에 보냈습니다` : r.errors[0]); redraw(); };
      return h('div', { class: 'dp-cand' },
        h('div', { class: 'dp-head' }, playerLink(p.id, p.name), h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `${p.age}세`), ovrChip(p),
          h('span', { class: 'note' }, `POT ${p.potential} (여유 ${p.potential - p.ovr})`), h('span', { class: 'note' }, `계약 ${p.contract.yearsLeft}년 · ${eok(p.contract.salaryEok)}`)),
        h('div', { class: 'dp-pick' }, h('span', { class: 'note' }, '집중'), select),
        h('div', { class: 'dp-opts' },
          h('div', { class: 'dp-opt' }, h('b', 'D리그'),
            h('div', { class: 'dp-eff' }, left ? `${STAT_LABELS[stat]} ${plus(pv.program)}` : '-', h('span', { class: 'note' }, left ? ` (훈련만 ${plus(pv.normal)}, +${plus(pv.extra).replace('+', '')} 더)` : '')),
            h('button', { class: 'btn', disabled: !dl.ok, onclick: send('dleague') }, 'D리그 파견'), dl.ok ? null : h('div', { class: 'note dp-why' }, dl.reason)),
          h('div', { class: 'dp-opt' }, h('b', '해외 유학'),
            h('div', { class: 'dp-eff' }, `${STAT_LABELS[stat]} ${plus(pa.program)}`, h('span', { class: 'note' }, ` (${plus(pa.low)} ~ ${plus(pa.high)}, 훈련만 ${plus(pa.normal)})`)),
            h('button', { class: 'btn primary', disabled: !ab.ok, onclick: send('abroad') }, '유학 보내기'), ab.ok ? null : h('div', { class: 'note dp-why' }, ab.reason))));
    })),
    h('p', { class: 'note' }, 'D리그 예상은 남은 훈련을 모두 반영한 평균 상승량이고, 유학 예상은 한 시즌 전체 기준 평균과 (적응 실패 ~ 최대 편차) 범위입니다. 시즌 중 경기 기록에 따른 능력치 갱신은 따로 반영됩니다.'));
}

/** 육성 프로그램 구역. redraw()는 상태가 바뀐 뒤 화면을 다시 그리게 한다 */
export function renderProgramPanel(ctx, redraw) {
  const s = ctx.session;
  return h('div', { class: 'stack dp' }, intro(ctx.data.rules), currentCards(ctx, s, redraw), candidates(ctx, s, redraw), lastReport(s));
}
