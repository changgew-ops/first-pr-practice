// 저장 슬롯: 자동 저장 + 직접 저장 3칸. 저장·불러오기·삭제, 용량 표시, 파일로 내보내기·가져오기.
import { h } from '../lib/dom.js';
import { listSlots, deleteSlot, SLOTS, QUOTA, storageStatus, capacityNotice, oldestManualSlot, buildExport, parseImport, importToSlot } from '../lib/save.js';
import { Session } from '../lib/session.js';

const fmtTime = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const label = (slot) => (slot === 'auto' ? '자동 저장' : `슬롯 ${slot}`);
/** 글자 수 → "123KB" / "1.2MB" (저장소는 글자 수로 한도를 센다) */
export const fmtSize = (chars) => (chars >= 1024 * 1024 ? `${(chars / 1024 / 1024).toFixed(1)}MB` : `${Math.round(chars / 1024)}KB`);

/** 파일로 받게 한다. 막히면 false */
function download(filename, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch { return false; }
}

// ---------- 어느 화면에서나: 저장할 때 용량이 80%를 넘었거나 저장에 실패하면 경고 띠 ----------
let dismissed = null; // 닫은 단계: 같은 단계에서는 다시 띄우지 않고, 더 나빠지거나 저장이 실패하면 다시 띄운다
function bannerFor({ ok, status }) {
  document.getElementById('save-banner')?.remove();
  const note = capacityNotice({ ok, status });
  if (!note) { dismissed = null; return; }
  if (ok && dismissed === note.level) return;
  if (location.hash.startsWith('#/save')) return; // 저장 화면은 자기 안내가 있다
  const bar = h('div', { id: 'save-banner', class: `slt-banner ${note.level}`, role: 'alert' },
    h('span', note.text),
    h('a', { href: '#/save' }, '저장 화면 열기'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { dismissed = note.level; bar.remove(); } }, '닫기'));
  document.body.append(bar);
}
if (typeof window !== 'undefined') {
  window.addEventListener('kblgm:save', (e) => { try { bannerFor(e.detail); } catch { /* 경고는 덤이다 */ } });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/save')) document.getElementById('save-banner')?.remove(); });
}

