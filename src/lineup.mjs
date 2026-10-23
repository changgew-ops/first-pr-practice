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

// ---------- 부상 반영 (src/injuries.mjs) ----------
// injured: 결장 중인 선수 → 남은 결장 경기 수의 Map (또는 id Set)

/** 편성 후보: 부상 선수를 뺀 로스터. 건강한 선수가 minHealthy명보다 적으면 가장 빨리 돌아올 선수부터 부상을 안고 뛴다(playingHurt) */
export function availableRoster(roster, injured, minHealthy = 8) {
  if (!injured || !injured.size) return { roster, playingHurt: [] };
  const left = (p) => (typeof injured.get === 'function' ? injured.get(p.id) ?? 1 : 1);
  const healthy = roster.filter((p) => !injured.has(p.id));
  if (healthy.length >= minHealthy) return { roster: healthy, playingHurt: [] };
  const extra = roster.filter((p) => injured.has(p.id)).sort((a, b) => left(a) - left(b) || b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, minHealthy - healthy.length);
  return { roster: [...healthy, ...extra], playingHurt: extra.map((p) => p.id) };
}

/** 부상 선수를 뺀 자동 편성. 남은 선수가 엔트리(5+7)보다 적으면 벤치를 줄여서 편성한다 */
export function buildLineupHealthy(roster, rules, benchWeight, injured = null, minHealthy = 8) {
  const { roster: pool, playingHurt } = availableRoster(roster, injured, minHealthy);
  const { starters: nStart, bench: nBench } = rules.lineup;
  const r = pool.length >= nStart + nBench ? rules : { ...rules, lineup: { ...rules.lineup, bench: Math.max(0, pool.length - nStart) } };
  const lineup = buildLineup(pool, r, benchWeight);
  return playingHurt.length ? { ...lineup, playingHurt } : lineup;
}

/**
 * 직접 편성(선수 객체)에 부상 선수가 있으면 건강한 선수로 같은 자리(스타팅·벤치)를 메운다.
 * 후보는 OVR 높은 순이고 코스트 제한·외국 선수 동시 출전 제한을 지키는 첫 선수다.
 * 반환: { starters, bench, swaps: [{ out, in }] } 또는 (메울 수 없으면) null — 그때는 자동 편성을 쓴다
 */
export function substituteInjured(lineup, roster, injured, rules) {
  const hurt = [...lineup.starters, ...lineup.bench].filter((p) => injured.has(p.id));
  if (!hurt.length) return { starters: lineup.starters, bench: lineup.bench, swaps: [] };
  const inLineup = new Set([...lineup.starters, ...lineup.bench].map((p) => p.id));
  const pool = roster.filter((p) => !injured.has(p.id) && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
  let starters = [...lineup.starters], bench = [...lineup.bench];
  const swaps = [];
  for (const out of hurt) {
    const isStarter = starters.some((p) => p.id === out.id);
    let done = false;
    for (let i = 0; i < pool.length && !done; i++) {
      const cand = pool[i];
      const s2 = isStarter ? starters.map((p) => (p.id === out.id ? cand : p)) : starters;
      const b2 = isStarter ? bench : bench.map((p) => (p.id === out.id ? cand : p));
      if (!validateLineup(s2, b2, rules).ok) continue;
      starters = s2; bench = b2; pool.splice(i, 1); swaps.push({ out, in: cand }); done = true;
    }
    if (!done) return null;
  }
  return { starters, bench, swaps };
}
