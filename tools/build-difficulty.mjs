// 팀 난이도 안내(data/difficulty.json, 생성물): 구단마다 첫 시즌을 반복 시뮬레이션해 우승·플레이오프 진출 확률을 재고,
// 그 숫자로 목표 태그와 난이도 단계를 규칙으로 정한다. 팀 선택 화면(web/views/new.js)이 읽는다.
// 사용:  npm run build:difficulty [-- --seeds 200 --rebuildSeeds 100 --procs 4]
//   무개입 봇 = 자동 편성·추천 전술. 기본 운영 봇 = 휴식 로테이션(컨디션 65 미만 주전 2명까지) + 훈련 집중 지정(상위 8명) + 기본 자동 단장.
// 엔진(규칙값·시작 로스터)이 바뀌면 값이 낡는다. 그래서 engineFingerprint를 같이 저장하고 tests/difficulty.test.mjs가 다르면 경고만 낸다.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCareer } from './lab-bots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const OUT = join(ROOT, 'data/difficulty.json');
const TMP = '/tmp/claude-0/x/lab/diff';

export const BOTS = {
  auto: null,
  basic: { season: { rest: { below: 65, max: 2 }, focus: true } }
};
/** 난이도·목표 태그 산정 규칙(임계값). 기본 운영 봇의 첫 시즌 결과로 정한다 */
export const RULES = {
  _note: '기본 운영 봇의 첫 시즌 반복 시뮬레이션 결과로 정한다. 난이도(level): 쉬움 = 우승 ≥ easyChamp 또는 PO 진출 ≥ easyPo, 보통 = PO 진출 ≥ midPo, 어려움 = PO 진출 ≥ hardPo, 그 밖은 매우 어려움. 목표 태그: 우승 ≥ tagChamp면 "우승 도전", PO 진출 ≥ tagPo면 "PO 경쟁", 그 밖은 "리빌딩". 임계값은 게임용 가정이다.',
  easyChamp: 0.2, easyPo: 0.9, midPo: 0.5, hardPo: 0.25, tagChamp: 0.12, tagPo: 0.4
};
const LEVELS = ['', '쉬움', '보통', '어려움', '매우 어려움'];

export function levelOf(first, r = RULES) {
  const { champ, po } = first;
  if (champ >= r.easyChamp || po >= r.easyPo) return 1;
  if (po >= r.midPo) return 2;
  if (po >= r.hardPo) return 3;
  return 4;
}
export function tagOf(first, r = RULES) {
  if (first.champ >= r.tagChamp) return '우승 도전';
  if (first.po >= r.tagPo) return 'PO 경쟁';
  return '리빌딩';
}

/** 엔진 지문: 규칙 파일의 경기·재정·성장에 영향을 주는 키들과 시작 로스터의 해시 */
export function engineFingerprint(root = ROOT) {
  const rules = JSON.parse(readFileSync(join(root, 'data/league-rules.json'), 'utf8'));
  const KEYS = ['protagonist', 'synergy', 'simulation', 'effective', 'tactics', 'condition', 'coaching', 'injuries', 'lineup', 'salaryCap', 'roster', 'transactions', 'offseason', 'economy', 'aging', 'revenue', 'playoffs', 'ratingModel', 'devProgram', 'fans', 'inSeason', 'waivers'];
  const pick = Object.fromEntries(KEYS.filter((k) => k in rules).map((k) => [k, rules[k]]));
  const sha = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);
  const players = readFileSync(join(root, 'data/players.json'), 'utf8');
  return { rules: sha(JSON.stringify(pick)), players: sha(players), keys: KEYS.filter((k) => k in rules) };
}

const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function runWorker(jobFile, outFile) {
  const jobs = JSON.parse(readFileSync(jobFile, 'utf8'));
  const out = jobs.map((j) => ({ ...j, rows: runCareer({ teamId: j.team, seed: j.seed, seasons: j.seasons, strat: BOTS[j.bot], protagonist: true }) })); // 새 게임의 기본(초보 도움 켬)과 같은 조건
  writeFileSync(outFile, JSON.stringify(out));
}

async function runJobs(name, jobs, procs) {
  mkdirSync(TMP, { recursive: true });
  const chunks = Array.from({ length: procs }, () => []);
  jobs.forEach((j, i) => chunks[i % procs].push(j));
  const files = chunks.map((c, k) => ({ job: join(TMP, `${name}.job${k}.json`), res: join(TMP, `${name}.res${k}.json`) }));
  chunks.forEach((c, k) => writeFileSync(files[k].job, JSON.stringify(c)));
  await Promise.all(files.map((fl) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SELF, '--worker', fl.job, fl.res], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`워커 실패 ${c}`))));
  })));
  return files.flatMap((fl) => JSON.parse(readFileSync(fl.res, 'utf8')));
}