export function render(ctx) {
  const host = h('div', { class: 'stack' });
  const usageHost = h('div', { class: 'card slt-usage' });
  const msgHost = h('div', { class: 'stack' });
  let msg = null; // { kind: 'ok'|'bad', text }
  let copyText = null; // 파일 받기가 막혔을 때 보여 줄 내용

  const teamIds = ctx.data.teams.map((t) => t.id);

  function drawUsage(slots) {
    const st = storageStatus();
    const note = capacityNotice({ ok: true, status: st });
    const old = oldestManualSlot(slots);
    usageHost.replaceChildren(...[
      h('div', { class: 'slt-usage-head' }, h('h3', { style: { margin: 0 } }, '저장 공간'),
        h('span', { class: 'note' }, h('b', fmtSize(st.used)), ` / 약 ${fmtSize(QUOTA)} · ${st.percent}%`)),
      h('div', { class: `slt-meter ${st.level}`, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(100, st.percent), 'aria-label': '저장 공간 사용량' }, h('i', { style: { width: `${Math.min(100, st.ratio * 100)}%` } })),
      note ? h('p', { class: `slt-note ${note.level}` }, note.text) : h('p', { class: 'note', style: { margin: 0 } }, '브라우저가 허용하는 크기(보통 5MB)의 추정치입니다. 80%를 넘으면 알려 드립니다.'),
      note && old ? h('div', { class: 'slt-actions' },
        h('button', { class: 'btn danger', type: 'button', onclick: () => { deleteSlot(old); msg = { kind: 'ok', text: `${label(old)}를 지웠습니다` }; draw(); } }, `가장 오래된 ${label(old)} 지우기`),
        h('span', { class: 'note' }, '지우기 전에 “파일로 내보내기”로 받아 두면 나중에 가져올 수 있습니다.')) : null].filter(Boolean));
  }

  function exportSlot(slot) {
    const out = buildExport(slot);
    if (!out) { msg = { kind: 'bad', text: '내보낼 수 없는 저장입니다(비었거나 깨졌습니다)' }; return draw(); }
    if (download(out.filename, out.text)) { msg = { kind: 'ok', text: `${out.filename} 파일로 내보냈습니다(${fmtSize(out.text.length)})` }; copyText = null; }
    else { msg = { kind: 'bad', text: '파일 받기가 막혀 있습니다. 아래 내용을 복사해서 .json 파일로 저장해 두세요.' }; copyText = out.text; }
    draw();
  }

  async function importFile(file, slot) {
    if (!file) { msg = { kind: 'bad', text: '가져올 파일을 먼저 고르세요' }; return draw(); }
    const parsed = parseImport(await file.text(), { teamIds });
    if (!parsed.ok) { msg = { kind: 'bad', text: `가져오지 못했습니다: ${parsed.error}` }; return draw(); }
    try { new Session(ctx.data, parsed.game); } catch (e) { msg = { kind: 'bad', text: `가져오지 못했습니다: 게임을 다시 돌려 보니 열리지 않습니다(${e.message})` }; return draw(); }
    const taken = listSlots().find((s) => s.slot === slot)?.meta;
    if (taken && !window.confirm(`${label(slot)}에는 이미 저장이 있습니다. 덮어쓸까요?`)) return;
    if (!importToSlot(slot, parsed.game)) { msg = { kind: 'bad', text: '저장 공간이 부족해 가져오지 못했습니다. 오래된 슬롯을 지우고 다시 시도하세요.' }; return draw(); }
    msg = { kind: 'ok', text: `${label(slot)}에 가져왔습니다 — ${ctx.name(parsed.meta.teamId)} · ${parsed.meta.season} · ${parsed.meta.seasonsPlayed}시즌 완료` };
    draw();
  }

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '가져올 저장 파일' });
  const slotPick = h('select', { 'aria-label': '가져올 슬롯' }, SLOTS.filter((s) => s !== 'auto').map((s) => h('option', { value: s }, label(s))));
  const importCard = h('div', { class: 'card stack' },
    h('h3', { style: { margin: 0 } }, '파일에서 가져오기'),
    h('p', { class: 'note', style: { margin: 0 } }, '“파일로 내보내기”로 받은 .json 파일을 고르세요. 형식·버전·시드·구단을 확인한 뒤 고른 슬롯에 저장합니다.'),
    h('div', { class: 'slt-import' }, fileInput, h('label', '넣을 슬롯', slotPick),
      h('button', { class: 'btn primary', type: 'button', onclick: () => importFile(fileInput.files?.[0], slotPick.value) }, '가져오기')));

  function draw() {
    const slots = listSlots();
    drawUsage(slots);
    msgHost.replaceChildren(...[msg ? h('p', { class: `slt-msg ${msg.kind}`, role: 'status' }, msg.text) : null,
      copyText ? h('div', { class: 'card stack' }, h('textarea', { class: 'slt-copy', readonly: true, 'aria-label': '저장 내용(복사용)' }, copyText),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(copyText); msg = { kind: 'ok', text: '복사했습니다' }; } catch { msg = { kind: 'bad', text: '복사하지 못했습니다. 위 글을 직접 선택해 복사하세요.' }; } draw(); } }, '복사')) : null].filter(Boolean));
    host.replaceChildren(...slots.map(({ slot, meta, size }) => {
      const stage = meta && ({ regular: meta.day ? `정규리그 ${meta.day}일차` : '시즌 시작 전', playoffs: '플레이오프', offseason: '오프시즌' }[meta.stage] ?? '');
      return h('div', { class: 'card slot' },
        h('div', { class: 'row between' },
          h('div', h('h3', { style: { margin: 0 } }, label(slot)),
            meta ? h('div', { class: 'note' }, `${meta.gmName} 단장 · ${ctx.name(meta.teamId)} · ${meta.season} ${stage} · ${meta.seasonsPlayed}시즌 완료 · ${fmtTime(meta.savedAt)} · `, h('span', { class: 'slt-size', 'data-size': size }, fmtSize(size))) : h('div', { class: 'note' }, '비어 있음')),
          h('div', { class: 'row' },
            ctx.session && slot !== 'auto' ? h('button', { class: 'btn primary', onclick: () => { ctx.save(slot); draw(); } }, meta ? '덮어쓰기' : '여기에 저장') : null,
            meta ? h('button', { class: 'btn', onclick: () => ctx.loadSlot(slot) }, '불러오기') : null,
            meta ? h('button', { class: 'btn ghost', type: 'button', 'data-export': slot, onclick: () => exportSlot(slot) }, '파일로 내보내기') : null,
            meta && slot !== 'auto' ? h('button', { class: 'btn ghost', onclick: () => { deleteSlot(slot); draw(); } }, '삭제') : null)));
    }));
  }
  draw();
  const body = h('div', { class: ctx.session ? 'stack' : 'intro stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '저장'), h('h1', '저장 · 불러오기'))),
    ctx.session ? null : h('button', { class: 'btn ghost', onclick: () => ctx.go('title') }, '← 타이틀'),
    h('p', { class: 'note' }, '저장은 이 브라우저에만 남습니다. 시즌 중 어느 날이든, 오프시즌 어느 단계든 저장한 그 자리에서 이어집니다. 자동 저장은 조작할 때마다 갱신됩니다. 오래된 시즌은 요약만 남겨 용량을 줄이고, 파일로 내보내 두면 브라우저 데이터를 지워도 되살릴 수 있습니다.'),
    usageHost, msgHost, host, importCard);
  return { title: '저장', body };
}
