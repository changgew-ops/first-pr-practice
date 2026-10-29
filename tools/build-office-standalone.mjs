// 단일 HTML 파일(dist/에이전트-오피스.html)로 오피스를 묶는다. 서버 없이 더블클릭으로 열린다(window.claude가 없으면 예시 직원으로 돌아간다).
// 이미지(atlas.png, props.png)와 atlas.json은 base64로 안에 넣고, 페이지가 읽는 'assets/…' 요청(fetch, Image)을 가로채 이 표에서 돌려준다.
// 사용: node tools/build-office-standalone.mjs   (의존성 없음)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = join(root, 'office/assets');
const page = readFileSync(join(root, 'office/office3.html'), 'utf8');

const files = { 'assets/atlas.png': 'image/png', 'assets/props.png': 'image/png', 'assets/atlas.json': 'application/json' };
const table = {};
for (const [path, mime] of Object.entries(files)) table[path] = `data:${mime};base64,${readFileSync(join(root, 'office', path)).toString('base64')}`;

// fetch('assets/…')와 img.src = 'assets/…'를 표로 돌려보내는 짧은 가림막. 페이지 코드는 건드리지 않는다
const shim = `<script>(function(){
var T=${JSON.stringify(table)};
var key=function(u){u=String(u);var i=u.indexOf('assets/');return i>=0?u.slice(i):u;};
var rf=window.fetch;
window.fetch=function(u,o){var k=key(u);if(T[k]){return rf.call(window,T[k],o);}return rf.apply(window,arguments);};
var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){var k=key(v);d.set.call(this,T[k]||v);}});
})();</script>`;

// db에 연결되지 않은 단일 HTML에서도 실제 직원 목록을 보이도록, office/snapshot.json(db를 내려받은 스냅샷)이 있으면 넣는다
let snapshotTag = '';
try { snapshotTag = `<script>window.__OFFICE_SNAPSHOT=${readFileSync(join(root, 'office/snapshot.json'), 'utf8').replace(/</g, '\\u003c')};</script>`; } catch { /* 스냅샷이 없으면 예시 직원 10명 */ }

// 호스트(claude.ai)가 붙이던 문서 틀을 직접 붙인다: 기본 리셋 + viewport
const skeleton = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>${shim}${snapshotTag}</head><body>
${body}
</body></html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/에이전트-오피스.html');
writeFileSync(out, skeleton(page));
console.log(`${out} (${(Buffer.byteLength(skeleton(page)) / 1048576).toFixed(1)}MB)`);
