// 구단 엠블럼: 실제 구단 로고가 아니라 화면 구분용으로 직접 만든 배지다(공식 로고·CI를 쓰지 않는다. web/lib/team-ui.js 참고).
// 구단 색 + 구단마다 다른 모양 + 농구공 이음선 + 두 글자 약호. 구단 id가 없거나 모르는 구단(과거 구단 등)은 회색 농구공 배지.
import { svg } from './dom.js';
import { colorOf } from './team-ui.js';

const CODE = { 'wonju-db': 'DB', 'seoul-samsung': 'SS', 'goyang-sono': 'SN', 'seoul-sk': 'SK', 'changwon-lg': 'LG', 'anyang-jungkwanjang': 'JK', 'busan-kcc': 'KC', 'suwon-kt': 'KT', 'daegu-kogas': 'KG', 'ulsan-hyundai-mobis': 'HM' };
// 32×32 안에 그린 윤곽(구단마다 다르다)
const SHAPE = {
  'wonju-db': 'M16 2 A14 14 0 1 1 15.99 2 Z',
  'seoul-samsung': 'M16 1.5 L30.5 16 L16 30.5 L1.5 16 Z',
  'goyang-sono': 'M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z',
  'seoul-sk': 'M4 4 H28 V17 Q28 26 16 30 Q4 26 4 17 Z',
  'changwon-lg': 'M8 3 H24 Q29 3 29 8 V24 Q29 29 24 29 H8 Q3 29 3 24 V8 Q3 3 8 3 Z',
  'anyang-jungkwanjang': 'M16 2 L29 11 L24 29 H8 L3 11 Z',
  'busan-kcc': 'M16 2 A14 14 0 1 1 15.99 2 Z',
  'suwon-kt': 'M10 2 H22 L30 10 V22 L22 30 H10 L2 22 V10 Z',
  'daegu-kogas': 'M16 2 L30 28 H2 Z',
  'ulsan-hyundai-mobis': 'M16 1.5 L20 9 L28.5 7.5 L24 15 L30.5 21 L22 22 L19 30 L16 23.5 L13 30 L10 22 L1.5 21 L8 15 L3.5 7.5 L12 9 Z'
};
const FALLBACK = 'M16 2 A14 14 0 1 1 15.99 2 Z';

function lightness(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 구단 엠블럼 SVG. size: 화면 px */
export function emblem(id, { size = 22, label = null } = {}) {
  const known = id in SHAPE;
  const base = known ? colorOf(id) : '#8b93a7';
  const dark = shade(base, 0.62);
  const text = lightness(base) > 0.62 ? '#10162f' : '#ffffff';
  const code = CODE[id] ?? '';
  return svg('svg', { viewBox: '0 0 32 32', width: size, height: size, class: 'emblem', role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true' },
    svg('path', { d: SHAPE[id] ?? FALLBACK, fill: base, stroke: dark, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    // 농구공 이음선(연한 선)
    svg('path', { d: 'M3 16 H29 M16 3 V29 M7 7 Q16 16 7 25 M25 7 Q16 16 25 25', fill: 'none', stroke: dark, 'stroke-opacity': 0.28, 'stroke-width': 1.2 }),
    code ? svg('text', { x: 16, y: 20.2, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, 'font-family': 'system-ui, sans-serif', fill: text, stroke: dark, 'stroke-opacity': text === '#ffffff' ? 0.5 : 0, 'stroke-width': 0.5, 'paint-order': 'stroke' }, code) : null);
}
