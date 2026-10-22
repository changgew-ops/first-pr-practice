// 시즌의 구단별 승·패 합계(정규리그 + 플레이오프)를 JSON으로 출력한다. 선수 기록 시트가 플레이오프까지 합친 누적이라 팀 아이콘 판독 검증에 쓴다.
//   node tools/team-totals.mjs 2024-25
import { loadHistory } from '../src/history.mjs';

const season = process.argv[2];
const s = loadHistory().seasons.find((x) => x.season === season);
if (!s) { console.error(`알 수 없는 시즌: ${season}`); process.exit(1); }
const t = Object.fromEntries(s.teams.map((x) => [x.franchiseId, { w: x.wins, l: x.losses }]));
for (const r of s.playoffs?.rounds ?? []) {
  for (const q of r.series) {
    t[q.a].w += q.winsA; t[q.a].l += q.winsB;
    t[q.b].w += q.winsB; t[q.b].l += q.winsA;
  }
}
console.log(JSON.stringify(t));
