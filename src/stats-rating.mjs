// 기록(득점·리바운드·어시스트 …) → 능력치(0~99) 변환.
// 실제 기록과 시뮬레이션 기록이 같은 방식으로 능력치가 되도록, 입력은 "시즌 합계" 한 가지 형식만 받는다.
//
// 방법: 지표별로 리그 안의 백분위를 구해 정규분포 점수(z)로 바꾸고, 지표를 섞어 능력치별 종합 z를 만든 뒤
// 리그 평균(mean)·편차(sd)로 되돌린다. 절대 수치가 아니라 "그 시즌 리그 안의 순위"이므로 시대가 달라도 비교된다.
// 기록이 적은 선수는 출전 시간에 비례하는 신뢰도로 기준점 쪽으로 당겨 둔다.
import { STAT_KEYS } from './rating.mjs';

export const SKILL_KEYS = ['shooting', 'passing', 'defense', 'rebound'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 표준정규분포 역함수 (Abramowitz & Stegun 26.2.23, 오차 4.5e-4)
export function invNormalCdf(p) {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  const t = Math.sqrt(-2 * Math.log(q < 0.5 ? q : 1 - q));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3);
  return q < 0.5 ? -x : x;
}

const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };

// 정렬된 분포 안에서 x의 정규분포 점수
function zScore(sorted, x) {
  const lo = lowerBound(sorted, x);
  const hi = upperBound(sorted, x);
  return invNormalCdf((lo + (hi - lo) / 2 + 0.5) / (sorted.length + 1));
}

/** 합계 → 지표. 출전 기록이 없으면 null */
export function metricsOf(t) {
  if (!t || t.minutes <= 0) return null;
  const per36 = 36 / t.minutes;
  const shotDen = 2 * (t.fga + 0.44 * t.fta);
  return {
    ts: shotDen > 0 ? t.points / shotDen : 0.45,
    tp: (t.tpm + 0.3 * 40) / (t.tpa + 40), // 표본이 적으면 3점 성공률 30% 쪽으로
    ft: (t.ftm + 0.7 * 20) / (t.fta + 20),
    pts36: t.points * per36,
    reb36: t.rebounds * per36,
    ast36: t.assists * per36,
    stl36: t.steals * per36,
    blk36: t.blocks * per36,
    mpg: t.games > 0 ? t.minutes / t.games : 0
  };
}

const METRIC_KEYS = ['ts', 'tp', 'ft', 'pts36', 'reb36', 'ast36', 'stl36', 'blk36', 'mpg'];

// 능력치별 종합 z의 구성 (가중치 합 1)
const COMPOSITE = {
  shooting: { ts: 0.4, tp: 0.25, ft: 0.15, pts36: 0.2 },
  passing: { ast36: 1 },
  defense: { stl36: 0.55, blk36: 0.45 },
  rebound: { reb36: 1 },
  // 아래 둘은 기록으로 직접 재기 어려운 신체 능력의 대용 지표다
  athletic: { pts36: 0.3, reb36: 0.25, stl36: 0.2, blk36: 0.25 },
  stamina: { mpg: 1 }
};

/**
 * 리그 분포 모델 만들기. 입력: 선수별 합계 배열, 규칙의 ratingModel.
 * 표본이 충분한 선수(출전 시간 기준 이상)만 분포에 쓴다.
 */
export function buildRatingModel(totalsList, model, minMinutes = model.minQualifiedMinutes) {
  const rows = totalsList.map(metricsOf).filter((m, i) => m && totalsList[i].minutes >= minMinutes);
  if (rows.length < 5) throw new Error(`분포를 만들기엔 표본이 부족합니다 (${rows.length}명)`);
  const dists = {};
  for (const k of METRIC_KEYS) dists[k] = rows.map((r) => r[k]).sort((a, b) => a - b);
  const comp = {};
  for (const stat of STAT_KEYS) {
    const raw = rows.map((r) => rawComposite(stat, r, dists));
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const sd = Math.sqrt(raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length) || 1;
    comp[stat] = { mean, sd };
  }
  return { dists, comp, model, size: rows.length };
}

