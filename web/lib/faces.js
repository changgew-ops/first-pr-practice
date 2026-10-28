// 페이스팩 어댑터(선택 기능, v2 전체팩). HTML 옆의 `facepack/`(data.js, facepack.js, faces/ 또는 offline/, uniforms/, generated/)가 있으면 읽어서 선수 사진을 쓰고,
// 없거나 읽기에 실패하면 아무 일도 하지 않는다(기존 조합형 아바타 web/lib/avatar.js가 그대로 보인다).
//  - 실존 선수: 게임 선수의 kblId(KBL playerNo)가 팩의 선수 목록에 있고 사진이 있을 때만 사진을 쓴다. 이름으로 짝짓지 않는다.
//  - 가상 얼굴: 사진이 없는 선수는 고정 id(kblId ?? id)의 해시로 16종 중 하나를 고른다. 같은 선수는 이적·시즌·저장 불러오기 뒤에도 같은 얼굴이다(저장 형식은 바뀌지 않는다).
//  - 실사 사진 파일은 저장소에 올리지 않는다(.gitignore). 외부 다운로드·AI 호출은 하지 않는다.
// 이 모듈은 import만으로는 DOM을 건드리지 않는다(node에서도 불러올 수 있다).

/** 게임 구단 id → 팩 구단 id(유니폼 몸통) */
export const PACK_TEAM = {
  'wonju-db': 'db', 'seoul-sk': 'sk', 'suwon-kt': 'kt', 'changwon-lg': 'lg', 'busan-kcc': 'kcc',
  'goyang-sono': 'sono', 'seoul-samsung': 'samsung', 'ulsan-hyundai-mobis': 'mobis', 'daegu-kogas': 'gas', 'anyang-jungkwanjang': 'kgc'
};
export const packTeamId = (teamId) => PACK_TEAM[teamId] ?? 'db';

export const FACE_NOTE = '사진은 사용자가 따로 넣은 페이스팩(KBL 공식 프로필 사진, 촬영 시즌 미확인)입니다. 사진이 없는 선수는 AI로 만든 가상 얼굴이며 실존 인물이 아닙니다. 몸통(유니폼)의 번호와 체형은 합성 원본 그대로입니다.';
export const VIRTUAL_FACE_TITLE = '가상 얼굴 — AI로 만든 그림이며 실존 인물이 아닙니다';
export const PHOTO_TITLE = 'KBL 공식 프로필 사진(페이스팩)';

const state = { status: 'idle', fp: null, base: null, waiters: [], pending: new Set() };
const urlCache = new Map();

const baseOf = () => String(globalThis.KBL_FACEPACK_BASE ?? '../facepack/').replace(/\/?$/, '/');

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('missing')); };
    document.head.append(s);
  });
}

/** 팩을 한 번만 읽는다. 반환: Promise<boolean>(쓸 수 있으면 true). 실패해도 예외·경고 없이 false */
export function loadFaces() {
  if (state.status === 'ready') return Promise.resolve(true);
  if (state.status === 'failed') return Promise.resolve(false);
  if (state.status === 'loading') return new Promise((ok) => state.waiters.push(ok));
  if (typeof document === 'undefined') { state.status = 'failed'; return Promise.resolve(false); }
  state.status = 'loading';
  return new Promise((ok) => {
    state.waiters.push(ok);
    const done = (fp) => {
      state.fp = fp; state.status = fp ? 'ready' : 'failed';
      const ws = state.waiters.splice(0);
      if (fp) flushPending();
      state.pending.clear();
      for (const w of ws) w(Boolean(fp));
    };
    (async () => {
      try {
        const base = baseOf();
        state.base = base;
        if (!globalThis.KBL_FULL_DATA) await loadScript(`${base}data.js`);
        if (!globalThis.KBLFacePack) await loadScript(`${base}facepack.js`);
        const fp = await globalThis.KBLFacePack.create({ basePath: base });
        done(fp);
      } catch { done(null); }
    })();
  });
}

export const facesReady = () => state.status === 'ready';
/** 팩이 준비되면 한 번 부른다(이미 준비됐으면 바로). 준비되지 않으면 부르지 않는다 */
export function onFacesReady(fn) {
  if (state.status === 'ready') { fn(); return; }
  if (state.status === 'failed') return;
  loadFaces().then((ok) => { if (ok) fn(); });
}

const idOf = (p) => String(p?.kblId ?? p?.id ?? '');

