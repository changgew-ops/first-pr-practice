// 구단 경기장: data/arenas.csv(구단 id, 경기장, capacity, source, note) → 구단 데이터에 venue로 붙인다.
// 수용 인원(capacity)은 확인한 값만 넣는다. 빈 칸은 "자료 없음"이고 관중 모델은 상한 없이 계산한다.
import { splitCsvLine } from './real-players.mjs';

/** csv 텍스트 → [{ teamId, arena, capacity|null, source, note }] */
export function parseArenasCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = splitCsvLine(lines.shift()).map((h) => h.trim());
  return lines.map((l) => {
    const c = splitCsvLine(l);
    const row = Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
    const cap = row.capacity === '' ? null : Number(row.capacity);
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) throw new Error(`${row.teamId}: 수용 인원이 올바르지 않습니다 "${row.capacity}"`);
    return { teamId: row.teamId, arena: row.arena, capacity: cap, source: row.source || null, note: row.note || null };
  });
}

/** 구단 데이터에 venue({ capacity, source, note })를 붙인 새 배열. 행이 없는 구단은 capacity null */
export function applyArenas(teams, rows = []) {
  const byId = new Map(rows.map((r) => [r.teamId, r]));
  return teams.map((t) => {
    const r = byId.get(t.id);
    return { ...t, venue: { capacity: r?.capacity ?? null, source: r?.source ?? null, note: r?.note ?? null } };
  });
}

export const capacityOf = (team) => team?.venue?.capacity ?? null;
