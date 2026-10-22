// 저장 슬롯: 자동 저장 + 직접 저장 3칸. 저장·불러오기·삭제.
import { h } from '../lib/dom.js';
import { listSlots, deleteSlot, SLOTS } from '../lib/save.js';

const fmtTime = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const label = (slot) => (slot === 'auto' ? '자동 저장' : `슬롯 ${slot}`);

export function render(ctx) {
  const host = h('div', { class: 'stack' });
  const draw = () => {
    host.replaceChildren(...listSlots().map(({ slot, meta, size }) => {
      const stage = meta && ({ regular: meta.day ? `정규리그 ${meta.day}일차` : '시즌 시작 전', playoffs: '플레이오프', offseason: '오프시즌' }[meta.stage] ?? '');
      return h('div', { class: 'card slot' },
        h('div', { class: 'row between' },
          h('div', h('h3', { style: { margin: 0 } }, label(slot)),
            meta ? h('div', { class: 'note' }, `${meta.gmName} 단장 · ${ctx.name(meta.teamId)} · ${meta.season} ${stage} · ${meta.seasonsPlayed}시즌 완료 · ${fmtTime(meta.savedAt)} · ${(size / 1024).toFixed(0)}KB`) : h('div', { class: 'note' }, '비어 있음')),
          h('div', { class: 'row' },
            ctx.session && slot !== 'auto' ? h('button', { class: 'btn primary', onclick: () => { ctx.save(slot); draw(); } }, meta ? '덮어쓰기' : '여기에 저장') : null,
            meta ? h('button', { class: 'btn', onclick: () => ctx.loadSlot(slot) }, '불러오기') : null,
            meta && slot !== 'auto' ? h('button', { class: 'btn ghost', onclick: () => { deleteSlot(slot); draw(); } }, '삭제') : null)));
    }));
  };
  draw();
  const body = h('div', { class: ctx.session ? 'stack' : 'intro stack' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '저장'), h('h1', '저장 · 불러오기'))),
    ctx.session ? null : h('button', { class: 'btn ghost', onclick: () => ctx.go('title') }, '← 타이틀'),
    h('p', { class: 'note' }, '저장은 이 브라우저에만 남습니다. 시즌 중 어느 날이든, 오프시즌 어느 단계든 저장한 그 자리에서 이어집니다. 자동 저장은 조작할 때마다 갱신됩니다.'),
    host);
  return { title: '저장', body };
}
