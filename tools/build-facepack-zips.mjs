// 페이스팩(facepack/)을 내려받기용 ZIP 세 개로 나눈다. 의존성 없는 순수 Node(내장 zlib)로 ZIP을 직접 쓴다.
//   dist/facepack-공통.zip         코드·data.js·manifest·generated/·uniforms/·README 등 (faces/, offline/ 제외)
//   dist/facepack-사진-웹용.zip     faces/ (웹·개발 서버에서 쓰는 WebP 사진)
//   dist/facepack-사진-로컬용.zip   offline/ (HTML을 file://로 열 때 쓰는 데이터 조각)
// 세 ZIP 모두 최상위 폴더가 `facepack/`이라, 같은 위치에 풀면 하나의 facepack/ 폴더로 합쳐진다(공통 + 웹용 또는 로컬용, 둘 다 풀어도 된다).
// 각 ZIP은 10MB(10,485,760바이트) 이하여야 하며 넘으면 오류로 끝난다. 사진 파일은 저장소에 없으므로(.gitignore) 폴더가 비어 있으면 그 ZIP은 건너뛴다.
// 사용: node tools/build-facepack-zips.mjs [facepack 폴더] [출력 폴더]
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const LIMIT = 10 * 1024 * 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- CRC32 ----------
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ---------- ZIP 쓰기(저장/Deflate, UTF-8 파일명) ----------
function dosTime(d = new Date(2026, 9, 28, 0, 0, 0)) { // 같은 입력은 같은 ZIP이 되도록 고정 시각을 쓴다
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** entries: [{ name: 'facepack/…', data: Buffer }] → ZIP Buffer */
export function makeZip(entries) {
  const { time, date } = dosTime();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    let method = 0, body = data;
    if (data.length > 64) { const d = deflateRawSync(data, { level: 9 }); if (d.length < data.length * 0.95) { method = 8; body = d; } }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/** 만든 ZIP을 다시 읽어 파일 수·이름·CRC를 확인한다. 반환: [{ name, size }] */
export function verifyZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ZIP 끝 기록을 찾지 못했습니다');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('중앙 디렉터리 손상');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (data.length !== size || crc32(data) !== crc) throw new Error(`ZIP 검증 실패: ${name}`);
    out.push({ name, size });
    p += 46 + nl + el + cl;
  }
  return out;
}

// ---------- 파일 나누기 ----------
function walk(dir, base = dir, acc = []) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, base, acc); else acc.push(relative(base, p).replaceAll('\\', '/'));
  }
  return acc;
}

/** 폴더를 세 묶음으로 나눈다: { common, web, local } 각각 상대 경로 배열 */
export function splitFacepack(dir) {
  const all = walk(dir);
  return {
    common: all.filter((f) => !f.startsWith('faces/') && !f.startsWith('offline/')),
    web: all.filter((f) => f.startsWith('faces/')),
    local: all.filter((f) => f.startsWith('offline/'))
  };
}

const NAMES = { common: 'facepack-공통.zip', web: 'facepack-사진-웹용.zip', local: 'facepack-사진-로컬용.zip' };

export function buildZips(dir, outDir) {
  const parts = splitFacepack(dir);
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const [key, files] of Object.entries(parts)) {
    if (!files.length) { console.warn(`건너뜀: ${NAMES[key]} (파일 없음)`); continue; }
    const zip = makeZip(files.map((f) => ({ name: `facepack/${f}`, data: readFileSync(join(dir, f)) })));
    const entries = verifyZip(zip);
    if (entries.length !== files.length) throw new Error(`${NAMES[key]}: 파일 수가 맞지 않습니다`);
    const out = join(outDir, NAMES[key]);
    report.push({ key, out, files: files.length, bytes: zip.length });
    if (zip.length > LIMIT) throw new Error(`${NAMES[key]}가 10MB를 넘습니다: ${zip.length}바이트 (한도 ${LIMIT})`);
    writeFileSync(out, zip);
  }
  // HTML 파일만 쓰는 사용자용 한 묶음: 공통 + 로컬용(faces/ 제외). 합쳐서 10MB 이하일 때만 만든다
  const htmlFiles = [...parts.common, ...parts.local];
  if (parts.local.length) {
    const zip = makeZip(htmlFiles.map((f) => ({ name: `facepack/${f}`, data: readFileSync(join(dir, f)) })));
    verifyZip(zip);
    if (zip.length > LIMIT) throw new Error(`facepack.zip이 10MB를 넘습니다: ${zip.length}바이트 (한도 ${LIMIT})`);
    const out = join(outDir, 'facepack.zip');
    writeFileSync(out, zip);
    report.push({ key: 'html', out, files: htmlFiles.length, bytes: zip.length });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(root, 'facepack'));
  const outDir = resolve(process.argv[3] ?? join(root, 'dist'));
  if (!existsSync(dir)) { console.error(`폴더가 없습니다: ${dir}`); process.exit(1); }
  try {
    for (const r of buildZips(dir, outDir)) console.log(`${r.out}  ${(r.bytes / 1048576).toFixed(2)}MB (${r.bytes.toLocaleString()}바이트, 파일 ${r.files}개, 한도 ${LIMIT.toLocaleString()}바이트 이하)`);
    console.log('HTML만 쓰면 facepack.zip(공통+로컬용) 하나만 풀어 facepack/ 폴더를 게임 HTML 옆에 두세요. 웹서버에 올릴 때는 공통 + 웹용을 같은 위치에 풀면 됩니다.');
  } catch (e) { console.error(e.message); process.exit(1); }
}
