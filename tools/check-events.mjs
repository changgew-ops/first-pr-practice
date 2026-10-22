// 시즌 이벤트 파일 하나만 검증한다(다른 시즌 파일이나 생성물은 건드리지 않는다).
//   node tools/check-events.mjs 2025-26
import { readFileSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildEvents } from '../src/history-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const season = process.argv[2];
const src = join(ROOT, `data/history/events/${season}.json`);
if (!season || !existsSync(src)) { console.error(`파일이 없습니다: data/history/events/${season}.json`); process.exit(1); }
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));
const readCsv = (p) => new Map(readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('name,')).map((l) => l.split(',').slice(0, 2)));
const seasonTeams = new Map();
for (const s of ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26']) { const f = join(ROOT, `data/players/team-${s}.csv`); if (existsSync(f)) seasonTeams.set(s, readCsv(f)); }
seasonTeams.set('2026-27', readCsv(join(ROOT, 'data/players/registry.csv')));
const dir = mkdtempSync(join(tmpdir(), 'ev-'));
try {
  copyFileSync(src, join(dir, `${season}.json`));
  const { events, errors, warnings } = buildEvents(dir, teams, { seasonTeams });
  for (const e of errors) console.log('오류  ' + e);
  for (const w of warnings) console.log('경고  ' + w);
  const ev = events[0];
  if (ev) console.log(`요약: 코칭 ${ev.coaching.length}, 트레이드 ${ev.trades.length}, 외국인 ${ev.foreign.length}, 은퇴 ${ev.retirements.reduce((a, g) => a + g.names.length, 0)}, 군 입대 ${ev.military.enlist.reduce((a, g) => a + g.names.length, 0)}, FA 대상 ${ev.fa?.targets.reduce((a, g) => a + g.names.length, 0) ?? 0}, FA 계약 ${ev.fa?.contracts.length ?? 0}`);
  console.log(errors.length ? `검증 실패 ${errors.length}건` : '검증 통과');
  process.exit(errors.length ? 1 : 0);
} finally { rmSync(dir, { recursive: true, force: true }); }