/** 선수 → 팩 입력. 가상 선수(real === false)는 isGenerated */
function inputOf(p, teamId) {
  return { id: idOf(p), name: p.baseName ?? p.name, isGenerated: p.real === false, teamId: packTeamId(teamId ?? p.teamId) };
}

/** 로딩 전 명부 기준 얼굴 종류: 'real'(사진이 있는 id) | 'generated' | 'fallback'(사진 없는 실존 선수의 가상 얼굴) | null(팩 없음) */
export function faceKind(p) {
  if (!state.fp || !p || !idOf(p)) return null;
  try { return state.fp.resolve(inputOf(p)).kind; } catch { return null; }
}
/** 이 선수에게 실제 사진이 있는가(팩이 준비된 뒤, 로딩 전 명부 기준) */
export function hasRealPhoto(p) { return p?.real !== false && faceKind(p) === 'real'; }
/** 가상 얼굴 번호(gen-01…16). 같은 선수는 항상 같다 */
export function faceKeyOf(p) {
  if (!idOf(p)) return null;
  try { return state.fp ? state.fp.resolve(inputOf(p)).faceKey ?? null : globalThis.KBLFacePack?.assignFace(idOf(p)) ?? null; } catch { return null; }
}

function toUrl(canvas) {
  try { return canvas.toDataURL('image/webp', 0.9); } catch { return null; }
}

