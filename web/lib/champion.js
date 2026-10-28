// 우승 축하 연출의 순수 계산: 상황 판정, 멘트 템플릿 선택, 단체 사진(SVG 문자열).
// DOM·브라우저 API를 쓰지 않아 node에서 시험할 수 있다. 화면은 web/views/champion.js.
// 사진은 선수의 실제 모습이 아니다 — 이름·번호로 자동 조합한 일러스트(web/lib/avatar.js)를 시상대에 세운 그림이다. 트로피도 직접 그린 단순한 컵이다.
import { fill, cleanName } from '../../src/news.mjs';
import { hashString } from '../../src/rng.mjs';
import { avatarSvg } from './avatar.js';
import { colorOf } from './team-ui.js';

export const CHAMPION_NOTE = '이 문구와 팬 반응은 게임이 만든 가상 콘텐츠이며 실제 보도·실제 인물의 발언이 아닙니다. 사진 속 선수 그림은 자동 조합한 일러스트입니다.';

// ---------- 구단 이력에서 통산 우승·연속 우승 ----------
/**
 * 구단 이력(league.legacy[구단 id]: [{ season, stage }…], 오래된 시즌부터)에서 { titles(통산 우승), streak(마지막 시즌까지 이어진 연속 우승) }.
 * includesCurrent: 이 기록에 이번 우승 시즌이 이미 들어 있는가(시즌 종료 뒤). false면(플레이오프가 끝난 직후) 이번 우승을 한 번 더한다.
 */
export function titleStats(records = [], { includesCurrent = false } = {}) {
  let titles = records.filter((r) => r.stage === '우승').length;
  let streak = 0;
  for (let i = records.length - 1; i >= 0 && records[i].stage === '우승'; i--) streak++;
  if (!includesCurrent) { titles += 1; streak += 1; }
  return { titles, streak };
}

// ---------- 상황 판정 ----------
/**
 * 우승 상황. 입력(input):
 *  { teamName, season('2026-27'), gmName, regRank, wins, losses, titles(통산, 이번 포함), streak(연속, 이번 포함), gmTitles(단장 부임 뒤 이번 이전 우승 수),
 *    opp(결승 상대 이름), myWins, oppWins, games(결승 경기 수), bestOf, mvpName(챔프전 MVP 이름, 없으면 null), mvpLine(그의 기록 한 줄, 없으면 null) }
 * 반환: { primary(대표 상황 키), flags({ 키: true }), chips: [칩 문구] }
 */
export function championSituation(input) {
  const { regRank, titles, streak, gmTitles = 0, oppWins, games, bestOf } = input;
  const flags = {
    threePeat: streak >= 3, backToBack: streak === 2, clubFirst: titles === 1,
    underdog: regRank >= 6, gmFirst: gmTitles === 0 && titles > 1,
    decider: Boolean(bestOf) && games === bestOf && oppWins > 0, sweep: oppWins === 0,
    double: regRank === 1, nth: titles >= 2
  };
  const ORDER = ['threePeat', 'backToBack', 'clubFirst', 'underdog', 'gmFirst', 'decider', 'sweep', 'double', 'nth'];
  const primary = ORDER.find((k) => flags[k]) ?? 'plain';
  const chips = [];
  chips.push(`통산 ${titles}번째 우승`);
  if (streak >= 2) chips.push(`${streak}연속 우승`);
  if (flags.double) chips.push('정규리그 1위 · 통합 우승');
  if (flags.underdog) chips.push(`정규리그 ${regRank}위의 반란`);
  if (flags.decider) chips.push('마지막 경기까지 간 승부');
  if (flags.sweep) chips.push('무패 결승');
  return { primary, flags, chips };
}

