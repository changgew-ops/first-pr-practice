import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflationIndex, rulesFor, indexOf } from '../src/economy.mjs';
import { demandEok, payrollEok, domesticOf } from '../src/valuation.mjs';
import { rookieSalary } from '../src/offseason.mjs';
import { priceIndex } from '../src/funds.mjs';
import { createLeague, playLeagueYear } from '../src/league.mjs';
import { mulberry32 } from '../src/rng.mjs';
import { Session } from '../web/lib/session.js';
import { loadHistory } from '../src/history.mjs';
import { invariants } from './helpers.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const rules = read('league-rules.json'), teams = read('teams.json'), players = read('players.json');
const infl = rules.economy.inflation;

test('물가 지수: 시작 시즌 1.0, 해마다 연 inflation만큼, 시작 이전은 1, 수입 쪽 지수와 같다', () => {
  assert.equal(inflationIndex(rules.economy.startYear, rules), 1);
  assert.equal(inflationIndex(rules.economy.startYear - 5, rules), 1);
  assert.ok(Math.abs(inflationIndex(2036, rules) - (1 + infl) ** 10) < 1e-12);
  let prev = 1;
  for (let y = 2027; y <= 2056; y++) { const v = inflationIndex(y, rules); assert.ok(v > prev); prev = v; }
  for (const y of [2026, 2030, 2045]) assert.equal(priceIndex(y, rules), inflationIndex(y, rules)); // 수입(객단가·중계권·스폰서)도 같은 지수
});

test('rulesFor: 시작 시즌은 원본 그대로, 원본은 바뀌지 않고, 같은 입력이면 같은 객체이며, 다시 넘겨도 원본에서 계산한다', () => {
  const before = JSON.stringify(rules);
  assert.equal(rulesFor(rules, 2026), rules);
  const a = rulesFor(rules, 2036);
  assert.equal(rulesFor(rules, 2036), a);
  assert.equal(JSON.stringify(rules), before);
  assert.equal(rulesFor(a, 2036), a, '이미 맞춘 규칙을 같은 시즌으로 다시 맞춰도 같다');
  assert.equal(rulesFor(a, 2040), rulesFor(rules, 2040), '다른 시즌으로 맞추면 원본에서 다시 계산한다(이중으로 곱하지 않는다)');
  assert.equal(indexOf(a), inflationIndex(2036, rules)); assert.equal(indexOf(rules), 1);
});

test('rulesFor: 금액 상수가 지수만큼 오르고 반올림 단위가 깔끔하며, 서로의 관계(한도·하한)가 유지된다', () => {
  const y = 2046, idx = inflationIndex(y, rules), r = rulesFor(rules, y);
  const near = (a, b, step) => assert.ok(Math.abs(a - b * idx) <= step / 2 + 1e-9, `${a} vs ${b * idx}`);
  near(r.salaryCap.domesticEok, rules.salaryCap.domesticEok, 0.1);
  near(r.salaryCap.foreignUsdTotal, rules.salaryCap.foreignUsdTotal, 10000);
  near(r.salaryCap.foreignUsdPerPlayer, rules.salaryCap.foreignUsdPerPlayer, 10000);
  near(r.salaryCap.minSalaryEok, rules.salaryCap.minSalaryEok, 0.01);
  near(r.salaryCap.soft.exemptContractEok, rules.salaryCap.soft.exemptContractEok, 0.01);
  near(r.offseason.emergencySalaryEok, rules.offseason.emergencySalaryEok, 0.01);
  near(r.offseason.rookieSalaryEok.bands[0].from, rules.offseason.rookieSalaryEok.bands[0].from, 0.01);
  near(r.asiaQuota.salaryEok[1], rules.asiaQuota.salaryEok[1], 0.1);
  near(r.cards.foreignUsd.max, rules.cards.foreignUsd.max, 10000);
  assert.equal(Math.round(r.salaryCap.domesticEok * 10), r.salaryCap.domesticEok * 10); // 0.1억 단위
  assert.equal(r.salaryCap.soft.maxOverRatio, rules.salaryCap.soft.maxOverRatio); // 비율은 그대로
  assert.deepEqual(r.salaryCap.soft.penaltyTiers, rules.salaryCap.soft.penaltyTiers);
  assert.ok(r.cards.foreignUsd.max <= r.salaryCap.foreignUsdPerPlayer);
  assert.ok(r.salaryCap.soft.exemptContractEok <= r.salaryCap.minSalaryEok + 1e-9);
  assert.equal(r.transactions.funds.start, rules.transactions.funds.start, '구단 자금 초기값은 곱하지 않는다');
  assert.equal(r.transactions.funds.foreignUsdToEok, rules.transactions.funds.foreignUsdToEok, '환율은 곱하지 않는다');
  // 신인 보수: 순번 구간 안에서 내려가고 최저 아래로 안 간다
  const cfg = r.offseason.rookieSalaryEok;
  for (let i = 1; i < 20; i++) assert.ok(rookieSalary(i, cfg) <= rookieSalary(i - 1, cfg) + 1e-9);
  assert.ok(rookieSalary(0, cfg) > rookieSalary(0, rules.offseason.rookieSalaryEok));
  assert.equal(rookieSalary(30, cfg), cfg.min);
});

