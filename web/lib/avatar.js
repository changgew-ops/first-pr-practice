// 선수 카드 일러스트: 선수 id·이름에서 결정적으로 조합한 스타일화 인물 그림(평면 벡터 SVG).
// 이 그림은 실제 선수의 사진·초상이 아니다(선택 기능인 페이스팩 사진은 web/lib/faces.js가 따로 덮어쓴다). 피부·머리·표정·체형을 해시로 고른 무작위 조합일 뿐이라 실존 인물의 특징을 반영하지 않는다.
// 같은 선수(같은 kblId/id)는 늘 같은 그림이고, 나이·포지션·희귀도·구단색만 표현을 조금 바꾼다.
// 순수 문자열 생성(avatarSvg)과 DOM 요소(avatarEl)를 나눠 두어 node 테스트가 가능하다.
import { mulberry32, hashString } from '../../src/rng.mjs';
import { upgradeAvatar } from './faces.js';

const SKIN = ['#f6d5b8', '#eec29b', '#d9a273', '#b97d52', '#8d5a36', '#6b4226'];
const HAIR = ['#1f1a17', '#2b1f17', '#43301f', '#5f4328', '#7a5a35', '#b8893a', '#8a8d93'];
const NEUTRAL_JERSEY = ['#4a6fa5', '#a0522d', '#2f7d6b', '#7b5ea7', '#b5651d', '#3d7ea6', '#8c4a5a', '#5a6b3a'];
// 희귀도별 배경·테두리(일반·레어·에이스·레전드)
const RARITY = {
  common: ['#e6ebf3', '#c3cde0'], rare: ['#d6e6fd', '#86b3f2'], ace: ['#e7defb', '#a58cf0'], legend: ['#fdf0c4', '#e6a417']
};
// 포지션별 어깨 폭(가드는 호리호리, 센터는 큰 체구)과 머리 크기
const BUILD = { PG: { w: 0.78, head: 1.04 }, SG: { w: 0.84, head: 1.02 }, SF: { w: 0.9, head: 1 }, PF: { w: 0.98, head: 0.97 }, C: { w: 1.06, head: 0.94 } };

const darken = (hex, k = 0.78) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const r1 = (v) => Math.round(v * 10) / 10;

/** 선수 → 그림 시드. 같은 선수의 다른 시즌 카드(같은 kblId)는 같은 기본 모습을 공유한다 */
export function avatarSeed(p) {
  return `${p.kblId ?? p.id ?? ''}|${p.baseName ?? p.name ?? ''}`;
}

/** 시드에서 고른 모습(테스트·디버그용으로 공개) */
export function avatarLook(p, teamColor = null) {
  const rng = mulberry32(hashString(avatarSeed(p)));
  const look = {
    skin: pick(rng, SKIN), hair: pick(rng, HAIR), hairStyle: Math.floor(rng() * 8), brow: Math.floor(rng() * 3), mouth: Math.floor(rng() * 3),
    glasses: rng() < 0.14, stubble: rng() < 0.2, eye: Math.floor(rng() * 2), jersey: teamColor ?? pick(rng, NEUTRAL_JERSEY)
  };
  const age = p.age ?? 26;
  look.gray = age >= 33 && look.hairStyle !== 6; // 나이가 들면 구레나룻이 희끗해진다
  look.stubble = look.stubble && age >= 24;
  look.round = age <= 21; // 어리면 얼굴이 조금 둥글다
  return look;
}

function hairShapes(look, cx) {
  const c = look.hair;
  const dome = `<path d="M${cx - 12} 28 C${cx - 12} 14 ${cx + 12} 14 ${cx + 12} 28 C${cx + 8} 22 ${cx - 8} 22 ${cx - 12} 28Z" fill="${c}"/>`;
  switch (look.hairStyle) {
    case 0: return `<path d="M${cx - 11} 26 C${cx - 11} 16 ${cx + 11} 16 ${cx + 11} 26 C${cx + 7} 21 ${cx - 7} 21 ${cx - 11} 26Z" fill="${c}"/>`; // 짧게 민 머리
    case 1: return `${dome}<path d="M${cx - 12} 27 C${cx - 4} 22 ${cx + 6} 20 ${cx + 12} 24 L${cx + 12} 28 C${cx + 6} 24 ${cx - 6} 24 ${cx - 12} 29Z" fill="${c}"/>`; // 가르마
    case 2: return `<path d="M${cx - 12} 25 L${cx - 11} 14 L${cx + 11} 14 L${cx + 12} 25 C${cx + 8} 21 ${cx - 8} 21 ${cx - 12} 25Z" fill="${c}"/>`; // 각진 윗머리
    case 3: return [[-8, 17], [0, 14], [8, 17], [-12, 22], [12, 22], [-4, 18], [4, 18]].map(([dx, y]) => `<circle cx="${cx + dx}" cy="${y}" r="5" fill="${c}"/>`).join(''); // 곱슬
    case 4: return `${dome}<path d="M${cx - 12} 26 L${cx - 14} 42 C${cx - 10} 44 ${cx - 9} 40 ${cx - 9} 34 Z M${cx + 12} 26 L${cx + 14} 42 C${cx + 10} 44 ${cx + 9} 40 ${cx + 9} 34 Z" fill="${c}"/>`; // 긴 머리
    case 5: return `${dome}<circle cx="${cx}" cy="12" r="5" fill="${c}"/>`; // 묶은 머리
    case 6: return `<ellipse cx="${cx - 4}" cy="19" rx="3.5" ry="1.6" fill="#ffffff" opacity=".35"/>`; // 대머리(광택)
    default: return `<path d="M${cx - 11} 26 C${cx - 11} 16 ${cx + 11} 16 ${cx + 11} 26 C${cx + 7} 21 ${cx - 7} 21 ${cx - 11} 26Z" fill="${c}"/><rect x="${cx - 12}" y="23" width="24" height="3.4" rx="1.7" fill="#f4f1e8" opacity=".92"/>`; // 머리띠
  }
}

