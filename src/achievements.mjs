// 단장 업적: 시즌 기록(log)과 지금 상태에서 판정하는 순수 함수. 달성한 업적은 { 업적 id: 달성한 시즌 } 으로만 저장한다(game.achievements).
// 판정은 달성 이후에도 다시 해도 같은 결과가 나오게 쓰였다(이미 달성한 업적은 건드리지 않는다). 기준값은 rules.achievements(게임용 가정).
// ctx: { log(시즌 결과들, 오래된 것부터), my(우리 구단 id), roster(지금 우리 선수들), funds(우리 구단 자금), codexCount, mood(우리 팬 열기), trust(단장 신뢰도),
//        startSeason(시작 로스터의 카드 시즌, 예: '2026-27'), firstPrevRank(첫 시즌 직전 실제 순위, 없으면 null), rules }

const mine = (e, my) => e.standings.find((s) => s.id === my);
const inPo = (e, my) => Boolean(e.stage?.[my]);
const champ = (e, my) => e.championId === my;
const streak = (list, ok, n) => { let run = 0; for (const x of list) { run = ok(x) ? run + 1 : 0; if (run >= n) return true; } return false; };
const myAward = (e, my, key) => {
  const a = e.awards?.[key];
  const ids = Array.isArray(a) ? a : a ? [a] : [];
  return ids.filter((id) => e.lines?.[id]?.[13] === my).length;
};
const prevRankOf = (log, i, my, ctx) => (i === 0 ? ctx.firstPrevRank ?? null : mine(log[i - 1], my)?.rank ?? null);

