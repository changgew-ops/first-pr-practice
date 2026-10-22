// 선수별 시즌 기록 누적
export const TOTAL_KEYS = ['games', 'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];

export function emptyTotals() {
  return Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
}

// totals: Map<선수id, 합계>. box: 한 경기의 선수별 기록 배열
export function addBox(totals, box) {
  for (const line of box) {
    if (!line.minutes) continue;
    let t = totals.get(line.id);
    if (!t) { t = emptyTotals(); totals.set(line.id, t); }
    t.games += 1;
    for (const k of TOTAL_KEYS) if (k !== 'games') t[k] += line[k] ?? 0;
  }
}
