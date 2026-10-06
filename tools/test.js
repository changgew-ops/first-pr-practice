#!/usr/bin/env node
/* 자동 테스트: node tools/test.js  (의존성 없음)
 * 1) 데이터 무결성  2) 시즌 불변식  3) 저장/복원 결정론  4) 텍스트 토큰 치환
 */
const path = require('path');
['labels', 'protagonists', 'events', 'extra'].forEach((f) => require(path.join(__dirname, `../data/${f}.js`)));
const Engine = require(path.join(__dirname, '../src/engine.js'));
const D = global.GameData;

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('  ✗ ' + msg); } }
function section(t) { console.log('▸ ' + t); }

// ───────── 1. 데이터 무결성 ─────────
section('데이터 무결성');
ok(D.labels.reduce((a, l) => a + l.slots, 0) === 101, '레이블 슬롯 합계가 101이어야 함');
ok(D.protagonists.length === 12, '주인공은 12명');
ok(new Set(D.protagonists.map((p) => p.id)).size === 12, '주인공 id 중복 없음');
ok([1, 2, 3, 4, 5].every((n) => D.protagonists.some((p) => p.star === n)), '난이도 ★1~★5가 모두 존재');
D.protagonists.forEach((p) => {
  ok(D.labels.some((l) => l.id === p.label), `${p.name}: 존재하지 않는 레이블 ${p.label}`);
  ok(p.arc.beats.length === 3, `${p.name}: 서사 beat는 3개여야 함 (현재 ${p.arc.beats.length})`);
  p.arc.beats.forEach((b) => ok(b.choices.length >= 2 && b.choices.every((c) => c.result), `${p.name}: beat "${b.title}" 선택지/결과 누락`));
});
const FX_KEYS = new Set(['skill', 'stamina', 'mental', 'trust', 'favor', 'aw', 'coh', 'funds', 'fans', 'ready', 'risk', 'guard']);
const allFx = [];
D.daily.forEach((e) => {
  ok(e.id && e.title && e.text && e.choices && e.choices.length >= 2, `이벤트 형식 오류: ${e.id}`);
  if (e.only) ok(D.protagonists.some((p) => p.id === e.only), `${e.id}: only가 존재하지 않는 주인공`);
  e.choices.forEach((c) => { ok(!!c.result, `${e.id}: 결과 문구 누락`); allFx.push([e.id, c.fx]); });
});
D.protagonists.forEach((p) => p.arc.beats.forEach((b) => b.choices.forEach((c) => allFx.push([p.id, c.fx]))));
allFx.forEach(([id, fx]) => Object.keys(fx || {}).forEach((k) => ok(FX_KEYS.has(k), `${id}: 알 수 없는 fx 키 "${k}"`)));
ok(new Set(D.daily.map((e) => e.id)).size === D.daily.length, '일상 이벤트 id 중복 없음');
D.actions.forEach((a) => Object.keys(a.fx || {}).forEach((k) => ok(FX_KEYS.has(k), `행동 ${a.id}: 알 수 없는 fx 키 "${k}"`)));
console.log(`  일상 이벤트 ${D.daily.length}개 / 행동 ${D.actions.length}개`);

// ───────── 정책(결정론적 봇) ─────────
function policy(state, scene, mode) {
  if (scene.type === 'event') {
    const opts = scene.choices.map((c, i) => i).filter((i) => !scene.choices[i].disabled);
    if (mode === 'idle') return { choose: opts[opts.length - 1] };
    return { choose: scene.title === '방송 후 대응' ? opts[opts.length - 1] : opts[0] };
  }
  if (scene.type === 'actions') {
    const ids = scene.menu.map((m) => m.id);
    const p = Engine.player(state);
    const m = state.info.mission;
    const wk = Object.keys(m.w).sort((a, b) => m.w[b] * (88 - p.skills[b]) - m.w[a] * (88 - p.skills[a]))[0];
    let want;
    if (mode === 'idle') want = ['interview_prep', 'interview_prep'];
    else if (p.mental < 45) want = ['counsel'];
    else want = state.info.phase === 'prep'
      ? ['negotiate_main', 'train_' + (wk === 'variety' ? 'charm' : wk), 'interview_prep']
      : ['promo', 'fanservice', 'condition'];
    return { actions: want.filter((id) => ids.includes(id)), fallback: ids[0] };
  }
  return {};
}

const CUT_WEEKS = { 3: 60, 5: 35, 7: 22, 9: 16, 11: 13, 12: 11 };
function play(pid, seed, mode, onBoundaryWeek, hooks) {
  const state = Engine.newGame(pid, seed);
  const saved = {};
  Engine.onWeekBoundary = (s) => { if (s.week === onBoundaryWeek) saved.json = Engine.serialize(s); };
  return run(state, mode, hooks, saved);
}
function run(state, mode, hooks, saved) {
  const texts = [];
  for (let i = 0; i < 3000; i++) {
    const sc = Engine.next(state);
    if (!sc) throw new Error('장면 없이 종료');
    texts.push((sc.title || '') + ' ' + (sc.lines || []).join(' ') + ' ' + (sc.choices || []).map((c) => c.label + (c.result || '')).join(' '));
    if (hooks && hooks.onScene) hooks.onScene(state, sc);
    if (sc.type === 'ending') return { state, ending: sc, saved, texts };
    const a = policy(state, sc, mode);
    if (sc.type === 'event') Engine.choose(state, a.choose);
    else if (sc.type === 'actions') {
      (a.actions || []).forEach((id) => { if (state.slotsLeft > 0) Engine.doAction(state, id); });
      while (state.slotsLeft > 0) Engine.doAction(state, a.fallback);
    }
  }
  throw new Error('시즌이 끝나지 않음');
}

