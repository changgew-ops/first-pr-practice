// 저장 슬롯: 브라우저 로컬 저장소. 막혀 있어도(사생활 보호 모드 등) 게임은 돌아가야 하므로 모든 접근을 감싼다.
// 슬롯: 'auto'(자동 저장) + '1' '2' '3'(직접 저장). 저장하는 것은 세션 상태(session.game) — 시드·조작·결정 기록이라 크지 않다.
import { seasonLabel } from './game.js';

const PREFIX = 'kblgm.v2.slot.';
export const SLOTS = ['auto', '1', '2', '3'];

const metaOf = (game) => ({
  gmName: game.gm?.name ?? '단장', teamId: game.managerId, season: seasonLabel(game.league.season), stage: game.stage, day: game.day,
  seasonsPlayed: game.log.length, savedAt: Date.now()
});

export function listSlots() {
  return SLOTS.map((slot) => {
    try { const raw = localStorage.getItem(PREFIX + slot); if (!raw) return { slot, meta: null }; const { meta } = JSON.parse(raw); return { slot, meta, size: raw.length }; } catch { return { slot, meta: null }; }
  });
}
/** 슬롯의 게임 상태(없거나 깨졌으면 null) */
export function readSlot(slot) {
  try { const raw = localStorage.getItem(PREFIX + slot); return raw ? JSON.parse(raw).game : null; } catch { return null; }
}
/** 저장. 실패(저장 공간 부족·막힘)하면 false */
export function writeSlot(slot, game) {
  try { localStorage.setItem(PREFIX + slot, JSON.stringify({ meta: metaOf(game), game })); return true; } catch { return false; }
}
export function deleteSlot(slot) {
  try { localStorage.removeItem(PREFIX + slot); } catch { /* 무시 */ }
}
/** 가장 최근에 저장한 슬롯 { slot, meta } 또는 null */
export function latestSlot() {
  return listSlots().filter((s) => s.meta).sort((a, b) => b.meta.savedAt - a.meta.savedAt)[0] ?? null;
}
