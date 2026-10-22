// 팀 이력 빌드 도구: data/history/raw/*.json 을 검증하고 data/history/seasons.json, franchises.json 을 만든다.
//   npm run build:history
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHistory } from '../src/history-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));
const { seasons, franchises, errors, warnings } = buildHistory(join(ROOT, 'data/history/raw'), teams);

if (errors.length) {
  console.error(`검증 실패 ${errors.length}건:\n` + errors.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
writeFileSync(join(ROOT, 'data/history/seasons.json'), JSON.stringify(seasons, null, 2) + '\n');
writeFileSync(join(ROOT, 'data/history/franchises.json'), JSON.stringify(franchises, null, 2) + '\n');
console.log(`팀 이력 빌드 완료: ${seasons.length}개 시즌, ${franchises.length}개 구단`);
if (warnings.length) {
  console.log(`경고 ${warnings.length}건 (홈·원정 기록 합 불일치 등, 사이트 표시값 그대로):\n` + warnings.slice(0, 30).map((w) => '  ' + w).join('\n') + (warnings.length > 30 ? `\n  … 외 ${warnings.length - 30}건` : ''));
}
