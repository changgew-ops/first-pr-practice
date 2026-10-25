// 시너지 버프: 엔트리(스타팅 5 + 벤치 7) 안에 같은 구단·같은 해의 시즌 카드 선수가 모이면 팀의 경기 보정(점수)이 오른다.
// 칸(slot)은 규칙값 rules.synergy.slots 의 배열이라 칸을 더하기 쉽다: { id, label, key, thresholds, perLevel }
//   key: 같은 값끼리 묶을 카드 필드 이름 배열(['teamId','season'] = 같은 구단·같은 시즌, ['season'] = 같은 해). 값이 하나라도 없으면 묶지 않는다.
//   thresholds: 단계 1·2·3에 필요한 인원(예: [3,4,5]). 최대 단계 = thresholds 길이(규칙상 3).
//   perLevel: 한 단계가 올려 주는 경기 기대 득점 보정(점).
// 세지 않는 선수: 시즌 카드가 아닌 선수(card 없음), 그리고 "시작 로스터 표식"이 살아 있는 선수 — 게임 시작 때 로스터에 있던 선수(baseRoster: 선수 id → 시작 소속 구단)가
// 아직 그 구단에 그대로 있는 동안만 표식이 유효하다. 구단을 떠나면(트레이드·방출·계약 만료 후 다른 구단) 표식을 잃고 다른 구단에서는 센다.
// 나중에 드래프트·FA·카드 시장으로 다시 들어온 "26" 카드는 새 선수 id를 받으므로 항상 센다. 그래서 시작 시점에는 모든 구단의 시너지가 0이다.
// baseRoster는 세션에서 파생 값(data.players의 id → teamId, 저장하지 않는다)이고, AI끼리의 시뮬레이션(playLeagueYear)은 league.baseRoster를 쓴다.
// 순수 함수만 둔다. 계산 기준 편성은 호출하는 쪽이 정한다(엔진은 실제 출전 편성 lineupOf).

const round2 = (v) => Math.round(v * 100) / 100;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** 시너지 설정이 켜져 있고 칸이 있는가 */
export const synergyOn = (rules) => Boolean(rules.synergy?.enabled && rules.synergy.slots?.length);

/** 칸 id → 경기 보정 항목 이름(parts의 키): team → synergyTeam, year → synergyYear */
export const synergyPartKey = (id) => `synergy${cap(id)}`;

/** 시작 로스터 표식: 선수 목록(게임 시작 때의 data.players)에서 { 선수 id: 시작 소속 구단 } */
export function baseRosterOf(players) {
  const out = {};
  for (const p of players) if (p.teamId != null) out[p.id] = p.teamId;
  return out;
}
const BASE_MEMO = new WeakMap();
/** 같은 선수 배열이면 한 번만 계산한다(세션의 data.players) */
export function baseRosterFor(players) {
  let b = BASE_MEMO.get(players);
  if (!b) { b = baseRosterOf(players); BASE_MEMO.set(players, b); }
  return b;
}

/** 시작 로스터 표식이 아직 유효한 선수인가(시작 때 있던 선수가 시작 소속 구단에 그대로 있다) */
export const isBaseRoster = (p, baseRoster) => Boolean(baseRoster) && baseRoster[p.id] != null && baseRoster[p.id] === p.teamId;

function groupKey(p, slot, baseRoster) {
  const c = p.card;
  if (!c || !c.season || isBaseRoster(p, baseRoster)) return null;
  const vals = slot.key.map((k) => c[k]);
  if (vals.some((v) => v == null || v === '')) return null;
  return vals.join('|');
}

/**
 * 엔트리 선수들의 시너지 칸 계산.
 * players: 엔트리 선수 객체 목록(스타팅 + 벤치), baseRoster: 시작 로스터 표식(baseRosterOf). 반환: [{ id, label, level, max, count, players: [선수 id], need(다음 단계까지 더 필요한 인원, 최대면 null), thresholds, perLevel, edge }]
 * count/players는 가장 큰 묶음(동수면 OVR 합이 큰 묶음) 기준이다.
 */
export function synergyOf(players, rules, baseRoster = null) {
  if (!synergyOn(rules)) return [];
  return rules.synergy.slots.map((slot) => {
    const groups = new Map();
    for (const p of players) {
      const k = groupKey(p, slot, baseRoster);
      if (k == null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    let best = [];
    for (const g of groups.values()) if (g.length > best.length || (g.length === best.length && g.reduce((s, p) => s + p.ovr, 0) > best.reduce((s, p) => s + p.ovr, 0))) best = g;
    const th = slot.thresholds;
    const level = th.filter((n) => best.length >= n).length;
    return {
      id: slot.id, label: slot.label, level, max: th.length, count: best.length, players: best.map((p) => p.id),
      need: level >= th.length ? null : th[level] - best.length, thresholds: th, perLevel: slot.perLevel, edge: round2(level * slot.perLevel)
    };
  });
}

/** 칸 계산 결과 → 경기 보정 항목 { synergyTeam: 0.6, synergyYear: 0.3 } */
export function synergyParts(slots) {
  return Object.fromEntries(slots.map((s) => [synergyPartKey(s.id), s.edge]));
}
