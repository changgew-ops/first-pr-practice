// 라인업 편성: 코트 위 포지션 자리(PG·SG·SF·PF·C)와 벤치 칸에 우리 구단 선수를 넣고, 외국 선수 수를 확인해 적용한다.
// 능력치 보기: 코트·벤치 카드의 미니 막대와 강점 칩, 선수 목록의 능력치 열(색 단계 + 숫자, 같은 포지션 평균과의 차이), 선택한 선수의 레이더 상세, 스타팅 평균 능력치 막대.
// 선수 옮기기(셋 다 같은 규칙):
//   · 누르기: 코트 카드·벤치 칸·목록 행 어디든 한 번 누르면 선택, 이어서 다른 선수나 빈 칸을 누르면 서로 바뀐다(목록 선수는 그 자리로 들어가고 원래 선수는 빠진다).
//     선택한 선수는 [빼기]나 위쪽 "빼기" 칸을 눌러 한 번에 뺀다. Esc나 같은 칸을 다시 누르면 선택 해제.
//   · 끌기: 마우스는 바로, 터치는 길게 눌렀다가 끌면 FM처럼 고스트 카드가 따라오고 놓을 수 있는 칸이 강조된다.
//   · 키보드: 칸·행에서 Enter/Space로 누르기와 같다.
// 적용한 편성은 시즌이 끝날 때까지 쓰이고(선수가 팀을 떠나면 자동으로 돌아간다), 새 시즌에는 자동 편성으로 초기화된다.
import { h, svg, ovrChip, stat, radar, signed, STAT_KEYS, ORIGIN_LABEL } from '../lib/dom.js';
import { openPlayerInfo, positionAverages, statRows } from '../lib/player-info.js';
import { avatarEl } from '../lib/avatar.js';
import { colorOf } from '../lib/team-ui.js';
import { injuryMap, injuryTag, injuryCard } from '../lib/injury-view.js';
import { tacticsCard, conditionCard, condBar, conditionOf } from '../lib/tactics-view.js';
import {
  evalDraft, autoDraft, rosterOfTeam, POSITIONS, powerOf, seatFit, slotsFromDraft, draftFromSlots, sameArrangement,
  firstFreeSlot, placeInSlot, slotRef, refOfPlayer, sameRef, idOfRef, moveRefs, OUT_REF, positionSummary, poolList, POOL_SORTS,
  STAT_SHORT, statHeat, topStats, leagueAverages, teamProfile, positionBalance
} from '../lib/lineup-view.js';

let edit = null; // { key, slots } — 화면을 다시 그려도(다른 화면에 갔다 와도) 편집 중인 편성을 유지한다
let autoCache = null;
let ui = { key: null, sel: null, pos: null, sort: 'ovr', unusedOnly: false, showStats: null }; // sel: 선택한 ref, showStats: 목록의 능력치 열(null이면 화면 폭으로 정함)
let justDragged = false;
let escHandler = null;
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && escHandler) escHandler(); });

// 코트 위 자리 위치(코트 그림 크기에 대한 %)
const SEAT_XY = { PG: [50, 79], SG: [83, 58], SF: [17, 58], PF: [70, 30], C: [30, 30] };
const FIT_LABEL = { exact: '', near: '인접', off: '어색' };
const DRAG_PX = 5;      // 이 거리 안의 움직임은 끌기가 아니라 누르기
const LONG_PRESS = 380; // 터치로 끌려면 이만큼(ms) 누르고 있는다

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

/** 끌어 놓을 수 있는 칸: data-drop(slot·row·out) 속성이 있는 가장 가까운 요소 */
const dropTargetAt = (x, y) => document.elementsFromPoint(x, y).map((n) => n.closest?.('[data-drop]')).find(Boolean) ?? null;

/**
 * 끌어 놓기. 마우스·펜은 5px 넘게 움직이면 끌기, 터치는 380ms 눌러야 끌기(그 전에 움직이면 스크롤).
 * ghostText: 따라다니는 카드에 적을 글, from: 끌기를 시작한 ref, onDrop(from, 놓은 요소)
 */
