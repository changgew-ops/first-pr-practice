// 감독·코치진: 구단마다 감독 1명(전술 이해·선수 육성·로테이션 운영 각 1~99)과 코치 3명(공격·수비·체력, 각 1~99).
// 전부 가상 인물이다(실제 지도자 정보를 쓰지 않는다). 효과는 모두 작게: 감독의 로테이션 운영은 팀 기대 득점에 ±(rotationEdge)점,
// 전술 이해는 전술 이득의 배수(±), 선수 육성·코치는 오프시즌 성장과 우리 구단 훈련 성장에, 체력 코치는 컨디션 회복에 쓰인다.
// 상태는 league.staff = { [구단 id]: { head, off, def, cond } }: head { id, name, tac, dev, rot, pay, yrs }, 코치 { id, name, k, pay, yrs }.
//   pay는 2026-27 기준 연봉(억 원, 물가는 시즌 규칙의 지수로 곱한다), yrs는 이번 시즌을 포함한 남은 계약 연수. 없으면(이전 저장) 구단 id로 고정된 기본 스태프를 만든다.
// 값은 rules.coaching(게임용 가정, _note). 난수는 모두 이름·시즌으로 고정한 시드라 같은 입력이면 같은 결과다.
import { mulberry32, hashString } from './rng.mjs';
import { indexOf } from './economy.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

export const ROLES = ['head', 'off', 'def', 'cond'];
export const ROLE_LABEL = { head: '감독', off: '공격 코치', def: '수비 코치', cond: '체력 코치' };
/** 코치의 능력치가 도움이 되는 훈련 능력치 */
export const COACH_STATS = { off: ['shooting', 'passing'], def: ['defense', 'rebound'], cond: ['athletic', 'stamina'] };

export const coachingOn = (rules) => Boolean(rules.coaching?.enabled);

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍', '전', '고', '문', '양'];
const GIVEN = ['성', '민', '준', '현', '재', '우', '진', '도', '승', '태', '지', '동', '영', '건', '찬', '시', '호', '혁', '훈', '석', '규', '환', '원', '수', '철', '범', '율', '한', '기', '용'];
const makeName = (rng) => `${SURNAMES[Math.floor(rng() * SURNAMES.length)]}${GIVEN[Math.floor(rng() * GIVEN.length)]}${GIVEN[Math.floor(rng() * GIVEN.length)]}`;

const skillOf = (rng, cfg) => {
  // 두 난수의 평균으로 종 모양에 가깝게(평균 mean, 표준편차 약 sd)
  const z = (rng() + rng() + rng() - 1.5) / 0.5;
  return Math.round(clamp(cfg.skill.mean + cfg.skill.sd * z, cfg.skill.min, cfg.skill.max));
};
const yearsOf = (rng, cfg) => cfg.contractYears[0] + Math.floor(rng() * (cfg.contractYears[1] - cfg.contractYears[0] + 1));

/** 능력치 → 기본 연봉(억 원, 2026-27 기준): 평균 능력치가 skill.min이면 lo, skill.max면 hi, 사이는 직선 */
export function basePay(role, avgSkill, rules) {
  const cfg = rules.coaching;
  const [lo, hi] = role === 'head' ? cfg.salary.head : cfg.salary.coach;
  const t = clamp((avgSkill - cfg.skill.min) / (cfg.skill.max - cfg.skill.min), 0, 1);
  return round2(lo + (hi - lo) * t);
}

const headOf = (rng, id, rules) => {
  const cfg = rules.coaching;
  const tac = skillOf(rng, cfg), dev = skillOf(rng, cfg), rot = skillOf(rng, cfg);
  return { id, name: makeName(rng), tac, dev, rot, pay: basePay('head', (tac + dev + rot) / 3, rules), yrs: yearsOf(rng, cfg) };
};
const coachOf = (rng, id, role, rules) => {
  const cfg = rules.coaching, k = skillOf(rng, cfg);
  return { id, name: makeName(rng), k, pay: basePay(role, k, rules), yrs: yearsOf(rng, cfg) };
};

