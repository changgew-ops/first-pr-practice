#!/usr/bin/env node
/* 밸런스 시뮬레이션: 봇이 전 시즌을 자동 플레이하고 결과를 집계한다.
 * 사용: node tools/simulate.js [시드수=40] [전략=pro|smart|random|idle]
 * pro = 메인 파트 협상·분석 기반 훈련·홍보·결속을 쓰고 선택지는 건설적인 첫 번째를 고르는 숙련 플레이어
 */
const path = require('path');
require(path.join(__dirname, '../data/labels.js'));
require(path.join(__dirname, '../data/protagonists.js'));
require(path.join(__dirname, '../data/events.js'));
require(path.join(__dirname, '../data/extra.js'));
const Engine = require(path.join(__dirname, '../src/engine.js'));

const N = parseInt(process.argv[2] || '40', 10);
const STRATEGY = process.argv[3] || 'smart';

function pickActions(state, scene, rnd) {
  const ids = scene.menu.map((m) => m.id);
  const p = Engine.player(state);
  const phase = state.info.phase;
  const want = [];
  if (STRATEGY === 'idle') return [ids[ids.length - 1], ids[ids.length - 1]];
  if (STRATEGY === 'random') { for (let i = 0; i < 2; i++) want.push(ids[Math.floor(rnd() * ids.length)]); return want; }
  if (STRATEGY === 'pro') {
    const mm = state.info.mission;
    const wk = Object.keys(mm.w).sort((a, b) => mm.w[b] * (88 - p.skills[b]) - mm.w[a] * (88 - p.skills[a]))[0];
    if (p.mental < 45) want.push('counsel');
    if (p.stamina < 50 && phase === 'broadcast') want.push('condition');
    if (phase === 'prep') {
      if (state.info.kind !== 'open') want.push('negotiate_main');
      want.push('train_' + (wk === 'variety' ? 'charm' : wk));
      want.push('interview_prep', 'rehearse');
    } else {
      want.push('promo', 'fanservice', 'rehearse', 'condition');
    }
    return want.filter((id) => ids.includes(id));
  }
  // smart: 컨디션 > 약점 훈련 > 홍보/결속
  const m = state.info.mission;
  const worstKey = Object.keys(m.w).sort((a, b) => m.w[b] * (85 - p.skills[b]) - m.w[a] * (85 - p.skills[a]))[0];
  if (p.mental < 40) want.push('counsel');
  if (p.stamina < 45 && phase === 'broadcast') want.push('condition');
  if (phase === 'prep') {
    if (state.info.kind !== 'open') want.push(state.mgr.trust > 40 ? 'negotiate_safe' : 'negotiate_safe');
    want.push('train_' + (worstKey === 'rap' || worstKey === 'vocal' || worstKey === 'dance' || worstKey === 'charm' ? worstKey : 'charm'));
    want.push('interview_prep', 'rehearse');
  } else {
    want.push('promo', 'fanservice', 'rehearse', 'condition');
  }
  return want.filter((id) => ids.includes(id));
}

function play(pid, seed) {
  const state = Engine.newGame(pid, seed);
  const rnd = (() => { let a = seed * 7919 + 13; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; })();
  let steps = 0;
  const rankByWeek = {};
  while (steps++ < 2000) {
    const s = Engine.next(state);
    if (!s) break;
    if (s.type === 'ending') return { state, ending: s, rankByWeek };
    if (s.type === 'event') {
      const opts = s.choices.map((c, i) => i).filter((i) => !s.choices[i].disabled);
      if (STRATEGY === 'pro') {
        // 대응 장면은 동료 증언(마지막)을 우선, 나머지는 건설적인 첫 선택지
        const resp = s.title === '방송 후 대응';
        Engine.choose(state, resp ? opts[opts.length - 1] : opts[0]);
      } else Engine.choose(state, opts[Math.floor(rnd() * opts.length)]);
    } else if (s.type === 'actions') {
      const want = pickActions(state, s, rnd);
      let used = 0;
      for (const id of want) { if (state.slotsLeft <= 0) break; Engine.doAction(state, id); used++; }
      while (state.slotsLeft > 0) Engine.doAction(state, s.menu[Math.floor(rnd() * s.menu.length)].id);
    } else if (s.type === 'rank' && s.official) {
      rankByWeek[state.week] = Engine.player(state).rank;
    }
  }
  throw new Error('시즌이 끝나지 않음: ' + pid + ' seed=' + seed + ' week=' + state.week);
}

const protas = global.GameData.protagonists;
console.log(`전략=${STRATEGY}, 시드 ${N}회/주인공\n`);
console.log('주인공'.padEnd(8), '난이도', '데뷔율', '센터', '평균최종순위', '평균탈락주', '엔딩분포');
const t0 = Date.now();
let anyErr = 0;
protas.forEach((p) => {
  let debut = 0, center = 0, ranks = [], weeks = [], kinds = {};
  for (let i = 0; i < N; i++) {
    try {
      const r = play(p.id, 1000 + i);
      const f = r.state.final;
      kinds[f.kind] = (kinds[f.kind] || 0) + 1;
      if (f.kind === 'center' || f.kind === 'debut') debut++;
      if (f.kind === 'center') center++;
      ranks.push(f.rank); weeks.push(r.state.week);
    } catch (e) { anyErr++; console.error('ERR', p.id, i, e.message); }
  }
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(1);
  console.log(p.name.padEnd(8), '★'.repeat(p.star).padEnd(6), `${Math.round((debut / N) * 100)}%`.padStart(5), `${Math.round((center / N) * 100)}%`.padStart(5), avg(ranks).padStart(8), avg(weeks).padStart(8), JSON.stringify(kinds));
});
console.log(`\n완료 ${(Date.now() - t0)}ms, 오류 ${anyErr}건`);
process.exit(anyErr ? 1 : 0);