// ---------- 멘트 템플릿 ----------
// 변수: {team} {season} {gm} {rank} {rec}(38승 16패) {opp} {series}(3승 1패) {titles} {streak} {mvp} {mvpLine} {next}
// 값이 없는 변수가 든 문장은 건너뛴다(fill이 null). 같은 입력이면 늘 같은 문장(시드는 구단·시즌·역할).
const HEAD = {
  threePeat: ['{team}, {streak}연패 대업… 왕조의 시작', '{streak}시즌 연속 정상! {team:이/가} 왕조를 완성했다', '{season} 챔피언 {team}, {streak}연속 우승'],
  backToBack: ['{team}, 2연패 달성!', '{team:이/가} 정상을 지켰다… 2시즌 연속 우승', '{season} 시즌도 챔피언은 {team}'],
  clubFirst: ['{team}, 구단 사상 첫 우승!', '{gm} 단장의 감격… {team:이/가} 처음으로 정상에 섰다', '{season} 시즌, {team:이/가} 우승 트로피를 처음 들었다'],
  underdog: ['{rank}위의 반란! {team:이/가} 챔피언에 올랐다', '아무도 몰랐다… {team}, 정규리그 {rank}위에서 우승까지', '{team}, 하위 시드의 기적 같은 우승'],
  gmFirst: ['{gm} 단장 부임 첫 우승, {team:이/가} 정상에 서다', '{team}, {gm} 단장과 함께한 첫 챔피언', '{season} 시즌 {team:이/가} 우승… 단장의 첫 트로피'],
  decider: ['마지막 경기까지 간 승부… {team:이/가} 웃었다', '{team}, {opp:과/와}의 혈투 끝에 챔피언', '{season} 시즌 결승은 {series}… 우승은 {team}'],
  sweep: ['{team}, {opp:을/를} 압도하며 정상 등극', '결승 무패 우승! {team:이/가} 트로피를 가져갔다', '{season} 챔피언 {team}, 한 경기도 내주지 않았다'],
  double: ['{team}, 정규리그에 이어 챔피언까지 통합 우승', '{rank}위로 시작해 끝까지… {team:이/가} 통합 우승을 이뤘다', '{season} 시즌의 주인공은 {team}, 통합 우승'],
  nth: ['{team}, 통산 {titles}번째 우승', '{season} 챔피언 {team}… 별이 하나 더 늘었다', '{team:이/가} 또 한 번 정상에 섰다'],
  plain: ['{team}, {season} 시즌 우승!', '{season} 시즌 챔피언은 {team}']
};
const GM = {
  threePeat: ['{gm} 단장은 "선수들이 왕조라는 말을 현실로 만들었다. 오늘만은 마음껏 즐기겠다"고 말했다.', '{gm} 단장은 "{streak}번째 우승이지만 매번 새롭다. 다음 시즌도 같은 마음으로 준비하겠다"고 밝혔다.'],
  backToBack: ['{gm} 단장은 "한 번 오르기도 어렵지만 지키기는 더 어렵다. 선수단과 코치진 덕분"이라고 말했다.', '{gm} 단장은 "연패는 숫자가 아니라 태도의 결과다. 선수들이 만들었다"고 소감을 밝혔다.'],
  clubFirst: ['{gm} 단장은 눈시울을 붉히며 "구단의 첫 우승을 함께해 영광이다. 팬들이 가장 큰 주인공"이라고 말했다.', '{gm} 단장은 "첫 우승이라는 말이 아직 실감 나지 않는다. 선수들이 해냈다"고 전했다.'],
  underdog: ['{gm} 단장은 "정규리그 {rank}위로 시작해 이 자리까지 왔다. 포기하지 않은 선수들이 자랑스럽다"고 말했다.', '{gm} 단장은 "아무도 기대하지 않았지만 우리는 믿었다"고 소감을 밝혔다.'],
  gmFirst: ['{gm} 단장은 "부임하고 처음 맞는 우승이다. 구단 모두의 노력이 모인 결과"라고 말했다.', '{gm} 단장은 "첫 우승으로 증명한 방향을 계속 가져가겠다"고 밝혔다.'],
  decider: ['{gm} 단장은 "{opp:과/와}의 시리즈가 {series}까지 갈 줄은 몰랐다. 끝까지 버틴 선수들 덕분"이라고 말했다.', '{gm} 단장은 "마지막 경기는 심장이 멎는 줄 알았다. 우승을 선수들에게 돌린다"고 전했다.'],
  sweep: ['{gm} 단장은 "결승에서 한 경기도 내주지 않을 줄은 몰랐다. 준비한 대로 풀렸다"고 말했다.', '{gm} 단장은 "{opp:을/를} 상대로 완벽에 가까운 시리즈였다"고 소감을 밝혔다.'],
  double: ['{gm} 단장은 "정규리그부터 챔피언까지 한 번도 흔들리지 않았다. 통합 우승은 선수단의 힘"이라고 말했다.', '{gm} 단장은 "통합 우승은 꿈꾸던 그림이다. 선수들이 완성했다"고 밝혔다.'],
  nth: ['{gm} 단장은 "{titles}번째 우승이라는 숫자가 무겁지만 기쁘다. 다음 시즌도 도전하겠다"고 말했다.', '{gm} 단장은 "우승은 늘 새롭다. 구단의 역사를 한 줄 더 쓰게 돼 영광"이라고 전했다.'],
  plain: ['{gm} 단장은 "선수들이 해냈다. 팬들께 감사드린다"고 말했다.']
};
const OWNER = [
  '모기업은 "{team}의 우승을 진심으로 축하한다. 선수단과 팬 모두에게 감사하다"는 짧은 입장을 냈다.',
  '모기업 관계자는 "{season} 시즌 우승은 구단 전체의 성과다. 다음 시즌도 아낌없이 지원하겠다"고 밝혔다.',
  '모기업은 우승 기념으로 전 직원에게 격려금을 지급하기로 했다고 전했다.',
  '모기업 회장은 직접 선수단을 찾아 "이제 시작일 뿐"이라며 어깨를 두드렸다.'
];
const FANS = [
  '팬 커뮤니티는 밤새 우승 이야기로 가득했다. "오늘은 퇴근길이 즐겁다"는 글에 추천이 쏟아졌다.',
  '응원석은 눈물바다였다. 한 팬은 "이 날을 얼마나 기다렸는지 모른다"며 목이 메었다.',
  '{team} 팬들은 우승 현수막 아래에서 늦도록 자리를 떠나지 않았다.',
  '커뮤니티에는 "올해 직관 티켓값이 아깝지 않다"는 글이 줄을 이었다.',
  '{mvp:이/가} 챔피언결정전 MVP에 오르자 팬들은 이름을 연호했다.',
  '"{opp:을/를} 꺾고 우승이라니 꿈만 같다"는 글이 커뮤니티 인기글 1위에 올랐다.'
];
const NEXT = [
  '이제 시선은 {next} 시즌으로 향한다. 오프시즌 선택이 왕조의 갈림길이 될 것이다.',
  '{next} 시즌에는 모두가 {team:을/를} 견제하는 입장이 된다. 이 기세를 이어 갈 수 있을까.',
  '우승의 여운이 가시기 전에 오프시즌이 시작된다. FA와 드래프트가 기다린다.',
  '{next} 시즌의 목표는 이미 정해졌다. 한 번 더 정상에 서는 것이다.'
];

