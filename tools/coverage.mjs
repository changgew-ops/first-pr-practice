// 시즌별 데이터 현황표: 어떤 시즌에 어떤 자료가 들어 있는지 한눈에 본다. 에이전트와 사람이 "다음에 뭘 넣을지" 정할 때 쓴다.
//   npm run coverage            표를 출력
//   npm run coverage -- --write docs/DATA_STATUS.md   마크다운으로 저장
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadHistory } from '../src/history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { seasons } = loadHistory();
const json = (p) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), 'utf8')) : []);
const events = new Set(json('data/history/events.json').map((e) => e.season));
const drafts = new Set(json('data/history/drafts.json').map((d) => d.season));
const draftFull = new Set(json('data/history/drafts.json').filter((d) => d.participantsKnown).map((d) => d.season));
const has = (p) => existsSync(join(ROOT, p));

const COLUMNS = [
  ['순위', (s) => true],
  ['PO', (s) => Boolean(s.playoffs)],
  ['우승팀', (s) => s.championId !== null],
  ['라운드', (s) => Boolean(s.rounds)],
  ['상대전적', (s) => Boolean(s.headToHead)],
  ['수상', (s) => Boolean(s.awards)],
  ['기록', (s) => has(`data/stats/${s.season}.csv`)],
  ['공식기록', (s) => has(`data/stats/official/${s.season}.csv`)],
  ['소속', (s) => has(`data/players/team-${s.season}.csv`) || has(`data/stats/official/${s.season}.csv`) || s.season === '2025-26'],
  ['외국인', (s) => has(`data/history/foreign/${s.season}.json`)],
  ['이벤트', (s) => events.has(s.season)],
  ['드래프트', (s) => draftFull.has(s.season) ? 2 : drafts.has(s.season) ? 1 : false]
];
const mark = (v) => (v === 2 ? '●' : v === 1 ? '◐' : v ? '●' : '·');

const rows = [...seasons].reverse().map((s) => [s.season, ...COLUMNS.map(([, f]) => mark(f(s)))]);
// 아직 시즌 문서가 없는 다음 시즌(등록선수 화면 등으로 일부만 있음)
const next = '2026-27';
const nextRow = [next, '·', '·', '·', '·', '·', '·', has('data/stats/2026-27.csv') ? '◐' : '·', has('data/stats/official/2026-27.csv') ? '◐' : '·', has('data/players/registry.csv') ? '◐' : '·', has('data/history/foreign/2026-27.json') ? '●' : '·', events.has(next) ? '●' : '·', '·'];
const header = ['시즌', ...COLUMNS.map(([n]) => n)];
const table = [header, ...[nextRow, ...rows]];
const md = [
  '# 데이터 현황 (자동 생성)',
  '',
  '`npm run coverage -- --write docs/DATA_STATUS.md`로 다시 만든다. ●=있음, ◐=일부(진행 중 시즌 기록·등록선수 화면 / 드래프트 참가자 명단 없음), ·=없음.',
  '',
  '| ' + header.join(' | ') + ' |',
  '|' + header.map(() => '---').join('|') + '|',
  ...table.slice(1).map((r) => '| ' + r.join(' | ') + ' |'),
  '',
  '- 기록: `data/stats/<시즌>.csv` (선수 시즌 누적, 플레이오프 포함; 게임의 능력치 계산에 쓰는 시트)  - 공식기록: `data/stats/official/<시즌>.csv` (KBL 공식 기록, 정규시즌·플레이오프·챔피언결정전·소속팀별, 1997~)',
  '- 소속: `data/players/team-<시즌>.csv` (팀 아이콘 판독; 2025-26 포함, 2026-27은 등록선수 화면) 또는 공식 기록의 소속팀',
  '- 외국인: `data/history/foreign/<시즌>.json` (그 시즌에 뛴 외국인 선수 명단 전체, 나무위키 역대표 + 공식 기록 대조)',
  '- 이벤트: `data/history/events/<시즌>.json` (트레이드·외국인·FA·은퇴·군 입대·코칭)  - 드래프트: `data/history/drafts/<연도>.json` (그 시즌에 합류한 신인)',
  ''
].join('\n');

const argv = process.argv.slice(2);
const w = argv.indexOf('--write');
if (w >= 0) { writeFileSync(join(ROOT, argv[w + 1]), md); console.log(`→ ${argv[w + 1]}`); }
else console.log(table.map((r) => r.map((c, i) => String(c).padEnd(i === 0 ? 8 : 6, ' ')).join('')).join('\n'));
