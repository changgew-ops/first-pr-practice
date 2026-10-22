// 정적 데이터 불러오기. 저장소 루트를 그대로 서빙하므로 ../data/ 경로를 쓴다.
const get = async (path) => {
  const res = await fetch(`../data/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res;
};
const json = async (path) => (await get(path)).json();

export async function loadData() {
  const [rules, teams, players, seasons, franchises, profiles, careers] = await Promise.all([
    json('league-rules.json'), json('teams.json'), json('players.json'),
    json('history/seasons.json'), json('history/franchises.json'), json('players/profiles.json'), json('players/careers.json')
  ]);
  return { rules, teams, players, history: { seasons, franchises }, profiles, careers };
}

/** 선수 이름(또는 별칭)으로 찾는 실제 프로필 (생년월일·키·학교·KBL 경력). 없으면 undefined */
export function profileIndex(profiles) {
  const m = new Map();
  for (const p of profiles) for (const n of [p.name, ...(p.aliases ?? [])]) m.set(n, p);
  return m;
}