/** 시드에서 하나 고르되, 값이 모자라 null이 되는 문장은 건너뛴다 */
function pickLine(list, vars, seedKey) {
  const start = hashString(seedKey) % list.length;
  for (let i = 0; i < list.length; i++) {
    const out = fill(list[(start + i) % list.length], vars);
    if (out) return out;
  }
  return null;
}

/** 멘트 묶음. 반환: { primary, flags, chips, headline, gm, owner, fans, next } */
export function championTexts(input) {
  const sit = championSituation(input);
  const vars = {
    team: input.teamName, season: input.season, gm: input.gmName, rank: input.regRank, rec: `${input.wins}승 ${input.losses}패`,
    opp: input.opp, series: `${input.myWins}승 ${input.oppWins}패`, titles: input.titles, streak: input.streak,
    mvp: input.mvpName ? cleanName(input.mvpName) : null, mvpLine: input.mvpLine ?? null, next: nextSeasonLabel(input.season)
  };
  const key = (role) => `${input.teamName}|${input.season}|${role}`;
  return {
    ...sit,
    headline: pickLine(HEAD[sit.primary], vars, key('h')),
    gm: pickLine(GM[sit.primary] ?? GM.plain, vars, key('g')),
    owner: pickLine(OWNER, vars, key('o')),
    fans: pickLine(FANS, vars, key('f')),
    next: pickLine(NEXT, vars, key('n'))
  };
}

/** '2026-27' → '2027-28' */
export function nextSeasonLabel(season) {
  const y = Number(String(season).slice(0, 4));
  return Number.isFinite(y) ? `${y + 1}-${String((y + 2) % 100).padStart(2, '0')}` : season;
}