/** 구단 하나의 기본 스태프(구단 id로 고정) */
export function defaultTeamStaff(teamId, rules) {
  const rng = mulberry32(hashString(`staff:init:${teamId}`));
  return { head: headOf(rng, `S0-${teamId}-h`, rules), off: coachOf(rng, `S0-${teamId}-o`, 'off', rules), def: coachOf(rng, `S0-${teamId}-d`, 'def', rules), cond: coachOf(rng, `S0-${teamId}-c`, 'cond', rules) };
}

/** league.staff가 있으면 그것(복사), 없으면 모든 구단의 기본 스태프 */
export function staffOf(league, teamData, rules) {
  const out = {};
  for (const t of teamData) {
    const s = league.staff?.[t.id];
    out[t.id] = s ? { head: { ...s.head }, off: { ...s.off }, def: { ...s.def }, cond: { ...s.cond } } : defaultTeamStaff(t.id, rules);
  }
  return out;
}

/** 이번 시즌의 연봉(억 원, 물가 반영) */
export const payOf = (person, rules) => round2(person.pay * indexOf(rules));
export const teamPay = (staff, rules) => round2(ROLES.reduce((s, r) => s + staff[r].pay, 0) * indexOf(rules));

/** 영입 후보 풀(시즌마다 고정). exclude: 이미 어느 구단에 있는 사람 id 집합. 반환: { head: [], off: [], def: [], cond: [] } (능력치 평균 높은 순) */
export function candidatePool(season, rules, exclude = new Set()) {
  const cfg = rules.coaching;
  const rng = mulberry32(hashString(`staff:pool:${season}`));
  const out = { head: [], off: [], def: [], cond: [] };
  for (let i = 0; i < cfg.pool.heads; i++) out.head.push(headOf(rng, `S${season}-h${i}`, rules));
  for (const role of ['off', 'def', 'cond']) for (let i = 0; i < cfg.pool.coaches; i++) out[role].push(coachOf(rng, `S${season}-${role}${i}`, role, rules));
  for (const role of ROLES) out[role] = out[role].filter((x) => !exclude.has(x.id)).sort((a, b) => avgSkill(role, b) - avgSkill(role, a) || a.id.localeCompare(b.id));
  return out;
}
export const avgSkill = (role, person) => (role === 'head' ? (person.tac + person.dev + person.rot) / 3 : person.k);

export const staffIds = (staffByTeam) => new Set(Object.values(staffByTeam).flatMap((s) => ROLES.map((r) => s[r].id)));

// ---------- 효과 ----------
/** 감독의 로테이션 운영 → 팀 기대 득점 이득(점수). 능력치 50이면 0 */
export const rotationEdge = (head, rules) => (coachingOn(rules) ? round2(rules.coaching.rotationEdge * (head.rot - 50) / 50) : 0);
/** 감독의 전술 이해 → 전술 이득의 배수(50이면 1) */
export const tacMult = (head, rules) => (coachingOn(rules) ? 1 + rules.coaching.tacticsUnderstanding * (head.tac - 50) / 50 : 1);
/** 우리 구단 훈련 성장 배수: 그 능력치를 맡은 코치의 능력치(50이면 1) */
export function trainMul(staff, stat, rules) {
  if (!coachingOn(rules) || !staff) return 1;
  const role = Object.keys(COACH_STATS).find((r) => COACH_STATS[r].includes(stat));
  return role ? 1 + rules.coaching.training * (staff[role].k - 50) / 50 : 1;
}
/** 오프시즌 성장 가산(성장폭 배수에 더하는 값): 감독의 육성과 코치 세 명의 평균 */
export function devBonus(staff, rules) {
  if (!coachingOn(rules) || !staff) return 0;
  const g = rules.coaching.growth, avg = (staff.off.k + staff.def.k + staff.cond.k) / 3;
  return g.head * (staff.head.dev - 50) / 50 + g.coaches * (avg - 50) / 50;
}
/** 체력 코치 → 컨디션 회복 배수(50이면 1) */
export const recoveryMul = (staff, rules) => (coachingOn(rules) && staff ? 1 + rules.coaching.recovery * (staff.cond.k - 50) / 50 : 1);

