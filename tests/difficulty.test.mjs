// 팀 난이도 안내(data/difficulty.json, 생성물): 형식·구단 전부 포함·값 범위를 확인하고, 엔진 지문이 현재와 다르면 경고만 낸다(실패하지 않는다).
// 갱신: npm run build:difficulty
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { levelOf, tagOf, RULES, engineFingerprint } from '../tools/build-difficulty.mjs';
import { simDifficulty, tagsFor, teamTraits } from '../web/views/new.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const teams = read('teams.json');
const PATH = new URL('../data/difficulty.json', import.meta.url);
const diff = existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : null;

test('난이도·태그 규칙: 임계값대로 단계가 나뉜다', () => {
  assert.equal(levelOf({ champ: 0.5, po: 0.99 }), 1);
  assert.equal(levelOf({ champ: 0, po: RULES.easyPo }), 1);
  assert.equal(levelOf({ champ: 0.05, po: 0.6 }), 2);
  assert.equal(levelOf({ champ: 0, po: 0.3 }), 3);
  assert.equal(levelOf({ champ: 0, po: 0.05 }), 4);
  assert.equal(tagOf({ champ: RULES.tagChamp, po: 0.2 }), '우승 도전');
  assert.equal(tagOf({ champ: 0.01, po: RULES.tagPo }), 'PO 경쟁');
  assert.equal(tagOf({ champ: 0, po: 0.1 }), '리빌딩');
});

test('difficulty.json: 형식과 값 범위, 모든 구단 포함', { skip: diff ? false : 'data/difficulty.json이 없다(npm run build:difficulty)' }, () => {
  assert.equal(diff.version, 1);
  assert.ok(diff.seeds >= 100, '표본이 너무 적다');
  assert.deepEqual(Object.keys(diff.teams).sort(), teams.map((t) => t.id).sort());
  for (const [id, t] of Object.entries(diff.teams)) {
    assert.ok([1, 2, 3, 4].includes(t.level), `${id} level`);
    assert.ok(['우승 도전', 'PO 경쟁', '리빌딩'].includes(t.tag), `${id} tag`);
    for (const bot of ['auto', 'basic']) {
      const f = t.first[bot];
      for (const k of ['po', 'champ', 'top2', 'bottom3']) assert.ok(f[k] >= 0 && f[k] <= 1, `${id} ${bot} ${k}`);
      assert.ok(f.champ <= f.po + 1e-9, `${id} ${bot}: 우승은 PO 진출의 부분집합`);
      assert.ok(f.winsMean > 5 && f.winsMean < 50 && f.winsP10 <= f.winsP50 && f.winsP50 <= f.winsP90, `${id} ${bot} 승수`);
      assert.ok(f.rankMean >= 1 && f.rankMean <= 10, `${id} ${bot} 순위`);
    }
    assert.equal(t.level, levelOf(t.first.basic, diff.rules), `${id}: 저장된 난이도가 저장된 규칙·결과와 맞다`);
    assert.equal(t.tag, tagOf(t.first.basic, diff.rules), `${id}: 태그`);
    if (t.rebuild) {
      assert.equal(t.rebuild.poBySeason.length, t.rebuild.seasons);
      assert.ok(t.rebuild.po5 >= Math.max(...t.rebuild.poBySeason) - 1e-9, '5시즌 안의 PO 진출 비율은 시즌별 비율의 최대 이상');
    }
  }
  // 우승 확률의 합은 1에 가깝다(우리가 우승한 비율을 구단별로 모으면 한 시즌에 한 팀만 우승)
  const sum = Object.values(diff.teams).reduce((a, t) => a + t.first.auto.champ, 0);
  assert.ok(sum > 0.8 && sum < 1.2, `무개입 우승 확률 합 ${sum.toFixed(2)}`);
});

test('engineFingerprint: 현재 엔진과 다르면 경고만 낸다(난이도가 낡았을 수 있다)', { skip: diff ? false : '파일 없음' }, () => {
  assert.ok(diff.engineFingerprint?.rules && diff.engineFingerprint?.players, '지문이 있다');
  const now = engineFingerprint();
  const stale = [];
  if (now.rules !== diff.engineFingerprint.rules) stale.push('규칙 파일');
  if (now.players !== diff.engineFingerprint.players) stale.push('시작 로스터');
  if (stale.length) console.warn(`[경고] data/difficulty.json은 ${diff.engineFingerprint.date} 기준입니다. ${stale.join('·')}이(가) 바뀌어 난이도 값이 낡았을 수 있습니다 → npm run build:difficulty`);
});

test('팀 선택 화면 변환: 값이 있으면 시뮬레이션 안내, 없거나 깨지면 null(자동 안내로 대신)', () => {
  assert.equal(simDifficulty(null, 'x'), null);
  assert.equal(simDifficulty({ teams: {} }, 'x'), null);
  assert.equal(simDifficulty({ teams: { x: { level: 9, first: { basic: { champ: 0.1, po: 0.5 } } } } }, 'x'), null);
  const sd = simDifficulty({ seeds: 200, teams: { x: { level: 2, tag: 'PO 경쟁', first: { basic: { champ: 0.034, po: 0.56 } }, rebuild: { seasons: 5, poBySeason: [0.1, 0.2, 0.4, 0.5, 0.6], po5: 0.8, champ5: 0.1 } } } }, 'x');
  assert.equal(sd.label, '보통'); assert.equal(sd.stars, '★★☆☆'); assert.equal(sd.tag, 'PO 경쟁');
  assert.match(sd.line, /시뮬레이션 200시즌 기준: 우승 3% · PO 진출 56%/);
  assert.match(sd.recovery, /5시즌 안에 PO 진출 80% · 우승 10% \(3시즌째 PO 40%\)/);
  // 태그: 시뮬레이션 태그가 앞, 자동 안내의 난이도성 태그는 빠진다
  const tr = teamTraits({ rank: 1, teams: 10, capRoomRank: 2, prestigeRank: 2 });
  assert.deepEqual(tagsFor(sd, tr), ['PO 경쟁', '전통 명문', '캡 여유']);
  assert.deepEqual(tagsFor(null, tr), tr.tags);
});
