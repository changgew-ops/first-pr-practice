// 라인업 편성: 코트 위 포지션 자리(PG·SG·SF·PF·C)와 벤치 칸에 우리 구단 선수를 넣고, 코스트 제한·외국 선수 수를 확인해 적용한다.
// 선수 옮기기: 자리를 누른 뒤 목록의 선수(또는 다른 자리)를 누른다 / 마우스로 끌어다 놓는다 / 키보드는 버튼에서 Enter.
// 적용한 편성은 시즌이 끝날 때까지 쓰이고(선수가 팀을 떠나면 자동으로 돌아간다), 새 시즌에는 자동 편성으로 초기화된다.
import { h, svg, ovrChip, bar, stat, link, ORIGIN_LABEL } from '../lib/dom.js';
import {
  evalDraft, autoDraft, prune, rosterOfTeam, POSITIONS, powerOf, seatFit, slotsFromDraft, draftFromSlots, sameArrangement,
  locate, placeInSlot, clearSlot, swapSlots, firstFreeSlot
} from '../lib/lineup-view.js';

let edit = null; // { key, slots } — 화면을 다시 그려도(다른 화면에 갔다 와도) 편집 중인 편성을 유지한다
let autoCache = null;
let ui = { key: null, sel: null, pick: null }; // sel: 고른 칸 { area, index }, pick: 고른 선수 id
let justDragged = false;

// 코트 위 자리 위치(코트 그림 크기에 대한 %)
const SEAT_XY = { PG: [50, 79], SG: [83, 58], SF: [17, 58], PF: [70, 30], C: [30, 30] };
const FIT_LABEL = { exact: '', near: '인접', off: '어색' };

