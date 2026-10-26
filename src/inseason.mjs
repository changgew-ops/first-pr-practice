// 시즌 중 선수단 변동의 규칙: 시장에 남은 FA 영입, 외국선수 일시교체·시즌대체. 순수 함수만 둔다(진행기 src/season-run.mjs가 부른다).
// 외국선수 교체는 외국선수 관리규정 제3조·제8~10조, 값은 data/league-rules.json `inSeason`·`injuries`(게임용 단순화는 _note에 적혀 있다).
// 아시아쿼터 선수에게도 같은 구조를 쓴다: 제공된 규정에 아시아쿼터 교체 조항이 없어서 "외국인 선수와 같게" 해 달라는 사용자 지시를 따르는 게임용 가정이다(`inSeason.asia`).
import { mulberry32, hashString } from './rng.mjs';
import { legacyOvr } from './rating.mjs';
import { domesticOf, foreignOf, asiaOf, payrollEok, demandEok } from './valuation.mjs';
import { capAllows } from './freeagency.mjs';
import { cardPlayer, cardOvr, weightedSample, ovrWeight, foreignPriceUsd, careerHighIndex } from './cards.mjs';
import { foreignGameThresholds } from './injuries.mjs';

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** 시즌 일수 비율(0~1)만큼의 보수(억) — 시즌 중 계약·방출의 정산 보정에 쓴다 */
export const proratedEok = (eok, day, totalDays) => round2(eok * Math.max(0, Math.min(1, day / totalDays)));

/** 등번호: 구단에서 안 쓰는 가장 작은 번호(1부터) */
export function freeNumber(players, teamId) {
  const used = new Set(players.filter((p) => p.teamId === teamId).map((p) => p.number));
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 0;
}

// ---------- 시즌 중 FA ----------
/** 시즌 중 계약 기간 범위 [최소, 최대] (이번 시즌 포함) */
export const faYearsRange = (rules) => [rules.inSeason.fa.minYears, rules.inSeason.fa.maxYears];

/** 시장에 남은 선수의 요구 연봉(억): 오프시즌 요구액의 askingFactor배, 최저 연봉 이상 */
export function faAsking(p, rules) {
  return Math.max(rules.salaryCap.minSalaryEok, round1(demandEok(p, rules) * rules.inSeason.fa.askingFactor));
}

/**
 * 시즌 중 FA 영입 판정. offer: { salaryEok, years }. isManager면 캡 초과(소프트캡)를 직접 결정할 수 있다.
 * 반환: { ok, reason, asking, range }
 */
export function faSignCheck({ players, pool, teamId, playerId, offer, rules, isManager = false }) {
  const p = pool.find((x) => x.id === playerId);
  const range = faYearsRange(rules);
  if (!p) return { ok: false, reason: '시장에 남은 선수가 아닙니다', asking: null, range };
  const asking = faAsking(p, rules);
  if (p.origin !== 'domestic') return { ok: false, reason: '국내 선수만 영입할 수 있습니다', asking, range };
  if (domesticOf(players, teamId).length >= rules.roster.domestic) return { ok: false, reason: `국내 선수가 이미 ${rules.roster.domestic}명입니다. 먼저 한 명을 방출하세요`, asking, range };
  if (!(offer.salaryEok > 0)) return { ok: false, reason: '연봉을 입력해 주세요', asking, range };
  if (offer.salaryEok + 1e-9 < rules.salaryCap.minSalaryEok) return { ok: false, reason: `연봉은 최저 연봉 ${rules.salaryCap.minSalaryEok}억(보수 규정 제9조) 이상이어야 합니다`, asking, range };
  if (offer.salaryEok + 1e-9 < asking) return { ok: false, reason: `요구 연봉 ${asking.toFixed(1)}억보다 낮아 거절합니다`, asking, range };
  if (!Number.isInteger(offer.years) || offer.years < range[0] || offer.years > range[1]) return { ok: false, reason: `계약 기간은 ${range[0]}~${range[1]}년이어야 합니다(이번 시즌 포함)`, asking, range };
  if (!capAllows(payrollEok(players, teamId), offer.salaryEok, rules, { isManager })) return { ok: false, reason: '이 연봉으로는 샐러리캡 한도(소프트캡 상한)를 넘습니다', asking, range };
  return { ok: true, reason: null, asking, range };
}

