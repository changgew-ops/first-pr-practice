// 라인업 편성: 우리 구단 선수를 스타팅·벤치·제외로 나누고, 코스트 제한·외국 선수 수를 확인해 적용한다.
// 적용한 편성은 시즌이 끝날 때까지 쓰이고(선수가 팀을 떠나면 자동으로 돌아간다), 새 시즌에는 자동 편성으로 초기화된다.
import { h, ovrChip, bar, stat, link, ORIGIN_LABEL } from '../lib/dom.js';
import { evalDraft, autoDraft, setRole, roleOf, sameDraft, prune, rosterOfTeam, POSITIONS, powerOf } from '../lib/lineup-view.js';

let edit = null; // { key, draft } — 화면을 다시 그려도(다른 화면에 갔다 와도) 편집 중인 편성을 유지한다
let autoCache = null;

export function render(ctx) {
  const s = ctx.session, rules = ctx.data.rules;
  const my = s.managerId;
  const roster = rosterOfTeam(s.players, my);
  const live = s.stage === 'regular' || s.stage === 'playoffs';
  const key = `${s.game.seed}:${s.season}`;
  const sig = roster.map((p) => `${p.id}:${p.ovr}`).join(',');
  if (!autoCache || autoCache.key !== key || autoCache.sig !== sig) autoCache = { key, sig, draft: autoDraft(roster, rules) };
  const auto = autoCache.draft;
  const appliedNow = () => s.lineup ?? auto; // 지금 경기에 쓰이는 편성(적용할 때마다 바뀐다)
  if (!edit || edit.key !== key) edit = { key, draft: { starters: [...appliedNow().starters], bench: [...appliedNow().bench] } };
  edit.draft = prune(edit.draft, roster);

  const host = h('div', { class: 'stack' });
  const draw = () => {
    const draft = edit.draft;
    const e = evalDraft(draft, roster, rules);
    const autoEval = evalDraft(auto, roster, rules);
    const applied = appliedNow();
    const dirty = !sameDraft(draft, applied);
    const customApplied = Boolean(s.lineup);
    const cap = rules.lineup.costCap;
    const onCourt = rules.foreignPlayers.onCourt;
    const diff = e.power - autoEval.power;
    const setDraft = (d) => { edit.draft = d; draw(); };
    const message = (text, kind = 'ok') => h('div', { class: `lu-msg ${kind}`, role: 'status' }, text);

    const apply = () => {
      const r = s.setLineup({ starters: draft.starters, bench: draft.bench });
      if (!r.ok) { ctx.toast(`적용하지 못했습니다: ${r.errors[0]}`); return; }
      ctx.toast('라인업을 적용했습니다. 다음 경기부터 이 편성으로 뜁니다.');
      draw();
    };
    const useAuto = () => {
      s.setLineup(null);
      edit.draft = { starters: [...auto.starters], bench: [...auto.bench] };
      ctx.toast('자동 편성으로 돌아갔습니다');
      draw();
    };

    const rows = [...roster].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).map((p) => {
      const role = roleOf(draft, p.id);
      const seg = (r, label) => h('button', { type: 'button', class: `lu-seg ${role === r ? 'on' : ''} ${r}`, 'aria-pressed': String(role === r), disabled: !live, onclick: () => setDraft(setRole(draft, p.id, r)) }, label);
      return h('tr', { class: `lu-row ${role}` },
        h('td', link(`#/player/${p.id}`, p.name)), h('td', h('span', { class: 'pos' }, p.position)), h('td', { class: 'r lu-hide-sm' }, p.age),
        h('td', { class: 'r' }, ovrChip(p)), h('td', { class: 'r' }, p.cost),
        h('td', { class: 'lu-hide-sm' }, p.origin === 'domestic' ? '' : h('span', { class: 'tag' }, ORIGIN_LABEL[p.origin])),
        h('td', h('div', { class: 'lu-segs', role: 'group', 'aria-label': `${p.name} 역할` }, seg('starter', '스타팅'), seg('bench', '벤치'), seg('out', '제외'))));
    });

    host.replaceChildren(...[
      !live ? h('div', { class: 'callout' }, s.stage === 'offseason' ? '지금은 오프시즌이라 라인업을 바꿀 수 없습니다. 시즌이 시작되면 자동 편성으로 시작하고, 여기서 직접 편성할 수 있습니다.' : '지금은 라인업을 바꿀 수 없습니다.') : null,
      h('div', { class: 'grid g4' },
        stat('스타팅', `${e.starters.length} / ${rules.lineup.starters}`, e.starters.length === rules.lineup.starters ? '완성' : '5명을 골라 주세요'),
        stat('벤치', `${e.bench.length} / ${rules.lineup.bench}`, e.bench.length === rules.lineup.bench ? '완성' : '5명을 골라 주세요'),
        stat('코스트', `${e.totalCost} / ${cap}`, e.totalCost > cap ? `${e.totalCost - cap} 초과` : `여유 ${cap - e.totalCost}`),
        stat('스타팅 외국 선수', `${e.foreignStarters}명`, `동시에 ${onCourt}명까지`)),
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'note' }, '코스트 사용'), h('span', { class: 'note' }, `${e.totalCost}/${cap}`)), bar(e.totalCost, cap, { cls: e.totalCost > cap ? 'bad' : e.totalCost > cap - 3 ? 'warn' : '' })),
      e.errors.length ? h('div', { class: 'lu-errors', role: 'alert' }, h('b', '이 편성은 적용할 수 없습니다'), h('ul', e.errors.map((m) => h('li', m)))) : message('규칙에 맞는 편성입니다.', 'ok'),
      h('div', { class: 'card lu-compare' },
        h('h2', '자동 편성과 비교'),
        h('div', { class: 'lu-cmp-grid' },
          h('div', h('div', { class: 'note' }, '현재 편집'), h('div', { class: 'lu-big' }, e.power.toFixed(1)), h('div', { class: 'note' }, `스타팅 ${powerOf(e.starters, []).toFixed(1)} · 벤치 ${e.bench.length ? powerOf(e.bench, []).toFixed(1) : '-'}`)),
          h('div', h('div', { class: 'note' }, '자동 편성'), h('div', { class: 'lu-big' }, autoEval.power.toFixed(1)), h('div', { class: 'note' }, `코스트 ${autoEval.totalCost}/${cap}`)),
          h('div', h('div', { class: 'note' }, '차이'), h('div', { class: `lu-big ${diff > 0.05 ? 'good' : diff < -0.05 ? 'bad' : ''}` }, `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`), h('div', { class: 'note' }, '스타팅 70% + 벤치 30%'))),
        h('div', { class: 'lu-pos' }, h('span', { class: 'note' }, '스타팅 포지션'), POSITIONS.map((pos) => h('span', { class: `lu-poschip ${e.positions[pos] ? 'has' : 'none'}` }, `${pos} ${e.positions[pos]}`)))),
      h('div', { class: 'card lu-actions' },
        h('div', { class: 'lu-state' },
          customApplied ? h('span', { class: 'tag hot' }, '직접 편성 적용 중') : h('span', { class: 'tag' }, '자동 편성 사용 중'),
          dirty ? h('span', { class: 'tag warn' }, '미적용 변경 있음') : h('span', { class: 'tag' }, '적용된 편성과 같음')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !live, onclick: () => setDraft({ starters: [...auto.starters], bench: [...auto.bench] }) }, '자동 편성으로 채우기'),
          h('button', { class: 'btn primary', disabled: !live || !dirty || e.errors.length > 0, onclick: apply }, '적용'),
          h('button', { class: 'btn', disabled: !live || !dirty, onclick: () => setDraft({ starters: [...applied.starters], bench: [...applied.bench] }) }, '변경 취소'),
          h('button', { class: 'btn ghost', disabled: !live || !customApplied, onclick: useAuto }, '자동 편성 사용')),
        h('p', { class: 'note' }, '채우기와 선수 선택은 편집 상태만 바꿉니다. [적용]을 눌러야 다음 경기부터 쓰입니다. 시즌이 끝나면 직접 편성은 초기화되어 새 시즌은 자동 편성으로 시작합니다.')),
      h('div', { class: 'card flush' },
        h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '선수 고르기'), h('p', { class: 'note', style: { margin: '4px 0 0' } }, '역할 버튼을 다시 누르면 제외로 돌아갑니다. 능력치는 시즌 중 갱신된 값입니다.')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'lu-table' },
          h('thead', h('tr', ['이름', '포지션', '나이', 'OVR', '코스트', '구분', '역할'].map((t, i) => h('th', { class: `${[3, 4, 2].includes(i) ? 'r' : ''} ${[2, 5].includes(i) ? 'lu-hide-sm' : ''}` }, t)))),
          h('tbody', rows))))].filter(Boolean));
  };
  draw();
  return { title: '라인업', body: h('div', { class: 'stack lineup-view' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '라인업'), h('h1', '라인업 · 코스트'))), host) };
}
