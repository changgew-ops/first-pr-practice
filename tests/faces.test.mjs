// 페이스팩 연동(web/lib/faces.js + 우승 화면 확장): 팩이 없어도 안전하고, 구단 매핑·결정적 얼굴·3줄 시상대·사진 SVG가 맞는지 확인한다.
// 실사 사진 파일(facepack/faces/)은 저장소에 없으므로 이 시험은 사진 없이도 통과해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PACK_TEAM, packTeamId, upgradeAvatar, facePicture, championPortraits, faceKeyOf, facesReady, loadFaces } from '../web/lib/faces.js';
import { championPhotoSvg, photoRoster, podiumLayout, MAX_PHOTO } from '../web/lib/champion.js';
import { avatarSvg } from '../web/lib/avatar.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const players = read('data/players.json');
const teams = read('data/teams.json');

test('구단 매핑: 게임 10개 구단이 모두 팩 구단 id에 대응하고 팩 data.js에 몸통이 있다', () => {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../facepack/data.js', import.meta.url), 'utf8'), ctx);
  const packTeams = new Set(ctx.window.UNIFORM_DATA.teams.map((t) => t.id));
  for (const t of teams) {
    assert.ok(PACK_TEAM[t.id], `${t.id} 매핑 없음`);
    assert.ok(packTeams.has(PACK_TEAM[t.id]), `${t.id} → ${PACK_TEAM[t.id]} 팩에 없음`);
  }
  assert.equal(new Set(Object.values(PACK_TEAM)).size, teams.length); // 서로 다른 몸통
  assert.equal(packTeamId('모르는-구단'), 'db'); // 잘못된 id는 오류 대신 기본 몸통
});

test('팩이 없는 환경(node): 아무 일도 하지 않고 기존 아바타가 그대로다', async () => {
  assert.equal(facesReady(), false);
  assert.equal(await loadFaces(), false); // document가 없으면 조용히 실패
  const p = players.find((x) => x.kblId) ?? players[0];
  assert.equal(facePicture(p), null);
  assert.equal(championPortraits([{ p }], p.teamId), null);
  assert.equal(upgradeAvatar({ replaceChildren() { throw new Error('호출되면 안 됨'); } }, p, {}), undefined);
  assert.ok(avatarSvg(p).startsWith('<svg')); // 기존 그림은 그대로
  assert.equal(faceKeyOf({ id: '' }), null);
});

test('시상대: 9~12명도 세 줄로 로스터 전체가 겹치지 않고 들어간다', () => {
  const roster = players.filter((p) => p.teamId === 'wonju-db').sort((a, b) => b.ovr - a.ovr);
  assert.ok(roster.length >= 12);
  for (let n = 9; n <= MAX_PHOTO; n++) {
    const r = photoRoster({ starters: roster.slice(0, 5), bench: roster.slice(5, 12), finalsMvp: roster[2], limit: n });
    assert.equal(r.length, n);
    const lay = podiumLayout(r);
    assert.equal(lay.length, n);
    assert.equal(lay.find((c) => c.mvp).row, 'back');
    for (const c of lay) { assert.ok(c.x >= 0 && c.x + c.size <= 960, `x ${c.x}`); assert.ok(c.y + c.size <= 412, `y ${c.y} ${c.size}`); }
    for (let i = 0; i < lay.length; i++) for (let j = i + 1; j < lay.length; j++) {
      const a = lay[i], b = lay[j];
      const sep = a.x + a.size <= b.x || b.x + b.size <= a.x || a.y + a.size <= b.y || b.y + b.size <= a.y;
      assert.ok(sep, `겹침 ${a.row}/${b.row} ${a.x},${a.y} ${b.x},${b.y}`);
    }
    // 트로피(가운데 480±62, 아래 412, 줄이면 0.72배)와 겹치지 않는다
    for (const c of lay) { if (c.row !== 'front') assert.ok(c.y + c.size <= 412 - 128 * 0.72 + 1, '트로피 침범'); }
  }
  assert.equal(photoRoster({ starters: roster.slice(0, 5), bench: roster.slice(5, 12), limit: 99 }).length, 12); // 상한 12
});

test('우승 사진 SVG: 사진 주소가 있으면 image로, 가상 얼굴은 "가상" 표시, 없으면 기존 일러스트', () => {
  const roster = players.filter((p) => p.teamId === 'wonju-db').sort((a, b) => b.ovr - a.ovr);
  const r = photoRoster({ starters: roster.slice(0, 5), bench: roster.slice(5, 12), finalsMvp: roster[0], limit: 12 });
  const data = { teamId: 'wonju-db', teamName: '원주 DB', season: '2026-27', regRank: 1, wins: 40, losses: 14, opp: '서울 SK', myWins: 4, oppWins: 1, mvpName: roster[0].name, roster: r };
  const plain = championPhotoSvg(data);
  assert.ok(!plain.includes('<image') && !plain.includes('>가상<'));
  assert.equal((plain.match(/<svg/g) ?? []).length, 1 + r.length); // 기존: 선수마다 SVG 한 장
  const photos = { [r[0].p.id]: { href: 'data:image/webp;base64,AAAA', virtual: false }, [r[1].p.id]: { href: 'data:image/webp;base64,BBBB', virtual: true } };
  const svg = championPhotoSvg(data, { photos });
  assert.equal((svg.match(/<image/g) ?? []).length, 2);
  assert.equal((svg.match(/>가상</g) ?? []).length, 1);
  assert.equal((svg.match(/<svg/g) ?? []).length, 1 + r.length - 2); // 사진이 있는 카드는 일러스트 SVG를 쓰지 않는다
  assert.ok(!/NaN|undefined|\[object/.test(svg));
  assert.equal(svg, championPhotoSvg(data, { photos })); // 결정적
});