/** 영입한 선수 객체(구단·번호·계약을 채운다) */
export function signedFa(p, { teamId, number, salaryEok, years }) {
  const q = { ...p, teamId, number, contract: { salaryEok, yearsLeft: years } };
  for (const k of ['prevTeamId', 'prevSalaryEok', 'prevRank']) delete q[k];
  return q;
}

// ---------- 외국선수 교체 ----------
/**
 * 시즌 중 외국인 후보 풀: 시즌 시작 상태에서 정해지는 카드 선수 몇 명(같은 시드·같은 로스터면 항상 같다).
 * 반환: [{ player, usd }]. 카드가 없으면 빈 배열.
 */
export function buildForeignPool({ players, freeAgents = [], usedKbl = [], cards, rules, season, seed = 0 }) {
  const cfg = rules.cards;
  if (!cards?.foreign || !cfg) return [];
  const present = new Set([...players, ...freeAgents].map((p) => p.kblId).filter(Boolean));
  const used = new Set(usedKbl);
  const eligible = cards.foreign.filter((c) => c.kind === 'f' && !present.has(c.kblId) && !used.has(c.kblId) && c.min >= cfg.minMinutes);
  const rng = mulberry32(hashString(`foreignpool:${seed}:${season}`));
  const highs = careerHighIndex(cards);
  const picked = weightedSample(eligible, (c) => ovrWeight(cardOvr(c), { weightMid: cfg.foreignWeightMid, weightScale: cfg.foreignWeightScale }), rules.inSeason.foreign.poolSize, rng, (c) => c.kblId);
  return picked.map((c, i) => {
    const player = cardPlayer(c, { id: `m${season}-f${String(i + 1).padStart(2, '0')}`, unknownAge: cfg.unknownAge, potentialRules: cfg.potential ?? null, careerHigh: highs.get(c.kblId) ?? null });
    return { player, usd: foreignPriceUsd(player.ovr, cfg.foreignUsd) };
  });
}

/** 외국인·아시아쿼터(교체 규칙이 같은 두 신분) */
export const isOverseas = (p) => p?.origin === 'foreign' || p?.origin === 'asia';
/** 신분별 교체 규칙값(inSeason.foreign | inSeason.asia) */
export const overseasCfg = (rules, origin) => (origin === 'asia' ? rules.inSeason.asia : rules.inSeason.foreign);
/** 화면·메시지용 신분 이름 */
export const ORIGIN_TEXT = { foreign: '외국인 선수', asia: '아시아쿼터 선수' };

/** 아시아쿼터 후보의 요구 연봉(억): OVR이 priceOvrLow면 아시아쿼터 연봉 범위의 하한, priceOvrHigh면 상한, 그 사이는 직선(0.1억 단위). 게임용 가정 */
export function asiaPriceEok(ovr, rules) {
  const { priceOvrLow: lo, priceOvrHigh: hi } = rules.inSeason.asia;
  const [min, max] = rules.asiaQuota.salaryEok;
  const t = Math.max(0, Math.min(1, (legacyOvr(ovr) - lo) / (hi - lo))); // priceOvrLow·High는 예전 OVR 눈금 기준
  return Math.round((min + (max - min) * t) * 10) / 10;
}

/**
 * 시즌 중 아시아쿼터 후보 풀: 카드 시장의 아시아쿼터 카드(kind 'a') 몇 장. 외국인 풀과 섞이지 않는다(각각 kind로 걸러낸다).
 * 반환: [{ player, eok }]. 카드가 없으면 빈 배열.
 */