// v2의 render는 async(사진을 그때그때 불러온다). 동시에 너무 많이 돌리지 않도록 작은 작업 대기열을 쓴다
const MAX_JOBS = 3;
let running = 0;
const queue = [];
function schedule(fn) {
  return new Promise((resolve) => {
    queue.push(() => fn().then(resolve, () => resolve(null)));
    pump();
  });
}
function pump() {
  while (running < MAX_JOBS && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

const keyOf = (p, { mode, teamId, size, virtual }) => {
  const r = state.fp.resolve(inputOf(p, teamId));
  return `${r.kind}|${idOf(p)}|${r.faceKey ?? ''}|${mode}|${mode === 'bust' ? packTeamId(teamId) : ''}|${size}|${virtual ? 1 : 0}`;
};

/**
 * 선수 사진(데이터 URL)을 만든다. 반환 Promise<{ href, kind } | null>.
 * 팩이 없거나, 실제 사진이 아닌데 virtual을 허용하지 않았거나, 사진 로딩에 실패하면 null.
 * mode 'face': 얼굴만(정사각, 목록·카드). 'bust': 소속팀 유니폼 합성 상반신의 위쪽 정사각형(상세·우승). size는 한 변(px).
 * virtual: true면 사진 없는 선수의 가상 얼굴도 돌려준다(우승 화면). 같은 조건의 결과는 캐시한다.
 */
export async function facePicture(p, { mode = 'face', teamId = p?.teamId, size = 120, virtual = false } = {}) {
  if (!state.fp || !p || !idOf(p)) return null;
  const S = Math.max(24, Math.min(256, Math.round(size * 2)));
  let key;
  try { key = keyOf(p, { mode, teamId, size: S, virtual }); } catch { return null; }
  const hit = urlCache.get(key);
  if (hit) return hit;
  const fp = state.fp;
  const input = inputOf(p, teamId);
  const pre = fp.resolve(input).kind;
  if (pre !== 'real' && !virtual) return null;
  const out = await schedule(async () => {
    const c = document.createElement('canvas');
    if (mode === 'face') {
      c.width = S; c.height = S;
      const r = await fp.render(c, input, { mode: 'face', teamId: input.teamId });
      if (!r || r.cancelled) return null;
      if (r.kind !== 'real' && !virtual) return null; // 사진 로딩 실패로 대체 얼굴이 된 경우
      const href = toUrl(c);
      return href ? { href, kind: r.kind } : null;
    }
    c.width = 470; c.height = 609;
    const r = await fp.render(c, input, { teamId: input.teamId, mode: 'portrait', tone: true });
    if (!r || r.cancelled) return null;
    if (r.kind !== 'real' && !virtual) return null;
    const sq = document.createElement('canvas'); sq.width = S; sq.height = S;
    sq.getContext('2d').drawImage(c, 0, 0, 470, 470, 0, 0, S, S);
    const href = toUrl(sq);
    return href ? { href, kind: r.kind } : null;
  });
  if (out) {
    if (urlCache.size > 600) urlCache.clear();
    urlCache.set(key, out);
  }
  return out;
}

// ---------- 기존 아바타 요소 업그레이드 ----------
const optsOf = (p, opts) => ({ mode: (opts.size ?? 64) >= 96 ? 'bust' : 'face', teamId: p.teamId, size: opts.size ?? 64 });

function setPhoto(el, p, opts, pic) {
  const label = String(p.baseName ?? p.name ?? '선수').replace(/[<>&"]/g, '');
  const img = document.createElement('img');
  img.className = 'face-photo';
  img.src = pic.href;
  img.alt = opts.decorative === false ? `${label} 사진` : '';
  img.decoding = 'async';
  el.replaceChildren(img);
  el.classList.add('has-photo');
  el.title = PHOTO_TITLE;
}

// 화면에 보이는(또는 곧 보일) 요소만 사진을 만든다. 로스터·도감이 길어도 보이는 것만 불러온다
let io = null;
const watched = new WeakMap();
function observe(el, p, opts) {
  if (typeof IntersectionObserver === 'undefined') { render(el, p, opts); return; }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const job = watched.get(e.target);
      io.unobserve(e.target); watched.delete(e.target);
      if (job) render(e.target, job.p, job.opts);
    }
  }, { rootMargin: '200px' });
  watched.set(el, { p, opts });
  io.observe(el);
}
async function render(el, p, opts) {
  try {
    const pic = await facePicture(p, optsOf(p, opts));
    if (!pic || el.dataset.faceSkip) return;
    setPhoto(el, p, opts, pic);
  } catch { /* 기존 아바타 유지 */ }
}
function flushPending() {
  for (const { el, p, opts } of state.pending) { if (el.isConnected) track(el, p, opts); }
}
function track(el, p, opts) {
  if (!hasRealPhoto(p)) return; // 사진이 없는 선수는 기존 일러스트 그대로
  let hit = null;
  try { hit = urlCache.get(keyOf(p, { ...optsOf(p, opts), size: Math.max(24, Math.min(256, Math.round((opts.size ?? 64) * 2))), virtual: false })); } catch { /* 없음 */ }
  if (hit) { setPhoto(el, p, opts, hit); return; } // 캐시에 있으면 바로(로스터를 다시 그려도 깜빡이지 않는다)
  observe(el, p, opts);
}

/**
 * avatarEl이 만든 요소를, 팩이 있고 이 선수에게 실제 사진이 있으면 사진으로 바꾼다. 팩이 없으면 아무 일도 하지 않는다.
 * 팩이 아직 로드 중이면 대기열에 넣어 두었다가 준비되면 이어서 한다.
 */
export function upgradeAvatar(el, p, opts = {}) {
  if (typeof document === 'undefined' || !p || p.real === false || !idOf(p)) return;
  if (state.status === 'failed') return;
  if (state.status === 'ready') { try { track(el, p, opts); } catch { /* 기존 아바타 유지 */ } return; }
  if (state.pending.size > 400) { for (const q of state.pending) if (!q.el.isConnected) state.pending.delete(q); }
  state.pending.add({ el, p, opts });
  if (state.status === 'idle') loadFaces();
}

// ---------- 우승 화면 ----------
/**
 * 우승 단체 사진용 상반신 그림: roster [{ p, mvp }] → Promise<{ photos: { [선수 id]: { href, virtual } }, virtualCount, realCount } | null>.
 * 팩이 준비되지 않았으면 null. 사진 없는(또는 로딩에 실패한) 선수는 가상 얼굴(16종 해시 배정)이 소속팀 유니폼 몸통에 붙는다.
 * 사진을 한꺼번에 몇 장씩 나눠 불러온다.
 */
export async function championPortraits(roster, teamId, size = 120) {
  if (!state.fp) return null;
  const photos = {}; let virtualCount = 0, realCount = 0;
  const list = roster.map(({ p }) => p);
  for (let i = 0; i < list.length; i += 4) {
    const part = await Promise.all(list.slice(i, i + 4).map((p) => facePicture(p, { mode: 'bust', teamId, size, virtual: true })));
    part.forEach((pic, k) => {
      if (!pic) return;
      const virtual = pic.kind !== 'real';
      photos[list[i + k].id] = { href: pic.href, virtual };
      if (virtual) virtualCount++; else realCount++;
    });
  }
  return { photos, virtualCount, realCount };
}

/** 시험·진단용 */
export const __faces = { state, urlCache };
if (typeof globalThis !== 'undefined') globalThis.__faces = { state: () => state.status, kindOf: (p) => faceKind(p), keyOf: (p) => faceKeyOf(p), cache: () => urlCache.size };