function enableDrag(el, { ghostText, from, enabled, onDrop }) {
  if (!enabled) return;
  el.addEventListener('dragstart', (e) => e.preventDefault()); // 브라우저 기본 끌기(링크·이미지)가 가로채지 않게
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (e.target.closest?.('a, [data-nodrag]')) return;
    const touch = e.pointerType === 'touch';
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, over = null, timer = null, armed = !touch;
    const stopScroll = (ev) => { if (ghost) ev.preventDefault(); };
    const targetOf = (x, y) => { const t = dropTargetAt(x, y); return t && t !== el ? t : null; };
    const startGhost = (x, y) => {
      ghost = h('div', { class: 'lu-ghost' }, ghostText);
      document.body.append(ghost); el.classList.add('dragging'); document.body.classList.add('lu-dragging');
      ghost.style.left = `${x}px`; ghost.style.top = `${y}px`;
    };
    const move = (ev) => {
      if (!ghost) {
        const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (touch && !armed) { if (d > 10) cleanup(); return; } // 길게 누르기 전에 움직였다 → 스크롤
        if (d < DRAG_PX) return;
        startGhost(ev.clientX, ev.clientY);
      }
      ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`;
      const t = targetOf(ev.clientX, ev.clientY);
      if (t !== over) { over?.classList.remove('drop-hot'); over = t; over?.classList.add('drop-hot'); }
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', stopScroll);
    };
    const end = (ev, cancelled) => {
      cleanup();
      if (!ghost) return;
      const t = cancelled ? null : targetOf(ev.clientX, ev.clientY);
      over?.classList.remove('drop-hot'); ghost.remove(); el.classList.remove('dragging'); document.body.classList.remove('lu-dragging');
      justDragged = true; setTimeout(() => { justDragged = false; }, 50);
      if (t) onDrop(from, t);
    };
    const up = (ev) => end(ev, false);
    const cancel = (ev) => end(ev, true);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    if (touch) {
      window.addEventListener('touchmove', stopScroll, { passive: false });
      timer = setTimeout(() => { armed = true; if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* 진동 미지원 */ } startGhost(sx, sy); }, LONG_PRESS);
    }
  });
}

export function render(ctx) {
  const s = ctx.session, rules = ctx.data.rules;
  const my = s.managerId;
  const roster = rosterOfTeam(s.players, my);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const live = s.stage === 'regular' || s.stage === 'playoffs';
  const key = `${s.game.seed}:${s.season}`;
  const hurt = injuryMap(s); // 결장 중인 선수: 자동 편성에서 빠진다
  const condOf = s.stage === 'regular' ? conditionOf(s, rules) : null; // 컨디션(시즌 중에만)
  const sig = roster.map((p) => `${p.id}:${p.ovr}:${hurt.has(p.id) ? 'x' : ''}`).join(',');
  if (!autoCache || autoCache.key !== key || autoCache.sig !== sig) {
    const raw = autoDraft(roster, rules, hurt);
    autoCache = { key, sig, draft: draftFromSlots(slotsFromDraft(raw, roster, rules, { arrange: true })) }; // 자동 편성도 포지션에 맞춰 자리를 앉힌다
  }
  const auto = autoCache.draft;
  const appliedNow = () => s.lineup ?? auto; // 지금 경기에 쓰이는 편성(적용할 때마다 바뀐다)
  if (ui.key !== key) ui = { key, sel: null, pos: null, sort: 'ovr', unusedOnly: false, showStats: ui.showStats };
  if (ui.showStats == null) ui.showStats = window.innerWidth > 560;
  const posAvgs = positionAverages(s.players), leagueAvg = leagueAverages(s.players);
  if (!edit || edit.key !== key) edit = { key, slots: slotsFromDraft(appliedNow(), roster, rules, { arrange: !s.lineup }), sig, auto };
  else if (!s.lineup && edit.sig !== sig && sameArrangement(draftFromSlots(edit.slots), edit.auto)) edit = { key, slots: slotsFromDraft(auto, roster, rules, { arrange: true }), sig, auto }; // 자동 편성을 쓰는 중이고 편집을 안 했다면, 부상·복귀로 달라진 자동 편성을 따라간다
  else if (edit.sig !== sig) { edit.sig = sig; edit.auto = auto; }
  { // 없어진 선수(방출·이적)를 비운다
    const ids = new Set(roster.map((p) => p.id));
    edit.slots = { seats: edit.slots.seats.map((id) => (ids.has(id) ? id : null)), bench: edit.slots.bench.map((id) => (ids.has(id) ? id : null)) };
    if (ui.sel?.kind === 'pool' && !ids.has(ui.sel.id)) ui.sel = null;
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
    const onCourt = rules.foreignPlayers.onCourt;
    const diff = e.power - autoEval.power;
    const nBench = rules.lineup.bench;
    const message = (text, kind = 'ok') => h('div', { class: `lu-msg ${kind}`, role: 'status' }, text);
    const setSlots = (next) => { edit.slots = next; ui.sel = null; draw(); };
    const nameOf = (id) => byId.get(id)?.name ?? '';
    const labelOf = (ref) => (ref.kind === 'slot' ? (ref.area === 'seat' ? `${POSITIONS[ref.index]} 자리` : `벤치 ${ref.index + 1}`) : '');
    const selId = ui.sel ? idOfRef(slots, ui.sel) : null;
    const selIsInLineup = ui.sel?.kind === 'slot' && selId;
    escHandler = () => { if (ui.sel) { ui.sel = null; draw(); } };

    // ---- 동작 ----
    // 누르기: 아무것도 고르지 않았으면 선택, 같은 걸 다시 누르면 해제, 다른 걸 누르면 서로 바꾼다(목록 ↔ 목록은 선택만 옮긴다)
    const press = (ref) => {
      if (!live || justDragged) return;
      if (!ui.sel) { ui.sel = ref; draw(); return; }
      if (sameRef(ui.sel, ref)) { ui.sel = null; draw(); return; }
      if (ui.sel.kind === 'pool' && ref.kind === 'pool') { ui.sel = ref; draw(); return; }
      setSlots(moveRefs(slots, ui.sel, ref));
    };
    const removeSelected = () => { if (selIsInLineup) setSlots(moveRefs(slots, ui.sel, OUT_REF)); };
    const pressOut = () => {
      if (!live || justDragged) return;
      if (selIsInLineup) removeSelected();
      else ctx.toast('빼려면 먼저 코트나 벤치의 선수를 누르세요. 끌어서 이 칸에 놓아도 됩니다.');
    };
    // 끌어 놓기: 놓은 요소의 data-drop에 따라 ref를 만들어 같은 규칙(moveRefs)으로 처리
    const refOfDrop = (d) => {
      if (d.dataset.drop === 'out') return OUT_REF;
      if (d.dataset.drop === 'slot') return slotRef(d.dataset.area, Number(d.dataset.index));
      if (d.dataset.drop === 'row') return refOfPlayer(slots, d.dataset.id);
      return null;
    };
    const onDrop = (from, el) => { const to = refOfDrop(el); if (to) setSlots(moveRefs(slots, from, to)); };
    const quickAdd = (p) => {
      const t = firstFreeSlot(slots, p);
      if (!t) { ctx.toast('빈 칸이 없습니다. 칸을 누르고 바꿀 선수를 고르거나, 먼저 한 칸을 비워 주세요.'); return; }
      setSlots(placeInSlot(slots, p.id, t));
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
      ui.sel = null;
      ctx.toast('자동 편성으로 돌아갔습니다');
      draw();
    };
    const fillAuto = () => setSlots(slotsFromDraft(auto, roster, rules));

    // ---- 카드 ----
    const tagsOf = (p, seatPos) => [
      hurt.get(p.id) ? injuryTag(hurt.get(p.id)) : null,
      p.origin !== 'domestic' ? h('span', { class: 'lu-tag foreign', title: ORIGIN_LABEL[p.origin] }, p.origin === 'foreign' ? '외국' : '아쿼') : null,
      seatPos && seatFit(p, seatPos) !== 'exact' ? h('span', { class: `lu-tag fit-${seatFit(p, seatPos)}`, title: `${p.position} 선수를 ${seatPos} 자리에 두었습니다` }, `${p.position} ${FIT_LABEL[seatFit(p, seatPos)]}`) : null
    ];
    // 능력치 요약: 6칸 미니 막대(높이=값, 색 단계) + 강점 칩. 값은 칩·title·aria-label에도 숫자로 적는다.
    const miniBars = (p) => h('span', { class: 'lu-mini', role: 'img', 'aria-label': STAT_KEYS.map((k) => `${STAT_SHORT[k]} ${p.stats[k]}`).join(', ') },
      STAT_KEYS.map((k) => h('span', { class: 'lu-mini-col', title: `${STAT_SHORT[k]} ${p.stats[k]}` },
        h('i', { class: `h${statHeat(p.stats[k])}`, style: { height: `${Math.round(Math.max(10, Math.min(100, ((p.stats[k] - 30) / 65) * 100)))}%` } }),
        h('em', { 'aria-hidden': 'true' }, STAT_SHORT[k][0]))));
    const strongChips = (p, n) => h('span', { class: 'lu-strong' }, topStats(p, n, 0).strong.map(({ key, value }) => h('span', { class: `lu-stchip h${statHeat(value)}`, title: `강점: ${STAT_SHORT[key]} ${value}` }, `${STAT_SHORT[key]} ${value}`)));
    const slotButton = (cls, ref, p, seatPos, emptyLabel) => {
      const selected = sameRef(ui.sel, ref);
      const el = h('button', {
        type: 'button', class: `lu-slot ${cls} ${p ? 'filled' : 'empty'} ${selected ? 'selected' : ''} ${p && seatPos ? `fit-${seatFit(p, seatPos)}` : ''}`,
        'data-drop': 'slot', 'data-area': ref.area, 'data-index': ref.index, 'aria-pressed': String(selected), disabled: !live,
        'aria-label': p ? `${labelOf(ref)}: ${p.name}, ${p.position}, OVR ${p.ovr}, ${STAT_KEYS.map((k) => `${STAT_SHORT[k]} ${p.stats[k]}`).join(' ')}` : `${labelOf(ref)}: 비어 있음`,
        onclick: () => press(ref)
      },
      seatPos ? h('span', { class: 'lu-seatpos' }, seatPos) : h('span', { class: 'lu-seatpos' }, `벤치 ${ref.index + 1}`),
      p ? [avatarEl(p, { size: seatPos ? 36 : 34, teamColor: colorOf(p.teamId), cls: 'avatar-lu' }), h('span', { class: 'lu-name' }, p.name), h('span', { class: 'lu-line' }, ovrChip(p)), miniBars(p), strongChips(p, seatPos ? 2 : 1), h('span', { class: 'lu-tags' }, tagsOf(p, seatPos))]
        : [h('span', { class: 'lu-plus', 'aria-hidden': 'true' }, '+'), h('span', { class: 'lu-emptylabel' }, emptyLabel)]);
      if (p) enableDrag(el, { ghostText: `${p.name} · ${p.position} · OVR ${p.ovr}`, from: ref, enabled: live, onDrop });
      return el;
    };

    const court = h('div', { class: 'lu-court' }, courtSvg(),
      POSITIONS.map((pos, i) => {
        const p = byId.get(slots.seats[i]);
        const el = slotButton('lu-seat', slotRef('seat', i), p, pos, `${pos} 비어 있음`);
        el.style.left = `${SEAT_XY[pos][0]}%`; el.style.top = `${SEAT_XY[pos][1]}%`;
        return el;
      }));
    const benchRow = h('div', { class: 'lu-bench' }, Array.from({ length: nBench }, (_, i) => slotButton('lu-bslot', slotRef('bench', i), byId.get(slots.bench[i]), null, '비어 있음')));

    const hint = ui.sel
      ? h('div', { class: 'lu-hint', role: 'status' },
        h('span', { class: 'lu-hinttext' }, selId ? h('b', nameOf(selId)) : h('b', labelOf(ui.sel) || '빈 칸'), ' 선택됨 — ', selId && ui.sel.kind === 'pool' ? '들어갈 코트 자리·벤치 칸(또는 바꿀 선수)을 누르세요.' : '바꿀 상대(코트·벤치·목록의 선수나 빈 칸)를 누르세요.'),
        selIsInLineup ? h('button', { type: 'button', class: 'btn lu-removebtn', onclick: removeSelected }, '빼기') : null,
        selId && ui.sel.kind === 'pool' ? h('button', { type: 'button', class: 'btn', onclick: () => quickAdd(byId.get(selId)) }, '빈 칸에 넣기') : null,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { ui.sel = null; draw(); } }, '선택 해제 (Esc)'))
      : h('div', { class: 'lu-hint quiet' }, live ? '선수를 한 번 누르고 바꿀 상대를 누르거나, 끌어다 놓으세요. 목록의 선수도 똑같이 됩니다.' : '');
    const outZone = h('button', { type: 'button', class: `lu-outzone ${selIsInLineup ? 'armed' : ''}`, 'data-drop': 'out', disabled: !live, onclick: pressOut },
      h('b', '빼기'), h('span', selIsInLineup ? `${nameOf(selId)}을(를) 편성에서 뺍니다 — 누르세요` : '선수를 여기로 끌어 놓거나, 선수를 고른 뒤 누르면 편성에서 빠집니다'));

    // ---- 포지션 현황 ----
    const summary = positionSummary(roster, slots);
    const posPanel = h('div', { class: 'card lu-pos' },
      h('div', { class: 'row between lu-poshead' }, h('h2', { style: { margin: 0 } }, '포지션별 인원'), h('span', { class: 'note' }, '선수 본래 포지션 기준 · 칩을 누르면 선수 목록이 그 포지션만 보입니다')),
      h('div', { class: 'lu-posgrid' }, summary.map((r) => h('button', { type: 'button', class: `lu-poscell ${ui.pos === r.pos ? 'on' : ''} ${r.status === 'short' ? 'short' : ''}`, 'aria-pressed': String(ui.pos === r.pos), onclick: () => { ui.pos = ui.pos === r.pos ? null : r.pos; draw(); } },
        h('span', { class: 'lu-posname' }, r.pos),
        h('span', { class: 'lu-posnum' }, r.total, h('small', '명')),
        h('span', { class: 'lu-posbar', 'aria-hidden': 'true' },
          r.total ? [h('i', { class: 'st', style: { flex: r.starters } }), h('i', { class: 'bn', style: { flex: r.bench } }), h('i', { class: 'ot', style: { flex: r.out } })] : null),
        h('span', { class: 'lu-posdetail' }, h('b', { class: 'st' }, `스${r.starters}`), h('b', { class: 'bn' }, `벤${r.bench}`), h('b', { class: 'ot' }, `외${r.out}`)),
        h('span', { class: 'lu-postarget' }, r.target != null ? `국내 ${r.domestic}/${r.target}${r.status === 'short' ? ' 부족' : ''}` : `국내 ${r.domestic}`)))),
      h('p', { class: 'note lu-poslegend' }, h('b', { class: 'st' }, '스'), ' 스타팅 · ', h('b', { class: 'bn' }, '벤'), ' 벤치 · ', h('b', { class: 'ot' }, '외'), ' 엔트리 밖. 국내 권장 인원은 오프시즌 영입에 쓰는 기준(PG 3·SG 2·SF 3·PF 2·C 2)입니다.'));

    // ---- 선수 목록 ----
    const roleText = (p) => { const t = refOfPlayer(slots, p.id); return t.kind === 'pool' ? '제외' : t.area === 'seat' ? `스타팅 ${POSITIONS[t.index]}` : `벤치 ${t.index + 1}`; };
    const selSeat = ui.sel?.kind === 'slot' && ui.sel.area === 'seat' ? POSITIONS[ui.sel.index] : null;
    const shown = poolList(roster, { pos: ui.pos, sort: ui.sort }).filter((p) => !ui.unusedOnly || refOfPlayer(slots, p.id).kind === 'pool');
    // 능력치 칸: 색 단계(0~4)와 숫자, 같은 포지션 평균보다 8 이상 높으면 ▲, 8 이상 낮으면 ▼ (title에 평균과 차이)
    const statCell = (r) => h('td', { class: `r lu-st h${statHeat(r.value)}`, title: r.avg == null ? `${r.label} ${r.value}` : `${STAT_SHORT[r.key]} ${r.value} · 같은 포지션 평균 ${Math.round(r.avg)} (${signed(r.diff)})` },
      r.value, r.diff >= 8 ? h('sup', { class: 'up', 'aria-label': '포지션 평균보다 높음' }, '▲') : r.diff <= -8 ? h('sup', { class: 'down', 'aria-label': '포지션 평균보다 낮음' }, '▼') : null);
    const rows = shown.map((p) => {
      const ref = refOfPlayer(slots, p.id);
      const picked = sameRef(ui.sel, ref) || (ui.sel?.kind === 'slot' && selId === p.id);
      const tr = h('tr', {
        class: `lu-row ${ref.kind === 'pool' ? 'out' : ref.area === 'seat' ? 'starter' : 'bench'} ${picked ? 'picked' : ''}`,
        'data-drop': 'row', 'data-id': p.id, tabindex: live ? '0' : null, role: 'button', 'aria-pressed': String(picked),
        'aria-label': `${p.name}, ${p.position}, OVR ${p.ovr}, ${roleText(p)}`,
        onclick: (ev) => { if (ev.target.closest('a, [data-nodrag]')) return; press(refOfPlayer(slots, p.id)); },
        onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tr) { ev.preventDefault(); press(refOfPlayer(slots, p.id)); } }
      },
      h('td', { class: 'lu-namecell' }, h('span', { class: 'lu-pname' }, p.name), hurt.get(p.id) ? injuryTag(hurt.get(p.id)) : null, h('button', { type: 'button', class: 'lu-info', title: `${p.name} 선수 정보`, 'aria-label': `${p.name} 선수 정보`, 'aria-haspopup': 'dialog', 'data-nodrag': '1', onclick: (ev) => { ev.stopPropagation(); openPlayerInfo(ctx, p); } }, 'ⓘ'), condOf ? condBar(condOf(p.id), { compact: true }) : null),
      h('td', h('span', { class: 'pos' }, p.position), selSeat && seatFit(p, selSeat) !== 'exact' ? h('span', { class: `lu-tag fit-${seatFit(p, selSeat)}` }, FIT_LABEL[seatFit(p, selSeat)]) : null),
      h('td', { class: 'r lu-hide-sm lu-hide-md' }, p.age), h('td', { class: 'r' }, ovrChip(p)),
      ...(ui.showStats ? statRows(p, posAvgs).map((r) => statCell(r)) : []),
      h('td', { class: 'lu-hide-sm lu-hide-md' }, p.origin === 'domestic' ? '' : h('span', { class: 'tag' }, ORIGIN_LABEL[p.origin])),
      h('td', h('span', { class: `lu-role ${ref.kind === 'pool' ? 'out' : ''}` }, roleText(p))),
      h('td', ref.kind === 'pool' ? h('button', { type: 'button', class: 'btn ghost lu-quick', 'data-nodrag': '1', disabled: !live, title: '빈 칸에 바로 넣기', 'aria-label': `${p.name}을(를) 빈 칸에 넣기`, onclick: (ev) => { ev.stopPropagation(); quickAdd(p); } }, '＋') : null));
      enableDrag(tr, { ghostText: `${p.name} · ${p.position} · OVR ${p.ovr}`, from: ref, enabled: live, onDrop });
      return tr;
    });
    const headCols = [
      { label: '이름' }, { label: '포지션', sort: 'pos' }, { label: '나이', cls: 'r lu-hide-sm lu-hide-md', sort: 'age' }, { label: 'OVR', cls: 'r', sort: 'ovr' },
      ...(ui.showStats ? STAT_KEYS.map((k) => ({ label: STAT_SHORT[k], cls: 'r', sort: k })) : []),
      { label: '구분', cls: 'lu-hide-sm lu-hide-md' }, { label: '지금' }, { label: '' }];
    const chip = (label, on, fn) => h('button', { type: 'button', class: `lu-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: fn }, label);
    const filters = h('div', { class: 'lu-filters' },
      h('div', { class: 'lu-chips', role: 'group', 'aria-label': '포지션 필터' }, chip('전체', !ui.pos, () => { ui.pos = null; draw(); }), POSITIONS.map((pos) => chip(pos, ui.pos === pos, () => { ui.pos = ui.pos === pos ? null : pos; draw(); }))),
      h('label', { class: 'lu-sort' }, h('span', { class: 'note' }, '정렬'), h('select', { onchange: (ev) => { ui.sort = ev.target.value; draw(); } }, Object.entries(POOL_SORTS).map(([k, [label]]) => h('option', { value: k, selected: ui.sort === k }, label)))),
      chip('엔트리 밖만', ui.unusedOnly, () => { ui.unusedOnly = !ui.unusedOnly; draw(); }),
      chip('능력치 열', ui.showStats, () => { ui.showStats = !ui.showStats; draw(); }));

    // 선택한 선수 상세: 레이더 + 능력치 6줄(같은 포지션 평균 대비) + 정보 창
    const detailOf = (p) => {
      const rowsD = statRows(p, posAvgs);
      const { strong, weak } = topStats(p, 2, 1);
      return h('div', { class: 'lu-detail', role: 'region', 'aria-label': `${p.name} 능력치 상세` },
        h('div', { class: 'lu-detail-radar' }, radar(p.stats, { size: 190 })),
        h('div', { class: 'lu-detail-body' },
          h('div', { class: 'lu-detail-head' }, h('b', p.name), ovrChip(p), h('span', { class: 'note' }, `${p.position} · ${p.age}세 · ${roleText(p)}`)),
          h('div', { class: 'note' }, `강점 ${strong.map((x) => `${STAT_SHORT[x.key]} ${x.value}`).join(' · ')} / 약점 ${weak.map((x) => `${STAT_SHORT[x.key]} ${x.value}`).join(' · ')}`),
          h('ul', { class: 'lu-detail-rows' }, rowsD.map((r) => h('li', { class: `h${statHeat(r.value)}` },
            h('span', { class: 'lu-dl' }, STAT_SHORT[r.key]), h('b', r.value),
            h('span', { class: 'lu-dbar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(2, Math.min(100, r.value))}%` } }), r.avg != null ? h('s', { style: { left: `${Math.min(100, r.avg)}%` } }) : null),
            h('span', { class: `lu-dd ${r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : ''}`, title: '같은 포지션 평균과의 차이' }, r.avg == null ? '' : `${signed(r.diff)}`)))),
          h('button', { type: 'button', class: 'btn ghost lu-detail-btn', 'data-nodrag': '1', onclick: () => openPlayerInfo(ctx, p) }, '선수 정보 창')));
    };
    const selPlayer = selId ? byId.get(selId) : null;
    // 스타팅 능력치: 스타팅 평균을 리그 평균과 견준다
    const prof = teamProfile(e.starters, leagueAvg);
    const balance = positionBalance(e.starters);
    const profileCard = h('div', { class: 'card lu-profile' },
      h('div', { class: 'row between lu-poshead' }, h('h2', { style: { margin: 0 } }, '스타팅 능력치'), h('span', { class: 'note' }, '스타팅 5명 평균 · 세로선은 리그 전체 선수 평균')),
      e.starters.length ? h('ul', { class: 'lu-prof' }, prof.map((r) => h('li', { class: `h${statHeat(r.value)}`, title: `${r.label} ${r.value.toFixed(1)} · 리그 평균 ${r.avg.toFixed(1)}` },
        h('span', { class: 'lu-dl' }, r.label), h('b', r.value.toFixed(1)),
        h('span', { class: 'lu-dbar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(2, Math.min(100, r.value))}%` } }), h('s', { style: { left: `${Math.min(100, r.avg)}%` } })),
        h('span', { class: `lu-dd ${r.diff > 0.4 ? 'up' : r.diff < -0.4 ? 'down' : ''}` }, `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}`)))) : h('p', { class: 'muted', style: { margin: 0 } }, '스타팅 선수를 넣으면 능력치 평균이 나옵니다.'),
      h('p', { class: `note lu-balance ${balance.ok ? 'ok' : ''}` }, balance.text));
    const hurtInDraft = [...slots.seats, ...slots.bench].filter((id) => id && hurt.has(id));
    const injWarn = hurt.size ? h('div', { class: 'card inj-warn' },
      h('b', `부상 선수 ${hurt.size}명이 있습니다`),
      hurtInDraft.length ? h('ul', hurtInDraft.map((id) => h('li', `${nameOf(id)}: ${hurt.get(id).part}, ${hurt.get(id).kind === 'season' ? '시즌 아웃' : `${hurt.get(id).left}경기 결장`} — 이 편성으로 적용해도 경기 때는 건강한 선수가 같은 자리에 대신 서고, 복귀하면 돌아옵니다.`)))
        : h('p', { class: 'note', style: { margin: '4px 0 0' } }, '현재 편집 중인 편성에는 부상 선수가 없습니다. 자동 편성은 부상 선수를 뺍니다.')) : null;
    host.replaceChildren(...[
      !live ? h('div', { class: 'callout' }, s.stage === 'offseason' ? '지금은 오프시즌이라 라인업을 바꿀 수 없습니다. 시즌이 시작되면 자동 편성으로 시작하고, 여기서 직접 편성할 수 있습니다.' : '지금은 라인업을 바꿀 수 없습니다.') : null,
      h('div', { class: 'grid g4' },
        stat('스타팅', `${e.starters.length} / ${rules.lineup.starters}`, e.starters.length === rules.lineup.starters ? '완성' : `${rules.lineup.starters}명을 채워 주세요`),
        stat('벤치', `${e.bench.length} / ${nBench}`, e.bench.length === nBench ? '완성' : `${nBench}명을 채워 주세요`),
        stat('팀 전력', e.power.toFixed(1), `자동 편성 ${autoEval.power.toFixed(1)}`),
        stat('스타팅 외국 선수', `${e.foreignStarters}명`, `동시에 ${onCourt}명까지`)),
      profileCard,
      e.errors.length ? h('div', { class: 'lu-errors', role: 'alert' }, h('b', '이 편성은 적용할 수 없습니다'), h('ul', e.errors.map((m) => h('li', m)))) : message('규칙에 맞는 편성입니다.', 'ok'),
      h('div', { class: 'card lu-actions' },
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !live, onclick: fillAuto }, '자동 편성으로 채우기'),
          h('button', { class: 'btn primary', disabled: !live || !dirty || e.errors.length > 0, onclick: apply }, '적용'),
          h('button', { class: 'btn', disabled: !live || !dirty, onclick: () => setSlots(slotsFromDraft(applied, roster, rules)) }, '변경 취소'),
          h('button', { class: 'btn ghost', disabled: !live || !customApplied, onclick: useAuto }, '자동 편성 사용')),
        h('p', { class: 'note' }, '채우기와 선수 옮기기는 편집 상태만 바꿉니다. [적용]을 눌러야 다음 경기부터 쓰입니다. 시즌이 끝나면 직접 편성은 초기화되어 새 시즌은 자동 편성으로 시작합니다.')),
      injWarn,
      hurt.size ? injuryCard(ctx, { compact: true }) : null,
      tacticsCard(ctx, { lineup: e.starters.length === rules.lineup.starters && e.bench.length === nBench ? { starters: e.starters, bench: e.bench } : null, onChange: draw }),
      live ? conditionCard(ctx, roster, { onChange: draw }) : null,
      posPanel,
      h('div', { class: 'lu-split' },
        h('div', { class: 'card lu-courtcard' },
          h('div', { class: 'row between lu-courthead' }, h('h2', { style: { margin: 0 } }, '코트'), h('div', { class: 'lu-state' },
            customApplied ? h('span', { class: 'tag hot' }, '직접 편성 적용 중') : h('span', { class: 'tag' }, '자동 편성 사용 중'),
            dirty ? h('span', { class: 'tag warn' }, '미적용 변경 있음') : h('span', { class: 'tag' }, '적용된 편성과 같음'))),
          hint, outZone, court,
          h('h3', { class: 'lu-benchtitle' }, `벤치 ${nBench}명`), benchRow,
          h('p', { class: 'note' }, '포지션 자리는 보기용입니다. 경기 시뮬레이션은 자리와 포지션이 맞는지 따지지 않고, 출전 시간은 스타팅·벤치 각각 OVR이 높은 순서로 나눕니다. 외국 선수는 스타팅에 동시에 2명까지 둘 수 있습니다.')),
        h('div', { class: 'card flush lu-listcard', 'data-drop': 'out' },
          h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, '선수 목록'), h('p', { class: 'note', style: { margin: '4px 0 8px' } }, '행을 누르면 선택, 이어서 코트의 칸이나 다른 선수를 누르면 바뀝니다. 행을 칸으로 끌어 놓아도 되고, 코트 선수를 이 목록으로 끌어 오면 편성에서 빠집니다. 이름 옆 ⓘ는 선수 정보 창, 머리글(OVR·능력치)을 누르면 그 순서로 정렬합니다.'), filters, selPlayer ? detailOf(selPlayer) : null),
          h('div', { class: 'table-wrap lu-listscroll' }, h('table', { class: 'lu-table' },
            h('thead', h('tr', headCols.map((c) => h('th', { class: `${c.cls ?? ''}`, 'aria-sort': c.sort && ui.sort === c.sort ? 'descending' : null },
              c.sort ? h('button', { type: 'button', class: `lu-th ${ui.sort === c.sort ? 'on' : ''}`, title: `${c.label} 순으로 정렬`, onclick: () => { ui.sort = ui.sort === c.sort ? 'ovr' : c.sort; draw(); } }, c.label) : c.label)))),
            h('tbody', rows.length ? rows : h('tr', h('td', { colspan: headCols.length, class: 'muted' }, '조건에 맞는 선수가 없습니다.')))))),
      ),
      h('div', { class: 'card lu-compare' },
        h('h2', '자동 편성과 비교'),
        h('div', { class: 'lu-cmp-grid' },
          h('div', h('div', { class: 'note' }, '현재 편집'), h('div', { class: 'lu-big' }, e.power.toFixed(1)), h('div', { class: 'note' }, `스타팅 ${powerOf(e.starters, []).toFixed(1)} · 벤치 ${e.bench.length ? powerOf(e.bench, []).toFixed(1) : '-'}`)),
          h('div', h('div', { class: 'note' }, '자동 편성'), h('div', { class: 'lu-big' }, autoEval.power.toFixed(1)), h('div', { class: 'note' }, `스타팅 ${powerOf(autoEval.starters, []).toFixed(1)} · 벤치 ${autoEval.bench.length ? powerOf(autoEval.bench, []).toFixed(1) : '-'}`)),
          h('div', h('div', { class: 'note' }, '차이'), h('div', { class: `lu-big ${diff > 0.05 ? 'good' : diff < -0.05 ? 'bad' : ''}` }, `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`), h('div', { class: 'note' }, '스타팅 70% + 벤치 30%'))))].filter(Boolean));
  };
  draw();
  return { title: '라인업', body: h('div', { class: 'stack lineup-view' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '라인업'), h('h1', '라인업'))), host) };
}
