// 페이스팩을 단일 HTML 안에 넣는다(tools/build-standalone.mjs가 부른다). 폴더 없이 다른 PC에서도 사진이 나오게 하려는 것이다.
//  - 사진: facepack/faces/*.webp를 같은 비율로 줄여(기본 0.875배, WebP 품질 45) 선수 id별 base64로 내장한다. 얼굴 위치(faceBox)는 원본 대비 비율이라 그대로 맞는다.
//  - 유니폼 몸통 10장은 0.5배, 가상 얼굴 아틀라스는 너비 640으로 줄여 내장한다.
//  - 팩 코드(facepack.js)는 내장용으로 몇 군데 고쳐서(경로 대신 내장 표를 읽도록) KBLFacePackEmbed로 넣는다. 원본 facepack/facepack.js는 건드리지 않는다.
//  - 내장 데이터는 `<script type="application/json" id="kbl-embed">`에 두고 처음 쓸 때 한 번만 읽는다. 사진 하나하나는 필요할 때만 이미지로 만든다.
//  - 폴더가 옆에 있으면 어댑터(web/lib/faces.js)가 고해상도로 올려 쓴다.
// 실사 사진은 저장소에 올리지 않는다: 이 도구는 facepack/faces가 이 PC에 있을 때만 내장하고, 결과(dist/)도 커밋하지 않는다.
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const HTML_LIMIT = 10 * 1024 * 1024; // 10MB(10,485,760바이트)
export const HTML_TARGET = 9.3 * 1024 * 1024;

/** 기본 화질 설정(비교표로 고른 값, docs/QA.md 12절 참고) */
export const DEFAULT_PARAMS = { photoScale: 0.875, photoQuality: 45, uniformScale: 0.5, uniformQuality: 70, atlasWidth: 640, atlasQuality: 70 };

/** 내장 가능한 facepack 폴더인가(데이터와 사진이 모두 있어야 한다) */
export function hasEmbeddablePack(dir) {
  try { return existsSync(join(dir, 'data.js')) && existsSync(join(dir, 'facepack.js')) && readdirSync(join(dir, 'faces')).some((f) => f.endsWith('.webp')); } catch { return false; }
}

/** 팩 SDK를 내장용으로 고친다. 고칠 곳이 하나라도 없으면 팩 버전이 달라진 것이므로 오류로 알린다 */
export function patchSdk(src) {
  const rules = [
    ["const scriptBase=new URL('.',document.currentScript.src).href;", 'const scriptBase=location.href;'],
    ["const offline=location.protocol==='file:'||options.offline;", 'const offline=true;'],
    ["if(offline&&!global.KBL_FULL_BOOT)await script(base+'offline/boot.js');", ''],
    ["if(offline){if(!chunks.has(p.chunk))chunks.set(p.chunk,script(base+'offline/'+p.chunk+'.js'));await chunks.get(p.chunk);src=global.KBL_FULL_IMAGES[id];}", "src=global.KBL_EMB_IMAGES[id];if(!src)throw new Error('내장 사진 없음');"],
    ['global.KBLFacePack={version:VERSION,create,assignFace};', 'global.KBLFacePackEmbed={version:VERSION,create,assignFace};']
  ];
  let out = src;
  for (const [from, to] of rules) {
    if (!out.includes(from)) throw new Error(`facepack.js가 예상과 다릅니다(내장용으로 고칠 곳을 찾지 못함): ${from.slice(0, 60)}…`);
    out = out.replace(from, () => to);
  }
  if (!out.includes('global.KBL_FULL_BOOT')) throw new Error('facepack.js에서 KBL_FULL_BOOT를 찾지 못했습니다');
  return out.replaceAll('global.KBL_FULL_BOOT', 'global.KBL_EMB_BOOT');
}

/** 내장 표를 읽는 작은 코드(처음 쓸 때 JSON을 한 번 읽고, 사진은 부를 때만 데이터 URL로 만든다) */
export const LOADER = `(function(){
var cache=null,pre='data:image/webp;base64,';
function emb(){if(!cache){try{cache=JSON.parse(document.getElementById('kbl-embed').textContent);}catch(e){cache={photos:{},uniforms:{},atlas:null};}}return cache;}
window.KBL_EMB_IMAGES=new Proxy({},{get:function(_,id){var b=emb().photos[id];return b?pre+b:undefined;}});
window.KBL_EMB_BOOT=new Proxy({},{get:function(_,k){var e=emb();if(k==='atlas')return e.atlas?pre+e.atlas:undefined;var b=e.uniforms[k];return b?pre+b:undefined;}});
window.KBL_EMBED_INFO={get photos(){return Object.keys(emb().photos).length;}};
})();`;

/** 사진을 줄여 JSON으로 받는다(Python PIL). 반환 { json: 문자열, stats } */
export function resizePhotos(dir, params = DEFAULT_PARAMS) {
  const tmp = mkdtempSync(join(tmpdir(), 'fp-embed-'));
  try {
    const out = join(tmp, 'embed.json');
    const p = { ...DEFAULT_PARAMS, ...params };
    execFileSync('python3', ['-I', join(here, 'facepack-resize.py'), dir, out, p.photoScale, p.photoQuality, p.uniformScale, p.uniformQuality, p.atlasWidth, p.atlasQuality].map(String),
      { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
    const json = readFileSync(out, 'utf8');
    return { json, stats: JSON.parse(json).stats };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * HTML에 끼울 조각을 만든다.
 * 반환 { headScripts, dataScript, jsonScript, bytes, stats }: headScripts(팩 데이터+SDK+표 읽기)는 게임 스크립트보다 앞, jsonScript는 뒤에 둔다.
 */
export function buildEmbed(dir, params = DEFAULT_PARAMS, { json = null } = {}) {
  const { json: payload, stats } = json ?? resizePhotos(dir, params);
  const dataJs = readFileSync(join(dir, 'data.js'), 'utf8').replaceAll('</script', '<\\/script');
  const sdk = patchSdk(readFileSync(join(dir, 'facepack.js'), 'utf8')).replaceAll('</script', '<\\/script');
  const headScripts = `<script>\n${dataJs}\n</script>\n<script>\n${sdk}\n</script>\n<script>\n${LOADER}\n</script>`;
  const jsonScript = `<script type="application/json" id="kbl-embed">${payload}</script>`;
  return { headScripts, jsonScript, bytes: Buffer.byteLength(headScripts) + Buffer.byteLength(jsonScript), stats };
}