test('금액처럼 보이는 모든 규칙값은 물가가 곱해지거나 예외 목록에 있다(새 금액 상수를 빼먹지 않는다)', () => {
  const r = rulesFor(rules, 2046);
  const EXEMPT = [/maxPick$/, /foreignUsdToEok$/, /foreignUsd\.ovr(Low|High)$/];
  const unchanged = [];
  (function walk(a, b, path) {
    if (a && typeof a === 'object') { for (const k of Object.keys(a)) if (k !== 'econ') walk(a[k], b?.[k], `${path}.${k}`); return; }
    if (typeof a === 'number' && /Eok|Usd/.test(path) && a === b && !EXEMPT.some((re) => re.test(path))) unchanged.push(path);
  })(rules, r, '');
  assert.deepEqual(unchanged, [], '물가가 곱해지지 않은 금액 상수');
});

test('요구 연봉(demandEok): rules를 주면 지수만큼 오르고, 안 주면 이전과 같다', () => {
  const p = { ovr: 70, potential: 72, age: 27 };
  const idx = inflationIndex(2046, rules), r = rulesFor(rules, 2046);
  assert.equal(demandEok(p), demandEok(p, rules));
  assert.ok(Math.abs(demandEok(p, r) - demandEok(p) * idx) <= 0.2, `${demandEok(p, r)} vs ${demandEok(p) * idx}`);
  assert.ok(demandEok({ ovr: 99, potential: 99, age: 27 }, r) <= 8 * idx + 0.1);
  assert.ok(demandEok({ ovr: 40, potential: 40, age: 30 }, r) >= 0.3 * idx - 0.1);
});

test('엔진: 오프시즌에 맺는 계약은 다음 시즌 규칙(캡·외국인 한도·최저 연봉) 안이고, 해마다 규칙이 유지된다', () => {
  const rng = mulberry32(5);
  let league = createLeague(players, rules);
  for (let y = 0; y < 6; y++) {
    const { league: next } = playLeagueYear(league, teams, rules, rng, {});
    invariants(next, `Y${y + 1}`); // helpers가 league.season의 물가 규칙으로 점검한다
    const r = rulesFor(rules, next.season);
    for (const p of next.players.filter((q) => q.origin === 'domestic')) assert.ok(p.contract.salaryEok <= 8 * indexOf(r) * 1.3, `${p.name} ${p.contract.salaryEok}`); // 연봉 곡선 상한도 지수만큼
    league = next;
  }
});

test('세션: 지금 시즌 규칙(session.rules)은 정규리그엔 그 시즌, 오프시즌엔 다음 시즌 지수다', () => {
  const data = { rules, teams, players, history: loadHistory(), profiles: read('players/profiles.json'), careers: read('players/careers.json'), cards: null };
  const s = Session.create(data, { managerId: 'busan-kcc', gmName: 'T', seed: 3 });
  assert.equal(s.rules, rules); // 2026-27: 지수 1
  while (!s.regularDone) s.advance(9);
  s.startPlayoffs(); for (let i = 0; i < 6 && s.stage === 'playoffs'; i++) { try { s.playoffRound(); } catch { break; } }
  if (s.stage !== 'offseason') s.endSeason();
  assert.equal(indexOf(s.rules), inflationIndex(2027, rules));
  assert.equal(s.rules.salaryCap.domesticEok, rulesFor(rules, 2027).salaryCap.domesticEok);
  s.decide('trade', { accept: [], proposals: [] }); // 오프시즌 결정이 다음 시즌 규칙으로 진행되는지(예외 없이)
  assert.ok(s.pending);
});

test('장기 시뮬(30시즌): 캡이 지수 곡선으로 오르고, 구단 평균 국내 연봉 총합이 캡의 일정한 비율을 유지한다', () => {
  const rng = mulberry32(11);
  let league = createLeague(players, rules, { history: loadHistory(), teamData: teams });
  const ratios = [];
  for (let y = 0; y < 30; y++) {
    const { league: next } = playLeagueYear(league, teams, rules, rng, {});
    const r = rulesFor(rules, next.season);
    const dom = next.players.filter((p) => p.origin === 'domestic');
    const avg = teams.reduce((s, t) => s + payrollEok(dom, t.id), 0) / teams.length;
    ratios.push(avg / r.salaryCap.domesticEok);
    league = next;
  }
  const mean = (a) => a.reduce((x, y) => x + y) / a.length;
  const early = mean(ratios.slice(0, 5)), late = mean(ratios.slice(-5));
  assert.ok(late > 0.6 && late < 1.1, `후반 연봉/캡 ${late.toFixed(2)}`);
  assert.ok(Math.abs(late - early) < 0.25, `연봉/캡 비율이 크게 변하지 않는다 ${early.toFixed(2)} → ${late.toFixed(2)}`);
});
