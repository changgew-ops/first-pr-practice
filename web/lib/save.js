// 저장: 브라우저 로컬 저장소. 막혀 있어도(사생활 보호 모드 등) 게임은 돌아가야 하므로 모든 접근을 감싼다.
const KEY = 'kblgm.save.v1';
export function loadSave() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function writeSave(game) {
  try { localStorage.setItem(KEY, JSON.stringify(game)); return true; } catch { return false; }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
