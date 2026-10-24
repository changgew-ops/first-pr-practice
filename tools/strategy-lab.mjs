// 전략 실험실: 같은 구단·같은 시드에서 전략 봇을 여러 개 돌려 승수·순위·플레이오프·우승·재정을 비교한다(docs/BALANCE.md).
// 사용:  node tools/strategy-lab.mjs run <실험> [--seeds N] [--teams a,b,c] [--procs 4] [--out 폴더]
//        node tools/strategy-lab.mjs report <실험>      (저장된 원자료로 표만 다시 만든다)
//        실험: rest | tactic | acquire | staff | longrun
// 원자료는 --out(기본 /tmp/claude-0/x/lab/raw)에 JSON으로 저장하고 표는 같은 폴더의 <실험>.md로도 쓴다. 엔진은 읽기 전용이다.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCareer, loadBase, playSeason, playOffseason, leagueMetrics, slim } from './lab-bots.mjs';
import { Session } from '../web/lib/session.js';

const SELF = fileURLToPath(import.meta.url);
const DEFAULT_TEAMS = ['wonju-db', 'changwon-lg', 'suwon-kt']; // 표시 전력 1·5·10위(쉬운·중간·어려운 출발점)

// ---------- 전략 표 ----------
const REST = (below, max = 2) => ({ season: { rest: { below, max } } });
const ACE = { value: 'star', priceMul: 0.5, keepTop: 4 };
export const EXPERIMENTS = {
  rest: { seasons: 1, seeds: 80, base: 'auto', strategies: {
    auto: null, 'rest<75(2명)': REST(75), 'rest<70(2명)': REST(70), 'rest<65(2명)': REST(65), 'rest<60(2명)': REST(60), 'rest<55(2명)': REST(55), 'rest<70(1명)': REST(70, 1), 'rest<70(3명)': REST(70, 3)
  } },
  tactic: { seasons: 1, seeds: 80, base: '추천', strategies: {
    '추천': null, balanced: { season: { tactic: 'balanced' } }, fast: { season: { tactic: 'fast' } }, half: { season: { tactic: 'half' } },
    press: { season: { tactic: 'press' } }, inside: { season: { tactic: 'inside' } },
    '매일 최적': { season: { tactic: 'best' } }, '매일 최악': { season: { tactic: 'worst' } }
  } },
  acquire: { seasons: 10, seeds: 24, base: 'bal', strategies: {
    bal: null,
    'ace(캡 준수)': { offseason: { ...ACE, capMode: 'cap' } },
    'ace(캡 초과)': { offseason: { ...ACE, capMode: 'over' } },
    'depth(고른 선수층)': { offseason: { value: 'linear', priceMul: 2.0, keepTop: 12, capMode: 'cap' } },
    'youth(유망주+D리그)': { season: { programs: true }, offseason: { value: 'youth', draft: 'youth', capMode: 'cap' } },
    'vet(베테랑)': { offseason: { value: 'vet', draft: 'vet', capMode: 'cap' } },
    'bal(캡 초과)': { offseason: { value: 'linear', capMode: 'over' } }
  } },
  staff: { seasons: 5, seeds: 30, base: 'none', strategies: { none: null, '감독·코치 최고 영입': { season: { staff: true } } } },
  longrun: { seasons: 30, seeds: 10, base: 'auto', strategies: { auto: null }, kind: 'longrun' }
};

// ---------- 통계 ----------
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const se = (a) => (a.length > 1 ? sd(a) / Math.sqrt(a.length) : 0);
const f = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : v.toFixed(d));
const pm = (a, d = 1) => `${f(mean(a), d)} ±${f(se(a), d)}`;
/** 쌍 비교 차이(전략 − 기준): [평균, 95% 구간 하한, 상한] */
function diffCI(a, b) {
  const d = a.map((x, i) => x - b[i]);
  const m = mean(d), h = 1.96 * se(d);
  return { m, lo: m - h, hi: m + h, sig: m - h > 0 || m + h < 0 };
}
const sig = (c) => `${c.m >= 0 ? '+' : ''}${f(c.m, 2)} [${f(c.lo, 2)}, ${f(c.hi, 2)}]${c.sig ? ' *' : ''}`;

