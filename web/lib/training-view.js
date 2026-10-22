// 훈련 화면의 순수 계산(브라우저 API 없음). 훈련 규칙은 src/training.mjs.
import { trainPlayer, ageMultiplier, potentialMultiplier, trainingThreshold } from '../../src/training.mjs';

/**
 * 정규리그 day일을 치른 시점에서 남은 훈련 횟수.
 * 훈련은 checkpointDays일마다(그 날이 정규리그 마지막 날이 아닐 때) 한 번 반영된다.
 */
export function remainingCheckpoints(day, totalDays, checkpointDays) {
  let n = 0;
  for (let d = Math.floor(day / checkpointDays + 1) * checkpointDays; d < totalDays; d += checkpointDays) n++;
  return n;
}

/**
 * 한 번 훈련했을 때 기대 경험치와 그 상승분: { xpGain, threshold, perSession(능력치 +x.x), progress(0~1, 다음 +1까지) }.
 * 경험치가 임계값을 채울 때마다 능력치가 +1 오르므로 "경험치 ÷ 임계값"이 평균 상승량이다.
 */
export function previewGain(p, stat, rules) {
  const cfg = rules.training;
  const xpGain = cfg.sessionsPerCheckpoint * cfg.baseGain * ageMultiplier(p.age, cfg) * potentialMultiplier(p, cfg);
  const threshold = trainingThreshold(p.stats[stat], cfg);
  return { xpGain, threshold, perSession: p.stats[stat] >= rules.stats.max ? 0 : xpGain / threshold, progress: Math.min(1, (p.xp?.[stat] ?? 0) / threshold) };
}

/** 남은 훈련 n회를 모두 반영한 결과: { statDelta, ovrDelta, ovr, value } (결정적 계산, 원본은 바꾸지 않는다) */
export function projectGain(p, stat, rules, n) {
  let q = p;
  for (let i = 0; i < n; i++) q = trainPlayer(q, stat, rules.training.sessionsPerCheckpoint, rules);
  return { statDelta: q.stats[stat] - p.stats[stat], ovrDelta: q.ovr - p.ovr, ovr: q.ovr, value: q.stats[stat] };
}