export function buildAsiaPool({ players, freeAgents = [], usedKbl = [], cards, rules, season, seed = 0 }) {
  const cfg = rules.cards;
  if (!cards?.foreign || !cfg || !rules.inSeason.asia) return [];
  const present = new Set([...players, ...freeAgents].map((p) => p.kblId).filter(Boolean));
  const used = new Set(usedKbl);
  const eligible = cards.foreign.filter((c) => c.kind === 'a' && !present.has(c.kblId) && !used.has(c.kblId) && c.min >= cfg.minMinutes);
  const rng = mulberry32(hashString(`asiapool:${seed}:${season}`));
  const highs = careerHighIndex(cards);
  const picked = weightedSample(eligible, () => 1, rules.inSeason.asia.poolSize, rng, (c) => c.kblId);
  return picked.map((c, i) => {
    const player = cardPlayer(c, { id: `m${season}-a${String(i + 1).padStart(2, '0')}`, unknownAge: cfg.unknownAge, potentialRules: cfg.potential ?? null, careerHigh: highs.get(c.kblId) ?? null });
    return { player, eok: asiaPriceEok(player.ovr, rules) };
  });
}

export const KIND_TEXT = { temp: '일시교체', season: '시즌대체(부상)', other: '시즌대체(기타 사유)' };

/**
 * 외국선수 교체 판정.
 *  kind: 'temp'(일시교체) | 'season'(부상 시즌대체) | 'other'(기타 사유 시즌대체)
 *  injury: 교체되는 선수의 부상 { total(진단 결장 경기 수), left, temp(이미 일시교체 중이면 후보 id) } 또는 null
 *  state: { otherCount(이번 시즌 이 구단의 기타 사유 교체 횟수) }
 *  exclude: 연봉 합계에서 뺄 선수 id(일시교체 선수가 대신 뛰고 있어 지금은 명단에서 빠진 부상 선수)
 * 반환: { ok, reason }
 */
export function foreignReplaceCheck({ players, teamId, outId, candidate, kind, injury = null, state = { otherCount: 0 }, rules, exclude = [] }) {
  const out = players.find((p) => p.id === outId);
  if (!out || out.teamId !== teamId || !isOverseas(out)) return { ok: false, reason: '우리 구단의 외국인·아시아쿼터 선수가 아닙니다' };
  const asia = out.origin === 'asia';
  const who = ORIGIN_TEXT[out.origin];
  const f = overseasCfg(rules, out.origin);
  const th = foreignGameThresholds(rules, out.origin);
  if (out.temp) return { ok: false, reason: '일시교체로 들어온 선수는 다시 교체할 수 없습니다' };
  if (injury?.temp) return { ok: false, reason: '일시교체 선수가 뛰는 중입니다. 부상 선수가 돌아와 일시교체 선수가 떠난 뒤에 다시 교체할 수 있습니다' };
  if (!candidate) return { ok: false, reason: '후보 선수를 고르세요' };
  if (candidate.player.origin !== out.origin) return { ok: false, reason: `${who}는 같은 신분의 후보로만 교체할 수 있습니다` };
  if (kind === 'temp' || kind === 'season') {
    if (!injury || !(injury.left > 0)) return { ok: false, reason: `${KIND_TEXT[kind]}는 부상·질병으로 결장 중인 ${who}만 할 수 있습니다` };
    if (kind === 'temp' && injury.total < th.temporary) return { ok: false, reason: `일시교체는 진단 2주(약 ${th.temporary}경기) 이상일 때만 가능합니다(이번 진단 ${injury.total}경기)` };
    if (kind === 'season' && injury.total < th.season) return { ok: false, reason: `부상 시즌대체는 진단 8주(약 ${th.season}경기) 이상일 때만 가능합니다(이번 진단 ${injury.total >= 99 ? '시즌 아웃' : `${injury.total}경기`})` };
  } else if (kind === 'other') {
    if (state.otherCount >= f.otherReasonLimit) {
      return { ok: false, reason: asia
        ? `기타 사유 교체는 구단당 ${f.otherReasonLimit}회까지입니다(외국인 선수와 같은 횟수를 적용한 게임용 가정)`
        : `기타 사유 교체는 구단당 ${f.otherReasonLimit}회까지입니다. 3회째부터는 이사회 승인과 5경기 출전 정지가 필요해(제9조) 게임에서는 할 수 없습니다` };
    }
  } else return { ok: false, reason: '알 수 없는 교체 종류입니다' };
  if (asia) {
    // 아시아쿼터: 1인 연봉 상한은 아시아쿼터 연봉 범위의 상한(게임용), 구단 슬롯은 asiaQuota.max(교체되는 선수·일시교체로 비운 선수는 빼고 센다)
    const maxEok = rules.asiaQuota.salaryEok[1];
    if (candidate.eok > maxEok + 1e-9) return { ok: false, reason: `요구 연봉 ${candidate.eok}억이 아시아쿼터 연봉 상한(${maxEok}억)을 넘습니다` };
    const others = asiaOf(players, teamId).filter((p) => p.id !== outId && !exclude.includes(p.id)).length;
    if (others + 1 > rules.asiaQuota.max) return { ok: false, reason: `아시아쿼터는 구단당 ${rules.asiaQuota.max}명까지입니다` };
    return { ok: true, reason: null };
  }
  if (candidate.usd > rules.salaryCap.foreignUsdPerPlayer) return { ok: false, reason: `요구 연봉이 1인 한도(${Math.round(rules.salaryCap.foreignUsdPerPlayer / 10000)}만 달러)를 넘습니다` };
  // 월 보수 상한(제11조 ②)을 단순화: 교체되는 선수를 뺀 나머지 외국 선수와 후보의 연봉 합계가 구단 한도를 넘지 않게 한다
  const others = foreignOf(players, teamId).filter((p) => p.id !== outId && !exclude.includes(p.id)).reduce((s, p) => s + p.contract.salaryUsd, 0);
  if (others + candidate.usd > rules.salaryCap.foreignUsdTotal) {
    return { ok: false, reason: `외국 선수 연봉 합계가 한도(${Math.round(rules.salaryCap.foreignUsdTotal / 10000)}만 달러)를 넘습니다(다른 외국 선수 ${Math.round(others / 10000)}만 + 후보 ${Math.round(candidate.usd / 10000)}만)` };
  }
  return { ok: true, reason: null };
}