// ---------- 작업 실행(자식 프로세스) ----------
function runWorker(jobFile, outFile) {
  const jobs = JSON.parse(readFileSync(jobFile, 'utf8'));
  const exps = EXPERIMENTS;
  const out = [];
  for (const j of jobs) {
    const exp = exps[j.exp];
    const strat = exp.strategies[j.strat];
    if (exp.kind === 'longrun') out.push({ ...j, rows: runLongrun(j) });
    else out.push({ ...j, rows: runCareer({ teamId: j.team, seed: j.seed, seasons: exp.seasons, strat }) });
  }
  writeFileSync(outFile, JSON.stringify(out));
}

/** 30시즌 건전성: 시즌 시작마다 리그 지표와 신인 정착을 기록 */
function runLongrun(j) {
  const base = loadBase();
  const s = Session.create(base, { managerId: j.team, gmName: 'LAB', seed: j.seed });
  const rows = [];
  const draftees = []; // { id, pick, season }
  let prevStand = null;
  for (let i = 0; i < EXPERIMENTS.longrun.seasons; i++) {
    const lm = leagueMetrics(s);
    // 신인 정착: 최근 3시즌에 뽑힌 1·2순위가 지금 팀 안에서 OVR 5위 안(스타팅)인지
    const rosterRank = new Map();
    for (const t of base.teams) { const arr = s.players.filter((p) => p.teamId === t.id && p.origin === 'domestic').sort((a, b) => b.ovr - a.ovr); arr.forEach((p, k) => rosterRank.set(p.id, k + 1)); }
    const settle = draftees.filter((d) => i - d.season <= 3 && i - d.season >= 1).map((d) => ({ age: i - d.season, starter: (rosterRank.get(d.id) ?? 99) <= 5 }));
    const r = playSeason(s, null);
    const e = r.entry;
    const standings = e.standings.map((x) => ({ id: x.id, rank: x.rank, wins: x.wins }));
    const po = e.po;
    rows.push({ i, league: lm, standings, po, champ: e.championId, settle, retiredOvr: null, drafted: null, ledgerNet: Object.fromEntries(Object.entries(e.ledger).map(([k, v]) => [k, v.net])) });
    prevStand = standings;
    if (i < EXPERIMENTS.longrun.seasons - 1) {
      playOffseason(s, null);
      const rep = s.game.log.at(-1).report;
      rows.at(-1).retiredOvr = rep.retired?.length ? mean(rep.retired.map((x) => x.ovr)) : null;
      rows.at(-1).retiredN = rep.retired?.length ?? 0;
      rows.at(-1).drafted = rep.drafted?.length ? { n: rep.drafted.length, ovr: mean(rep.drafted.map((x) => x.ovr)), pot: mean(rep.drafted.map((x) => x.potential)), top2Ovr: mean(rep.drafted.slice(0, 2).map((x) => x.ovr)) } : null;
      for (const d of (rep.drafted ?? []).filter((x) => x.pick <= 2)) draftees.push({ id: d.id, pick: d.pick, season: i + 1 });
    }
  }
  return rows;
}

