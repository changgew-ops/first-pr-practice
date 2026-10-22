// 팀 이력 요약(순수 함수). 브라우저 화면도 쓰므로 node 모듈을 가져오지 않는다. 파일에서 읽는 loadHistory는 history.mjs에 있다.

/** 플레이오프 기록이 있는 시즌의 우승·준우승 */
export function champions(seasons) {
  return seasons.filter((s) => s.playoffs).map((s) => {
    const final = s.playoffs.rounds.at(-1).series[0];
    return {
      season: s.season,
      championId: s.playoffs.championId,
      runnerUpId: s.playoffs.runnerUpId,
      score: final.winner === final.a ? `${final.winsA}-${final.winsB}` : `${final.winsB}-${final.winsA}`
    };
  });
}

/**
 * 구단별 통산 요약. 우승·결승·플레이오프 횟수는 플레이오프 화면이 있는 시즌(2007-08~, 2019-20 제외)만 센다.
 * 시즌 수·승률·최고/최저 순위는 모든 시즌을 센다.
 */
export function franchiseSummary({ seasons, franchises }) {
  const withPlayoffs = seasons.filter((s) => s.playoffs);
  return franchises.map((f) => {
    const rows = seasons.map((s) => ({ s, r: s.teams.find((t) => t.franchiseId === f.id) })).filter((x) => x.r);
    const wins = rows.reduce((a, x) => a + x.r.wins, 0);
    const losses = rows.reduce((a, x) => a + x.r.losses, 0);
    const ranks = rows.map((x) => x.r.rank);
    const po = withPlayoffs.filter((s) => f.id in s.playoffs.seeds);
    return {
      id: f.id,
      name: f.name,
      seasons: rows.length,
      wins,
      losses,
      winPct: wins / (wins + losses),
      bestRank: Math.min(...ranks),
      worstRank: Math.max(...ranks),
      firstPlaces: rows.filter((x) => x.r.rank === 1).length,
      titles: withPlayoffs.filter((s) => s.playoffs.championId === f.id).map((s) => s.season),
      finals: withPlayoffs.filter((s) => [s.playoffs.championId, s.playoffs.runnerUpId].includes(f.id)).length,
      playoffAppearances: po.length,
      names: f.names
    };
  });
}

/** 한 구단의 최근 N시즌 순위·승패 (오래된 순) */
export function recentForm({ seasons }, franchiseId, n = 5) {
  return seasons.slice(-n).map((s) => {
    const r = s.teams.find((t) => t.franchiseId === franchiseId);
    return r ? { season: s.season, rank: r.rank, wins: r.wins, losses: r.losses } : null;
  }).filter(Boolean);
}
