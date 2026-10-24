// 표기 규칙(화면 전체): 선수의 "성장 변화"는 OVR 옆 "(+N)"(web/lib/dom.js ovrChip, 시즌 사이에 능력치가 바뀐 폭)이고,
// "이번 경기에만 적용되는 보정"(감독·전술·컨디션)은 이 파일의 칩("경기 보정 +0.8점")과 컨디션 막대로 따로 보인다. 두 종류를 같은 +N/화살표/색으로 섞지 않는다.
// 숫자의 출처는 모두 src/effective.mjs(엔진이 경기에 쓰는 값과 같은 함수)다.
import { h } from './dom.js';

/** 점수 표기: +0.8점 / −0.4점 / ±0.0점 */
export const fmtPts = (v) => `${v > 0.005 ? '+' : v < -0.005 ? '−' : '±'}${Math.abs(v).toFixed(1)}점`;
const tone = (v) => (v > 0.05 ? 'good' : v < -0.05 ? 'bad' : '');

/** 경기 보정 칩: 합계와 감독·전술·컨디션 내역은 툴팁(title)에 */
export function modChip(e, { label = '경기 보정' } = {}) {
  const p = e.parts ?? { coach: 0, tactic: 0, cond: 0 };
  const title = `이번 경기에만 적용되는 보정(선수 성장 변화가 아님) — 감독 ${fmtPts(p.coach)} · 전술 ${fmtPts(p.tactic)} · 컨디션 ${fmtPts(p.cond)}. 팀 기대 득점에 더해지는 점수입니다.`;
  return h('span', { class: `mod-chip ${tone(e.edge)}`, title }, `${label} ${fmtPts(e.edge)}`);
}

/** 내역 한 줄(감독·전술·컨디션): 텍스트 */
export const modText = (e) => {
  const p = e.parts ?? { coach: 0, tactic: 0, cond: 0 };
  return `감독 ${fmtPts(p.coach)} · 전술 ${fmtPts(p.tactic)} · 컨디션 ${fmtPts(p.cond)}`;
};

/** 유효 전력 표기: "63.8" (기본 63.3 + 경기 보정) */
export const effText = (e) => `${e.effective.toFixed(1)}`;