// ---------- 마스터 ----------
async function runAll(expName, { seeds, teams, procs, outDir }) {
  const exp = EXPERIMENTS[expName];
  const jobs = [];
  const teamList = exp.kind === 'longrun' ? teams.slice(0, 1) : teams;
  for (const team of teamList) for (let seed = 1; seed <= seeds; seed++) for (const strat of Object.keys(exp.strategies)) jobs.push({ exp: expName, team, seed, strat });
  mkdirSync(outDir, { recursive: true });
  const chunks = Array.from({ length: procs }, () => []);
  jobs.forEach((j, i) => chunks[i % procs].push(j));
  const t0 = Date.now();
  console.log(`[${expName}] 작업 ${jobs.length}개(${exp.seasons}시즌씩) → 프로세스 ${procs}개`);
  const files = chunks.map((c, k) => ({ job: join(outDir, `${expName}.job${k}.json`), res: join(outDir, `${expName}.res${k}.json`), n: c.length }));
  chunks.forEach((c, k) => writeFileSync(files[k].job, JSON.stringify(c)));
  await Promise.all(files.map((fl) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SELF, '--worker', fl.job, fl.res], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`워커 실패 ${c}`))));
  })));
  const all = files.flatMap((fl) => JSON.parse(readFileSync(fl.res, 'utf8')));
  writeFileSync(join(outDir, `${expName}.json`), JSON.stringify({ exp: expName, seeds, teams: teamList, took: (Date.now() - t0) / 1000, results: all }));
  console.log(`완료: ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}

// ---------- 표 ----------
function indexResults(results) {
  const m = new Map(); // key `${team}|${seed}|${strat}` → rows
  for (const r of results) m.set(`${r.team}|${r.seed}|${r.strat}`, r.rows);
  return m;
}
const early = (rows, k = 3) => rows.slice(0, k), late = (rows, k = 3) => rows.slice(-k);
const rowsMean = (rows, key) => mean(rows.map((r) => r[key]));

function tableSeasons(expName, data) {
  const exp = EXPERIMENTS[expName];
  const idx = indexResults(data.results);
  const strats = Object.keys(exp.strategies), base = exp.base;
  const lines = [];
  const slices = exp.seasons === 1 ? [['1시즌', (r) => r]] : exp.seasons >= 10 ? [['1~3시즌', (r) => early(r)], ['8~10시즌', (r) => late(r)], ['전체 10시즌', (r) => r]] : [['1~2시즌', (r) => early(r, 2)], ['4~5시즌', (r) => late(r, 2)], ['전체', (r) => r]];
  for (const [label, pick] of slices) {
    lines.push(`\n#### ${label}\n`);
    lines.push('| 전략 | 구단 | n | 승수 | 승수 차(기준 대비, 95% 구간) | PO 진출 | 우승 | 평균 순위 | 순이익(억) | 구단 자금(끝) | 소프트캡 기금(억) | 부상 건수 | 결장 경기 |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const team of [...data.teams, '전체']) {
      for (const st of strats) {
        const keys = [], baseVals = [], vals = [];
        for (const t of team === '전체' ? data.teams : [team]) for (let seed = 1; seed <= data.seeds; seed++) {
          const a = idx.get(`${t}|${seed}|${st}`), b = idx.get(`${t}|${seed}|${base}`);
          if (!a || !b) continue;
          keys.push(`${t}|${seed}`); vals.push(rowsMean(pick(a), 'wins')); baseVals.push(rowsMean(pick(b), 'wins'));
        }
        if (!vals.length) continue;
        const sel = (k) => { const out = []; for (const key of keys) { const [t, seed] = key.split('|'); const rr = idx.get(`${t}|${seed}|${st}`); out.push(...pick(rr).map((r) => r[k])); } return out.filter((x) => x != null); };
        const c = st === base ? null : diffCI(vals, baseVals);
        const selAll = (k) => { const out = []; for (const key of keys) { const [t, seed] = key.split('|'); out.push(...pick(idx.get(`${t}|${seed}|${st}`)).map((r) => r[k])); } return out; };
        const champ = mean(selAll('champ').map(Number)) * 100, po = mean(selAll('po').map((x) => (x ? 1 : 0))) * 100;
        const lastFunds = keys.map((key) => { const [t, seed] = key.split('|'); const rr = pick(idx.get(`${t}|${seed}|${st}`)); return rr.at(-1).funds; }).filter((x) => x != null);
        lines.push(`| ${st} | ${team} | ${vals.length} | ${pm(vals)} | ${c ? sig(c) : '(기준)'} | ${f(po, 0)}% | ${f(champ, 1)}% | ${f(mean(sel('rank')), 2)} | ${f(mean(sel('net')), 1)} | ${f(mean(lastFunds), 0)} | ${f(mean(sel('penalty')), 2)} | ${f(mean(sel('inj')), 1)} | ${f(mean(sel('injGames')), 0)} |`);
      }
    }
  }
  return lines.join('\n');
}