function courtSvg() {
  const line = { fill: 'none', stroke: 'rgba(255,255,255,.8)', 'stroke-width': 3, 'stroke-linejoin': 'round' };
  return svg('svg', { class: 'lu-courtsvg', viewBox: '0 0 500 440', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('rect', { x: 0, y: 0, width: 500, height: 440, class: 'lu-floor' }),
    svg('rect', { x: 180, y: 10, width: 140, height: 190, class: 'lu-paint' }),
    svg('rect', { x: 10, y: 10, width: 480, height: 420, rx: 4, ...line }),
    svg('rect', { x: 180, y: 10, width: 140, height: 190, ...line }),
    svg('path', { d: 'M190 200 A60 60 0 0 0 310 200', ...line }),
    svg('path', { d: 'M190 200 A60 60 0 0 1 310 200', ...line, 'stroke-dasharray': '8 8' }),
    svg('path', { d: 'M45 10 V120 A235 235 0 0 0 455 120 V10', ...line }),
    svg('path', { d: 'M210 52 A40 40 0 0 0 290 52', ...line }),
    svg('line', { x1: 220, y1: 34, x2: 280, y2: 34, ...line }),
    svg('circle', { cx: 250, cy: 46, r: 9, ...line, stroke: 'rgba(255,140,60,.95)' }),
    svg('path', { d: 'M190 430 A60 60 0 0 1 310 430', ...line }));
}

/** 마우스(펜)로 끌어 놓기. 터치는 탭 선택 방식을 쓴다. payload: { type: 'slot'|'player', id, from? }, onDrop(target element dataset) */
function enableDrag(el, payload, enabled, onDrop) {
  if (!enabled) return;
  el.addEventListener('dragstart', (e) => e.preventDefault()); // 이름 링크를 끌 때 브라우저의 링크 끌기가 가로채지 않게
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, over = null;
    const targetAt = (x, y) => document.elementsFromPoint(x, y).map((n) => n.closest?.('[data-drop]')).find(Boolean) ?? null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = el.cloneNode(true); ghost.classList.add('lu-ghost'); ghost.style.width = `${el.offsetWidth}px`;
        ghost.removeAttribute('id'); document.body.append(ghost); el.classList.add('dragging');
      }
      ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`;
      const t = targetAt(ev.clientX, ev.clientY);
      if (t !== over) { over?.classList.remove('drop-hot'); over = t; over?.classList.add('drop-hot'); }
    };
    const end = (ev, cancelled) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      const t = cancelled ? null : targetAt(ev.clientX, ev.clientY);
      over?.classList.remove('drop-hot'); ghost.remove(); el.classList.remove('dragging');
      justDragged = true; setTimeout(() => { justDragged = false; }, 0);
      if (t) onDrop(payload, t.dataset);
    };
    const up = (ev) => end(ev, false);
    const cancel = (ev) => end(ev, true);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  });
}

export function render(ctx) {
  const s = ctx.session, rules = ctx.data.rules;
  const my = s.managerId;
  const roster = rosterOfTeam(s.players, my);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const live = s.stage === 'regular' || s.stage === 'playoffs';
  const key = `${s.game.seed}:${s.season}`;
  const sig = roster.map((p) => `${p.id}:${p.ovr}`).join(',');
  if (!autoCache || autoCache.key !== key || autoCache.sig !== sig) {
    const raw = autoDraft(roster, rules);
    autoCache = { key, sig, draft: draftFromSlots(slotsFromDraft(raw, roster, rules, { arrange: true })) }; // 자동 편성도 포지션에 맞춰 자리를 앉힌다
  }
  const auto = autoCache.draft;
  const appliedNow = () => s.lineup ?? auto; // 지금 경기에 쓰이는 편성(적용할 때마다 바뀐다)
  if (ui.key !== key) ui = { key, sel: null, pick: null };
  if (!edit || edit.key !== key) edit = { key, slots: slotsFromDraft(appliedNow(), roster, rules, { arrange: !s.lineup }) };
  { // 없어진 선수(방출·이적)를 비운다
    const ids = new Set(roster.map((p) => p.id));
    edit.slots = { seats: edit.slots.seats.map((id) => (ids.has(id) ? id : null)), bench: edit.slots.bench.map((id) => (ids.has(id) ? id : null)) };
    if (ui.pick && !ids.has(ui.pick)) ui.pick = null;
  }

  const host = h('div', { class: 'stack' });
  const draw = () => {
    const slots = edit.slots;
    const draft = draftFromSlots(slots);
    const e = evalDraft(draft, roster, rules);
    const autoEval = evalDraft(auto, roster, rules);
    const applied = appliedNow();
    const dirty = !sameArrangement(draft, applied);
    const customApplied = Boolean(s.lineup);
    const cap = rules.lineup.costCap;
    const onCourt = rules.foreignPlayers.onCourt;
    const diff = e.power - autoEval.power;
    const nBench = rules.lineup.bench;
    const message = (text, kind = 'ok') => h('div', { class: `lu-msg ${kind}`, role: 'status' }, text);
    const setSlots = (next) => { edit.slots = next; ui.sel = null; ui.pick = null; draw(); };
    const targetOf = (area, index) => ({ area, index });
    const sameTarget = (a, b) => a && b && a.area === b.area && a.index === b.index;
    const idAt = (t) => (t.area === 'seat' ? slots.seats[t.index] : slots.bench[t.index]);
    const nameOf = (id) => byId.get(id)?.name ?? '';
    const labelOf = (t) => (t.area === 'seat' ? `${POSITIONS[t.index]} 자리` : `벤치 ${t.index + 1}`);

    // ---- 동작 ----
    const clickSlot = (t) => {
      if (!live || justDragged) return;
      if (ui.pick) { setSlots(placeInSlot(slots, ui.pick, t)); return; }
      if (ui.sel && !sameTarget(ui.sel, t)) { setSlots(swapSlots(slots, ui.sel, t)); return; }
      ui.sel = sameTarget(ui.sel, t) ? null : t; draw();
    };
    const clickPlayer = (p) => {
      if (!live || justDragged) return;
      if (ui.sel) { setSlots(placeInSlot(slots, p.id, ui.sel)); return; }
      ui.pick = ui.pick === p.id ? null : p.id; draw();
    };
    const quickAdd = (p) => {
      const t = firstFreeSlot(slots, p);
      if (!t) { ctx.toast('빈 칸이 없습니다. 자리를 누르고 선수를 골라 바꾸거나, 먼저 한 칸을 비워 주세요.'); return; }
      if (locate(slots, p.id)) { ctx.toast(`${p.name}은(는) 이미 편성에 있습니다`); return; }
      setSlots(placeInSlot(slots, p.id, t));
    };
    const onDrop = (payload, d) => {
      if (d.drop === 'out') { if (payload.type === 'slot') { const from = locate(slots, payload.id); if (from) setSlots(clearSlot(slots, from)); } return; }
      const t = targetOf(d.area, Number(d.index));
      if (payload.type === 'slot') { const from = locate(slots, payload.id); if (from && !sameTarget(from, t)) setSlots(swapSlots(slots, from, t)); }
      else setSlots(placeInSlot(slots, payload.id, t));
    };
    const apply = () => {
      const r = s.setLineup({ starters: draft.starters, bench: draft.bench });
      if (!r.ok) { ctx.toast(`적용하지 못했습니다: ${r.errors[0]}`); return; }
      ctx.toast('라인업을 적용했습니다. 다음 경기부터 이 편성으로 뜁니다.');
      draw();
    };
    const useAuto = () => {
      s.setLineup(null);
      edit.slots = slotsFromDraft(auto, roster, rules);
      ui.sel = null; ui.pick = null;
      ctx.toast('자동 편성으로 돌아갔습니다');
      draw();
    };
    const fillAuto = () => setSlots(slotsFromDraft(auto, roster, rules));

    // ---- 카드 ----
    const tagsOf = (p, seatPos) => [
      p.origin !== 'domestic' ? h('span', { class: 'lu-tag foreign', title: ORIGIN_LABEL[p.origin] }, p.origin === 'foreign' ? '외국' : '아쿼') : null,
      seatPos && seatFit(p, seatPos) !== 'exact' ? h('span', { class: `lu-tag fit-${seatFit(p, seatPos)}`, title: `${p.position} 선수를 ${seatPos} 자리에 두었습니다` }, `${p.position} ${FIT_LABEL[seatFit(p, seatPos)]}`) : null
    ];
    const slotButton = (cls, t, p, seatPos, emptyLabel) => {
      const selected = sameTarget(ui.sel, t);
      const el = h('button', {
        type: 'button', class: `lu-slot ${cls} ${p ? 'filled' : 'empty'} ${selected ? 'selected' : ''} ${p && seatPos ? `fit-${seatFit(p, seatPos)}` : ''}`,
        'data-drop': 'slot', 'data-area': t.area, 'data-index': t.index, 'aria-pressed': String(selected), disabled: !live,
        'aria-label': p ? `${labelOf(t)}: ${p.name}, ${p.position}, OVR ${p.ovr}, 코스트 ${p.cost}` : `${labelOf(t)}: 비어 있음`,
        onclick: () => clickSlot(t)
      },
      seatPos ? h('span', { class: 'lu-seatpos' }, seatPos) : h('span', { class: 'lu-seatpos' }, `벤치 ${t.index + 1}`),
      p ? [h('span', { class: 'lu-name' }, p.name), h('span', { class: 'lu-line' }, ovrChip(p), h('span', { class: 'lu-cost' }, `코 ${p.cost}`)), h('span', { class: 'lu-tags' }, tagsOf(p, seatPos))]
        : [h('span', { class: 'lu-plus', 'aria-hidden': 'true' }, '+'), h('span', { class: 'lu-emptylabel' }, emptyLabel)]);
      if (p) enableDrag(el, { type: 'slot', id: p.id }, live, onDrop);
      return el;
    };

    const court = h('div', { class: 'lu-court' }, courtSvg(),
      POSITIONS.map((pos, i) => {
        const p = byId.get(slots.seats[i]);
        const el = slotButton('lu-seat', targetOf('seat', i), p, pos, `${pos} 비어 있음`);
        el.style.left = `${SEAT_XY[pos][0]}%`; el.style.top = `${SEAT_XY[pos][1]}%`;
        return el;
      }));
    const benchRow = h('div', { class: 'lu-bench' }, Array.from({ length: nBench }, (_, i) => slotButton('lu-bslot', targetOf('bench', i), byId.get(slots.bench[i]), null, '비어 있음')));

    const selId = ui.sel ? idAt(ui.sel) : null;
    const hint = ui.pick
      ? h('div', { class: 'lu-hint', role: 'status' }, h('b', byId.get(ui.pick)?.name), '을(를) 넣을 자리나 벤치 칸을 누르세요.', h('button', { type: 'button', class: 'btn ghost', onclick: () => { ui.pick = null; draw(); } }, '취소'))
      : ui.sel
        ? h('div', { class: 'lu-hint', role: 'status' }, h('b', labelOf(ui.sel)), selId ? ` (${nameOf(selId)})` : ' (비어 있음)', ' 선택됨. 아래 목록에서 선수를 누르면 이 칸에 들어가고, 다른 칸을 누르면 서로 바뀝니다.',
          selId ? h('button', { type: 'button', class: 'btn', onclick: () => setSlots(clearSlot(slots, ui.sel)) }, '이 칸 비우기') : null,
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { ui.sel = null; draw(); } }, '선택 해제'))
        : h('div', { class: 'lu-hint quiet' }, live ? '자리를 누르고 선수를 고르거나, 선수를 끌어다 놓으세요.' : '');

    // ---- 선수 목록 ----
    const roleText = (p) => { const t = locate(slots, p.id); return !t ? '제외' : t.area === 'seat' ? `스타팅 ${POSITIONS[t.index]}` : `벤치 ${t.index + 1}`; };
    const rows = [...roster].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).map((p) => {
      const t = locate(slots, p.id);
      const selSeat = ui.sel?.area === 'seat' ? POSITIONS[ui.sel.index] : null;
      const tr = h('tr', { class: `lu-row ${t ? (t.area === 'seat' ? 'starter' : 'bench') : 'out'} ${ui.pick === p.id ? 'picked' : ''}`, 'data-drop-row': '1' },
        h('td', link(`#/player/${p.id}`, p.name)), h('td', h('span', { class: 'pos' }, p.position), selSeat && seatFit(p, selSeat) !== 'exact' ? h('span', { class: `lu-tag fit-${seatFit(p, selSeat)}` }, FIT_LABEL[seatFit(p, selSeat)]) : null),
        h('td', { class: 'r lu-hide-sm lu-hide-md' }, p.age), h('td', { class: 'r' }, ovrChip(p)), h('td', { class: 'r' }, p.cost),
        h('td', { class: 'lu-hide-sm lu-hide-md' }, p.origin === 'domestic' ? '' : h('span', { class: 'tag' }, ORIGIN_LABEL[p.origin])),
        h('td', h('span', { class: `lu-role ${t ? '' : 'out'}` }, roleText(p))),
        h('td', h('div', { class: 'lu-rowbtns' },
          h('button', { type: 'button', class: `btn lu-pickbtn ${ui.pick === p.id ? 'on' : ''}`, disabled: !live, 'aria-pressed': String(ui.pick === p.id), 'aria-label': ui.sel ? `${p.name}을(를) ${labelOf(ui.sel)}에 넣기` : `${p.name} 고르기`, onclick: () => clickPlayer(p) }, ui.sel ? '넣기' : ui.pick === p.id ? '고름' : '고르기'),
          t ? null : h('button', { type: 'button', class: 'btn ghost', disabled: !live, 'aria-label': `${p.name}을(를) 빈 칸에 넣기`, onclick: () => quickAdd(p) }, '빈 칸에'))));
      enableDrag(tr, { type: 'player', id: p.id }, live, onDrop);
      return tr;
    });
    const outZone = h('div', { class: 'lu-outzone', 'data-drop': 'out' }, '여기로 끌어 놓으면 편성에서 뺍니다');

    host.replaceChildren(...[
      !live ? h('div', { class: 'callout' }, s.stage === 'offseason' ? '지금은 오프시즌이라 라인업을 바꿀 수 없습니다. 시즌이 시작되면 자동 편성으로 시작하고, 여기서 직접 편성할 수 있습니다.' : '지금은 라인업을 바꿀 수 없습니다.') : null,
      h('div', { class: 'grid g4' },
        stat('스타팅', `${e.starters.length} / ${rules.lineup.starters}`, e.starters.length === rules.lineup.starters ? '완성' : `${rules.lineup.starters}명을 채워 주세요`),
        stat('벤치', `${e.bench.length} / ${nBench}`, e.bench.length === nBench ? '완성' : `${nBench}명을 채워 주세요`),
        stat('코스트', `${e.totalCost} / ${cap}`, e.totalCost > cap ? `${e.totalCost - cap} 초과` : `여유 ${cap - e.totalCost}`),
        stat('스타팅 외국 선수', `${e.foreignStarters}명`, `동시에 ${onCourt}명까지`)),
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'note' }, `코스트 사용 · 엔트리 ${rules.lineup.starters + nBench}명(스타팅 ${rules.lineup.starters} + 벤치 ${nBench})`), h('span', { class: 'note' }, `${e.totalCost}/${cap}`)), bar(e.totalCost, cap, { cls: e.totalCost > cap ? 'bad' : e.totalCost > cap - 3 ? 'warn' : '' })),
      e.errors.length ? h('div', { class: 'lu-errors', role: 'alert' }, h('b', '이 편성은 적용할 수 없습니다'), h('ul', e.errors.map((m) => h('li', m)))) : message('규칙에 맞는 편성입니다.', 'ok'),
      h('div', { class: 'card lu-actions' },
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !live, onclick: fillAuto }, '자동 편성으로 채우기'),
          h('button', { class: 'btn primary', disabled: !live || !dirty || e.errors.length > 0, onclick: apply }, '적용'),
          h('button', { class: 'btn', disabled: !live || !dirty, onclick: () => setSlots(slotsFromDraft(applied, roster, rules)) }, '변경 취소'),
          h('button', { class: 'btn ghost', disabled: !live || !customApplied, onclick: useAuto }, '자동 편성 사용')),
        h('p', { class: 'note' }, '채우기와 선수 선택은 편집 상태만 바꿉니다. [적용]을 눌러야 다음 경기부터 쓰입니다. 시즌이 끝나면 직접 편성은 초기화되어 새 시즌은 자동 편성으로 시작합니다.')),
      h('div', { class: 'lu-split' },
      h('div', { class: 'card lu-courtcard' },
        h('div', { class: 'row between lu-courthead' }, h('h2', { style: { margin: 0 } }, '코트'), h('div', { class: 'lu-state' },
          customApplied ? h('span', { class: 'tag hot' }, '직접 편성 적용 중') : h('span', { class: 'tag' }, '자동 편성 사용 중'),
          dirty ? h('span', { class: 'tag warn' }, '미적용 변경 있음') : h('span', { class: 'tag' }, '적용된 편성과 같음'))),
        hint, court,
        h('h3', { class: 'lu-benchtitle' }, `벤치 ${nBench}명`), benchRow, outZone,
        h('p', { class: 'note' }, '포지션 자리는 보기용입니다. 경기 시뮬레이션은 자리와 포지션이 맞는지 따지지 않고, 출전 시간은 스타팅·벤치 각각 OVR이 높은 순서로 나눕니다. 외국 선수는 스타팅에 동시에 2명까지 둘 수 있습니다.')),
      h('div', { class: 'card flush lu-listcard' },
        h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '선수 고르기'), h('p', { class: 'note', style: { margin: '4px 0 0' } }, '[고르기]를 누른 뒤 코트의 칸을 누르거나, 칸을 먼저 누르고 [넣기]를 누르세요. 행을 칸으로 끌어 놓아도 됩니다. 능력치는 시즌 중 갱신된 값입니다.')),
        h('div', { class: 'table-wrap lu-listscroll' }, h('table', { class: 'lu-table' },
          h('thead', h('tr', ['이름', '포지션', '나이', 'OVR', '코스트', '구분', '지금', ''].map((t, i) => h('th', { class: `${[2, 3, 4].includes(i) ? 'r' : ''} ${[2, 5].includes(i) ? 'lu-hide-sm lu-hide-md' : ''}` }, t)))),
          h('tbody', rows))))),
      h('div', { class: 'card lu-compare' },
        h('h2', '자동 편성과 비교'),
        h('div', { class: 'lu-cmp-grid' },
          h('div', h('div', { class: 'note' }, '현재 편집'), h('div', { class: 'lu-big' }, e.power.toFixed(1)), h('div', { class: 'note' }, `스타팅 ${powerOf(e.starters, []).toFixed(1)} · 벤치 ${e.bench.length ? powerOf(e.bench, []).toFixed(1) : '-'}`)),
          h('div', h('div', { class: 'note' }, '자동 편성'), h('div', { class: 'lu-big' }, autoEval.power.toFixed(1)), h('div', { class: 'note' }, `코스트 ${autoEval.totalCost}/${cap}`)),
          h('div', h('div', { class: 'note' }, '차이'), h('div', { class: `lu-big ${diff > 0.05 ? 'good' : diff < -0.05 ? 'bad' : ''}` }, `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`), h('div', { class: 'note' }, '스타팅 70% + 벤치 30%'))))].filter(Boolean));
  };
  draw();
  return { title: '라인업', body: h('div', { class: 'stack lineup-view' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '라인업'), h('h1', '라인업 · 코스트'))), host) };
}