function inner(p, { teamColor = null, number = null } = {}) {
  const look = avatarLook(p, teamColor);
  const build = BUILD[p.position] ?? BUILD.SF;
  const [bg, ring] = RARITY[p.rarity] ?? RARITY.common;
  const cx = 32, sw = 26 * build.w, hs = build.head * (look.round ? 1.05 : 1);
  const skin = look.skin, skinD = darken(skin, 0.86), jersey = look.jersey, trim = darken(jersey, 0.7);
  const hy = 29; // 머리 중심 y
  const rx = r1(11 * hs), ry = r1((look.round ? 12 : 13) * hs);
  const brows = [
    `<path d="M${cx - 9} 25.6 H${cx - 4.5} M${cx + 4.5} 25.6 H${cx + 9}" stroke="${look.hair === '#8a8d93' ? '#555' : darken(look.hair, 0.8)}" stroke-width="1.5" stroke-linecap="round"/>`,
    `<path d="M${cx - 9} 26.4 L${cx - 4.5} 25 M${cx + 4.5} 25 L${cx + 9} 26.4" stroke="${darken(look.hair, 0.8)}" stroke-width="1.5" stroke-linecap="round"/>`,
    `<path d="M${cx - 9} 25.6 Q${cx - 6.7} 24.2 ${cx - 4.5} 25.6 M${cx + 4.5} 25.6 Q${cx + 6.7} 24.2 ${cx + 9} 25.6" fill="none" stroke="${darken(look.hair, 0.8)}" stroke-width="1.4" stroke-linecap="round"/>`
  ][look.brow];
  const eyes = look.eye === 0
    ? `<circle cx="${cx - 6.4}" cy="29.4" r="1.5" fill="#1b1b22"/><circle cx="${cx + 6.4}" cy="29.4" r="1.5" fill="#1b1b22"/>`
    : `<ellipse cx="${cx - 6.4}" cy="29.4" rx="1.4" ry="1.9" fill="#1b1b22"/><ellipse cx="${cx + 6.4}" cy="29.4" rx="1.4" ry="1.9" fill="#1b1b22"/>`;
  const mouth = [
    `<path d="M${cx - 4} 36.4 Q${cx} 39.6 ${cx + 4} 36.4" fill="none" stroke="#7a3b30" stroke-width="1.5" stroke-linecap="round"/>`,
    `<path d="M${cx - 3.4} 37 H${cx + 3.4}" stroke="#7a3b30" stroke-width="1.5" stroke-linecap="round"/>`,
    `<path d="M${cx - 4.6} 36 Q${cx} 41 ${cx + 4.6} 36 Z" fill="#fff" stroke="#7a3b30" stroke-width="1.2" stroke-linejoin="round"/>`
  ][look.mouth];
  const glasses = look.glasses ? `<g fill="none" stroke="#2a2a33" stroke-width="1.2"><rect x="${cx - 10}" y="26.6" width="8.4" height="6" rx="2.4"/><rect x="${cx + 1.6}" y="26.6" width="8.4" height="6" rx="2.4"/><path d="M${cx - 1.6} 29.4 H${cx + 1.6}"/></g>` : '';
  const stubble = look.stubble ? `<path d="M${cx - rx + 1.5} ${hy + 4} Q${cx} ${hy + ry + 4} ${cx + rx - 1.5} ${hy + 4} Q${cx} ${hy + ry - 2} ${cx - rx + 1.5} ${hy + 4}Z" fill="${look.hair}" opacity=".22"/>` : '';
  const gray = look.gray ? `<ellipse cx="${cx - rx + 1}" cy="26" rx="2" ry="3.2" fill="#c9ccd2"/><ellipse cx="${cx + rx - 1}" cy="26" rx="2" ry="3.2" fill="#c9ccd2"/>` : '';
  const num = number != null ? `<text x="${cx}" y="60.5" text-anchor="middle" font-size="9" font-weight="800" fill="#ffffff" font-family="system-ui,sans-serif">${number}</text>` : '';
  return [
    `<rect width="64" height="64" rx="9" fill="${bg}"/>`,
    `<circle cx="${cx}" cy="30" r="25" fill="${ring}" opacity=".35"/>`,
    // 팔과 유니폼(민소매)
    `<ellipse cx="${r1(cx - sw - 1.5)}" cy="55" rx="4.4" ry="9" fill="${skin}"/><ellipse cx="${r1(cx + sw + 1.5)}" cy="55" rx="4.4" ry="9" fill="${skin}"/>`,
    `<path d="M${r1(cx - sw)} 64 C${r1(cx - sw)} 52 ${r1(cx - 13 * build.w)} 46 ${cx} 46 C${r1(cx + 13 * build.w)} 46 ${r1(cx + sw)} 52 ${r1(cx + sw)} 64Z" fill="${jersey}"/>`,
    `<path d="M${r1(cx - sw)} 64 C${r1(cx - sw)} 56 ${r1(cx - sw + 2)} 52 ${r1(cx - sw + 3.2)} 51 L${r1(cx - sw + 5)} 64Z M${r1(cx + sw)} 64 C${r1(cx + sw)} 56 ${r1(cx + sw - 2)} 52 ${r1(cx + sw - 3.2)} 51 L${r1(cx + sw - 5)} 64Z" fill="${trim}"/>`,
    // 목과 V넥
    `<rect x="${cx - 4.6}" y="38" width="9.2" height="11" rx="3" fill="${skinD}"/>`,
    `<path d="M${cx - 8} 46.2 L${cx} 55 L${cx + 8} 46.2 Q${cx} 49 ${cx - 8} 46.2Z" fill="${skin}"/>`,
    // 귀·얼굴
    `<circle cx="${cx - rx}" cy="31" r="2.6" fill="${skinD}"/><circle cx="${cx + rx}" cy="31" r="2.6" fill="${skinD}"/>`,
    `<ellipse cx="${cx}" cy="${hy}" rx="${rx}" ry="${ry}" fill="${skin}"/>`,
    stubble, hairShapes(look, cx), gray, brows, eyes, glasses,
    `<path d="M${cx - 0.8} 31.5 Q${cx} 34 ${cx + 1.6} 33.6" fill="none" stroke="${skinD}" stroke-width="1.2" stroke-linecap="round"/>`,
    mouth, num
  ].join('');
}

