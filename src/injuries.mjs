// 부상: 경기에서 선수가 다쳐 몇 경기 결장한다. 순수 함수만 둔다(진행기 src/season-run.mjs가 부른다).
// 부상은 경기 난수(rng)를 쓰지 않고 "선수·날짜"로 정한 시드에서 따로 굴려, 점수 계산의 난수 흐름을 건드리지 않는다.
// 확률·기간·부위는 모두 게임용 가정이다(data/league-rules.json `injuries`의 _note).
import { mulberry32, hashString } from './rng.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const KIND_LABEL = { minor: '경상', moderate: '중상', severe: '장기 부상', season: '시즌 아웃' };

// 부위·진단명(분위기용 가상 문구). 경증은 흔한 것, 중증일수록 큰 부상
const PARTS = {
  minor: ['발목 염좌', '종아리 근육 뭉침', '손가락 타박상', '허벅지 근육통', '어깨 타박상', '무릎 타박상', '허리 근육통', '안면 타박상'],
  moderate: ['발목 인대 부분 손상', '햄스트링 부분 손상', '무릎 인대 염좌', '손목 염좌', '복사근 손상', '발등 피로 골절 의심', '어깨 관절 염좌'],
  severe: ['무릎 반월판 손상', '중족골 골절', '어깨 탈구', '아킬레스건 부분 파열', '손가락 골절', '정강이 피로 골절'],
  season: ['전방십자인대 파열', '아킬레스건 파열', '발목 골절 수술', '무릎 연골 수술', '어깨 관절와순 수술']
};

/** 결장 경기 수 → 종류 */
export function kindOfGames(games, rules) {
  const sev = rules.injuries.severity;
  return [...sev].reverse().find((s) => games >= s.games[0])?.kind ?? sev[0].kind;
}

/** 외국선수 관리규정(제8조)의 2주·8주 기준을 경기 수로 바꾼 값: { temporary, season } */
export function foreignGameThresholds(rules, origin = 'foreign') {
  const gpw = rules.injuries.gamesPerWeek;
  const f = origin === 'asia' && rules.inSeason.asia ? rules.inSeason.asia : rules.inSeason.foreign; // 아시아쿼터도 같은 기준(게임용 가정, inSeason.asia)
  return { temporary: Math.ceil(f.temporaryMinWeeks * gpw - 1e-9), season: Math.ceil(f.seasonMinWeeks * gpw - 1e-9) };
}

/**
 * 한 선수가 이번 경기에서 다칠 확률. minutes: 이 경기 출전 시간(분), streak: 지금까지 이어진 연속 출전(24분 이상) 경기 수.
 * 나이(ageFrom 초과 시 세당 +slope), 스태미나(mid보다 낮으면 +), 연속 출전이 약하게 영향을 준다.
 */
export function injuryChance(p, minutes, rules, streak = 0) {
  const c = rules.injuries;
  if (!c?.enabled || !(minutes > 0)) return 0;
  const age = clamp(1 + c.age.slope * (p.age - c.age.from), c.age.min, c.age.max);
  const stamina = 1 + c.stamina.slope * (c.stamina.mid - (p.stats?.stamina ?? c.stamina.mid)) / c.stamina.mid;
  const fatigue = 1 + c.fatigue.slope * Math.min(streak, c.fatigue.cap) / c.fatigue.cap;
  return clamp(c.perMinute * minutes * age * stamina * fatigue, 0, 0.5);
}

/**
 * 부상 판정. key는 "시즌:날짜:선수" 같은 고정 문자열(같은 key면 같은 결과). 부상이 없으면 null.
 * 반환: { games(결장 경기 수), kind, part }. 시즌 아웃은 games가 99다(남은 경기 전부).
 */
export function rollInjury(p, minutes, rules, key, streak = 0) {
  const chance = injuryChance(p, minutes, rules, streak);
  if (chance <= 0) return null;
  const rng = mulberry32(hashString(`inj:${key}`));
  if (rng() >= chance) return null;
  const sev = rules.injuries.severity;
  let r = rng() * sev.reduce((s, x) => s + x.weight, 0);
  const pick = sev.find((x) => (r -= x.weight) < 0) ?? sev.at(-1);
  const [lo, hi] = pick.games;
  const games = lo + Math.floor(rng() * (hi - lo + 1));
  const parts = PARTS[pick.kind];
  return { games, kind: pick.kind, part: parts[Math.floor(rng() * parts.length)] };
}

/** 남은 경기 수를 화면 문구로: "3경기 결장", "시즌 아웃" */
export const absenceText = (left, kind) => (kind === 'season' ? '시즌 아웃' : `${left}경기 결장`);

/** 선수에게 남길 부상 요약(저장·표시용 작은 배열) */
export const injuryRow = (inj) => [inj.playerId, inj.teamId, inj.day, inj.games, inj.kind, inj.part];