function tableLongrun(data) {
  const rows = data.results.flatMap((r) => r.rows.map((x) => ({ ...x, seed: r.seed })));
  const lines = ['\n#### 시즌 시작 시점 리그 지표(시드 평균)\n', '| 시즌 | 평균 OVR | 상위 120명 OVR | 80+ 수 | 75+ 수 | 평균 나이 | 급여/캡 | 구단 평균 자금 | 최저 자금 | 마이너스 구단 수 |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const i of [0, 1, 2, 4, 9, 14, 19, 24, 29]) {
    const rs = rows.filter((r) => r.i === i);
    if (!rs.length) continue;
    const g = (k) => mean(rs.map((r) => r.league[k]));
    lines.push(`| ${i + 1} | ${f(g('meanOvr'), 2)} | ${f(g('top120Ovr'), 2)} | ${f(g('n80'), 1)} | ${f(g('n75'), 1)} | ${f(g('meanAge'), 1)} | ${f(g('payrollCap'), 2)} | ${f(g('fundsMean'), 0)} | ${f(g('fundsMin'), 0)} | ${f(g('negFunds'), 1)} |`);
  }
  // 신인 정착
  const settle = rows.flatMap((r) => r.settle);
  lines.push('\n#### 드래프트 1·2순위 정착(뽑힌 뒤 N시즌 시점에 팀 국내 OVR 5위 안인 비율)\n', '| 뽑힌 뒤 | 표본 | 스타팅권 비율 |', '|---|---|---|');
  for (const age of [1, 2, 3]) { const s = settle.filter((x) => x.age === age); lines.push(`| ${age}시즌 | ${s.length} | ${f(mean(s.map((x) => (x.starter ? 1 : 0))) * 100, 0)}% |`); }
  // 은퇴·유입 수준
  const ret = rows.filter((r) => r.retiredOvr != null), dr = rows.filter((r) => r.drafted);
  lines.push('\n#### 은퇴 선수와 신인 유입(시즌당 평균)\n', '| 구분 | 인원 | OVR | 잠재력 |', '|---|---|---|---|');
  lines.push(`| 은퇴 | ${f(mean(ret.map((r) => r.retiredN)), 1)} | ${f(mean(ret.map((r) => r.retiredOvr)), 1)} | - |`);
  lines.push(`| 신인(드래프트 전체) | ${f(mean(dr.map((r) => r.drafted.n)), 1)} | ${f(mean(dr.map((r) => r.drafted.ovr)), 1)} | ${f(mean(dr.map((r) => r.drafted.pot)), 1)} |`);
  lines.push(`| 신인 1·2순위 | 2 | ${f(mean(dr.map((r) => r.drafted.top2Ovr)), 1)} | - |`);
  // 부진 팀 회복: 시즌 k 하위 3팀이 이후 5시즌 안에 PO 진출/우승
  const bySeed = new Map();
  for (const r of rows) { if (!bySeed.has(r.seed)) bySeed.set(r.seed, []); bySeed.get(r.seed).push(r); }
  let n = 0, po5 = 0, champ5 = 0, top3 = 0;
  const poStage = (r, id) => r.po?.[id];
  for (const list of bySeed.values()) {
    list.sort((a, b) => a.i - b.i);
    for (let k = 0; k < list.length - 5; k += 5) {
      const bottom = [...list[k].standings].sort((a, b) => b.rank - a.rank).slice(0, 3).map((x) => x.id);
      for (const id of bottom) {
        n++;
        const next = list.slice(k + 1, k + 6);
        if (next.some((r) => poStage(r, id))) po5++;
        if (next.some((r) => r.champ === id)) champ5++;
        if (next.some((r) => r.standings.find((x) => x.id === id).rank <= 3)) top3++;
      }
    }
  }
  lines.push('\n#### 부진한 팀의 회복(꼴찌 3팀 → 이후 5시즌 안에)\n', '| 표본(팀·시기) | PO 진출 | 3위 이내 | 우승 |', '|---|---|---|---|');
  lines.push(`| ${n} | ${f(po5 / n * 100, 0)}% | ${f(top3 / n * 100, 0)}% | ${f(champ5 / n * 100, 0)}% |`);
  // 우승 분포
  const champs = new Map();
  for (const r of rows) champs.set(r.champ, (champs.get(r.champ) ?? 0) + 1);
  lines.push('\n#### 우승 분포(시드×30시즌 합)\n', '| 구단 | 우승 횟수 |', '|---|---|');
  for (const [id, c] of [...champs].sort((a, b) => b[1] - a[1])) lines.push(`| ${id} | ${c} |`);
  return lines.join('\n');
}

function report(expName, outDir) {
  const data = JSON.parse(readFileSync(join(outDir, `${expName}.json`), 'utf8'));
  const text = expName === 'longrun' ? tableLongrun(data) : tableSeasons(expName, data);
  writeFileSync(join(outDir, `${expName}.md`), text);
  console.log(text);
  console.log(`\n(시드 ${data.seeds}, 구단 ${data.teams.join('·')}, ${data.took.toFixed(0)}초)`);
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
if (argv[0] === '--worker') {
  runWorker(argv[1], argv[2]);
} else if (argv[0] === 'run' || argv[0] === 'report') {
  const expName = argv[1];
  if (!EXPERIMENTS[expName]) { console.error(`실험: ${Object.keys(EXPERIMENTS).join(' | ')}`); process.exit(1); }
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const outDir = opt('out', '/tmp/claude-0/x/lab/raw');
  if (argv[0] === 'run') {
    await runAll(expName, { seeds: Number(opt('seeds', EXPERIMENTS[expName].seeds)), teams: opt('teams', DEFAULT_TEAMS.join(',')).split(','), procs: Number(opt('procs', 4)), outDir });
  }
  report(expName, outDir);
}
