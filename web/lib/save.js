// 저장 슬롯: 브라우저 로컬 저장소. 막혀 있어도(사생활 보호 모드 등) 게임은 돌아가야 하므로 모든 접근을 감싼다.
// 슬롯: 'auto'(자동 저장) + '1' '2' '3'(직접 저장). 저장하는 것은 세션 상태(session.game) — 시드·조작·결정 기록 + 지난 시즌 결과 로그.
// 용량: 로그의 오래된 시즌은 요약만 남기고(game.js pruneGame) 문자열을 압축해서(lz.js) 쓴다. 값 모양: "KZ1\n<meta JSON>\n<압축된 game JSON>".
// 옛 저장(압축 전)은 "{"로 시작하는 JSON({ meta, game })이라 그대로 읽는다. 다음에 저장할 때 새 모양으로 바뀐다.
import { seasonLabel, pruneGame, DEFAULT_KEEP_SEASONS } from './game.js';
import { compress, decompress } from './lz.js';
import { VERSION as GAME_VERSION } from './session.js';

const PREFIX = 'kblgm.v2.slot.';
const MARK = 'KZ1\n';
export const SLOTS = ['auto', '1', '2', '3'];

/** 브라우저 localStorage 한도의 추정치(글자 수 기준, 보통 5MB)와 알림을 시작하는 비율 */
export const QUOTA = 5 * 1024 * 1024;
export const WARN_RATIO = 0.8;
/** 파일로 내보내는 형식 이름·버전 */
export const FILE_FORMAT = 'kblgm-save';
export const FILE_FORMAT_VERSION = 1;

let keepSeasons = DEFAULT_KEEP_SEASONS;
/** 규칙값(rules.save)을 알려 준다: { keepSeasonsDetail } — 전체를 남길 최근 시즌 수 */
export function configureSave(saveRules) {
  const n = Number(saveRules?.keepSeasonsDetail);
  keepSeasons = Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_KEEP_SEASONS;
}

const metaOf = (game) => ({
  gmName: game.gm?.name ?? '단장', teamId: game.managerId, season: seasonLabel(game.league.season), stage: game.stage, day: game.day,
  seasonsPlayed: game.log.length, savedAt: Date.now()
});

// ---------- 슬롯 값 모양 ----------
/** 슬롯에 넣을 문자열: 로그를 줄인 game을 압축 */
export const encodeSlot = (meta, game, keep = keepSeasons) => `${MARK}${JSON.stringify(meta)}\n${compress(JSON.stringify(pruneGame(game, keep)))}`;

/** 슬롯 문자열 → { meta, game }. 새 모양과 옛 모양(JSON) 모두 읽는다. 깨졌으면 예외 */
export function decodeSlot(raw) {
  if (raw.startsWith(MARK)) {
    const cut = raw.indexOf('\n', MARK.length);
    return { meta: JSON.parse(raw.slice(MARK.length, cut)), game: JSON.parse(decompress(raw.slice(cut + 1))) };
  }
  const { meta, game } = JSON.parse(raw);
  return { meta, game };
}

/** 슬롯 문자열의 meta만(압축을 풀지 않는다) */
export function decodeMeta(raw) {
  if (raw.startsWith(MARK)) return JSON.parse(raw.slice(MARK.length, raw.indexOf('\n', MARK.length)));
  return JSON.parse(raw).meta;
}

export function listSlots() {
  return SLOTS.map((slot) => {
    try { const raw = localStorage.getItem(PREFIX + slot); if (!raw) return { slot, meta: null }; return { slot, meta: decodeMeta(raw), size: raw.length + PREFIX.length + slot.length }; } catch { return { slot, meta: null }; }
  });
}
/** 슬롯의 게임 상태(없거나 깨졌으면 null) */
export function readSlot(slot) {
  try { const raw = localStorage.getItem(PREFIX + slot); return raw ? decodeSlot(raw).game : null; } catch { return null; }
}

// ---------- 용량 ----------
/**
 * 사용량 판정(순수 함수). used = 쓴 글자 수. level: 'ok' | 'warn'(80% 넘음) | 'full'(95% 넘음, 곧 저장 실패)
 * 0~1 비율 ratio, 퍼센트 percent(정수)도 준다.
 */
export function capacityOf(used, quota = QUOTA, warnRatio = WARN_RATIO) {
  const ratio = quota > 0 ? used / quota : 1;
  return { used, quota, ratio, percent: Math.round(ratio * 100), level: ratio > 0.95 ? 'full' : ratio > warnRatio ? 'warn' : 'ok' };
}

/** 이 사이트가 로컬 저장소에 쓴 글자 수(키+값). 저장소를 훑을 수 없으면 슬롯 크기의 합 */
export function storageUsed() {
  try {
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k)?.length ?? 0); }
      return n;
    }
  } catch { /* 아래로 */ }
  return listSlots().reduce((s, x) => s + (x.size ?? 0), 0);
}
export const storageStatus = () => capacityOf(storageUsed());

