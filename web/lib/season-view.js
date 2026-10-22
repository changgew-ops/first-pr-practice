// 시즌 화면이 쓰는 순수 가공 함수(브라우저 API 없음, node에서 테스트한다).

const pct = (w, l) => (w + l > 0 ? w / (w + l) : 0);

/** 순위표 행: 승률·경기당 득실·선두와의 게임차·플레이오프 컷(qualify위 아래 구분) 표시를 붙인다 */
export function standingsRows(standings, qualify = 6) {
  const top = standings[0];
  return standings.map((s, i) => {
    const g = s.wins + s.losses;
    return {
      ...s, rank: s.rank ?? i + 1, games: g, pct: pct(s.wins, s.losses),
      diffPerGame: g ? (s.pointsFor - s.pointsAgainst) / g : 0,
      gb: top ? ((top.wins - s.wins) + (s.losses - top.losses)) / 2 : 0,
      cut: (s.rank ?? i + 1) === qualify
    };
  });
}

/** 우리 최근 n경기 승패 칩 [{ day, win, label, title }] (오래된 순) */
export function formChips(myGames, nameOf, n = 10) {
  return myGames.slice(-n).map((g) => ({
    day: g.day, win: g.win, label: g.win ? '승' : '패',
    title: `${g.day}일차 ${g.home ? '홈' : '원정'} vs ${nameOf(g.oppId)} ${g.my}:${g.opp}${g.ot ? ` (연장 ${g.ot})` : ''}`
  }));
}

/** 현재 연승(+)/연패(-) 길이 */
export function streak(myGames) {
  let n = 0;
  for (let i = myGames.length - 1; i >= 0; i--) {
    if (i === myGames.length - 1) n = myGames[i].win ? 1 : -1;
    else if ((myGames[i].win && n > 0) || (!myGames[i].win && n < 0)) n += n > 0 ? 1 : -1;
    else break;
  }
  return n;
}

/** 경기 하나를 화면 줄로: 승자 쪽을 표시하고, 우리 구단 경기인지 알려 준다 */
export function gameRow(g, myId) {
  return {
    homeId: g.homeId, awayId: g.awayId, homePts: g.homePts, awayPts: g.awayPts, ot: g.overtimes ?? 0,
    homeWon: g.winnerId === g.homeId, mine: g.homeId === myId || g.awayId === myId, game: g
  };
}

/** 박스스코어 한 팀의 합계 줄 */
export function boxTotals(lines) {
  const sum = (k) => lines.reduce((s, p) => s + (p[k] ?? 0), 0);
  return { name: '합계', minutes: sum('minutes'), points: sum('points'), rebounds: sum('rebounds'), assists: sum('assists'), steals: sum('steals'), blocks: sum('blocks'), fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta') };
}

/**
 * 플레이오프 대진 모델. 시리즈 다섯 칸(6강 2 · 4강 2 · 결승 1)을 순서대로 돌려준다.
 *   { round: 0|1|2, name, bestOf, a, b, aLabel, bLabel, played, wins, winnerId, games }
 * 아직 안 치른 칸의 팀은 알 수 있을 때만(시드로 정해진 6강, 앞 라운드가 끝난 뒤의 4강) 채우고 나머지는 null + 라벨("4·5위 승자")
 */
export function bracketModel(seeds, series, rules) {
  const order = [...seeds].sort((x, y) => x[1] - y[1]).map(([id]) => id); // 시드 순서
  const rounds = rules.playoffs.rounds;
  const slots = [
    { round: 0, a: order[2], b: order[5], aLabel: '3위', bLabel: '6위' },
    { round: 0, a: order[3], b: order[4], aLabel: '4위', bLabel: '5위' },
    { round: 1, a: order[0], b: null, aLabel: '1위', bLabel: '4·5위 승자', from: 1 },
    { round: 1, a: order[1], b: null, aLabel: '2위', bLabel: '3·6위 승자', from: 0 },
    { round: 2, a: null, b: null, aLabel: '4강 승자', bLabel: '4강 승자' }
  ];
  const playedAt = (i) => series[i] ?? null;
  return slots.map((slot, i) => {
    const s = playedAt(i);
    const out = { ...slot, name: rounds[slot.round].name, bestOf: rounds[slot.round].bestOf, played: Boolean(s), wins: null, winnerId: null, games: [] };
    if (slot.from != null && playedAt(slot.from)) out.b = playedAt(slot.from).winnerId;
    if (i === 4) { out.a = playedAt(2)?.winnerId ?? null; out.b = playedAt(3)?.winnerId ?? null; }
    if (s) { out.a = s.higherId; out.b = s.lowerId; out.wins = s.wins; out.winnerId = s.winnerId; out.games = s.games; }
    return out;
  });
}

/** 시리즈의 경기별 점수 줄: 시리즈에서 높은 시드(higherId) 기준 좌우로 정렬 [{ n, homeId, awayId, homePts, awayPts, winnerId, ot }] */
export function seriesGameRows(s) {
  return s.games.map((g, i) => ({ n: i + 1, homeId: g.homeId, awayId: g.awayId, homePts: g.homePts, awayPts: g.awayPts, winnerId: g.winnerId, ot: g.overtimes ?? 0 }));
}

/** 시리즈 점수 문자열 "3-1" (높은 시드 기준) */
export const seriesScore = (s) => `${s.wins[s.higherId]}-${s.wins[s.lowerId]}`;

/** 정규리그 진행 버튼 목록: 남은 날수에 맞춰 자른다 */
export function advanceChoices(day, totalDays, cycle = 9) {
  const left = totalDays - day;
  if (left <= 0) return [];
  const out = [{ days: 1, label: '1일 진행' }];
  if (left > 1) out.push({ days: Math.min(cycle, left), label: `${Math.min(cycle, left)}일(한 바퀴) 진행` });
  if (left > cycle) out.push({ days: left, label: '정규리그 끝까지' });
  return out;
}