/** 템플릿 전체(시험용): 모든 문장 틀 */
export const CHAMPION_TEMPLATES = { HEAD, GM, OWNER, FANS, NEXT };

// ---------- 사진에 세울 선수 ----------
/** 한 장에 세울 수 있는 최대 인원(기본 limit은 7, 페이스팩 사진이 있으면 화면이 12까지 요청한다) */
export const MAX_PHOTO = 12;
/**
 * 시상대에 설 선수: 스타팅 5명 + (챔프전 MVP가 없으면 더해서) + 벤치 상위로 limit(기본 7, 최대 12)명까지.
 * starters·bench: 선수 객체 배열(출전 편성 순서). 반환: [{ p, mvp }]
 */
export function photoRoster({ starters = [], bench = [], finalsMvp = null, limit = 7 } = {}) {
  const cap = Math.max(1, Math.min(MAX_PHOTO, limit));
  const list = [];
  const add = (p) => { if (p && !list.some((x) => x.p.id === p.id) && list.length < cap) list.push({ p, mvp: Boolean(finalsMvp && p.id === finalsMvp.id) }); };
  starters.forEach(add);
  if (finalsMvp && !list.some((x) => x.p.id === finalsMvp.id)) {
    if (list.length >= cap) list.pop();
    list.push({ p: finalsMvp, mvp: true });
  }
  [...bench].sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0)).forEach(add);
  return list;
}

/** 시상대 자리 계산: 뒷줄(높은 단)과 앞줄, 트로피를 사이에 둔 좌우. MVP는 뒷줄 한가운데. 반환: [{ p, mvp, x, y, size, row }] (x,y는 카드 왼쪽 위) */
export function podiumLayout(roster) {
  const n = roster.length;
  const mvpIdx = roster.findIndex((r) => r.mvp);
  const ordered = [...roster];
  if (mvpIdx > 0) { const [m] = ordered.splice(mvpIdx, 1); ordered.unshift(m); } // 첫 칸(뒷줄 가운데)에 MVP
  const out = [];
  const CX = 480, gap = 20, trophyHalf = 62; // 트로피 폭 절반 + 여유
  const frontSlots = (count, size) => {
    const left = Math.floor(count / 2), right = count - left, xs = [];
    for (let i = 0; i < left; i++) xs.push(CX - trophyHalf - gap - size - i * (size + gap)); // 왼쪽: 트로피 쪽부터 바깥으로
    for (let i = 0; i < right; i++) xs.push(CX + trophyHalf + gap + i * (size + gap)); // 오른쪽
    return xs;
  };
  if (n <= 8) {
    const backCount = Math.min(4, Math.ceil(n / 2)), frontCount = n - backCount;
    const BS = 104, FS = 120;
    // 뒷줄: 가운데부터 좌우로 번갈아 놓는다(가운데 칸이 없으면(짝수) 왼쪽 가운데가 첫 칸)
    const backX = backSlots(backCount, BS, 18, CX);
    ordered.slice(0, backCount).forEach((r, i) => out.push({ ...r, x: backX[i], y: 140, size: BS, row: 'back' }));
    const frontX = frontSlots(frontCount, FS);
    ordered.slice(backCount).forEach((r, i) => out.push({ ...r, x: frontX[i], y: 292, size: FS, row: 'front' }));
    return out;
  }
  // 9~12명: 뒷줄·가운데줄·앞줄 세 줄(앞줄은 트로피 양옆). 로스터 전체가 보이도록 카드를 조금 줄인다
  const frontCount = Math.min(4, Math.max(2, Math.round(n / 3))), rest = n - frontCount;
  const backCount = Math.ceil(rest / 2), midCount = rest - backCount;
  const S = 84, FS = 104;
  const backX = backSlots(backCount, S, 14, CX);
  ordered.slice(0, backCount).forEach((r, i) => out.push({ ...r, x: backX[i], y: 128, size: S, row: 'back' }));
  const midX = backSlots(midCount, S, 14, CX);
  ordered.slice(backCount, backCount + midCount).forEach((r, i) => out.push({ ...r, x: midX[i], y: 220, size: S, row: 'mid' }));
  const frontX = frontSlots(frontCount, FS);
  ordered.slice(backCount + midCount).forEach((r, i) => out.push({ ...r, x: frontX[i], y: 308, size: FS, row: 'front' }));
  return out;
}
function backSlots(count, size, gap, cx) {
  // 왼쪽 위치부터 가운데 정렬로 놓은 뒤, 첫 사람(MVP)이 가운데에 오도록 순서를 바꾼 x 배열을 돌려준다
  const total = count * size + (count - 1) * gap;
  const xs = Array.from({ length: count }, (_, i) => Math.round(cx - total / 2 + i * (size + gap)));
  const centerFirst = [...xs].sort((a, b) => Math.abs(a + size / 2 - cx) - Math.abs(b + size / 2 - cx) || a - b);
  return centerFirst;
}