function firstStats(rows) {
  const wins = rows.map((r) => r[0].wins), rank = rows.map((r) => r[0].rank);
  const n = rows.length;
  return {
    n, winsMean: +mean(wins).toFixed(1), winsSd: +sd(wins).toFixed(1), winsP10: pct(wins, 0.1), winsP50: pct(wins, 0.5), winsP90: pct(wins, 0.9),
    rankMean: +mean(rank).toFixed(2),
    po: +(rows.filter((r) => r[0].po).length / n).toFixed(3),
    champ: +(rows.filter((r) => r[0].champ).length / n).toFixed(3),
    top2: +(rank.filter((x) => x <= 2).length / n).toFixed(3),
    bottom3: +(rank.filter((x) => x >= 8).length / n).toFixed(3)
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
  const seeds = opt('seeds', 200), rebuildSeeds = opt('rebuildSeeds', 100), procs = opt('procs', 4);
  const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8')).map((t) => t.id);
  const t0 = Date.now();
  const jobs = [];
  for (const team of teams) for (let seed = 1; seed <= seeds; seed++) for (const bot of Object.keys(BOTS)) jobs.push({ team, seed, bot, seasons: 1 });
  console.log(`첫 시즌: ${jobs.length}개 작업`);
  const res = await runJobs('first', jobs, procs);
  const first = {};
  for (const team of teams) first[team] = Object.fromEntries(Object.keys(BOTS).map((bot) => [bot, firstStats(res.filter((r) => r.team === team && r.bot === bot).map((r) => r.rows))]));
  // 가장 약한 3개 구단(기본 운영 봇의 평균 승수가 낮은 순): 5시즌 리빌딩 경로
  const weakest = [...teams].sort((a, b) => first[a].basic.winsMean - first[b].basic.winsMean).slice(0, 3);
  const rj = [];
  for (const team of weakest) for (let seed = 1; seed <= rebuildSeeds; seed++) rj.push({ team, seed, bot: 'basic', seasons: 5 });
  console.log(`리빌딩 5시즌: ${rj.length}개 작업(${weakest.join(', ')})`);
  const rr = await runJobs('rebuild', rj, procs);
  const rebuild = {};
  for (const team of weakest) {
    const rows = rr.filter((r) => r.team === team).map((r) => r.rows);
    const n = rows.length;
    rebuild[team] = {
      seasons: 5, n,
      poBySeason: [0, 1, 2, 3, 4].map((i) => +(rows.filter((r) => r[i].po).length / n).toFixed(3)),
      winsBySeason: [0, 1, 2, 3, 4].map((i) => +mean(rows.map((r) => r[i].wins)).toFixed(1)),
      po5: +(rows.filter((r) => r.some((x) => x.po)).length / n).toFixed(3),
      champ5: +(rows.filter((r) => r.some((x) => x.champ)).length / n).toFixed(3),
      top3Within5: +(rows.filter((r) => r.some((x) => x.rank <= 3)).length / n).toFixed(3)
    };
  }
  const out = { _note: '생성물: tools/build-difficulty.mjs(npm run build:difficulty)로만 바꾼다. 구단마다 첫 시즌을 반복 시뮬레이션한 결과와 그것으로 정한 난이도·목표 태그.', version: 1, generated: new Date().toISOString().slice(0, 10), seeds, rebuildSeeds, protagonist: { on: true, edge: JSON.parse(readFileSync(join(ROOT, 'data/league-rules.json'), 'utf8')).protagonist?.edge ?? 0 }, // 새 게임 기본(초보 도움 켬)으로 돌렸다: 구단마다 "우리 구단"으로 보정을 받으므로 구단별 우승 확률의 합이 1보다 클 수 있다
  bots: { auto: '무개입(자동 편성·추천 전술)', basic: '기본 운영(휴식 로테이션 + 훈련 집중 + 기본 자동 단장)' }, rules: RULES, engineFingerprint: { ...engineFingerprint(), date: new Date().toISOString().slice(0, 10) }, teams: {} };
  for (const team of teams) {
    const f = first[team].basic;
    const level = levelOf(f), tag = tagOf(f);
    out.teams[team] = { level, levelLabel: LEVELS[level], tag, first: first[team], rebuild: rebuild[team] ?? null };
  }
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`쓰기: ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  console.log('구단 | 무개입 승 | 기본 승 | PO | 우승 | 난이도 | 태그');
  for (const team of teams) { const t = out.teams[team]; console.log(`${team} | ${t.first.auto.winsMean} | ${t.first.basic.winsMean} | ${(t.first.basic.po * 100).toFixed(0)}% | ${(t.first.basic.champ * 100).toFixed(0)}% | ${t.levelLabel} | ${t.tag}`); }
}

const argv = process.argv.slice(2);
if (argv[0] === '--worker') runWorker(argv[1], argv[2]);
else if (process.argv[1] === SELF) await main();
