// 팀의 "유효 전력"을 계산하는 단일 출처. 경기 엔진(src/season-run.mjs)이 실제로 경기에 쓰는 보정(team.mods)도,
// 화면의 전력 표시도, 시즌 프리뷰(src/preview.mjs)의 확률 입력도 모두 이 파일의 함수를 거친다 — 화면마다 따로 계산하지 않는다.
//
// 용어(화면 표기도 이 구분을 따른다):
//   baseOvr  기본 전력: 실제 출전 편성(직접 편성·휴식·부상 대체 반영)의 OVR 합성(스타팅 평균 70% + 벤치 평균 30%). 능력치가 만든 값이다.
//   mods     이번 경기에만 적용되는 보정(점수): coach(감독의 로테이션 운영), tactic(전술 적합도 × 감독의 전술 이해), cond(컨디션 손실, 리그 평균과의 차이).
//            manager(단장 보정: 우리 구단에만, rules.protagonist), synergyTeam·synergyYear(시너지 칸, src/synergy.mjs: 모든 구단).
//            edge = 모든 항목의 합. 그 팀의 기대 득점에 더해지는 점수라 선수의 성장 변화(ovrWas 대비 "(+N)")와는 다른 종류다.
//   effective 유효 전력 = baseOvr + edge ÷ pointsPerPower. edge(득점 점수)를 OVR 전력과 같은 눈금으로 옮긴 값이다.
//   pointsPerPower: 전력 1이 경기 득점 차이로 몇 점인지. 편성의 (공격+수비) 점수가 전력 1당 qPerPower만큼 오르고 득점 차이는 ratingScale × 그 값이라 qPerPower × ratingScale(규칙값 effective, 게임용 보정값).
// 순수 함수만 둔다(파일·브라우저 API 없음).
import { legacyOvr } from './rating.mjs';
import { leagueRefs, chooseAuto, tacticMods, tacticList } from './tactics.mjs';
import { lineupCondScore, condEdge } from './condition.mjs';
import { rotationEdge, tacMult } from './coaching.mjs';
import { synergyOf, synergyOn, synergyParts } from './synergy.mjs';

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 기본 전력: 스타팅 OVR 평균 70% + 벤치 OVR 평균 30%.
 * 팀 단위 지표라서 선수 OVR을 예전 눈금(legacyOvr, src/rating.mjs)으로 되돌려 평균한다: 선수 OVR 눈금을 100까지 늘려도 전력 숫자와
 * 전력→득점 환산(qPerPower)·시즌 프리뷰 확률이 그대로 맞는다(늘린 눈금의 평균은 스타가 많은 팀을 과대평가해 득점과의 선형 관계가 깨진다).
 */
export function powerOfLineup(lineup) {
  const sum = (l) => l.reduce((s, p) => s + legacyOvr(p.ovr), 0);
  return sum(lineup.starters) / lineup.starters.length * 0.7 + sum(lineup.bench) / lineup.bench.length * 0.3;
}

/** 전력 1이 경기 기대 득점 차이로 몇 점인가 */
export const pointsPerPower = (rules) => (rules.effective?.qPerPower ?? 1.83) * rules.simulation.ratingScale;

/**
 * 모든 팀의 경기 보정을 한 번에 계산한다(엔진의 attachMods와 같은 식: 전술 적합도 기준은 리그 평균이라 팀 전체가 함께 필요하다).
 * teams: [{ id, lineup: { starters, bench } }]
 * ctx: { rules, staff(구단 id → { head, … } 또는 null), manager(우리 구단 id), tacticChoice(우리 구단이 고른 전술 id 또는 null),
 *        condition(컨디션 보정을 지금 적용하는가), cond(Map 선수 id → 컨디션), meanIds(컨디션 평균을 낼 구단 id 집합, 없으면 전체),
 *        protagonist(우리 구단에 단장 보정을 주는가: 새 게임의 "초보 도움" 옵션, 옛 저장은 꺼짐),
 *        baseRoster(시작 로스터 표식 id → 시작 소속 구단: 시너지에서 시작 멤버를 빼는 데 쓴다, src/synergy.mjs) }
 * 반환: { mods: Map(구단 id → { pace, three, reb, to, oppTo, drain, edge, parts: { coach, tactic, cond }, tactic?, fit? }), refs(전술 기준 점수 또는 null) }
 * 감독·전술·컨디션이 모두 꺼져 있으면 mods는 비어 있다(경기 계산이 보정 도입 전과 같다).
 */