// ---------- 계약·정산 ----------
/** 해임 위약금(억 원): 남은 계약 전부(이번 시즌 포함)를 채워 준다 */
export const buyoutEok = (person, rules) => round2(payOf(person, rules) * person.yrs);

/** 이번 시즌 스태프 인건비(억 원): 시즌 끝 스태프의 연봉 × 근무한 비율(hired: role → 합류한 날) + 해임 위약금(buyouts) */
export function seasonCharge(staff, hired, buyouts, totalDays, rules) {
  let sum = 0;
  for (const r of ROLES) sum += payOf(staff[r], rules) * (1 - (hired?.[r] ?? 0) / totalDays);
  return round2(sum + (buyouts ?? 0));
};

/** 기본 포함분을 넘는 금액(억 원): 구단 운영비에 이미 들어 있는 스태프 인건비(covered)와의 차이. 음수면 절약 */
export const extraCharge = (charge, rules) => round2(charge - rules.coaching.covered * indexOf(rules));

/**
 * 시즌이 끝난 뒤의 스태프: 계약 연수 −1, 계약이 끝난 사람은 같은 연봉으로 재계약, 능력치가 조금 흔들리고,
 * AI 구단의 감독은 성적이 나쁘면 교체된다. 우리 구단(manager)은 직접 정하므로 교체하지 않는다.
 * 반환: { staff, moves: [{ teamId, role, from: {name, …}, to: {name, …}, reason }] }
 */
export function rollStaff(staff, { standings, teamData, rules, season, manager }) {
  const cfg = rules.coaching;
  const rank = new Map(standings.map((s, i) => [s.id, i + 1]));
  const out = {}, moves = [];
  const used = staffIds(staff);
  for (const t of teamData) {
    const s = staff[t.id];
    const rng = mulberry32(hashString(`staff:roll:${season}:${t.id}`));
    const next = {};
    for (const r of ROLES) {
      let p = { ...s[r] };
      const drift = () => Math.round((rng() * 2 - 1) * cfg.drift);
      if (r === 'head') { p.tac = clamp(p.tac + drift(), 10, 95); p.dev = clamp(p.dev + drift(), 10, 95); p.rot = clamp(p.rot + drift(), 10, 95); } else p.k = clamp(p.k + drift(), 10, 95);
      p.pay = basePay(r, avgSkill(r, p), rules);
      p.yrs -= 1;
      if (p.yrs <= 0) p.yrs = t.id === manager ? 1 : yearsOf(rng, cfg);
      next[r] = p;
    }
    // AI 감독 교체: 최하위권이면 확률(failRank 이하 순위일수록 높게)로 새 감독
    const rk = rank.get(t.id) ?? 1;
    if (t.id !== manager) {
      const chance = rk > teamData.length - cfg.ai.worst ? cfg.ai.fireWorst : rk > teamData.length - cfg.ai.worst - cfg.ai.next ? cfg.ai.fireNext : 0;
      if (rng() < chance) {
        const id = `S${season + 1}-ai-${t.id}`;
        const hire = headOf(rng, id, rules);
        if (!used.has(id)) { moves.push({ teamId: t.id, role: 'head', from: { name: next.head.name, tac: next.head.tac, dev: next.head.dev, rot: next.head.rot }, to: { name: hire.name, tac: hire.tac, dev: hire.dev, rot: hire.rot }, reason: 'fired', rank: rk }); next.head = hire; }
      }
    }
    out[t.id] = next;
  }
  return { staff: out, moves };
}