/** 영입한 외국인 선수 객체. temp면 일시교체 표시(교체되는 선수 id) */
export function signedForeign(cand, { teamId, number, years, temp = null, day = 0 }) {
  const pl = cand.player;
  return { ...pl, ovrWas: pl.ovrWas ?? pl.ovr, statsWas: pl.statsWas ?? { ...pl.stats }, teamId, number, contract: { salaryUsd: cand.usd, yearsLeft: years }, ...(temp ? { temp: { forId: temp, day } } : {}) };
}

/** 영입한 아시아쿼터 선수 객체(연봉은 억 원). temp면 일시교체 표시 */
export function signedAsia(cand, { teamId, number, years, temp = null, day = 0 }) {
  const pl = cand.player;
  return { ...pl, ovrWas: pl.ovrWas ?? pl.ovr, statsWas: pl.statsWas ?? { ...pl.stats }, teamId, number, contract: { salaryEok: cand.eok, yearsLeft: years }, ...(temp ? { temp: { forId: temp, day } } : {}) };
}

/** AI가 고르는 후보: 교체 판정을 통과한 후보 중 OVR − 가격(5만 달러당 1)이 가장 높은 선수(오프시즌 AI와 같은 기준) */
export function aiForeignChoice(pool, check, rules = null) {
  // 외국인은 5만 달러당 1, 아시아쿼터는 같은 값을 억 원으로 환산해 쓴다(5만 달러 = 0.7억). rules 없이 부르면 외국인 기준
  const price = (c) => (c.eok != null ? c.eok / (50000 * (rules?.transactions.funds.foreignUsdToEok ?? 0.000014)) : c.usd / 50000);
  return [...pool].filter((c) => check(c).ok).sort((a, b) => (legacyOvr(b.player.ovr) - price(b)) - (legacyOvr(a.player.ovr) - price(a)) || a.player.id.localeCompare(b.player.id))[0] ?? null;
}