/** 지울 만한 슬롯 제안: 직접 저장 슬롯 중 가장 오래된 것(없으면 null). slots = listSlots() 결과 */
export function oldestManualSlot(slots) {
  return slots.filter((s) => s.meta && s.slot !== 'auto').sort((a, b) => a.meta.savedAt - b.meta.savedAt)[0]?.slot ?? null;
}

/** 경고 문구(순수 함수): 저장에 실패했거나 사용량이 80%를 넘으면 { level, text }, 아니면 null */
export function capacityNotice({ ok = true, status }) {
  if (!ok) return { level: 'full', text: '저장 공간이 부족해 저장하지 못했습니다. 오래된 슬롯을 지우거나 파일로 내보낸 뒤 다시 저장해 주세요.' };
  if (!status || status.level === 'ok') return null;
  return { level: status.level, text: `저장 공간이 ${status.percent}% 찼습니다. 가득 차면 저장이 막히니 오래된 슬롯을 지우거나 파일로 내보내 두세요.` };
}

/** 저장할 때마다 창에 알린다(화면 쪽이 경고 띠를 띄운다): detail = { slot, ok, status } */
function announce(slot, ok) {
  try {
    if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('kblgm:save', { detail: { slot, ok, status: storageStatus() } }));
  } catch { /* 알림은 덤이다 */ }
}

/** 저장. 실패(저장 공간 부족·막힘)하면 false */
export function writeSlot(slot, game) {
  let ok = false;
  try { localStorage.setItem(PREFIX + slot, encodeSlot(metaOf(game), game)); ok = true; } catch { ok = false; }
  announce(slot, ok);
  return ok;
}
export function deleteSlot(slot) {
  try { localStorage.removeItem(PREFIX + slot); } catch { /* 무시 */ }
}
/** 가장 최근에 저장한 슬롯 { slot, meta } 또는 null */
export function latestSlot() {
  return listSlots().filter((s) => s.meta).sort((a, b) => b.meta.savedAt - a.meta.savedAt)[0] ?? null;
}

// ---------- 파일로 내보내기·가져오기 ----------
/** 내보내기 파일(압축하지 않은 JSON)의 내용과 파일 이름. 슬롯이 비었으면 null */
export function buildExport(slot) {
  let raw; try { raw = localStorage.getItem(PREFIX + slot); } catch { return null; }
  if (!raw) return null;
  try {
    const { meta, game } = decodeSlot(raw);
    const file = { format: FILE_FORMAT, formatVersion: FILE_FORMAT_VERSION, gameVersion: game.version, exportedAt: Date.now(), meta, game };
    return { filename: `kblgm-${meta.teamId}-${String(meta.season).replace(/[^0-9-]/g, '')}-${slot}.json`, text: JSON.stringify(file) };
  } catch { return null; }
}

const STAGES = ['regular', 'playoffs', 'offseason'];
/**
 * 가져올 파일 검사(순수 함수). text = 파일 내용, teamIds = 이 게임에 있는 구단 id 목록.
 * 반환: { ok: true, game, meta } 또는 { ok: false, error }. 내보낸 파일과, game 객체만 담은 JSON 둘 다 받는다.
 */
export function parseImport(text, { teamIds = null } = {}) {
  const fail = (error) => ({ ok: false, error });
  let doc;
  try { doc = JSON.parse(text); } catch { return fail('JSON 파일이 아니거나 깨져 있습니다'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail('저장 파일 형식이 아닙니다');
  if (doc.format != null && doc.format !== FILE_FORMAT) return fail(`다른 형식의 파일입니다(${String(doc.format).slice(0, 30)})`);
  if (doc.formatVersion != null && doc.formatVersion > FILE_FORMAT_VERSION) return fail('더 새로운 버전에서 내보낸 파일입니다');
  const game = doc.game ?? doc;
  if (!game || typeof game !== 'object' || typeof game.league !== 'object' || !game.league) return fail('저장 파일 형식이 아닙니다(게임 상태가 없습니다)');
  if (game.version !== GAME_VERSION) return fail(`게임 저장 버전이 맞지 않습니다(파일 ${game.version ?? '없음'}, 현재 ${GAME_VERSION})`);
  if (!Number.isFinite(game.seed)) return fail('시드가 없거나 올바르지 않습니다');
  if (typeof game.managerId !== 'string' || (teamIds && !teamIds.includes(game.managerId))) return fail(`이 게임에 없는 구단입니다(${String(game.managerId).slice(0, 30)})`);
  if (!Array.isArray(game.log) || !Array.isArray(game.actions) || !Array.isArray(game.league.players)) return fail('저장 내용이 불완전합니다(로그·조작·선수 목록)');
  if (!STAGES.includes(game.stage) || !Number.isInteger(game.day) || game.day < 0) return fail('진행 단계가 올바르지 않습니다');
  if (game.stage === 'offseason' && !game.seasonEnd) return fail('오프시즌 저장인데 시즌 종료 정보가 없습니다');
  let meta; try { meta = metaOf(game); } catch { return fail('저장 내용을 읽을 수 없습니다'); }
  return { ok: true, game, meta };
}

/** 검사를 통과한 game을 슬롯에 넣는다. 저장 공간이 모자라면 false */
export const importToSlot = (slot, game) => writeSlot(slot, game);
