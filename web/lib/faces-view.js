// 얼굴 사진 상태 표시(작은 줄/카드): 폴더를 찾았는지, 사진이 몇 명인지, 안 나오는 이유가 무엇인지 한국어로 알려 준다.
// 저장 화면 아래와 홈 맨 아래에 붙인다. 진단은 web/lib/faces.js가 모은다.
import { h } from './dom.js';
import { loadFaces, onFaceDiagnostics, describeDiagnostics, linkedStats } from './faces.js';

/** ctx: 화면 컨텍스트(선수 목록은 ctx.session?.players ?? ctx.data.players). compact면 한 줄만 */
export function faceStatusEl(ctx, { compact = false } = {}) {
  const host = h('div', { class: `face-status${compact ? ' compact' : ''}`, role: 'status', 'aria-live': 'polite' });
  const players = () => ctx.session?.players ?? ctx.data?.players ?? [];
  let off = null, wasConnected = false;
  const draw = (d) => {
    if (host.isConnected) wasConnected = true;
    else if (wasConnected) { off?.(); return; } // 화면에서 사라졌으면 더 이상 갱신하지 않는다
    const t = describeDiagnostics(d, { linked: d.status === 'ready' ? linkedStats(players()) : null });
    host.dataset.drawn = '1';
    host.dataset.level = t.level;
    const kids = [h('b', { class: 'face-status-title' }, `얼굴 사진: ${compact && t.short ? t.short : t.title}`)];
    if (!compact) for (const l of t.lines) kids.push(h('div', { class: 'note' }, l));
    else if (t.level !== 'ok' && t.lines[0]) kids.push(h('span', { class: 'note' }, ` — ${t.lines[0]}`));
    host.replaceChildren(...kids);
  };
  off = onFaceDiagnostics(draw);
  loadFaces(); // 아직 한 번도 확인하지 않았다면 지금 확인한다
  return host;
}
