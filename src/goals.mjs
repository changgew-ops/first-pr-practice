// 모기업 목표와 단장 신뢰도. 시즌 시작에 목표 3개를 받고(성적 2 + 재정·연봉·신인 출전 중 1), 시즌이 끝나면 달성 여부로 신뢰도가 오르내린다.
// 난이도는 "기대 순위"(직전 시즌 순위와 지금 전력 순위의 평균)로 정해 약팀에게는 낮은 목표를 준다. 값은 rules.goals(게임용 가정, _note).
// 순수 함수만 있다. 목표는 시즌 시작 상태(직전 순위·전력 순위·연봉·젊은 선수)에서 정해지므로 저장하지 않아도 다시 만들 수 있고,
// 시즌 결과(entry.eval)에는 종류·값·결과만 남긴다.
import { hashString } from './rng.mjs';

export const STAGES = ['6강', '4강', '결승', '우승'];
const stageIndex = (s) => (s ? STAGES.indexOf(s) : -1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

/** 기대 순위: 직전 시즌 순위(없으면 중간)와 지금 전력 순위의 평균 */
export const expectedRank = (prevRank, powerRank, teamCount = 10) => Math.round(((prevRank ?? (teamCount + 1) / 2) + powerRank) / 2);

/**
 * 시즌 목표 3개: [{ kind, value, role('main'|'sub'|'extra') }].
 *  kind: 'rank'(정규리그 value위 이내) | 'stage'(플레이오프 value 단계 이상) | 'winPct'(승률 value 이상) | 'profit'(순이익 value억 이상) | 'payroll'(국내 연봉이 캡의 value배 이하) | 'youth'(젊은 선수 합계 출전 value분 이상)
 * ctx: { expected(기대 순위), payrollRatio(국내 연봉/캡), hasYouth(youthMaxAge 이하 선수가 있나), season, teamId }
 */
export function chooseGoals({ expected, payrollRatio, hasYouth, season, teamId }, rules) {
  const g = rules.goals;
  const tier = g.tiers.find((t) => expected <= t.maxRank) ?? g.tiers.at(-1);
  const x = g.extra;
  let extra;
  if (payrollRatio >= x.payrollRatio) extra = { kind: 'payroll', value: x.payrollLimit };
  else if (hasYouth && hashString(`goal:${season}:${teamId}`) % 2 === 0) extra = { kind: 'youth', value: x.youthMinutes };
  else extra = { kind: 'profit', value: x.profit };
  return [{ ...tier.main, role: 'main' }, { ...tier.sub, role: 'sub' }, { ...extra, role: 'extra' }];
}

/** 목표 한 줄 설명: { title, unit(짧은 이름) } */
export function describeGoal(goal) {
  const v = goal.value;
  switch (goal.kind) {
    case 'rank': return { title: `정규리그 ${v}위 이내`, unit: '순위' };
    case 'stage': return { title: v === '우승' ? '챔피언결정전 우승' : `플레이오프 ${v} 이상`, unit: '플레이오프' };
    case 'winPct': return { title: `승률 ${(v * 100).toFixed(0)}% 이상`, unit: '승률' };
    case 'profit': return { title: v > 0 ? `순이익 ${v}억 이상` : '흑자 시즌', unit: '재정' };
    case 'payroll': return { title: v >= 1 ? '국내 선수 연봉을 샐러리캡 안으로' : `국내 선수 연봉을 캡의 ${(v * 100).toFixed(0)}% 이하로`, unit: '연봉' };
    case 'youth': return { title: `젊은 선수(23세 이하) 합계 ${v}분 이상 출전`, unit: '신인 출전' };
    default: return { title: String(goal.kind), unit: '' };
  }
}

/**
 * 시즌이 끝난 뒤 한 목표의 결과. actual: { rank, wins, losses, stage, net, payrollRatio, youthMinutes }
 * 반환: { met, over(목표를 크게 넘었다), shown(화면에 보일 실제 값) }
 */
export function evaluateGoal(goal, actual) {
  const v = goal.value;
  switch (goal.kind) {
    case 'rank': return { met: actual.rank <= v, over: actual.rank <= v - 2, shown: actual.rank };
    case 'stage': { const a = stageIndex(actual.stage), t = stageIndex(v); return { met: a >= t, over: a >= t + 1, shown: actual.stage ?? '진출 실패' }; }
    case 'winPct': { const p = actual.wins / Math.max(1, actual.wins + actual.losses); return { met: p >= v, over: p >= v + 0.1, shown: Math.round(p * 1000) / 1000 }; }
    case 'profit': return { met: actual.net >= v, over: false, shown: round1(actual.net) };
    case 'payroll': return { met: actual.payrollRatio <= v + 1e-9, over: false, shown: Math.round(actual.payrollRatio * 1000) / 1000 };
    case 'youth': return { met: actual.youthMinutes >= v, over: false, shown: Math.round(actual.youthMinutes) };
    default: return { met: false, over: false, shown: null };
  }
}

/** 지난 시즌들의 결과에서 지금 단장 신뢰도(없으면 시작값) */
export const trustOf = (log, rules) => log?.findLast?.((e) => e.eval)?.eval.trust ?? rules.goals.trust.start;
/** 신뢰도가 위험선 이하로 연속된 시즌 수(마지막 시즌까지) */
export const lowStreakOf = (log) => log?.findLast?.((e) => e.eval)?.eval.low ?? 0;

/**
 * 시즌 평가: 목표별 결과를 신뢰도 변화로 바꾼다.
 *  goals: chooseGoals 결과, actual: evaluateGoal에 넘기는 값, before: { trust, low }
 * 반환(저장용, 작게): { goals: [{ kind, value, role, met, shown }], delta, trust, low, status('ok'|'warn'|'risk'), reward(보너스를 받는 신뢰도면 true), fired }
 */
export function evaluateSeason({ goals, actual, before }, rules) {
  const t = rules.goals.trust;
  const results = goals.map((goal) => ({ ...goal, ...evaluateGoal(goal, actual) }));
  let delta = 0;
  for (const r of results) delta += t[r.role][r.met ? 0 : 1];
  if (results.some((r) => r.over)) delta += t.over;
  const trust = Math.round(clamp(before.trust + delta, t.min, t.max));
  const low = trust <= t.riskBelow ? (before.low ?? 0) + 1 : 0;
  const status = low >= t.riskSeasons ? 'risk' : trust < t.warnBelow ? 'warn' : 'ok';
  return {
    goals: results.map(({ kind, value, role, met, shown }) => ({ kind, value, role, met, shown })),
    delta, trust, low, status, reward: trust >= t.rewardAt, fired: Boolean(rules.goals.firing) && low >= t.riskSeasons
  };
}

/**
 * 시즌 진행 중 목표 한 줄의 진행 상황. live: { rank, wins, losses, played, total(정규리그 경기 수), regularDone, stage, net, payrollRatio, youthMinutes }
 * 반환: { ratio(0~1 막대), now(현재 값 설명), state('pending'|'ok'|'risk') } — 'ok'는 지금 기준 달성 상태
 */
export function goalProgress(goal, live) {
  const v = goal.value;
  const started = live.played > 0;
  switch (goal.kind) {
    case 'rank': {
      const ok = live.rank <= v;
      return { ratio: started ? clamp((11 - live.rank) / (11 - v), 0, 1) : 0, now: started ? `현재 ${live.rank}위` : '시즌 시작 전', state: !started ? 'pending' : ok ? 'ok' : 'risk' };
    }
    case 'stage': {
      const a = stageIndex(live.stage), t = stageIndex(v);
      if (live.stage !== undefined && live.poStarted) return { ratio: clamp((a + 1) / (t + 1), 0, 1), now: live.stage ? `${live.stage} 도달` : '진출 실패', state: a >= t ? 'ok' : (live.poDone || !live.poAlive ? 'risk' : 'pending') };
      const inPo = live.rank <= 6;
      return { ratio: started ? clamp((7 - live.rank) / 6, 0, 1) * (1 / (t + 1)) : 0, now: started ? `현재 ${live.rank}위 (플레이오프 ${inPo ? '진출권' : '밖'})` : '시즌 시작 전', state: !started ? 'pending' : inPo ? 'ok' : 'risk' };
    }
    case 'winPct': {
      const need = Math.ceil(v * live.total - 1e-9);
      const p = live.wins / Math.max(1, live.played);
      return { ratio: clamp(live.wins / Math.max(1, need), 0, 1), now: started ? `${live.wins}승 ${live.losses}패 (승률 ${(p * 100).toFixed(1)}%)` : `목표 ${need}승`, state: !started ? 'pending' : live.wins >= need ? 'ok' : p >= v ? 'ok' : 'risk' };
    }
    case 'profit': {
      const ok = live.net >= v;
      return { ratio: clamp(0.5 + (live.net - v) / 20, 0, 1), now: `예상 순이익 ${live.net >= 0 ? '+' : ''}${live.net.toFixed(1)}억`, state: ok ? 'ok' : 'risk' };
    }
    case 'payroll': {
      const ok = live.payrollRatio <= v + 1e-9;
      return { ratio: clamp(1 - Math.max(0, live.payrollRatio - 0.7) / 0.5, 0, 1), now: `국내 연봉 ${(live.payrollRatio * 100).toFixed(0)}%`, state: ok ? 'ok' : 'risk' };
    }
    case 'youth': {
      return { ratio: clamp(live.youthMinutes / v, 0, 1), now: `${Math.round(live.youthMinutes)}분 출전`, state: live.youthMinutes >= v ? 'ok' : (started ? (live.played / live.total >= 0.5 && live.youthMinutes < v * (live.played / live.total) * 0.7 ? 'risk' : 'pending') : 'pending') };
    }
    default: return { ratio: 0, now: '', state: 'pending' };
  }
}

/** 보너스 예산(억): rules.goals.trust.rewardBonus × 물가 지수. 받을 자격이 없으면 0 */
export const rewardOf = (evalResult, priceIndex, rules) => (evalResult?.reward ? Math.round(rules.goals.trust.rewardBonus * priceIndex * 10) / 10 : 0);

/** 신뢰도 단계 이름 */
export function trustTier(trust, rules) {
  const t = rules.goals.trust;
  if (trust >= t.rewardAt) return '두터움';
  if (trust >= 50) return '안정';
  if (trust >= t.warnBelow) return '주의';
  return trust <= t.riskBelow ? '위험' : '불안';
}