// ---------- 단체 사진 SVG ----------
const FONT = "'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif";
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const dark = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); }
  return pts.join(' ');
}
function trophy(cx, bottom, k = 1) {
  return `<g transform="translate(${cx} ${bottom})${k === 1 ? '' : ` scale(${k})`}">
<ellipse cx="0" cy="2" rx="48" ry="7" fill="#000" opacity=".28"/>
<rect x="-36" y="-18" width="72" height="18" rx="3" fill="#a56a00"/><rect x="-26" y="-32" width="52" height="14" rx="2" fill="url(#gold)"/>
<rect x="-9" y="-62" width="18" height="32" fill="url(#gold)"/>
<path d="M-42 -128 H42 C42 -88 24 -66 0 -61 C-24 -66 -42 -88 -42 -128 Z" fill="url(#gold)" stroke="#a56a00" stroke-width="2"/>
<path d="M-42 -116 C-70 -116 -70 -80 -36 -78 M42 -116 C70 -116 70 -80 36 -78" fill="none" stroke="#e6a417" stroke-width="8" stroke-linecap="round"/>
<circle cx="0" cy="-98" r="17" fill="#fff" opacity=".22"/>
<path d="M-17 -98 H17 M0 -115 V-81 M-11 -110 Q0 -98 -11 -86 M11 -110 Q0 -98 11 -86" fill="none" stroke="#8a5a00" stroke-width="1.6" opacity=".7"/>
<path d="M-30 -122 C-30 -100 -22 -84 -8 -76" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".45"/>
</g>`;
}
function confettiDots(seed, team) {
  const colors = [team, '#ffd45c', '#ffffff', dark(team, 1.35), '#ff6b8a', '#6ad98a'];
  let h = hashString(`confetti:${seed}`) || 1;
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  let out = '';
  for (let i = 0; i < 70; i++) {
    const x = Math.round(rnd() * 960), y = Math.round(rnd() * 470), w = 6 + Math.round(rnd() * 8), hgt = 3 + Math.round(rnd() * 5), rot = Math.round(rnd() * 180);
    out += `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="${colors[i % colors.length]}" opacity="${(0.55 + rnd() * 0.4).toFixed(2)}" transform="rotate(${rot} ${x} ${y})"/>`;
  }
  return out;
}

/**
 * 우승 단체 사진 SVG(960×540). data: { teamId, teamName, season, regRank, wins, losses, opp, myWins, oppWins, mvpName, roster: photoRoster 결과 }
 * opts.logoHref: 구단 로고 이미지 주소(없으면 로고 없이). 화면과 PNG 저장이 같은 그림을 쓴다.
 */
