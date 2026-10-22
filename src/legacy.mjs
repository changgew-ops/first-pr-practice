// 구단의 이력(전통): 실제 시즌 이력(1997~2025-26)에서 시작해 시뮬레이션한 시즌을 이어 붙인다.
// 이력은 게임에서 두 가지로 쓰인다: 구단 수입(팬 기반)과 FA·재계약 선수의 구단 선호(명문 구단 프리미엄).
// 순수 함수. 상태는 { [구단 id]: [{ season, winPct, stage, regularChampion }] } 이고 league.legacy에 들어간다.

const STAGE_RANK = { 우승: 4, 결승: 3, '4강': 2, '6강': 1 };

/** 실제 이력의 한 시즌에서 구단이 플레이오프 어디까지 갔는지(없으면 null) */
export function stageOfHistory(season, franchiseId) {
  if (season.championId === franchiseId) return '우승';
  const po = season.playoffs;
  if (!po) return null;
  const inRound = (name) => po.rounds.find((r) => r.name === name)?.series.some((s) => s.a === franchiseId || s.b === franchiseId);
  if (inRound('결승')) return '결승';
  if (inRound('4강') || [1, 2].includes(po.seeds[franchiseId])) return '4강';
  if (inRound('6강')) return '6강';
  return null;
}

/** 실제 시즌 이력(history.seasons)에서 구단별 기록을 만든다 */
export function seedLegacy(historySeasons, teamData) {
  const legacy = Object.fromEntries(teamData.map((t) => [t.id, []]));
  for (const s of historySeasons) {
    // 코로나로 중단된 시즌처럼 경기 수가 모자란 시즌도 승률은 그대로 쓴다
    for (const row of s.teams) {
      if (!legacy[row.franchiseId]) continue;
      legacy[row.franchiseId].push({
        season: s.season,
        winPct: row.wins / (row.wins + row.losses),
        stage: stageOfHistory(s, row.franchiseId),
        regularChampion: row.rank === 1 && s.season !== '2019-20'
      });
    }
  }
  return legacy;
}

/** 시뮬레이션한 한 시즌을 이어 붙인다. result = playSeason 결과(standings, playoffs, championId) */
export function appendSeason(legacy, season, result, rules) {
  const games = rules.regularSeasonGames;
  const next = {};
  const stageOf = (id) => {
    const po = result.playoffs;
    if (!po) return null;
    if (po.championId === id) return '우승';
    const fin = po.series.at(-1);
    if ([fin.higherId, fin.lowerId].includes(id)) return '결승';
    if (po.series.slice(2, 4).some((s) => [s.higherId, s.lowerId].includes(id))) return '4강';
    if (po.series.slice(0, 2).some((s) => [s.higherId, s.lowerId].includes(id))) return '6강';
    return null;
  };
  const top = result.standings[0]?.id;
  for (const [id, list] of Object.entries(legacy)) {
    const rec = result.standings.find((s) => s.id === id);
    next[id] = [...list, { season, winPct: rec ? rec.wins / games : 0.5, stage: stageOf(id), regularChampion: id === top }];
  }
  return next;
}

/**
 * 전통 점수(0~1). 최근 성적(승률) + 최근 플레이오프 성적 + 통산 우승.
 * 구단 기록이 없으면 0.5(중립)라 이력이 없는 리그에서는 아무 영향이 없다.
 */
export function prestigeOf(records, rules) {
  const L = rules.legacy;
  if (!records?.length) return 0.5;
  const recent = records.slice(-L.window);
  const avg = (list, f) => list.reduce((s, r) => s + f(r), 0) / list.length;
  const form = Math.min(1, Math.max(0, (avg(recent, (r) => r.winPct) - L.winPctFloor) / (L.winPctCeil - L.winPctFloor)));
  const playoffs = avg(recent, (r) => (r.stage ? L.stagePoints[r.stage] : 0));
  const titles = records.filter((r) => r.stage === '우승').length;
  const regular = records.filter((r) => r.regularChampion).length;
  const titleScore = Math.min(1, (titles + L.regularTitleWeight * regular) / L.titlesCap);
  return L.weights.form * form + L.weights.playoffs * playoffs + L.weights.titles * titleScore;
}

/** 구단별 전통 점수와 설명용 요약 */
export function prestigeTable(legacy, rules) {
  return Object.fromEntries(Object.entries(legacy ?? {}).map(([id, records]) => [id, {
    score: prestigeOf(records, rules),
    titles: records.filter((r) => r.stage === '우승').length,
    regularTitles: records.filter((r) => r.regularChampion).length,
    recentWinPct: records.slice(-rules.legacy.window).reduce((s, r, _, a) => s + r.winPct / a.length, 0)
  }]));
}

export const STAGES = Object.keys(STAGE_RANK);
