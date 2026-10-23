// 홈의 "구단 · 경기장" 카드: 경기장, 수용 인원, 관중, 입장 수익, 이번 시즌 수입 구성.
import { h, eok } from '../lib/dom.js';
import { estimateRevenue, priceIndex } from '../../src/funds.mjs';
import { prestigeOf } from '../lib/game.js';

export const PART_LABEL = { gate: '입장 수익', playoffGate: '플레이오프 입장', broadcast: '중계권', sponsor: '모기업 스폰서', merch: '굿즈·기타', playoffBonus: '플레이오프 상금' };
const PART_ORDER = ['gate', 'playoffGate', 'broadcast', 'sponsor', 'merch', 'playoffBonus'];
const num = (n) => Number(n).toLocaleString('ko-KR');

/** 수입 구성 막대 + 범례. parts: { gate, broadcast, … } */
export function partsBar(parts) {
  const items = PART_ORDER.map((k) => [k, parts[k] ?? 0]).filter(([, v]) => v > 0);
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  return h('div', { class: 'fin-parts' },
    h('div', { class: 'fin-bar', role: 'img', 'aria-label': items.map(([k, v]) => `${PART_LABEL[k]} ${eok(v)}`).join(', ') }, items.map(([k, v]) => h('i', { class: `p-${k}`, style: { width: `${(v / total) * 100}%` }, title: `${PART_LABEL[k]} ${eok(v)}` }))),
    h('ul', { class: 'fin-legend' }, items.map(([k, v]) => h('li', h('span', { class: `dot p-${k}` }), `${PART_LABEL[k]} `, h('b', eok(v)), h('span', { class: 'note' }, ` ${Math.round((v / total) * 100)}%`)))));
}

/** 시즌별 리그 총 관중(플레이오프 포함 추정) 추이: 공식 집계의 최근 시즌 + 게임에서 치른 시즌 */
export function attendanceTrend(game, data, officialCount = 4) {
  const official = (data.attendance ?? []).filter((r) => r.season < '2026-27' && !['2020-21', '2021-22'].includes(r.season)).slice(0, officialCount).reverse().map((r) => ({ season: r.season, total: r.total, official: true }));
  const played = game.log.map((e) => {
    const led = Object.values(e.ledger ?? {});
    const total = led.reduce((s, l) => s + (l.attendance?.total ?? 0) + (l.attendance?.playoffAvg ?? 0) * (l.attendance?.playoffGames ?? 0), 0);
    return { season: e.season, total, official: false, gate: led.reduce((s, l) => s + (l.parts?.gate ?? 0) + (l.parts?.playoffGate ?? 0), 0) };
  }).filter((r) => r.total > 0);
  return [...official, ...played.slice(-6)];
}

function trendBars(rows) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return h('div', { class: 'fin-trend', role: 'img', 'aria-label': rows.map((r) => `${r.season} ${num(r.total)}명`).join(', ') },
    rows.map((r) => h('div', { class: `fin-t ${r.official ? 'off' : 'game'}`, title: `${r.season} ${num(r.total)}명${r.gate ? ` · 입장 ${eok(r.gate, 0)}` : ''}` },
      h('i', { style: { height: `${Math.max(6, (r.total / max) * 100)}%` } }), h('span', { class: 'note' }, r.season.replace(/^20/, '').replace('-', '-')), h('b', `${Math.round(r.total / 1000)}k`))));
}

export function financeCard(ctx) {
  const { game, data, session } = ctx;
  const my = game.managerId, team = ctx.team(my);
  const venue = team.venue ?? {};
  const last = game.log.at(-1)?.ledger?.[my];
  const att = last?.attendance;
  const est = estimateRevenue(my, { teamData: data.teams, standings: session.standings(), prestige: prestigeOf(game, data), season: game.league.season, att: game.league.att ?? null }, data.rules);
  const cap = venue.capacity;
  const fact = (label, value, sub) => h('div', { class: 'fin-fact' }, h('span', { class: 'note' }, label), h('b', value), sub ? h('span', { class: 'note' }, sub) : null);
  return h('div', { class: 'card fin-card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '구단 · 경기장'), h('span', { class: 'note' }, `${team.city} · ${team.arena}`)),
    h('div', { class: 'fin-facts' },
      fact('홈 경기장', team.arena, cap ? `수용 ${num(cap)}명` : '수용 인원 자료 없음'),
      fact('경기당 관중', att ? `${num(att.avg)}명` : `${num(est.attendance.avg)}명`, att ? `지난 시즌${att.occupancy != null ? ` · 점유율 ${Math.round(att.occupancy * 100)}%` : ''}${att.sellouts ? ` · 매진 ${att.sellouts}경기` : ''}` : `예상 (인기 ${est.attendance.popularity.toFixed(2)})`),
      fact('1인당 입장료', `${est.attendance.yieldMan.toFixed(2)}만원`, '게임용 추정'),
      fact('입장 수익', eok(att && last?.parts ? last.parts.gate + last.parts.playoffGate : est.parts.gate), att ? '지난 시즌' : '이번 시즌 예상')),
    h('p', { class: 'note', style: { margin: '10px 0 4px' } }, `이번 시즌 예상 수입 ${eok(est.revenue)} (지금 성적 기준)`),
    partsBar(est.parts),
    h('div', { class: 'fin-trend-wrap' }, h('div', { class: 'row between' }, h('b', '리그 총 관중 추이'), h('span', { class: 'note' }, '회색 = 공식 집계(플레이오프 포함 추정), 색 = 게임 진행')), trendBars(attendanceTrend(game, data))),
    h('p', { class: 'note fin-foot' }, `물가 반영: 샐러리캡·최저 연봉·요구 연봉과 객단가·중계권·스폰서·굿즈가 해마다 연 ${(data.rules.economy.inflation * 100).toFixed(1)}%씩 오르고(올해 ×${priceIndex(game.league.season, data.rules).toFixed(2)}), 리그 관중도 연 ${(data.rules.revenue.attendanceTrend * 100).toFixed(1)}% 안팎으로 완만히 늘어납니다. `),
    h('p', { class: 'note fin-foot' }, '2023-24 KBL 집계(리그 관중 73.8만 명, 입장 수입 약 100억 원, 서울 SK·창원 LG·부산 KCC·원주 DB 평균 관중)에 맞춘 추정 모델입니다. 중계권·스폰서·굿즈 금액은 자료가 없어 지은 값입니다. 구단별 관중은 팬 기반(2023-24 평균 관중)과 해마다의 성적으로 정합니다.' + (cap ? '' : ' 경기장 수용 인원은 자료가 확인되면 채웁니다.')));
}
