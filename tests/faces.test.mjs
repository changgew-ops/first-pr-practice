// 페이스팩 v2 연동(web/lib/faces.js + 우승 화면 확장 + tools/build-facepack-zips.mjs): 팩이 없어도 안전하고, 구단 매핑·결정적 얼굴·3줄 시상대·사진 SVG·ZIP 나누기가 맞는지 확인한다.
// 실사 사진 파일(facepack/faces/)은 저장소에 없으므로 이 시험은 사진 없이도 통과해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { PACK_TEAM, packTeamId, upgradeAvatar, facePicture, championPortraits, faceKeyOf, facesReady, loadFaces, candidateBases, describeDiagnostics, getFaceDiagnostics } from '../web/lib/faces.js';
import { championPhotoSvg, photoRoster, podiumLayout, MAX_PHOTO } from '../web/lib/champion.js';
import { avatarSvg } from '../web/lib/avatar.js';
import { makeZip, verifyZip, splitFacepack, buildZips, crc32, LIMIT } from '../tools/build-facepack-zips.mjs';
import { patchSdk, buildEmbed, hasEmbeddablePack, LOADER, HTML_LIMIT, HTML_TARGET, DEFAULT_PARAMS } from '../tools/build-facepack-embed.mjs';
import { execFileSync } from 'node:child_process';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const players = read('data/players.json');
const teams = read('data/teams.json');

