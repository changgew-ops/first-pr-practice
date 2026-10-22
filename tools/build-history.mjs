// 팀 이력 빌드 도구: data/history/raw/*.json 을 검증하고 data/history/seasons.json, franchises.json 을 만든다.
//   npm run build:history
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync as rf, existsSync } from 'node:fs';
import { buildHistory, buildDrafts, buildEvents } from '../src/history-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));
const { seasons, franchises, errors, warnings } = buildHistory(join(ROOT, 'data/history/raw'), teams);

const draftBuild = buildDrafts(join(ROOT, 'data/history/drafts'), teams);
errors.push(...draftBuild.errors);
// 시즌별 소속 CSV(선수 이름 → 구단 id): FA 새 소속 교차 확인용. 2026-27은 등록선수 화면을 쓴다
const seasonTeams = new Map();
const readTeamCsv = (path) => new Map(rf(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && l !== 'name,team').map((l) => l.split(',').slice(0, 2)));
for (const season of ['2023-24', '2024-25', '2025-26']) {
  const f = join(ROOT, `data/players/team-${season}.csv`);
  if (existsSync(f)) seasonTeams.set(season, readTeamCsv(f));
}
const regFile = join(ROOT, 'data/players/registry.csv');
if (existsSync(regFile)) seasonTeams.set('2026-27', new Map(rf(regFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('name,')).map((l) => l.split(',').slice(0, 2))));
const eventBuild = buildEvents(join(ROOT, 'data/history/events'), teams, { seasonTeams });
errors.push(...eventBuild.errors);
if (errors.length) {
  console.error(`검증 실패 ${errors.length}건:\n` + errors.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
writeFileSync(join(ROOT, 'data/history/seasons.json'), JSON.stringify(seasons, null, 2) + '\n');
writeFileSync(join(ROOT, 'data/history/franchises.json'), JSON.stringify(franchises, null, 2) + '\n');
writeFileSync(join(ROOT, 'data/history/events.json'), JSON.stringify(eventBuild.events, null, 2) + '\n');
console.log(`시즌 이벤트 ${eventBuild.events.length}개 빌드 (data/history/events.json)`);
if (eventBuild.warnings.length) console.log(`이벤트 경고 ${eventBuild.warnings.length}건:\n` + eventBuild.warnings.map((w) => '  ' + w).join('\n'));
writeFileSync(join(ROOT, 'data/history/drafts.json'), JSON.stringify(draftBuild.drafts, null, 2) + '\n');
console.log(`신인 드래프트 ${draftBuild.drafts.length}개 빌드 (data/history/drafts.json)`);
console.log(`팀 이력 빌드 완료: ${seasons.length}개 시즌, ${franchises.length}개 구단`);
if (warnings.length) {
  console.log(`경고 ${warnings.length}건 (홈·원정 기록 합 불일치 등, 사이트 표시값 그대로):\n` + warnings.slice(0, 30).map((w) => '  ' + w).join('\n') + (warnings.length > 30 ? `\n  … 외 ${warnings.length - 30}건` : ''));
}
