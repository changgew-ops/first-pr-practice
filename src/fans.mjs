// 팬 열기: 구단별 "요즘 분위기"(0~100). 관중(src/funds.mjs)과 FA 제안 호감(src/freeagency.mjs)에 작게 반영된다.
// 관중 상태의 팬 기반(league.att.fan, 2023-24 집계에서 시작)은 느리게 변하는 구단의 크기이고, 팬 열기는 해마다 성적·스타·연패로 움직이는 단기 분위기다.
// 상태는 league.att.mood = { [구단 id]: 값 }. 없으면(이전 저장·첫 시즌) 모두 rules.fans.start(중립 50)이고 그때 효과는 0이다.
// 값은 rules.fans(게임용 가정, _note). 순수 함수만 있다.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

/** 구단의 팬 열기(상태가 없으면 중립) */
export const moodOf = (att, teamId, rules) => att?.mood?.[teamId] ?? rules.fans?.start ?? 50;

/** 열기 → -1(0점) ~ +1(100점) */
const unit = (mood, rules) => (mood - (rules.fans?.start ?? 50)) / 50;

/** 관중 배수: 1 ± attendance × (열기 − 50) / 50. 규칙이 없거나 중립이면 정확히 1 */
export function fanFactor(mood, rules) {
  const k = rules.fans?.attendance;
  return k ? 1 + k * unit(mood, rules) : 1;
}

/** FA 선수가 이 구단 제안에 더하는 호감 점수(offerScore에 더한다): ± freeAgency × (열기 − 50) / 50 */
export function fanAppeal(mood, rules) {
  const k = rules.fans?.freeAgency;
  return k ? k * unit(mood, rules) : 0;
}

/** 플레이오프 도달 단계: 우승·결승·4강·6강, 못 올랐으면 null */
function stageOf(playoffs, id) {
  if (!playoffs) return null;
  if (playoffs.championId === id) return '우승';
  const s = playoffs.series;
  const has = (list) => list.some((x) => x.higherId === id || x.lowerId === id);
  if (has(s.slice(4))) return '결승';
  if (has(s.slice(2, 4))) return '4강';
  if (has(s.slice(0, 2))) return '6강';
  return null;
}

export const initialMood = (teamData, rules) => Object.fromEntries(teamData.map((t) => [t.id, rules.fans?.start ?? 50]));

/**
 * 한 시즌이 끝난 뒤의 팬 열기. 구단마다 변화량(delta) =
 *   (승률 − 0.5) × perWinPct + 플레이오프 단계 점수 + 스타 보유(시즌 끝 OVR star.ovr 이상 1명당 perStar, 최대 max)
 *   − 스타 이탈(시즌 시작 때 그 구단 소속이던 스타가 시즌 끝에 다른 구단이거나 없는 경우 1명당 perStar, 최대 max) − 긴 연패(streak.from 경기를 넘긴 만큼 perGame, 최대 max)
 * 다음 값 = 이전 값 + delta + reversion × (start − 이전 값), min~max로 자른다.
 * ctx: { standings, playoffs, teamData, startPlayers(시즌 시작 선수들), endPlayers(시즌 끝 선수들), streaks({ 구단 id: 최장 연패 }) }
 */
export function advanceMood(prev, { standings, playoffs, teamData, startPlayers = [], endPlayers = [], streaks = {} }, rules) {
  const f = rules.fans;
  if (!f) return prev ?? null;
  const out = {};
  const endTeam = new Map(endPlayers.map((p) => [p.id, p.teamId]));
  for (const t of teamData) {
    const rec = standings.find((r) => r.id === t.id);
    const winPct = rec ? rec.wins / Math.max(1, rec.wins + rec.losses) : 0.5;
    const stars = endPlayers.filter((p) => p.teamId === t.id && p.ovr >= f.star.ovr).length;
    const lost = startPlayers.filter((p) => p.teamId === t.id && p.ovr >= f.star.ovr && endTeam.get(p.id) !== t.id).length;
    const streakOver = Math.max(0, (streaks[t.id] ?? 0) - f.streak.from + 1);
    const delta = (winPct - 0.5) * f.perWinPct
      + (f.stage[stageOf(playoffs, t.id) ?? 'none'] ?? 0)
      + Math.min(f.star.max, stars * f.star.perStar)
      - Math.min(f.starLoss.max, lost * f.starLoss.perStar)
      - Math.min(f.streak.max, streakOver * f.streak.perGame);
    const before = prev?.[t.id] ?? f.start;
    out[t.id] = round1(clamp(before + delta + f.reversion * (f.start - before), f.min, f.max));
  }
  return out;
}

/** 팬 열기 단계 이름(홈 화면용) */
export function moodTier(mood) {
  if (mood >= 80) return '열광';
  if (mood >= 65) return '뜨거움';
  if (mood >= 45) return '보통';
  if (mood >= 30) return '식음';
  return '냉담';
}