test('구단 매핑: 게임 10개 구단이 모두 팩 구단 id에 대응하고 팩 data.js에 몸통이 있다', () => {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../facepack/data.js', import.meta.url), 'utf8'), ctx);
  const packTeams = new Set(ctx.window.KBL_FULL_DATA.teams.map((t) => t.id));
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
  assert.equal(await facePicture(p), null); // v2: 비동기
  assert.equal(await championPortraits([{ p }], p.teamId), null);
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

test('v2 명부: 게임 선수(players.json)의 kblId가 전부 팩 명부에 있고, 사진이 있는 선수 수를 센다', () => {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../facepack/data.js', import.meta.url), 'utf8'), ctx);
  const D = ctx.window.KBL_FULL_DATA;
  assert.equal(new Set(D.players.map((p) => p.id)).size, D.players.length); // 중복 id 없음
  assert.ok(D.players.every((p) => p.photo || /^gen-(0[1-9]|1[0-6])$/.test(p.fallbackFaceKey))); // 사진이 없으면 고정 가상 얼굴 번호
  const reg = new Map(D.players.map((p) => [p.id, p]));
  const ids = [...new Set(players.map((p) => String(p.kblId)))];
  const inPack = ids.filter((id) => reg.has(id));
  assert.equal(inPack.length, ids.length, `팩에 없는 kblId ${ids.filter((i) => !reg.has(i)).join(',')}`);
  assert.ok(inPack.filter((id) => reg.get(id).photo).length > 0);
});

test('ZIP 만들기: 읽어서 검증되고, 최상위는 facepack/, 공통·웹용·로컬용으로 나뉜다, 10MB 초과는 오류', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); // 표준 시험값
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  try {
    mkdirSync(join(dir, 'faces')); mkdirSync(join(dir, 'offline')); mkdirSync(join(dir, 'generated'));
    writeFileSync(join(dir, 'data.js'), 'window.X=1;'.repeat(100)); writeFileSync(join(dir, 'generated', 'atlas.webp'), Buffer.from([1, 2, 3, 4]));
    writeFileSync(join(dir, 'faces', '1.webp'), Buffer.from([9, 9])); writeFileSync(join(dir, 'offline', 'boot.js'), 'b'.repeat(500));
    const parts = splitFacepack(dir);
    assert.deepEqual(parts.common, ['data.js', 'generated/atlas.webp']);
    assert.deepEqual(parts.web, ['faces/1.webp']);
    assert.deepEqual(parts.local, ['offline/boot.js']);
    const out = join(dir, 'out');
    const rep = buildZips(dir, out);
    assert.equal(rep.length, 4); // 공통·웹용·로컬용 + HTML 전용 한 묶음(facepack.zip)
    for (const r of rep) { assert.ok(r.bytes < LIMIT); const entries = verifyZip(readFileSync(r.out)); assert.ok(entries.every((e) => e.name.startsWith('facepack/'))); }
    assert.throws(() => verifyZip(Buffer.concat([makeZip([{ name: 'facepack/a', data: Buffer.from('hello world, hello world, hello world, hello world, hello world, hello') }]).subarray(0, 40)])));
    // 10MB를 넘기면 오류(저장만 하는 큰 무작위 데이터)
    const big = randomBytes(LIMIT + 10); // 압축되지 않는 데이터
    writeFileSync(join(dir, 'faces', 'big.webp'), big);
    assert.throws(() => buildZips(dir, join(dir, 'out2')), /10MB/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('폴더 찾기 후보: 지정한 경로가 먼저, 중첩·ZIP 이름 폴더 변형을 모두 포함, 중복 없음', () => {
  const c = candidateBases('./facepack/');
  assert.equal(c[0], './facepack/');
  for (const need of ['./facepack/facepack/', './facepack-공통/facepack/', './facepack-사진-로컬용/facepack/', './facepack-사진-웹용/facepack/', '../facepack/']) assert.ok(c.includes(need), need);
  assert.equal(new Set(c).size, c.length);
  assert.equal(candidateBases('./내폴더')[0], './내폴더/'); // 끝에 /를 붙인다
  assert.ok(candidateBases(null).every((x) => x.endsWith('/')));
});

test('진단 문구: 상황마다 이유와 해야 할 일이 한국어로 나온다', () => {
  const tried = ['./facepack/', './facepack/facepack/'];
  const nf = describeDiagnostics({ status: 'notfound', tried });
  assert.match(nf.title, /폴더를 찾지 못했습니다/); assert.ok(nf.lines.join(' ').includes('./facepack/facepack/')); assert.equal(nf.level, 'info');
  const nl = describeDiagnostics({ status: 'nophotos-local', base: './facepack/', tried });
  assert.match(nl.title, /사진 조각\(offline\/\)이 없습니다/); assert.match(nl.lines.join(' '), /facepack-사진-로컬용\.zip/); assert.equal(nl.level, 'warn');
  const nw = describeDiagnostics({ status: 'nophotos-web', base: './facepack/' });
  assert.match(nw.lines.join(' '), /facepack-사진-웹용\.zip/);
  const ok = describeDiagnostics({ status: 'ready', base: './facepack/', commonBase: './facepack/', registry: 1454, photos: 1275, photoFails: 0, mode: 'file' }, { linked: { total: 149, withPhoto: 149 } });
  assert.equal(ok.level, 'ok'); assert.match(ok.lines.join(' '), /1,454명 중 사진 1,275명/); assert.match(ok.short, /149명 중 149명/);
  const nested = describeDiagnostics({ status: 'ready', base: './facepack/facepack/', commonBase: './facepack/facepack/', nested: 'double', registry: 10, photos: 5, photoFails: 0, mode: 'file' });
  assert.match(nested.lines[0], /또 facepack/);
  const warn = describeDiagnostics({ status: 'ready', base: './facepack/', commonBase: './facepack/', registry: 10, photos: 5, photoFails: 3, mode: 'file' });
  assert.equal(warn.level, 'warn'); assert.match(warn.lines.join(' '), /3명/);
  assert.match(describeDiagnostics({ status: 'error', detail: '이상함', base: null }).title, /열지 못했습니다/);
  assert.equal(getFaceDiagnostics().status === 'idle' || getFaceDiagnostics().status === 'failed', true); // node에서는 폴더 확인을 시작하지 않는다
});

// ---------- HTML 내장(tools/build-facepack-embed.mjs) ----------
test('내장용 SDK 고치기: 폴더 경로·offline 조각·currentScript 대신 내장 표를 읽고, 원본 이름과 겹치지 않는다', () => {
  const src = readFileSync(new URL('../facepack/facepack.js', import.meta.url), 'utf8');
  const out = patchSdk(src);
  assert.ok(!out.includes('currentScript'), 'currentScript(인라인에서는 src가 없다)가 남아 있다');
  assert.ok(!out.includes('KBL_FULL_BOOT') && !out.includes('KBL_FULL_IMAGES'), '파일 방식 전역이 남아 있다');
  assert.ok(!out.includes("'offline/'"), 'offline 조각 로드가 남아 있다');
  assert.match(out, /KBL_EMB_BOOT/); assert.match(out, /KBL_EMB_IMAGES\[id\]/);
  assert.match(out, /global\.KBLFacePackEmbed=/); assert.ok(!/global\.KBLFacePack=/.test(out), '폴더 팩의 KBLFacePack과 이름이 겹친다');
  assert.doesNotThrow(() => new vm.Script(out)); // 문법 오류 없음
  assert.throws(() => patchSdk('function(){}'), /예상과 다릅니다/); // 팩 버전이 다르면 조용히 넘어가지 않고 알린다
});

test('내장 한도와 기본 화질: 10MB 한도·9.3MB 목표, 사진 총량이 예산 안', () => {
  assert.equal(HTML_LIMIT, 10485760);
  assert.ok(HTML_TARGET < HTML_LIMIT);
  assert.ok(DEFAULT_PARAMS.photoScale > 0 && DEFAULT_PARAMS.photoScale <= 1);
  assert.ok(DEFAULT_PARAMS.photoQuality >= 30 && DEFAULT_PARAMS.photoQuality <= 90);
  assert.match(LOADER, /KBL_EMB_IMAGES/); assert.match(LOADER, /Proxy/); // 사진을 부를 때만 데이터 URL로 만든다
});

test('내장 만들기: 작은 가짜 팩으로 사진 id·몸통·아틀라스가 표와 일치하고 한도 안이다(실사 없이)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-emb-'));
  try {
    mkdirSync(join(dir, 'faces')); mkdirSync(join(dir, 'uniforms')); mkdirSync(join(dir, 'generated'));
    try {
      execFileSync('python3', ['-I', '-c', `
from PIL import Image
import os
d=${JSON.stringify(dir)}
for i,pid in enumerate(['111','222','333']):
    Image.new('RGBA',(160,240),(30*i+40,80,120,255)).save(os.path.join(d,'faces',pid+'.webp'),'WEBP')
for tid in ['db','sk']:
    Image.new('RGBA',(470,609),(10,20,30,255)).save(os.path.join(d,'uniforms',tid+'.webp'),'WEBP')
Image.new('RGBA',(1254,1254),(200,10,10,255)).save(os.path.join(d,'generated','atlas.webp'),'WEBP')
`], { stdio: 'pipe' });
    } catch { t.skip('python3/PIL 없음'); return; }
    writeFileSync(join(dir, 'data.js'), 'window.KBL_FULL_DATA={"players":[{"id":"111","photo":true},{"id":"222","photo":true},{"id":"333","photo":true}],"teams":[{"id":"db"},{"id":"sk"}]};');
    writeFileSync(join(dir, 'facepack.js'), readFileSync(new URL('../facepack/facepack.js', import.meta.url), 'utf8'));
    assert.equal(hasEmbeddablePack(dir), true);
    const e = buildEmbed(dir);
    const json = JSON.parse(e.jsonScript.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
    assert.deepEqual(Object.keys(json.photos).sort(), ['111', '222', '333']);
    assert.deepEqual(Object.keys(json.uniforms).sort(), ['db', 'sk']);
    for (const b64 of [...Object.values(json.photos), ...Object.values(json.uniforms), json.atlas]) assert.ok(Buffer.from(b64, 'base64').subarray(0, 4).toString() === 'RIFF', 'WebP 데이터가 아니다');
    assert.ok(e.bytes < HTML_LIMIT / 10);
    assert.ok(e.headScripts.includes('KBLFacePackEmbed') && e.headScripts.includes('KBL_FULL_DATA'));
    assert.ok(!e.headScripts.includes('</script></script>'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('내장 진단 문구: 폴더 없이 내장 사진만 쓰면 알려 주고, 폴더가 있으면 고해상도 연결을 알린다', () => {
  const base = { status: 'ready', embedded: true, mode: 'embedded', registry: 1454, photos: 1275, photoFails: 0, hi: null };
  const a = describeDiagnostics(base, { linked: { total: 149, withPhoto: 149 } });
  assert.equal(a.title, '내장 사진 사용 중'); assert.equal(a.level, 'ok');
  assert.match(a.lines.join(' '), /1,275명/); assert.match(a.lines.join(' '), /149명 중 149명/); assert.match(a.lines.join(' '), /facepack 폴더를 HTML 옆에/);
  const b = describeDiagnostics({ ...base, hi: './facepack/' });
  assert.match(b.lines.join(' '), /고해상도/); assert.match(b.short, /고해상도 폴더 연결/);
  assert.equal(describeDiagnostics({ ...base, photoFails: 2 }).level, 'warn');
});