/** 업적 목록: tier는 'bronze'(쉬움)·'silver'·'gold'(어려움). check(ctx)가 참이면 달성 */
export const ACHIEVEMENTS = [
  { id: 'season1', tier: 'bronze', name: '첫 시즌 완주', desc: '첫 시즌을 끝까지 치른다', check: (c) => c.log.length >= 1 },
  { id: 'seasons5', tier: 'silver', name: '5년 차 단장', desc: '5시즌을 치른다', check: (c) => c.log.length >= 5 },
  { id: 'seasons10', tier: 'silver', name: '장기 집권', desc: '10시즌을 치른다', check: (c) => c.log.length >= 10 },
  { id: 'seasons20', tier: 'gold', name: '농구 대통령', desc: '20시즌을 치른다', check: (c) => c.log.length >= 20 },
  { id: 'po1', tier: 'bronze', name: '봄 농구 입성', desc: '플레이오프에 처음 진출한다', check: (c) => c.log.some((e) => inPo(e, c.my)) },
  { id: 'po5', tier: 'silver', name: '단골 손님', desc: '플레이오프에 통산 5번 진출한다', check: (c) => c.log.filter((e) => inPo(e, c.my)).length >= 5 },
  { id: 'rank1', tier: 'silver', name: '정규리그 1위', desc: '정규리그 1위로 마친다', check: (c) => c.log.some((e) => mine(e, c.my)?.rank === 1) },
  { id: 'wins40', tier: 'silver', name: '40승 시즌', desc: '한 시즌에 40승 이상', check: (c) => c.log.some((e) => (mine(e, c.my)?.wins ?? 0) >= 40) },
  { id: 'final', tier: 'silver', name: '챔프전 무대', desc: '챔피언결정전에 오른다', check: (c) => c.log.some((e) => e.stage?.[c.my] === '결승' || champ(e, c.my)) },
  { id: 'title1', tier: 'gold', name: '첫 우승', desc: '챔피언결정전에서 우승한다', check: (c) => c.log.some((e) => champ(e, c.my)) },
  { id: 'title3', tier: 'gold', name: '우승 3회', desc: '통산 우승 3회', check: (c) => c.log.filter((e) => champ(e, c.my)).length >= 3 },
  { id: 'threepeat', tier: 'gold', name: '3연패 달성', desc: '챔피언결정전을 3시즌 연속 우승한다', check: (c) => streak(c.log, (e) => champ(e, c.my), 3) },
  { id: 'underdog', tier: 'silver', name: '언더독의 반란', desc: '직전 시즌 9위 이하였는데 플레이오프에 오른다', check: (c) => c.log.some((e, i) => (prevRankOf(c.log, i, c.my, c) ?? 0) >= 9 && inPo(e, c.my)) },
  { id: 'cinderella', tier: 'gold', name: '신데렐라', desc: '직전 시즌 8위 이하였는데 우승한다', check: (c) => c.log.some((e, i) => (prevRankOf(c.log, i, c.my, c) ?? 0) >= 8 && champ(e, c.my)) },
  { id: 'profit3', tier: 'silver', name: '흑자 경영', desc: '3시즌 연속 흑자', check: (c) => streak(c.log, (e) => (e.ledger?.[c.my]?.net ?? -1) >= 0, 3) },
  { id: 'rich', tier: 'silver', name: '곳간이 넘친다', desc: '구단 자금이 100억 원 이상', check: (c) => (c.funds ?? 0) >= c.rules.achievements.cash.eok },
  { id: 'capClean3', tier: 'bronze', name: '캡 안에서', desc: '3시즌 연속 소프트캡 기금 없이 운영', check: (c) => streak(c.log, (e) => !(e.ledger?.[c.my]?.penalty > 0), 3) },
  { id: 'mvp', tier: 'gold', name: '우리 팀 MVP', desc: '우리 선수가 정규시즌 MVP를 받는다', check: (c) => c.log.some((e) => myAward(e, c.my, 'mvp') > 0) },
  { id: 'rookieAward', tier: 'silver', name: '신인상 배출', desc: '우리 선수가 신인상을 받는다', check: (c) => c.log.some((e) => myAward(e, c.my, 'rookie') > 0) },
  { id: 'best5x2', tier: 'silver', name: '베스트5 듀오', desc: '한 시즌에 우리 선수 2명이 베스트5에 든다', check: (c) => c.log.some((e) => myAward(e, c.my, 'best5') >= 2) },
  { id: 'star80', tier: 'silver', name: '슈퍼스타 보유', desc: 'OVR 95 이상 선수를 보유한다', check: (c) => (c.roster ?? []).some((p) => p.ovr >= c.rules.achievements.stars.ovr) },
  { id: 'pastCards', tier: 'bronze', name: '타임머신 로스터', desc: '과거 시즌 카드 선수를 5명 이상 보유한다', check: (c) => (c.roster ?? []).filter((p) => p.card && p.card.season !== c.startSeason).length >= c.rules.achievements.cards.pastCardPlayers },
  { id: 'trade1', tier: 'bronze', name: '첫 트레이드', desc: '트레이드를 성사시킨다', check: (c) => c.log.some((e) => (e.report?.trades?.length ?? 0) > 0) },
  { id: 'goalsAll', tier: 'silver', name: '모기업의 흡족', desc: '한 시즌의 모기업 목표를 모두 달성한다', check: (c) => c.log.some((e) => e.eval?.goals?.length && e.eval.goals.every((g) => g.met)) },
  { id: 'trust90', tier: 'gold', name: '전폭적 신뢰', desc: '단장 신뢰도 90 이상', check: (c) => (c.trust ?? 0) >= 90 },
  { id: 'fans70', tier: 'silver', name: '팬이 열광한다', desc: '팬 열기 70 이상', check: (c) => (c.mood ?? 0) >= c.rules.achievements.fans.high },
  { id: 'codex50', tier: 'bronze', name: '도감 수집가', desc: '카드 도감 50장 수집', check: (c) => (c.codexCount ?? 0) >= c.rules.achievements.codex.small },
  { id: 'codex120', tier: 'gold', name: '카드 박물관', desc: '카드 도감 120장 수집', check: (c) => (c.codexCount ?? 0) >= c.rules.achievements.codex.big }
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** 새로 달성한 업적 id 목록(이미 달성한 것은 제외) */
export function newAchievements(have, ctx) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (have?.[a.id]) continue;
    let ok = false;
    try { ok = Boolean(a.check(ctx)); } catch { ok = false; }
    if (ok) out.push(a.id);
  }
  return out;
}
