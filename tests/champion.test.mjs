// 우승 축하(web/lib/champion.js): 상황 판정·멘트 템플릿·사진 SVG가 모든 입력에서 깨지지 않는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { championSituation, championTexts, championPhotoSvg, photoRoster, podiumLayout, titleStats, nextSeasonLabel, CHAMPION_TEMPLATES } from '../web/lib/champion.js';
import { fill } from '../src/news.mjs';

const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const roster = players.filter((p) => p.teamId === 'busan-kcc').sort((a, b) => b.ovr - a.ovr);

const base = { teamName: '부산 KCC', season: '2026-27', gmName: '홍길동', regRank: 2, wins: 35, losses: 19, titles: 3, streak: 1, gmTitles: 1, opp: '서울 SK', myWins: 4, oppWins: 2, games: 6, bestOf: 7, mvpName: '26 허웅', mvpLine: '18.0점 4.0리바 3.0어시' };

test('상황 판정: 우선순위와 칩', () => {
  assert.equal(championSituation({ ...base, streak: 3 }).primary, 'threePeat');
  assert.equal(championSituation({ ...base, streak: 2 }).primary, 'backToBack');
  assert.equal(championSituation({ ...base, titles: 1, streak: 1 }).primary, 'clubFirst');
  assert.equal(championSituation({ ...base, regRank: 6 }).primary, 'underdog');
  assert.equal(championSituation({ ...base, gmTitles: 0 }).primary, 'gmFirst');
  assert.equal(championSituation({ ...base, games: 7, oppWins: 3 }).primary, 'decider');
  assert.equal(championSituation({ ...base, oppWins: 0, games: 4 }).primary, 'sweep');
  assert.equal(championSituation({ ...base, regRank: 1 }).primary, 'double');
  assert.equal(championSituation({ ...base, titles: 4 }).primary, 'nth');
  assert.ok(championSituation({ ...base, streak: 2 }).chips.includes('2연속 우승'));
});

test('통산 우승·연속 우승: 이번 시즌 포함 여부', () => {
  const rec = [{ stage: '우승' }, { stage: '결승' }, { stage: '우승' }, { stage: '우승' }];
  assert.deepEqual(titleStats(rec, { includesCurrent: true }), { titles: 3, streak: 2 });
  assert.deepEqual(titleStats(rec.slice(0, 3), { includesCurrent: false }), { titles: 3, streak: 2 });
  assert.deepEqual(titleStats([], { includesCurrent: false }), { titles: 1, streak: 1 });
  assert.equal(nextSeasonLabel('2026-27'), '2027-28');
  assert.equal(nextSeasonLabel('2099-00'), '2100-01');
});

test('멘트: 모든 상황에서 빈칸·미치환 없이 문장이 나온다', () => {
  const cases = [{}, { streak: 3 }, { streak: 2 }, { titles: 1 }, { regRank: 7 }, { gmTitles: 0 }, { games: 7, oppWins: 3 }, { oppWins: 0, games: 4 }, { regRank: 1 }, { titles: 5 }, { mvpName: null, mvpLine: null }, { opp: '고양 소노' }];
  for (const c of cases) {
    const t = championTexts({ ...base, ...c });
    for (const k of ['headline', 'gm', 'owner', 'fans', 'next']) {
      assert.ok(t[k] && t[k].length > 8, `${JSON.stringify(c)} ${k}`);
      assert.ok(!/[{}]|undefined|null|NaN/.test(t[k]), `${k}: ${t[k]}`);
    }
  }
  assert.deepEqual(championTexts(base), championTexts(base)); // 같은 입력은 같은 문장
});

test('멘트 템플릿: 모든 틀이 변수를 채우면 문장이 되고, 조사가 맞다', () => {
  const vars = { team: '부산 KCC', season: '2026-27', gm: '홍길동', rank: 2, rec: '35승 19패', opp: '서울 SK', series: '4승 2패', titles: 3, streak: 2, mvp: '허웅', mvpLine: '18점', next: '2027-28' };
  for (const group of Object.values(CHAMPION_TEMPLATES)) {
    for (const list of Array.isArray(group) ? [group] : Object.values(group)) {
      assert.ok(list.length >= 1);
      for (const tpl of list) {
        const out = fill(tpl, vars);
        assert.ok(out && !/[{}]/.test(out), tpl);
      }
    }
  }
  assert.ok(fill('{team:이/가} 정상', vars).startsWith('부산 KCC가')); // 받침 없는 마지막 글자 'C'(시) → 가
  assert.ok(fill('{opp:과/와}', vars).startsWith('서울 SK와'));
});

test('사진 로스터·시상대 자리: 중복 없고 MVP가 뒷줄 가운데, 겹치지 않는다', () => {
  const starters = roster.slice(0, 5), bench = roster.slice(5, 12), mvp = roster[8];
  for (const limit of [5, 6, 7, 8]) {
    const r = photoRoster({ starters, bench, finalsMvp: mvp, limit });
    assert.equal(r.length, limit);
    assert.equal(new Set(r.map((x) => x.p.id)).size, r.length);
    assert.equal(r.filter((x) => x.mvp).length, 1);
    const lay = podiumLayout(r);
    const mvpCard = lay.find((c) => c.mvp);
    assert.equal(mvpCard.row, 'back');
    for (const c of lay) { assert.ok(c.x >= 0 && c.x + c.size <= 960, `x ${c.x}`); assert.ok(c.y + c.size <= 412); }
    for (let i = 0; i < lay.length; i++) for (let j = i + 1; j < lay.length; j++) {
      const a = lay[i], b = lay[j];
      if (a.row !== b.row) continue;
      assert.ok(a.x + a.size <= b.x || b.x + b.size <= a.x, `겹침 ${a.p.id} ${b.p.id}`);
    }
  }
  const noMvp = photoRoster({ starters, bench, finalsMvp: null });
  assert.ok(noMvp.every((x) => !x.mvp));
});

test('사진 SVG: 유효한 SVG이고 NaN·미치환이 없으며 구단·시즌·MVP가 들어 있다', () => {
  const r = photoRoster({ starters: roster.slice(0, 5), bench: roster.slice(5, 12), finalsMvp: roster[1] });
  const data = { teamId: 'busan-kcc', teamName: '부산 KCC', season: '2026-27', regRank: 2, wins: 35, losses: 19, opp: '서울 SK', myWins: 4, oppWins: 2, mvpName: roster[1].name, roster: r };
  const svg = championPhotoSvg(data);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(!/NaN|undefined|\[object/.test(svg));
  assert.ok(svg.includes('2026-27 시즌 우승') && svg.includes('부산 KCC') && svg.includes('MVP'));
  assert.equal((svg.match(/<svg/g) ?? []).length, 1 + r.length); // 바깥 1 + 선수 카드마다 1
  assert.ok(!svg.includes('<image')); // 로고 주소를 주지 않으면 이미지 없음
  assert.ok(championPhotoSvg(data, { logoHref: 'x.png' }).includes('<image'));
  assert.equal(svg, championPhotoSvg(data)); // 결정적
});
