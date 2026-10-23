// 카드 도감: 우리 구단이 한 번이라도 보유·영입한 시즌 카드(선수 + 시즌)를 기록한다. 순수 함수(파일·브라우저 API 없음).
// 카드 키는 `${kblId}:${시즌}`(예: "230021:1997", "291001:2026-27"). 저장에는 키 목록만 남긴다(game.codex).
// 도감 전체 목록은 시즌 카드 데이터(data/cards, 생성물)와 시작 로스터의 시즌 카드("26 …")로 만든다.
import { cardOvr, cardName, cardYearLabel } from './cards.mjs';
import { rarityOf } from './factory.mjs';

export const cardKey = (kblId, season) => `${kblId}:${season}`;

/** 선수 → 카드 키(카드가 아닌 선수·kblId 없는 선수는 null) */
export function keyOfPlayer(p) {
  return p?.kblId != null && p.card?.season ? cardKey(p.kblId, p.card.season) : null;
}

const CATALOG_CACHE = new WeakMap();

/**
 * 도감 전체 목록. cards: { domestic, foreign }(expandCard 한 객체들), startPlayers: 게임 시작 로스터(data.players, 실제 선수만), startSeason: 시작 시즌(예: '2026-27')
 * 반환: [{ key, kblId, season, label, name, display("98 서장훈"), kind('d'|'f'|'a'), position, age, teamId, ovr, rarity }] — 데이터 순서(오래된 시즌부터), 같은 입력이면 같은 객체(캐시)
 */
export function buildCatalog(cards, startPlayers = [], startSeason = '2026-27') {
  const hit = CATALOG_CACHE.get(cards);
  if (hit && hit.startSeason === startSeason && hit.n === startPlayers.length) return hit.list;
  const list = [];
  for (const group of [cards.domestic ?? [], cards.foreign ?? []]) {
    for (const c of group) {
      const ovr = cardOvr(c);
      list.push({ key: cardKey(c.kblId, c.season), kblId: c.kblId, season: c.season, label: cardYearLabel(c.season), name: c.name, display: cardName(c.name, c.season), kind: c.kind, position: c.position, age: c.age, teamId: c.teamId, ovr, rarity: rarityOf(ovr, ovr) });
    }
  }
  for (const p of startPlayers) {
    if (!p.real || p.kblId == null) continue;
    list.push({ key: cardKey(p.kblId, startSeason), kblId: p.kblId, season: startSeason, label: cardYearLabel(startSeason), name: p.name, display: cardName(p.name, startSeason), kind: { domestic: 'd', foreign: 'f', asia: 'a' }[p.origin] ?? 'd', position: p.position, age: p.age, teamId: p.teamId, ovr: p.ovr, rarity: rarityOf(p.ovr, p.ovr) });
  }
  CATALOG_CACHE.set(cards, { list, startSeason, n: startPlayers.length });
  return list;
}

/**
 * 지금 우리 선수들 중 도감에 없던 카드 키(중복 없이). have: 배열 또는 Set. 반환: 새 키 배열(원본은 바꾸지 않는다)
 */
export function newCodexKeys(have, players, managerId) {
  const set = have instanceof Set ? have : new Set(have ?? []);
  const out = [];
  for (const p of players) {
    if (p.teamId !== managerId) continue;
    const k = keyOfPlayer(p);
    if (k && !set.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** 필터링: { collected: 'all'|'yes'|'no', rarity, position, kind, season, query } */
export function filterCatalog(catalog, have, f = {}) {
  const set = have instanceof Set ? have : new Set(have ?? []);
  const q = (f.query ?? '').trim();
  return catalog.filter((c) => {
    if (f.collected === 'yes' && !set.has(c.key)) return false;
    if (f.collected === 'no' && set.has(c.key)) return false;
    if (f.rarity && f.rarity !== 'all' && c.rarity !== f.rarity) return false;
    if (f.position && f.position !== 'all' && c.position !== f.position) return false;
    if (f.kind && f.kind !== 'all' && c.kind !== f.kind) return false;
    if (f.season && f.season !== 'all' && c.season !== f.season) return false;
    if (q && !c.name.includes(q)) return false;
    return true;
  });
}

/** 진행률: { total, got, byRarity: { rarity: [got, total] } } */
export function codexProgress(catalog, have) {
  const set = have instanceof Set ? have : new Set(have ?? []);
  const byRarity = {};
  let got = 0;
  for (const c of catalog) {
    const r = (byRarity[c.rarity] ??= [0, 0]);
    r[1]++;
    if (set.has(c.key)) { r[0]++; got++; }
  }
  return { total: catalog.length, got, byRarity };
}
