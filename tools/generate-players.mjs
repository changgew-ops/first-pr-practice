// 가상 선수 데이터 생성기. 같은 시드면 항상 같은 결과가 나온다.
// 실명 로스터는 data/rosters/<teamId>.csv 로 넣을 수 있다 (data/rosters/README.md 참고).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calcOvr, calcCost } from '../src/rating.mjs';
import { parseStatsCsv, ratingsFromRows } from '../src/stats-import.mjs';
import { createFactory, DOMESTIC_SLOTS, FOREIGN_POSITIONS, rarityOf, rawSalaryEok } from '../src/factory.mjs';
import { mulberry32, hashString } from '../src/rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20261022;

const rules = JSON.parse(readFileSync(join(ROOT, 'data/league-rules.json'), 'utf8'));
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));

// ---------- 난수 / 공용 도구 ----------
const rng = mulberry32(SEED);
const usedNames = new Set();
const { rand, randInt, pick, uniqueName: makeName, makeStats, makePotential } = createFactory(rng, rules, usedNames);
const uniqueName = makeName;

// ---------- CSV (실명 로스터) ----------
function readRosterCsv(teamId) {
  const file = join(ROOT, 'data/rosters', `${teamId}.csv`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines.shift().split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    return {
      name: row.name,
      position: row.position,
      age: Number(row.age),
      number: Number(row.number),
      origin: row.origin === 'foreign' ? 'foreign' : 'domestic'
    };
  });
}

// ---------- 실제 기록 CSV (data/stats/base.csv) ----------
// 게임 시작 시점의 능력치는 직전 시즌 실제 기록에서 산출한다. 파일이 없으면 가상 능력치를 쓴다.
const statsFile = join(ROOT, 'data/stats/base.csv');
const statRows = existsSync(statsFile) ? parseStatsCsv(readFileSync(statsFile, 'utf8')) : [];
let statRatingByName = new Map();
if (statRows.length) {
  const positions = new Map();
  for (const t of teams) for (const r of readRosterCsv(t.id)) positions.set(r.name, r.position);
  statRatingByName = ratingsFromRows(statRows, positions, rules.ratingModel);
}
const matchedStatNames = new Set();

// ---------- 선수 생성 ----------
function buildPlayer(teamId, idx, spec, teamBase, slotOffset) {
  const origin = spec.origin;
  const seededRng = mulberry32(hashString(`${SEED}:${spec.name}`));
  const age = spec.age ?? (origin === 'foreign' ? 24 + Math.floor(seededRng() * 10) : 19 + Math.floor(seededRng() * 17));
  const target = teamBase + slotOffset + (origin === 'foreign' ? 8 : 0);
  const fromRecords = statRatingByName.get(spec.name);
  if (fromRecords) matchedStatNames.add(spec.name);
  const stats = fromRecords ? fromRecords.stats : makeStats(spec.position, target);
  const ovr = calcOvr(spec.position, stats);
  const potential = makePotential(age, ovr);
  return {
    id: `${teamId}-${String(idx + 1).padStart(2, '0')}`,
    name: spec.name,
    real: Boolean(spec.real),
    position: spec.position,
    age,
    number: spec.number,
    rarity: rarityOf(ovr, potential),
    stats,
    ovr,
    cost: calcCost(ovr),
    potential,
    origin,
    teamId,
    contract: { yearsLeft: randInt(1, 4) },
    assets: { portrait: null, model: null }
  };
}

function assignSalaries(players) {
  const domestic = players.filter((p) => p.origin === 'domestic');
  const raw = domestic.map((p) => rawSalaryEok(p.ovr));
  const total = raw.reduce((a, b) => a + b, 0);
  const capTarget = rules.salaryCap.domesticEok * rand(0.88, 0.97);
  const scale = total > capTarget ? capTarget / total : 1;
  domestic.forEach((p, i) => {
    p.contract.salaryEok = Math.floor(raw[i] * scale * 10) / 10;
  });
  const foreign = players.filter((p) => p.origin === 'foreign');
  let left = rules.salaryCap.foreignUsdTotal;
  foreign.forEach((p, i) => {
    const maxHere = Math.min(rules.salaryCap.foreignUsdPerPlayer, left - (foreign.length - 1 - i) * 200000);
    const usd = Math.floor(rand(Math.min(250000, maxHere), maxHere) / 10000) * 10000;
    p.contract.salaryUsd = usd;
    left -= usd;
  });
}

function buildTeam(team) {
  const teamBase = rand(58, 68);
  const fromCsv = readRosterCsv(team.id).map((r) => ({ ...r, real: true }));
  const domesticCsv = fromCsv.filter((r) => r.origin === 'domestic').slice(0, rules.roster.domestic);
  const foreignCsv = fromCsv.filter((r) => r.origin === 'foreign').slice(0, rules.roster.foreign);
  for (const r of fromCsv) usedNames.add(r.name);

  const usedNumbers = new Set(fromCsv.map((r) => r.number).filter(Number.isFinite));
  const freeNumber = () => {
    for (let i = 0; i < 200; i++) {
      const n = randInt(0, 45);
      if (!usedNumbers.has(n)) { usedNumbers.add(n); return n; }
    }
    throw new Error('등번호가 부족합니다');
  };

  const specs = [];
  const posPool = [...DOMESTIC_SLOTS];
  for (const r of domesticCsv) {
    const at = posPool.indexOf(r.position);
    if (at >= 0) posPool.splice(at, 1);
    specs.push(r);
  }
  while (specs.filter((s) => s.origin === 'domestic').length < rules.roster.domestic) {
    specs.push({ name: uniqueName('domestic'), position: posPool.shift() ?? pick(DOMESTIC_SLOTS), origin: 'domestic', number: freeNumber() });
  }
  for (const r of foreignCsv) specs.push(r);
  while (specs.filter((s) => s.origin === 'foreign').length < rules.roster.foreign) {
    specs.push({ name: uniqueName('foreign'), position: pick(FOREIGN_POSITIONS), origin: 'foreign', number: freeNumber() });
  }
  for (const s of specs) if (!Number.isFinite(s.number)) s.number = freeNumber();

  // 슬롯 순서대로 주전급 → 벤치로 목표 OVR 보정
  const offsets = [6, 5, 4, 3, 2, 0, -2, -4, -6, -8, -9, -10, -10, -10];
  const players = specs.map((s, i) => buildPlayer(team.id, i, s, teamBase, offsets[i] ?? -10));
  assignSalaries(players);
  return players;
}

const all = teams.flatMap(buildTeam);
const out = join(ROOT, 'data/players.json');
writeFileSync(out, JSON.stringify(all, null, 2) + '\n');
const real = all.filter((p) => p.real).length;
console.log(`players.json: ${all.length}명 (실명 ${real}명, 가상 ${all.length - real}명)`);
if (statRows.length) {
  const unmatched = [...statRatingByName.keys()].filter((n) => !matchedStatNames.has(n));
  console.log(`기록 반영: ${matchedStatNames.size}명 (기록 ${statRows.length}줄 중 로스터에 없는 이름 ${unmatched.length}명)`);
  if (unmatched.length) console.log(`  로스터에 없는 이름: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? ' …' : ''}`);
}
