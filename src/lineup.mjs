// 라인업 검증: 인원 구성과 코스트 합계 제한을 확인한다.
export function lineupCost(players) {
  return players.reduce((sum, p) => sum + p.cost, 0);
}

export function validateLineup(starters, bench, rules) {
  const { starters: nStart, bench: nBench, costCap } = rules.lineup;
  const errors = [];
  if (starters.length !== nStart) errors.push(`스타팅은 ${nStart}명이어야 합니다 (현재 ${starters.length}명)`);
  if (bench.length !== nBench) errors.push(`벤치는 ${nBench}명이어야 합니다 (현재 ${bench.length}명)`);

  const all = [...starters, ...bench];
  if (new Set(all.map((p) => p.id)).size !== all.length) errors.push('같은 선수가 중복되어 있습니다');

  const foreignCount = starters.filter((p) => p.origin === 'foreign').length;
  if (foreignCount > rules.foreignPlayers.onCourt) {
    errors.push(`외국 선수는 동시에 ${rules.foreignPlayers.onCourt}명까지만 출전할 수 있습니다`);
  }

  const totalCost = lineupCost(all);
  if (totalCost > costCap) errors.push(`코스트 합계 ${totalCost}가 제한 ${costCap}을 넘습니다`);
  return { ok: errors.length === 0, errors, totalCost };
}

// AI 구단용 자동 편성: 코스트 제한 안에서 점수가 가장 높은 10명을 고른다.
// 점수 = 스타팅 OVR 합 + 벤치 OVR 합 × benchWeight (스타팅 = 고른 10명 중 OVR 상위 5명)
export function buildLineup(roster, rules, benchWeight = 0.45) {
  const { starters: nStart, bench: nBench, costCap } = rules.lineup;
  const size = nStart + nBench;
  const sorted = [...roster].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
  let best = null;

  function visit(start, chosen, cost) {
    if (cost > costCap) return;
    if (chosen.length === size) {
      const top = chosen.slice(0, nStart);
      if (top.filter((p) => p.origin === 'foreign').length > rules.foreignPlayers.onCourt) return;
      const score = top.reduce((s, p) => s + p.ovr, 0)
        + chosen.slice(nStart).reduce((s, p) => s + p.ovr, 0) * benchWeight;
      if (!best || score > best.score) best = { score, chosen: [...chosen] };
      return;
    }
    for (let i = start; i < sorted.length; i++) {
      if (sorted.length - i < size - chosen.length) break;
      chosen.push(sorted[i]);
      visit(i + 1, chosen, cost + sorted[i].cost);
      chosen.pop();
    }
  }
  visit(0, [], 0);
  if (!best) {
    // 코스트 제한을 지키는 편성이 없으면(고액 카드를 많이 모은 구단) 코스트가 가장 낮은 선수들로 편성한다. 제한 초과는 감수하고 경기는 계속한다.
    if (roster.length < size) throw new Error('라인업을 만들 선수가 모자랍니다');
    const cheap = [...roster].sort((a, b) => a.cost - b.cost || b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, size).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    const starters = [], bench = [];
    for (const p of cheap) {
      const foreign = starters.filter((x) => x.origin === 'foreign').length;
      if (starters.length < nStart && !(p.origin === 'foreign' && foreign >= rules.foreignPlayers.onCourt)) starters.push(p); else bench.push(p);
    }
    return { starters, bench, overCost: true };
  }
  return { starters: best.chosen.slice(0, nStart), bench: best.chosen.slice(nStart) };
}
