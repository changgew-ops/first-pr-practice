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
