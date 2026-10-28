// 단일 HTML 파일(dist/프로농구-단장-게임.html)로 게임을 묶는다. 서버 없이 더블클릭으로 열린다(오프라인 가능, 구글 폰트만 인터넷이 있으면 쓰고 없으면 기본 글꼴).
// 사용: npm i --no-save esbuild && node tools/build-standalone.mjs   (esbuild는 개발 도구로만 쓴다. 게임 코드는 의존성이 없다)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = await import(process.env.ESBUILD ?? 'esbuild');
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

// 1) 이미지 → data URI 표 (web/assets 아래 전부). 키는 저장소 루트 기준 경로
const assets = {};
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const mime = MIME[extname(f)];
    if (mime) assets[relative(root, p).replaceAll('\\', '/')] = `data:${mime};base64,${readFileSync(p).toString('base64')}`;
  }
})(join(root, 'web/assets'));

// 2) 게임이 fetch로 읽는 데이터 파일 표 (data/ 아래 필요한 것만). 키는 data/ 기준 경로
const dataFiles = ['league-rules.json', 'teams.json', 'players.json', 'arenas.csv', 'history/seasons.json', 'history/franchises.json', 'history/attendance.csv', 'players/profiles.json', 'players/careers.json', 'cards/domestic.json', 'cards/foreign.json', 'difficulty.json'];
for (const f of readdirSync(join(root, 'data/history/stats'))) if (f.endsWith('.json')) dataFiles.push(`history/stats/${f}`);
const data = {};
for (const f of dataFiles) data[f] = readFileSync(join(root, 'data', f), 'utf8');

// 3) JS 묶기. `new URL(경로, import.meta.url).href`는 이미지 표를 찾는 __asset(경로, 파일 폴더)로 바꾼다
const assetPlugin = {
  name: 'asset-url',
  setup(build) {
    build.onLoad({ filter: /\.(js|mjs)$/ }, (args) => {
      let src = readFileSync(args.path, 'utf8');
      if (!src.includes('import.meta.url')) return null;
      const dir = relative(root, dirname(args.path)).replaceAll('\\', '/');
      src = src.replace(/new URL\(([^;]*?),\s*import\.meta\.url\)\.href/g, (_, e) => `globalThis.__asset(${e}, ${JSON.stringify(dir)})`);
      return { contents: src, loader: 'js' };
    });
  }
};
const out = await esbuild.build({ entryPoints: [join(root, 'web/app.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2022', plugins: [assetPlugin], logLevel: 'warning' });
const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');

// 4) CSS는 web/index.html의 순서대로 이어 붙인다
const index = readFileSync(join(root, 'web/index.html'), 'utf8');
const cssFiles = [...index.matchAll(/<link rel="stylesheet" href="(?!https?:)([^"]+)">/g)].map((m) => m[1]);
const css = cssFiles.map((f) => readFileSync(join(root, 'web', f), 'utf8')).join('\n');
const fontLink = index.match(/<link rel="stylesheet" href="https:[^"]+">/)?.[0] ?? '';

// 5) 데이터·이미지를 읽는 작은 준비 코드: fetch('inline/…')를 표에서 답한다
const boot = `
const __DATA = ${JSON.stringify(data).replaceAll('</', '<\\/')};
const __ASSETS = ${JSON.stringify(assets)};
globalThis.KBL_DATA_BASE = 'inline/';
// 페이스팩(선택): HTML 옆의 facepack/ 폴더가 있으면 읽고 없으면 무시한다. 사진은 HTML에 넣지 않는다(facepack/README.md)
globalThis.KBL_FACEPACK_BASE = './facepack/';
const __fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.startsWith('inline/')) {
    const key = decodeURIComponent(u.slice(7));
    const text = __DATA[key];
    return Promise.resolve(text == null ? new Response('not found', { status: 404 }) : new Response(text, { status: 200, headers: { 'content-type': key.endsWith('.json') ? 'application/json' : 'text/plain' } }));
  }
  return __fetch(url, opts);
};
globalThis.__asset = (rel, dir) => {
  const parts = (dir + '/' + rel).split('/'); const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return __ASSETS[out.join('/')] ?? '';
};`;

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>프로농구 단장 게임</title>
<link rel="icon" href="data:,">
${fontLink}
<style>
${css}
</style>
</head>
<body>
<div id="app"><p class="boot">불러오는 중…</p></div>
<script>
${boot}
</script>
<script>
${js}
</script>
</body>
</html>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
const outPath = join(root, 'dist/프로농구-단장-게임.html');
writeFileSync(outPath, html);
console.log('페이스팩(선택): 이 HTML 옆에 facepack/ 폴더를 두면 사진을 씁니다(facepack/README.md). 이 도구는 폴더를 복사하지 않습니다.');
console.log(outPath, (html.length / 1048576).toFixed(2) + 'MB', `(이미지 ${Object.keys(assets).length}개, 데이터 ${dataFiles.length}개)`);