function rawComposite(stat, metrics, dists) {
  let z = 0;
  for (const [k, w] of Object.entries(COMPOSITE[stat])) z += w * zScore(dists[k], metrics[k]);
  return z;
}

/** 합계 → 6개 능력치 (기록만으로 본 값, 신뢰도 보정 전) */
export function statRatings(totals, rm) {
  const m = metricsOf(totals);
  if (!m) return null;
  const out = {};
  for (const stat of STAT_KEYS) {
    const z = (rawComposite(stat, m, rm.dists) - rm.comp[stat].mean) / rm.comp[stat].sd;
    out[stat] = clamp(Math.round(rm.model.mean + rm.model.sd * z), 20, 99);
  }
  return out;
}

/** 출전 시간에 따른 신뢰도 (0~1) */
export const credibility = (minutes, model) => clamp(minutes / model.credibilityMinutes, 0, 1);

/**
 * 기록이 적은 선수는 기준점(prior) 쪽으로 당긴 능력치.
 * prior: 숫자(모든 능력치 공통) 또는 { shooting: .., ... } (능력치별)
 */
export function shrinkRatings(ratings, minutes, rm, prior = rm.model.mean) {
  const w = credibility(minutes, rm.model);
  const out = {};
  for (const stat of STAT_KEYS) {
    const base = typeof prior === 'number' ? prior : prior[stat];
    out[stat] = clamp(Math.round(base + w * (ratings[stat] - base)), 20, 99);
  }
  return out;
}

/**
 * 시즌 중 갱신: 시즌 시작 능력치(R0)와 지금까지의 기록 기반 능력치(S)를 섞는다.
 *   새 능력치 = R0 + w × (S′ − R0),  w = 상한 × 신뢰도(출전 시간)
 * S′는 포지션별 평균 수준을 시즌 시작 평균에 맞춘 값이라, 같은 포지션 안에서의 상대적 활약만 반영한다
 * (센터의 슛이 포인트가드보다 낮게 나오는 구조적 차이가 능력치를 끌고 가지 않게 한다).
 * 갱신되는 것은 기술 능력치(슛·패스·수비·리바운드)뿐이고, 신체 능력(운동능력·체력)은 나이와 훈련으로만 변한다.
 *
 * players: 현재 선수 배열, start: Map<id, 시즌 시작 stats>, totals: Map<id, 합계>
 * 반환: Map<id, 새 stats> (기록이 부족한 선수는 포함하지 않음)
 */
export function updateSkillsFromSeason(players, start, totals, model) {
  const gamesPlayed = Math.max(0, ...[...totals.values()].map((t) => t.games));
  if (gamesPlayed === 0) return new Map();
  const list = [...totals.values()];
  const rm = buildRatingModel(list, model, 8 * gamesPlayed); // 평균 8분 이상 뛴 선수만 분포에 사용
  const byId = new Map(players.map((p) => [p.id, p]));

  const rows = [];
  for (const [id, t] of totals) {
    const p = byId.get(id);
    if (!p || t.minutes < 8 * gamesPlayed) continue;
    const s = statRatings(t, rm);
    if (s) rows.push({ p, r0: start.get(id) ?? p.stats, s, minutes: t.minutes });
  }

  // 포지션별 보정량 = 시즌 시작 평균 − 기록 기반 평균
  const shift = {};
  for (const pos of new Set(rows.map((r) => r.p.position))) {
    const g = rows.filter((r) => r.p.position === pos);
    shift[pos] = {};
    for (const k of SKILL_KEYS) {
      const m0 = g.reduce((a, r) => a + r.r0[k], 0) / g.length;
      const ms = g.reduce((a, r) => a + r.s[k], 0) / g.length;
      shift[pos][k] = m0 - ms;
    }
  }

  const result = new Map();
  for (const r of rows) {
    const w = model.inSeasonWeightCap * credibility(r.minutes, model);
    const next = { ...r.p.stats };
    for (const k of SKILL_KEYS) {
      const target = r.s[k] + shift[r.p.position][k];
      next[k] = clamp(Math.round(r.r0[k] + w * (target - r.r0[k])), 20, 99);
    }
    result.set(r.p.id, next);
  }
  return result;
}
