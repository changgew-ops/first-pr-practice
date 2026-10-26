// 유망주 육성 프로그램: D리그(교육리그)와 해외 유학. 모든 수치는 league-rules.json의 devProgram(게임용 가정).
//   D리그: 선수는 시즌 중 우리 구단 등록 명단(라인업 후보)에서 빠지고 훈련 경험치를 배수로 받는다. 언제든 소환할 수 있다.
//   유학:  시즌이 시작되기 전에만 보낼 수 있고, 시즌 내내 명단에서 빠졌다가 시즌 종료 처리에서 큰 폭의 성장을 안고 돌아온다.
// 순수 함수만 둔다(난수는 호출하는 쪽이 넘긴다).
import { STAT_KEYS, ovrPlus } from './rating.mjs';
import { trainPlayer, trainingThreshold } from './training.mjs';

export const PROGRAMS = ['dleague', 'abroad'];
export const PROGRAM_LABEL = { dleague: 'D리그', abroad: '해외 유학' };

/** 한 시즌에 훈련이 반영되는 횟수(체크포인트: checkpointDays일마다, 마지막 날 제외) */
export function checkpointsPerSeason(totalDays, checkpointDays) {
  let n = 0;
  for (let d = checkpointDays; d < totalDays; d += checkpointDays) n++;
  return n;
}

/**
 * 파견 자격. ctx: { day, remainingRoster(이 선수를 뺀 우리 국내·외국·아시아 선수 수), activeCount(지금 파견 중인 선수 수), alreadyAway }
 * 반환: { ok, reason }
 */
export function eligibility(p, program, ctx, rules) {
  const cfg = rules.devProgram;
  if (!PROGRAMS.includes(program)) return { ok: false, reason: '알 수 없는 프로그램입니다' };
  if (!p || p.origin !== 'domestic') return { ok: false, reason: '국내 선수만 보낼 수 있습니다' };
  if (ctx.alreadyAway) return { ok: false, reason: '이미 육성 프로그램에 참가 중입니다' };
  if (p.age > cfg.maxAge) return { ok: false, reason: `${cfg.maxAge}세 이하 선수만 보낼 수 있습니다` };
  if (ctx.activeCount >= cfg.maxPlayers) return { ok: false, reason: `동시에 ${cfg.maxPlayers}명까지만 보낼 수 있습니다` };
  if (ctx.remainingRoster < rules.lineup.starters + rules.lineup.bench) return { ok: false, reason: '남는 선수만으로는 라인업을 채울 수 없습니다' };
  if (program === 'abroad') {
    if (ctx.day !== 0) return { ok: false, reason: '유학은 시즌이 시작되기 전에만 보낼 수 있습니다' };
    if (p.contract.yearsLeft < cfg.abroad.minContractYears) return { ok: false, reason: `계약이 ${cfg.abroad.minContractYears}년 이상 남은 선수만 유학을 갈 수 있습니다(돌아오면 계약이 끝나는 선수는 보낼 수 없습니다)` };
  }
  return { ok: true, reason: null };
}

/** D리그 중 한 번의 훈련에 쓰는 경험치 배수 적용 횟수 */
export const dleagueSessions = (rules) => rules.training.sessionsPerCheckpoint * rules.devProgram.dleague.trainingMultiplier;

/** 유학 한 시즌의 훈련 환산 횟수(배수 포함, 난수 변동 전) */
export const abroadSessions = (checkpoints, rules) => checkpoints * rules.training.sessionsPerCheckpoint * rules.devProgram.abroad.trainingMultiplier;

/**
 * 유학 복귀 성장. rng는 선수별로 시드가 고정된 난수다.
 * 반환: { player(성장 반영), outcome: 'success' | 'normal' | 'struggle', statDelta }
 *   성장 폭 = 기대치 × (1 ± spread). failChance 확률로 적응에 실패해 폭이 failMultiplier배로 줄어든다.
 *   성공(성장 폭이 기대치 이상)이면 potentialChance 확률로 잠재력이 potentialGain만큼 오른다.
 */
export function abroadGrowth(p, stat, checkpoints, rules, rng) {
  if (!STAT_KEYS.includes(stat)) throw new Error(`알 수 없는 능력치: ${stat}`);
  const cfg = rules.devProgram.abroad;
  const swing = 1 + (rng() * 2 - 1) * cfg.spread;
  const failed = rng() < cfg.failChance;
  const factor = failed ? cfg.failMultiplier : swing;
  const trained = trainPlayer(p, stat, abroadSessions(checkpoints, rules) * factor, rules);
  let potential = trained.potential;
  let outcome = failed ? 'struggle' : swing >= 1 ? 'success' : 'normal';
  const potRoll = rng();
  if (outcome === 'success' && potRoll < cfg.potentialChance) {
    const [lo, hi] = cfg.potentialGain;
    potential = ovrPlus(potential, lo + Math.floor(rng() * (hi - lo + 1))); // 상승폭은 예전 OVR 눈금 기준
  }
  potential = Math.max(potential, trained.ovr);
  return { player: { ...trained, potential }, outcome, statDelta: trained.stats[stat] - p.stats[stat] };
}

/** 프로그램 비용(억 원). dleague: 참가 일수 비례, abroad: 유학비 + 연봉의 salaryShare */
export function programCost(program, p, days, totalDays, rules) {
  const cfg = rules.devProgram;
  if (program === 'dleague') return Math.round(cfg.dleague.costEok * (days / totalDays) * 100) / 100;
  return Math.round((cfg.abroad.feeEok + cfg.abroad.salaryShare * p.contract.salaryEok) * 100) / 100;
}

/**
 * 화면용 미리보기(결정적): 집중 능력치 stat을 정규리그 끝까지(checkpointsLeft회) 보냈을 때의 기대 상승.
 * 반환: { normal, program, extra, low, high, ovrNormal, ovrProgram } — 능력치 상승량(소수)과 OVR 예상
 *   유학은 low(적응 실패)와 high(+spread)도 돌려준다.
 */
export function preview(p, stat, program, checkpointsLeft, checkpointsFull, rules) {
  const sessionsNormal = checkpointsLeft * rules.training.sessionsPerCheckpoint;
  const gain = (sessions) => {
    const q = trainPlayer(p, stat, sessions, rules);
    // 정수 상승분 + 남는 경험치의 비율 변화(임계값이 오르는 것까지 반영한 소수 상승량)
    const frac = (x, st) => (x.xp?.[stat] ?? 0) / trainingThreshold(st, rules.training);
    const approx = (q.stats[stat] - p.stats[stat]) + frac(q, q.stats[stat]) - frac(p, p.stats[stat]);
    return { stat: q.stats[stat] - p.stats[stat], approx, ovr: q.ovr - p.ovr };
  };
  const cfg = rules.devProgram;
  const normal = gain(sessionsNormal);
  if (program === 'dleague') {
    const withProgram = gain(checkpointsLeft * dleagueSessions(rules));
    return { normal: normal.approx, program: withProgram.approx, extra: withProgram.approx - normal.approx, ovrNormal: normal.ovr, ovrProgram: withProgram.ovr };
  }
  const full = abroadSessions(checkpointsFull, rules);
  const mid = gain(full), lo = gain(full * cfg.abroad.failMultiplier), hi = gain(full * (1 + cfg.abroad.spread));
  const normalFull = gain(checkpointsFull * rules.training.sessionsPerCheckpoint);
  return { normal: normalFull.approx, program: mid.approx, extra: mid.approx - normalFull.approx, low: lo.approx, high: hi.approx, ovrNormal: normalFull.ovr, ovrProgram: mid.ovr };
}
