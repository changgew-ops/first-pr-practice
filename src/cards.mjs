// 시즌 카드: 공식 기록(1997~)의 선수 시즌 하나가 카드 한 장이 된다. "97 서장훈", "98 서장훈"처럼 같은 선수도 시즌마다 다른 카드다.
// 능력치는 그 시즌 리그 안의 백분위로 만들어(stats-rating.mjs) 시대가 달라도 비교된다. 카드의 잠재력은 그 시즌 능력치(성장 여지 없음)다.
// 이 파일은 브라우저와 node가 함께 쓰므로 파일 읽기를 하지 않는다(읽고 쓰는 일은 tools/build-cards.mjs).
import { emptyTotals } from './stats.mjs';
import { ratingsFromRows } from './stats-import.mjs';
import { calcOvr, calcCost, legacyOvr, fromLegacyOvr, OVR_MAX } from './rating.mjs';
import { rarityOf } from './factory.mjs';
import { inferPosition } from './position.mjs';
import { positionFromRegistry, ageOn } from './real-players.mjs';
import { mulberry32, hashString } from './rng.mjs';

export const CARD_FIELDS = ['kblId', 'season', 'name', 'kind', 'position', 'age', 'teamId', 'gp', 'min', 'shooting', 'passing', 'defense', 'rebound', 'athletic', 'stamina'];

export const seasonStartYear = (season) => Number(String(season).slice(0, 4));

/** 카드 연도 표기: 시작 연도 두 자리("1998-99"→"98", "2026-27"→"26"). KBL 출범 첫 시즌 "1997"은 "1997-98"과 겹쳐서 "97초" */
export function cardYearLabel(season) {
  if (season === '1997') return '97초';
  return String(seasonStartYear(season) % 100).padStart(2, '0');
}
export const cardName = (name, season) => `${cardYearLabel(season)} ${name}`;

/** 나이를 재는 기준일: 시즌 시작 무렵(첫 시즌 1997은 봄에 열렸다) */
export const seasonStartDate = (season) => (season === '1997' ? '1997-04-01' : `${seasonStartYear(season)}-10-01`);

// KBL 선수 프로필의 포지션 표기(가드·포워드·센터, 외국 선수는 FC·GF도 있다) → 등록 포지션 약어
const KBL_POS = { 가드: 'G', 포워드: 'F', 센터: 'C', GF: 'G', FC: 'F', G: 'G', F: 'F', C: 'C' };
const KIND = { domestic: 'd', foreign: 'f', asia: 'a' };

/** 정규시즌 기록 행(구단별 한 줄)을 선수별 한 줄로 합친다. 반환: Map<playerNo, { name, totals, teamName, minutesByTeam }> */
export function aggregateRegular(rows) {
  const out = new Map();
  for (const r of rows) {
    if (r.gameType !== 'regular') continue;
    let e = out.get(r.playerNo);
    if (!e) { e = { name: r.name, totals: emptyTotals(), teams: new Map() }; out.set(r.playerNo, e); }
    const t = e.totals;
    t.games += Number(r.gp); t.minutes += Number(r.sec) / 60; t.points += Number(r.pts); t.rebounds += Number(r.reb);
    t.assists += Number(r.ast); t.steals += Number(r.stl); t.blocks += Number(r.blk);
    t.fgm += Number(r.fgm); t.fga += Number(r.fga); t.tpm += Number(r.pm3); t.tpa += Number(r.pa3); t.ftm += Number(r.ftm); t.fta += Number(r.fta);
    e.teams.set(r.team, (e.teams.get(r.team) ?? 0) + Number(r.sec));
  }
  return out;
}

/**
 * 시즌 카드 만들기.
 *  official: [[시즌, 공식 기록 행들]], births: births.csv 행들, franchiseOf(기록상 구단 표기) → 구단 id | null, rules: league-rules.json
 *  options.skip: 만들지 않을 시즌(진행 중인 시즌), options.minMinutes: 카드가 되는 최소 출전 시간(분)
 * 반환: { fields, rows } (행 = CARD_FIELDS 순서). 능력치가 만들어지지 않는 선수(출전 시간 0)는 건너뛴다.
 */