const cache = new Map();

/**
 * 선수 일러스트 SVG 문자열. opts: size(px, 기본 64), teamColor(유니폼 색, 없으면 선수별 중립색), number(등번호, size 72 이상일 때만 표시),
 * decorative(기본 true: 목록처럼 이름이 옆에 있을 때 스크린리더가 건너뜀. false면 role=img로 읽는다)
 */
export function avatarSvg(p, { size = 64, teamColor = null, number = null, decorative = true } = {}) {
  const showNum = number != null && size >= 72 ? number : null;
  const key = `${avatarSeed(p)}|${p.position ?? ''}|${p.rarity ?? ''}|${p.age ?? ''}|${teamColor ?? ''}|${showNum ?? ''}`;
  let body = cache.get(key);
  if (!body) { body = inner(p, { teamColor, number: showNum }); if (cache.size > 2000) cache.clear(); cache.set(key, body); }
  const label = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${String(p.baseName ?? p.name ?? '선수').replace(/[<>&"]/g, '')} 카드 일러스트(자동 생성, 실제 모습 아님)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" ${label} focusable="false">${body}</svg>`;
}

/** DOM 요소(span.avatar) — 화면에서 쓴다 */
export function avatarEl(p, opts = {}) {
  const el = document.createElement('span');
  el.className = `avatar r-${p.rarity ?? 'common'}${opts.cls ? ` ${opts.cls}` : ''}`;
  el.style.width = `${opts.size ?? 64}px`; el.style.height = `${opts.size ?? 64}px`;
  el.innerHTML = avatarSvg(p, opts);
  upgradeAvatar(el, p, opts); // 페이스팩이 있고 실제 사진이 있는 선수는 사진으로 바꾼다(없으면 이 그림 그대로)
  return el;
}

export const AVATAR_NOTE = '일러스트는 이름·번호로 자동 조합한 그림이며 실제 선수의 모습이 아닙니다(페이스팩 사진이 있는 선수는 KBL 공식 프로필 사진).';