export function championPhotoSvg(data, { logoHref = null, photos = null } = {}) {
  const team = colorOf(data.teamId);
  const bgTop = dark(team, 0.62), bgBottom = '#0b1022';
  const cards = podiumLayout(data.roster ?? []);
  const cardOf = ({ p, mvp, x, y, size }) => {
    const ph = photos?.[p.id] ?? null; // 페이스팩 사진(실존 사진 또는 가상 얼굴 + 유니폼 몸통)이 있으면 그것을, 없으면 자동 조합 일러스트를
    const av = ph
      ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="9" fill="${dark(team, 0.8)}"/><image href="${esc(ph.href)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMin slice"/>${ph.virtual ? `<text x="${x + 6}" y="${y + 14}" font-size="10" font-weight="800" fill="#fff" stroke="#000" stroke-opacity=".5" stroke-width="2.5" paint-order="stroke" font-family="${FONT}">가상</text>` : ''}`
      : avatarSvg(p, { size, teamColor: team, number: p.number ?? null }).replace(/^<svg xmlns="[^"]*"/, `<svg x="${x}" y="${y}"`);
    const label = cleanName(p.baseName ?? p.name ?? '');
    return `<g>${av}<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="9" fill="none" stroke="${mvp ? '#ffd45c' : '#ffffff'}" stroke-opacity="${mvp ? 1 : 0.55}" stroke-width="${mvp ? 4 : 2}"/>
<rect x="${x}" y="${y + size - 22}" width="${size}" height="22" fill="#000" opacity=".58"/><text x="${x + size / 2}" y="${y + size - 7}" text-anchor="middle" font-size="${size > 110 ? 14 : size < 90 ? 11 : 13}" font-weight="700" fill="#fff" font-family="${FONT}">${esc(label)}</text>
${mvp ? `<g><polygon points="${star(x + size - 15, y + 15, 14)}" fill="#ffd45c" stroke="#a56a00" stroke-width="1.5"/><text x="${x + size - 15}" y="${y + 36}" text-anchor="middle" font-size="9" font-weight="800" fill="#ffd45c" font-family="${FONT}">MVP</text></g>` : ''}</g>`;
  };
  const rowSvg = (row) => cards.filter((c) => c.row === row).map(cardOf).join('');
  const rec = `정규리그 ${data.regRank}위 ${data.wins}승 ${data.losses}패 · 챔피언결정전 ${esc(data.opp)} 상대 ${data.myWins}승 ${data.oppWins}패`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540" role="img" aria-label="${esc(data.teamName)} ${esc(data.season)} 시즌 우승 단체 사진(자동 생성 일러스트)" font-family="${FONT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bgBottom}"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".55" stop-color="#f1b928"/><stop offset="1" stop-color="#c88a00"/></linearGradient>
<linearGradient id="step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a456f"/><stop offset="1" stop-color="#1a2040"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${dark(team, 1.5)}" stop-opacity=".55"/><stop offset="1" stop-color="${team}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="960" height="540" fill="url(#bg)"/><rect width="960" height="540" fill="url(#glow)"/>
<polygon points="40,0 200,0 420,470 80,470" fill="#fff" opacity=".05"/><polygon points="920,0 760,0 540,470 880,470" fill="#fff" opacity=".05"/>
${confettiDots(`${data.teamId}:${data.season}`, team)}
<polygon points="150,30 190,30 190,92 150,92 172,61" fill="#c88a00"/><polygon points="810,30 770,30 770,92 810,92 788,61" fill="#c88a00"/>
<rect x="180" y="24" width="600" height="68" rx="6" fill="url(#gold)" stroke="#8a5a00" stroke-width="2"/>
${logoHref ? `<image href="${esc(logoHref)}" x="194" y="30" width="86" height="56" preserveAspectRatio="xMidYMid meet"/>` : ''}
<text x="${logoHref ? 500 : 480}" y="70" text-anchor="middle" font-size="36" font-weight="900" fill="#2b1b00">${esc(data.season)} 시즌 우승</text>
<text x="480" y="122" text-anchor="middle" font-size="24" font-weight="800" fill="#fff" stroke="#000" stroke-opacity=".35" stroke-width="3" paint-order="stroke">${esc(data.teamName)}</text>
${cards.some((c) => c.row === 'mid') ? '' : `<rect x="170" y="244" width="620" height="30" rx="4" fill="url(#step)"/><rect x="170" y="244" width="620" height="4" fill="#fff" opacity=".18"/>`}
<g>${rowSvg('back')}</g><g>${rowSvg('mid')}</g>
<rect x="70" y="412" width="820" height="44" rx="5" fill="url(#step)"/><rect x="70" y="412" width="820" height="4" fill="#fff" opacity=".18"/>
${trophy(480, 412, cards.some((c) => c.row === 'mid') ? 0.72 : 1)}
<g>${rowSvg('front')}</g>
<rect x="0" y="456" width="960" height="84" fill="#0b1022" opacity=".7"/>
<text x="480" y="492" text-anchor="middle" font-size="19" font-weight="700" fill="#fff">${rec}</text>
${data.mvpName ? `<text x="480" y="520" text-anchor="middle" font-size="17" font-weight="700" fill="#ffd45c">★ 챔피언결정전 MVP ${esc(cleanName(data.mvpName))}</text>` : ''}
</svg>`;
}