// ───────── 2. 시즌 불변식 ─────────
section('시즌 불변식 (12명 × 3시드 × 3전략)');
let runs = 0;
const arcLogs = [];
D.protagonists.forEach((p) => {
  ['pro', 'idle'].forEach((mode) => {
    for (let seed = 1; seed <= 3; seed++) {
      let res;
      try {
        res = play(p.id, 7000 + seed, mode, -1, {
          onScene(state, sc) {
            const alive = Engine.alive(state);
            alive.forEach((c) => {
              const vals = [c.awareness, c.favor, c.fans, c.coh, c.stamina, c.mental, ...Object.values(c.skills)];
              if (!vals.every(Number.isFinite)) throw new Error(`NaN 발생: ${c.name}`);
            });
            if (sc.type === 'rank' && sc.official && CUT_WEEKS[state.info.week]) {
              ok(alive.length === CUT_WEEKS[state.info.week], `${p.name}/${mode}/${seed}: ${state.info.week}주 생존 ${alive.length}명 (기대 ${CUT_WEEKS[state.info.week]})`);
              const ranks = alive.map((c) => c.rank).sort((x, y) => x - y);
              ok(ranks.every((r, i) => r === i + 1), `${p.name}: 순위가 1..N으로 연속이어야 함`);
            }
          },
        });
      } catch (e) { ok(false, `${p.name}/${mode}/${seed}: ${e.message}`); continue; }
      runs++;
      ok(!!res.state.final, `${p.name}: 엔딩 정보가 있어야 함`);
      ok(res.state.hist.length > 0, `${p.name}: 순위 기록이 있어야 함`);
      ok(res.texts.every((t) => !/\{(friend|rival)/.test(t)), `${p.name}: 치환되지 않은 토큰이 남아 있음`);
      const arcCount = res.state.log.filter((l) => l.text.startsWith('[서사]')).length;
      arcLogs.push([p.id, res.state.week, arcCount]);
      ok(arcCount <= 3, `${p.name}: 서사 beat가 3개를 초과함`);
      const reachedW10 = res.state.week >= 10 && !res.state.final.kind.startsWith('out');
      if (reachedW10 && res.state.final.kind !== 'withdraw') ok(arcCount === 3, `${p.name}/${mode}: 10주차까지 갔는데 서사 beat가 ${arcCount}개`);
    }
  });
});
console.log(`  ${runs}회 완주`);

// ───────── 3. 저장/복원 결정론 ─────────
section('저장/복원 결정론');
// 2주차 경계는 모든 주인공이 반드시 도달 (★5는 3주차에 탈락할 수 있음). 하연/유진은 6주차도 검증
const cases = [['hayeon', 2], ['taeri', 2], ['sodam', 2], ['yuna', 2], ['hayeon', 6], ['yujin', 6]];
cases.forEach(([pid, wk]) => {
  const a = play(pid, 4242, 'pro', wk);
  ok(!!a.saved.json, `${pid}: ${wk}주 경계 저장 데이터가 있어야 함`);
  Engine.onWeekBoundary = null;
  const restored = Engine.deserialize(a.saved.json);
  ok(restored.week === wk, `${pid}: 복원 주차 ${restored.week} (기대 ${wk})`);
  const b = run(restored, 'pro');
  const sig = (r) => JSON.stringify([r.state.final, r.state.log.map((l) => l.text), r.state.hist, Engine.player(r.state).votes]);
  ok(sig(a) === sig(b), `${pid}@${wk}주: 저장 후 이어서 한 결과가 원래 진행과 달라짐`);
  const info = Engine.saveInfo(a.saved.json);
  ok(info && info.name && info.week === wk, `${pid}: saveInfo 오류`);
});
ok((() => { try { Engine.deserialize('{"saveVersion":999}'); return false; } catch (e) { return true; } })(), '잘못된 저장 버전은 거부해야 함');

// ───────── 4. 서로 다른 시드는 다른 결과 ─────────
section('시드 다양성');
const outs = new Set();
for (let s = 1; s <= 12; s++) outs.add(play('hayeon', s * 31, 'pro', -1).state.contestants.map((c) => c.name).slice(0, 6).join());
ok(outs.size > 6, '시드가 달라지면 참가자 구성이 달라져야 함');

console.log(`\n${checks}개 검사, 실패 ${fails}개`);
process.exit(fails ? 1 : 0);
