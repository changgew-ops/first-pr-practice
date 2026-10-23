// 정적 데이터 불러오기. 저장소 루트를 그대로 서빙하므로 ../data/ 경로를 쓴다.
// 개발 서버(저장소 루트 서빙)에서는 ../data/. 데이터를 다른 곳에 두고 서빙하는 쪽(예: 아티팩트 묶음)은 페이지에서 KBL_DATA_BASE를 먼저 정해 준다
const BASE = globalThis.KBL_DATA_BASE ?? '../data/';
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res;
};
import { expandCard } from '../../src/cards.mjs';
const json = async (path) => (await get(path)).json();

export async function loadData() {
  const [rules, teams, players, seasons, franchises, profiles, careers, cardsDomestic, cardsForeign] = await Promise.all([
    json('league-rules.json'), json('teams.json'), json('players.json'),
    json('history/seasons.json'), json('history/franchises.json'), json('players/profiles.json'), json('players/careers.json'),
    json('cards/domestic.json'), json('cards/foreign.json')
  ]);
  // 시즌 카드(과거 시즌의 선수 시즌 하나 = 카드 한 장): 신인 드래프트와 외국인 영입 후보로 쓴다
  const cards = { domestic: cardsDomestic.rows.map(expandCard), foreign: cardsForeign.rows.map(expandCard) };
  return { rules, teams, players, history: { seasons, franchises }, profiles, careers, cards };
}

/** 선수 이름(또는 별칭)으로 찾는 실제 프로필 (생년월일·키·학교·KBL 경력). 없으면 undefined */
export function profileIndex(profiles) {
  const m = new Map();
  for (const p of profiles) for (const n of [p.name, ...(p.aliases ?? [])]) m.set(n, p);
  return m;
}
