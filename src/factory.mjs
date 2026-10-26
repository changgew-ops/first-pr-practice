// 가상 선수 생성에 쓰는 공용 도구 (선수 데이터 생성기와 드래프트 신인 생성이 함께 쓴다).
// rng를 주입받으므로 같은 시드와 같은 호출 순서면 같은 결과가 나온다.
import { STAT_KEYS, legacyOvr, ovrPlus } from './rating.mjs';

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN_A = ['민', '준', '현', '재', '성', '우', '진', '도', '승', '태', '지', '동', '영', '건', '찬', '시'];
const GIVEN_B = ['호', '우', '준', '혁', '민', '훈', '석', '규', '빈', '환', '원', '수', '철', '범', '율', '한'];
const FOREIGN_FIRST = ['Marcus', 'Devin', 'Terrell', 'Jalen', 'Andre', 'Caleb', 'Isaiah', 'Malik', 'Corey', 'Darius', 'Trevor', 'Jamal', 'Ryan', 'Elijah', 'Omar', 'Nolan'];
const FOREIGN_LAST = ['Webb', 'Holloway', 'Brooks', 'Sutton', 'Mercer', 'Dalton', 'Pierce', 'Rowe', 'Hale', 'Vance', 'Colby', 'Ellis', 'Fenn', 'Quill', 'Strand', 'Tate'];

// 앞 5칸이 주전급 슬롯이므로 포지션이 한쪽에 몰리지 않게 섞어 둔다
export const DOMESTIC_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SF'];
export const FOREIGN_POSITIONS = ['C', 'C', 'PF', 'PF', 'SF', 'SG'];
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// 목표 OVR 대비 능력치별 보정
export const ARCHETYPE = {
  PG: { shooting: 0, passing: 10, defense: -2, rebound: -14, athletic: 2, stamina: 4 },
  SG: { shooting: 8, passing: 2, defense: 0, rebound: -12, athletic: 2, stamina: 2 },
  SF: { shooting: 2, passing: -2, defense: 2, rebound: -4, athletic: 4, stamina: 2 },
  PF: { shooting: -6, passing: -6, defense: 2, rebound: 8, athletic: 4, stamina: 0 },
  C: { shooting: -12, passing: -8, defense: 4, rebound: 14, athletic: 2, stamina: -2 }
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 임계값은 예전 OVR 눈금(raw) 기준이다(src/rating.mjs의 legacyOvr): 눈금을 늘려도 희귀도 분포는 그대로다
export function rarityOf(ovr, pot) {
  const m = legacyOvr(Math.max(ovr, pot));
  if (m >= 81.5) return 'legend';
  if (m >= 73.5) return 'ace';
  if (m >= 65.5) return 'rare';
  return 'common';
}

// 국내 선수 시장 연봉(억 원). 능력(OVR)에 대해 가파르게 오르는 곡선이다.
// 상한 8억, OVR 65 약 2억, OVR 70 약 3억, OVR 77 이상 8억 (2025-26 KBL 최고 보수 8억대를 참고).
// 생성기는 구단 캡에 맞춰 비례 축소하고, 재계약·FA 협상은 이 값을 기준 요구액으로 쓴다.
export const MAX_SALARY_EOK = 8;
// 곡선은 예전 OVR 눈금 기준이라 지금 눈금의 OVR을 legacyOvr로 되돌려 넣는다(OVR 77은 지금 눈금 90에 해당).
export const rawSalaryEok = (ovr) => Math.min(MAX_SALARY_EOK, 0.3 + 20 * Math.pow(Math.max(0, (legacyOvr(ovr) - 45) / 40), 3.5));

export function createFactory(rng, rules, usedNames = new Set()) {
  const rand = (min, max) => min + rng() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  function uniqueName(origin) {
    const latin = origin === 'foreign' || origin === 'asia'; // 아시아쿼터도 로마자 이름 풀을 쓴다
    const base = () => (latin
      ? `${pick(FOREIGN_FIRST)} ${pick(FOREIGN_LAST)}`
      : `${pick(SURNAMES)}${pick(GIVEN_A)}${pick(GIVEN_B)}`);
    // 이름 조합이 소진되면(수십 년 진행 시) 접미사를 붙여 구분한다
    const suffixes = latin ? ['', ' Jr.', ' II', ' III', ' IV'] : ['', '2세', '3세', '4세'];
    for (const suffix of suffixes) {
      for (let i = 0; i < 200; i++) {
        const name = base() + suffix;
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
      }
    }
    throw new Error('이름 풀이 부족합니다');
  }

  function makeStats(position, target) {
    const stats = {};
    for (const k of STAT_KEYS) {
      stats[k] = clamp(Math.round(target + ARCHETYPE[position][k] + rand(-5, 5)), 20, rules.stats.max);
    }
    return stats;
  }

  function makePotential(age, ovr) {
    let bonus;
    if (age <= 22) bonus = randInt(4, 18);
    else if (age <= 26) bonus = randInt(1, 8);
    else if (age <= 30) bonus = randInt(0, 3);
    else bonus = 0;
    return ovrPlus(ovr, bonus); // 보너스는 예전 눈금 기준(src/rating.mjs): 스타도 같은 폭만큼 성장 여지를 갖는다
  }

  return { rand, randInt, pick, uniqueName, makeStats, makePotential, usedNames };
}