export function buildCards({ official, births, franchiseOf, rules }, { skip = [], minMinutes = 300 } = {}) {
  const profile = new Map(births.map((b) => [b.playerNo, b]));
  const rows = [];
  for (const [season, list] of official) {
    if (skip.includes(season)) continue;
    const agg = aggregateRegular(list);
    const positions = new Map();
    const ratingRows = [];
    for (const [no, e] of agg) {
      const b = profile.get(no);
      const kbl = KBL_POS[b?.position];
      positions.set(no, kbl ? positionFromRegistry(kbl, e.totals) : inferPosition(e.totals));
      ratingRows.push({ name: no, totals: e.totals });
    }
    const rated = ratingsFromRows(ratingRows, positions, rules.ratingModel);
    for (const [no, e] of agg) {
      const r = rated.get(no);
      if (!r || e.totals.minutes < minMinutes) continue;
      const b = profile.get(no);
      const kind = KIND[b?.kind];
      if (!kind) throw new Error(`${season} ${e.name}(${no}): 프로필에 국내/외국/아시아쿼터 구분이 없습니다`);
      const topTeam = [...e.teams].sort((a, c) => c[1] - a[1])[0][0];
      const age = b?.birth ? ageOn(b.birth, seasonStartDate(season)) : null;
      rows.push([no, season, e.name, kind, positions.get(no), age, franchiseOf(topTeam) ?? null, e.totals.games, Math.round(e.totals.minutes),
        r.stats.shooting, r.stats.passing, r.stats.defense, r.stats.rebound, r.stats.athletic, r.stats.stamina]);
    }
  }
  return { fields: CARD_FIELDS, rows };
}

/** 카드 한 줄 → 객체 */
export const expandCard = (row) => Object.fromEntries(CARD_FIELDS.map((k, i) => [k, row[i]]));

/** 같은 선수(kblId)의 모든 시즌 카드 중 최고 OVR(커리어 하이). cards({ domestic, foreign })마다 한 번만 만든다 */
const HIGH_CACHE = new WeakMap();
export function careerHighIndex(cards) {
  let m = HIGH_CACHE.get(cards);
  if (!m) {
    m = new Map();
    for (const list of [cards.domestic ?? [], cards.foreign ?? []]) for (const c of list) { const o = cardOvr(c); if (o > (m.get(c.kblId) ?? 0)) m.set(c.kblId, o); }
    HIGH_CACHE.set(cards, m);
  }
  return m;
}

/**
 * 카드 선수의 잠재력(성장 한도). 새로 만든 신인과 같은 방식으로 나이가 어릴수록 여지를 주고(rules.cards.potential.bonus: [최대 나이, 최소, 최대]),
 * 그 선수의 커리어 하이(careerHigh)를 기준점으로 삼아 어린 나이에는 그 근처까지 오를 수 있게 한다(highGap: [최대 나이, 커리어 하이에서 깎는 값], 99면 적용 안 함).
 * 보너스는 카드(kblId·시즌)로 고정된 난수라 같은 카드는 늘 같은 잠재력이다. 27세 이상은 엔진 규칙(withRatings)상 잠재력이 OVR로 수렴해 의미가 없다.
 */
export function cardPotential(card, ovr, careerHigh, potRules, age) {
  const row = potRules.bonus.find(([maxAge]) => age <= maxAge) ?? [99, 0, 0];
  const rnd = mulberry32(hashString(`pot:${card.kblId}:${card.season}`));
  const bonus = row[1] + Math.floor(rnd() * (row[2] - row[1] + 1));
  const gap = (potRules.highGap.find(([maxAge]) => age <= maxAge) ?? [99, 99])[1];
  // 보너스·highGap은 예전 OVR 눈금 기준이라 되돌려 계산한 뒤 지금 눈금으로 옮긴다(스타도 같은 폭의 성장 여지)
  const anchor = gap >= 99 ? 0 : legacyOvr(careerHigh) - gap;
  return Math.max(ovr, Math.min(OVR_MAX, fromLegacyOvr(Math.max(legacyOvr(ovr) + bonus, anchor))));
}

