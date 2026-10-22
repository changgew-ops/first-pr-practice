// 가상 선수 데이터 생성기. 같은 시드면 항상 같은 결과가 나온다.
// 실명 로스터는 data/rosters/<teamId>.csv 로 넣을 수 있다 (data/rosters/README.md 참고).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STAT_KEYS, calcOvr, calcCost } from '../src/rating.mjs';
import { mulberry32, hashString } from '../src/rng.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20261022;

const rules = JSON.parse(readFileSync(join(ROOT, 'data/league-rules.json'), 'utf8'));
const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));

// ---------- 난수 ----------
const rng = mulberry32(SEED);
const rand = (min, max) => min + rng() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- 이름 (전부 가상) ----------
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN_A = ['민', '준', '현', '재', '성', '우', '진', '도', '승', '태', '지', '동', '영', '건', '찬', '시'];
const GIVEN_B = ['호', '우', '준', '혁', '민', '훈', '석', '규', '빈', '환', '원', '수', '철', '범', '율', '한'];
const FOREIGN_FIRST = ['Marcus', 'Devin', 'Terrell', 'Jalen', 'Andre', 'Caleb', 'Isaiah', 'Malik', 'Corey', 'Darius', 'Trevor', 'Jamal', 'Ryan', 'Elijah', 'Omar', 'Nolan'];
const FOREIGN_LAST = ['Webb', 'Holloway', 'Brooks', 'Sutton', 'Mercer', 'Dalton', 'Pierce', 'Rowe', 'Hale', 'Vance', 'Colby', 'Ellis', 'Fenn', 'Quill', 'Strand', 'Tate'];

const usedNames = new Set();
function uniqueName(origin) {
  for (let i = 0; i < 1000; i++) {
    const name = origin === 'foreign'
      ? `${pick(FOREIGN_FIRST)} ${pick(FOREIGN_LAST)}`
      : `${pick(SURNAMES)}${pick(GIVEN_A)}${pick(GIVEN_B)}`;
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
  }
  throw new Error('이름 풀이 부족합니다');
}

// ---------- 포지션 / 능력치 ----------
// 앞 5칸이 주전급 슬롯이므로 포지션이 한쪽에 몰리지 않게 섞어 둔다
const DOMESTIC_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SF'];
const FOREIGN_POSITIONS = ['C', 'C', 'PF', 'PF', 'SF', 'SG'];

// 목표 OVR 대비 능력치별 보정
const ARCHETYPE = {
  PG: { shooting: 0, passing: 10, defense: -2, rebound: -14, athletic: 2, stamina: 4 },
  SG: { shooting: 8, passing: 2, defense: 0, rebound: -12, athletic: 2, stamina: 2 },
  SF: { shooting: 2, passing: -2, defense: 2, rebound: -4, athletic: 4, stamina: 2 },
  PF: { shooting: -6, passing: -6, defense: 2, rebound: 8, athletic: 4, stamina: 0 },
  C: { shooting: -12, passing: -8, defense: 4, rebound: 14, athletic: 2, stamina: -2 }
};

function makeStats(position, target) {
  const stats = {};
  for (const k of STAT_KEYS) {
    stats[k] = clamp(Math.round(target + ARCHETYPE[position][k] + rand(-5, 5)), 20, rules.stats.max);
  }
  return stats;
}

function makePotential(age, ovr) {
  let bonus;
  if (age <= 22) bonus = randInt(4, 18);
  else if (age <= 26) bonus = randInt(1, 8);
  else if (age <= 30) bonus = randInt(0, 3);
  else bonus = 0;
  return clamp(ovr + bonus, ovr, rules.stats.max);
}

function rarityOf(ovr, pot) {
  const m = Math.max(ovr, pot);
  if (m >= 82) return 'legend';
  if (m >= 74) return 'ace';
  if (m >= 66) return 'rare';
  return 'common';
}

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

// ---------- 선수 생성 ----------
function buildPlayer(teamId, idx, spec, teamBase, slotOffset) {
  const origin = spec.origin;
  const seededRng = mulberry32(hashString(`${SEED}:${spec.name}`));
  const age = spec.age ?? (origin === 'foreign' ? 24 + Math.floor(seededRng() * 10) : 19 + Math.floor(seededRng() * 17));
  const target = teamBase + slotOffset + (origin === 'foreign' ? 8 : 0);
  const stats = makeStats(spec.position, target);
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
  const raw = domestic.map((p) => Math.max(0.3, 0.4 + (p.ovr - 45) * 0.06));
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