export function computeTeamMods(teams, ctx) {
  const { rules, staff = null, manager = null, tacticChoice = null, condition = false, cond = new Map(), meanIds = null, protagonist = false, baseRoster = null } = ctx;
  const coachingEnabled = Boolean(rules.coaching?.enabled && staff), tacticsEnabled = Boolean(rules.tactics?.enabled), condEnabled = Boolean(rules.condition?.enabled);
  const out = new Map();
  const protagonistEdge = protagonist && manager && rules.protagonist?.enabled ? rules.protagonist.edge ?? 0 : 0;
  const synergyEnabled = synergyOn(rules);
  if (!coachingEnabled && !tacticsEnabled && !condEnabled && !protagonistEdge && !synergyEnabled) return { mods: out, refs: null };
  const refs = tacticsEnabled ? leagueRefs(teams.map((t) => t.lineup), rules) : null;
  const scores = condition ? new Map(teams.map((t) => [t.id, lineupCondScore(t.lineup, cond, rules)])) : null;
  const meanOf = scores && meanIds ? teams.filter((t) => meanIds.has(t.id)) : teams;
  const mean = scores ? meanOf.reduce((a, t) => a + scores.get(t.id), 0) / Math.max(1, meanOf.length) : 0;
  for (const t of teams) {
    const st = staff?.[t.id];
    const parts = { coach: 0, tactic: 0, cond: 0 };
    const mods = { pace: 1, three: 1, reb: 1, to: 1, oppTo: 1, drain: 1, edge: 0 };
    if (coachingEnabled) parts.coach = rotationEdge(st.head, rules);
    if (tacticsEnabled) {
      const id = t.id === manager && tacticChoice ? tacticChoice : chooseAuto(t.lineup, rules, refs);
      const tm = tacticMods(id, t.lineup, rules, st ? tacMult(st.head, rules) : 1, refs);
      if (tm) { Object.assign(mods, { pace: tm.pace, three: tm.three, reb: tm.reb, to: tm.to, oppTo: tm.oppTo }); mods.drain = tacticList(rules).find((x) => x.id === tm.id)?.drain ?? 1; mods.tactic = tm.id; mods.fit = tm.fit; parts.tactic = tm.edge; }
    }
    if (scores) parts.cond = condEdge(scores.get(t.id), mean, rules);
    if (t.id === manager && protagonistEdge) parts.manager = protagonistEdge;
    if (synergyEnabled) {
      const slots = synergyOf([...t.lineup.starters, ...t.lineup.bench], rules, baseRoster);
      Object.assign(parts, synergyParts(slots));
      mods.synergy = slots;
    }
    mods.edge = Math.round(Object.values(parts).reduce((a, v) => a + v, 0) * 100) / 100;
    mods.parts = parts;
    out.set(t.id, mods);
  }
  return { mods: out, refs };
}

/** 한 팀의 유효 전력 요약: { baseOvr, edge, parts, tactic, fit, effective, pointsPerPower }. mods가 없으면 보정 0 */
export function effectiveOf(lineup, mods, rules) {
  const baseOvr = powerOfLineup(lineup);
  const edge = mods?.edge ?? 0;
  const ppp = pointsPerPower(rules);
  return {
    baseOvr: round2(baseOvr), edge, parts: { coach: mods?.parts?.coach ?? 0, tactic: mods?.parts?.tactic ?? 0, cond: mods?.parts?.cond ?? 0, ...Object.fromEntries(Object.entries(mods?.parts ?? {}).filter(([k]) => k !== 'coach' && k !== 'tactic' && k !== 'cond')) },
    synergy: mods?.synergy ?? [],
    tactic: mods?.tactic ?? null, fit: mods?.fit ?? 0, pointsPerPower: round2(ppp),
    effective: round2(baseOvr + edge / ppp)
  };
}
