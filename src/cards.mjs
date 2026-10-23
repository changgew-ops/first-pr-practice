// 시즌 카드: 공식 기록(1997~)의 선수 시즌 하나가 카드 한 장이 된다. "97 서장훈", "98 서장훈"처럼 같은 선수도 시즌마다 다른 카드다.
// 능력치는 그 시즌 리그 안의 백분위로 만들어(stats-rating.mjs) 시대가 달라도 비교된다. 카드의 잠재력은 그 시즌 능력치(성장 여지 없음)다.
// 이 파일은 브라우저와 node가 함께 쓰므로 파일 읽기를 하지 않는다(읽고 쓰는 일은 tools/build-cards.mjs).
import { emptyTotals } from './stats.mjs';
import { ratingsFromRows } from './stats-import.mjs';
import { calcOvr, calcCost } from './rating.mjs';
import { rarityOf } from './factory.mjs';
import { inferPosition } from './position.mjs';
import { positionFromRegistry, ageOn } from './real-players.mjs';

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

/**
 * 카드 → 게임 선수. 선수 id·구단·번호·계약은 호출하는 쪽이 정한다.
 * 카드의 나이를 그대로 쓴다(나이를 모르는 카드는 unknownAge). 잠재력은 그 시즌 OVR이라 성장 여지가 없고, 나이가 들면 일반 노화를 받는다.
 */
export function cardPlayer(card, { id, teamId = null, number = 0, contract = { yearsLeft: 0 }, unknownAge = 27 } = {}) {
  const stats = { shooting: card.shooting, passing: card.passing, defense: card.defense, rebound: card.rebound, athletic: card.athletic, stamina: card.stamina };
  const ovr = calcOvr(card.position, stats);
  return {
    id, name: cardName(card.name, card.season), baseName: card.name, real: true, position: card.position, age: card.age ?? unknownAge, number,
    rarity: rarityOf(ovr, ovr), stats, ovr, cost: calcCost(ovr), potential: ovr, origin: { d: 'domestic', f: 'foreign', a: 'asia' }[card.kind],
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

/** 능력치가 높은 카드일수록 드물게 나오도록 하는 가중치: OVR이 mid 이하면 1, 넘으면 scale마다 e배씩 줄어든다 */
export const ovrWeight = (ovr, { weightMid, weightScale }) => Math.exp(-Math.max(0, ovr - weightMid) / weightScale);

/** 카드의 OVR(포지션 가중 평균) */
export const cardOvr = (card) => calcOvr(card.position, { shooting: card.shooting, passing: card.passing, defense: card.defense, rebound: card.rebound, athletic: card.athletic, stamina: card.stamina });

/** 외국인 카드의 요구 연봉(달러): OVR이 lo면 min, hi면 max, 그 사이는 직선. 만 달러 단위 */
export function foreignPriceUsd(ovr, { min, max, ovrLow, ovrHigh }) {
  const t = Math.max(0, Math.min(1, (ovr - ovrLow) / (ovrHigh - ovrLow)));
  return Math.round((min + (max - min) * t) / 10000) * 10000;
}