/**
 * 카드 → 게임 선수. 선수 id·구단·번호·계약은 호출하는 쪽이 정한다.
 * 카드의 나이를 그대로 쓴다(나이를 모르는 카드는 unknownAge). potentialRules·careerHigh를 주면 잠재력을 위처럼 풀어 주고,
 * 주지 않으면 잠재력 = 그 시즌 OVR(성장 여지 없음)이다. 나이가 들면 일반 노화를 받는다.
 */
export function cardPlayer(card, { id, teamId = null, number = 0, contract = { yearsLeft: 0 }, unknownAge = 27, potentialRules = null, careerHigh = null } = {}) {
  const stats = { shooting: card.shooting, passing: card.passing, defense: card.defense, rebound: card.rebound, athletic: card.athletic, stamina: card.stamina };
  const ovr = calcOvr(card.position, stats);
  const age = card.age ?? unknownAge;
  const potential = potentialRules ? cardPotential(card, ovr, careerHigh ?? ovr, potentialRules, age) : ovr;
  return {
    id, name: cardName(card.name, card.season), baseName: card.name, real: true, position: card.position, age, number: number,
    rarity: rarityOf(ovr, potential), stats, ovr, cost: calcCost(ovr), potential, origin: { d: 'domestic', f: 'foreign', a: 'asia' }[card.kind],
    kblId: card.kblId, teamId, contract, assets: { portrait: null, model: null },
    card: { season: card.season, label: cardYearLabel(card.season), teamId: card.teamId, gp: card.gp, minutes: card.min }
  };
}

/** 가중치대로 중복 없이 n개를 뽑는다. rng는 0~1 난수 함수. keyOf를 주면 같은 키(예: 같은 선수의 다른 시즌 카드)는 하나만 뽑는다 */
export function weightedSample(items, weightOf, n, rng, keyOf = null) {
  const pool = items.map((it) => ({ it, w: Math.max(0, weightOf(it)) })).filter((x) => x.w > 0);
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = rng() * total;
    let idx = pool.findIndex((x) => (r -= x.w) < 0);
    if (idx < 0) idx = pool.length - 1;
    const picked = pool[idx].it;
    out.push(picked);
    pool.splice(idx, 1);
    if (keyOf) { const k = keyOf(picked); for (let i = pool.length - 1; i >= 0; i--) if (keyOf(pool[i].it) === k) pool.splice(i, 1); }
  }
  return out;
}

/** OVR 가중치: OVR이 mid 이하면 1, 넘으면 scale마다 e배씩 줄어든다(scale > 0: 높은 카드가 드물게). scale이 음수면 거꾸로 e배씩 늘어난다(높은 카드 우대) */
export const ovrWeight = (ovr, { weightMid, weightScale }) => Math.exp(-Math.max(0, legacyOvr(ovr) - weightMid) / weightScale); // mid·scale은 예전 OVR 눈금 기준

/** 카드의 OVR(포지션 가중 평균) */
export const cardOvr = (card) => calcOvr(card.position, { shooting: card.shooting, passing: card.passing, defense: card.defense, rebound: card.rebound, athletic: card.athletic, stamina: card.stamina });

/** 외국인 카드의 요구 연봉(달러): OVR이 lo면 min, hi면 max, 그 사이는 직선. 만 달러 단위 */
export function foreignPriceUsd(ovr, { min, max, ovrLow, ovrHigh }) {
  const t = Math.max(0, Math.min(1, (legacyOvr(ovr) - ovrLow) / (ovrHigh - ovrLow))); // ovrLow·ovrHigh는 예전 OVR 눈금 기준
  return Math.round((min + (max - min) * t) / 10000) * 10000;
}
