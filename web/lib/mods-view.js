// 표기 규칙(화면 전체): 선수의 "성장 변화"는 OVR 옆 "(+N)"(web/lib/dom.js ovrChip, 시즌 사이에 능력치가 바뀐 폭)이고,
// "이번 경기에만 적용되는 보정"(감독·전술·컨디션)은 이 파일의 칩("경기 보정 +0.8점")과 컨디션 막대로 따로 보인다. 두 종류를 같은 +N/화살표/색으로 섞지 않는다.
// 숫자의 출처는 모두 src/effective.mjs(엔진이 경기에 쓰는 값과 같은 함수)다.
import { h } from './dom.js';

/** 점수 표기: +0.8점 / −0.4점 / ±0.0점 */
export const fmtPts = (v) => `${v > 0.005 ? '+' : v < -0.005 ? '−' : '±'}${Math.abs(v).toFixed(1)}점`;
const tone = (v) => (v > 0.05 ? 'good' : v < -0.05 ? 'bad' : '');

/** 내역 항목: [이름, 점수][] — 감독·전술·컨디션은 늘 보이고, 단장 보정(우리 구단, 초보 도움)·시너지 칸은 있을 때만 별도 줄로 */
export function modLines(e) {
  const p = e.parts ?? { coach: 0, tactic: 0, cond: 0 };
  const lines = [['감독', p.coach], ['전술', p.tactic], ['컨디션', p.cond]];
  if (p.manager != null) lines.push(['단장 보정', p.manager]);
  for (const s of e.synergy ?? []) lines.push([`${s.label} ${s.level}단계`, s.edge]);
  return lines;
}

/** 경기 보정 칩: 합계와 내역(감독·전술·컨디션·단장 보정·시너지)은 툴팁(title)에 */
export function modChip(e, { label = '경기 보정' } = {}) {
  const title = `이번 경기에만 적용되는 보정(선수 성장 변화가 아님) — ${modLines(e).map(([n, v]) => `${n} ${fmtPts(v)}`).join(' · ')}. 팀 기대 득점에 더해지는 점수입니다.`;
  return h('span', { class: `mod-chip ${tone(e.edge)}`, title }, `${label} ${fmtPts(e.edge)}`);
}

/** 내역 한 줄: 텍스트 */
export const modText = (e) => modLines(e).map(([n, v]) => `${n} ${fmtPts(v)}`).join(' · ');

/** 유효 전력 표기: "63.8" (기본 63.3 + 경기 보정) */
export const effText = (e) => `${e.effective.toFixed(1)}`;

/**
 * 시너지 카드: 칸마다 단계(●●○)·모인 인원·다음 단계까지 필요한 인원. e = effectiveOf 결과(synergy 배열 포함)
 * 시작 로스터의 26 선수는 구단을 옮기기 전까지 세지 않는다(src/synergy.mjs).
 */
export function synergyCard(e, { names = null } = {}) {
  const slots = e?.synergy;
  if (!slots?.length) return null;
  const pips = (s) => h('span', { class: 'syn-pips', 'aria-label': `${s.level}단계 / ${s.max}단계` }, Array.from({ length: s.max }, (_, i) => h('i', { class: i < s.level ? 'on' : '' })));
  const row = (s) => h('li', { class: `syn-row ${s.level ? 'on' : ''}` },
    h('div', { class: 'syn-head' }, h('b', s.label), pips(s), h('span', { class: `mod-chip ${s.level ? 'good' : ''}` }, fmtPts(s.edge))),
    h('div', { class: 'note' }, s.level >= s.max ? `최대 단계 · ${s.count}명이 모였습니다` : `${s.count ? `${s.count}명 모임` : '아직 없음'} · ${s.need}명 더 모으면 ${s.level + 1}단계(${s.thresholds.join('·')}명이면 1·2·3단계)`),
    s.count && names ? h('div', { class: 'note syn-names' }, s.players.map((id) => names(id)).filter(Boolean).join(', ')) : null);
  return h('div', { class: 'card syn-card' },
    h('h2', { style: { margin: 0 } }, '시너지'),
    h('p', { class: 'note', style: { margin: '4px 0 8px' } }, '엔트리(스타팅 + 벤치)에 같은 구단·같은 해 카드, 또는 같은 해 카드 선수가 모이면 단계가 오르고 경기 보정이 붙습니다(최대 3단계). 게임 시작 때의 26 선수는 구단을 옮기기 전까지 세지 않고, 나중에 드래프트·FA로 다시 데려온 카드는 셉니다.'),
    h('ul', { class: 'syn-list' }, slots.map(row)));
}
