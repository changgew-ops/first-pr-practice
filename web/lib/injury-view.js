// 부상 화면 부품: 표시 문구·태그·현황 카드·선수별 부상 이력. 규칙은 src/injuries.mjs, 상태는 세션(session.injuries / rosterLog)이 준다.
import { h, table, POS_ORDER } from './dom.js';
import { playerLink } from './player-info.js';
import { KIND_LABEL } from '../../src/injuries.mjs';

/** 선수 id → 지금 부상 */
export const injuryMap = (session) => new Map((session.injuries ?? []).map((i) => [i.playerId, i]));

/** "3경기 결장" / "시즌 아웃" */
export const leftText = (inj) => (inj.kind === 'season' ? '시즌 아웃' : `${inj.left}경기 결장`);

/** 작은 부상 표시(십자 아이콘 + 남은 경기). 색은 종류별(css/injury.css) */
export function injuryTag(inj, { full = false } = {}) {
  const title = `${KIND_LABEL[inj.kind] ?? '부상'} · ${inj.part} · 진단 ${inj.kind === 'season' ? '시즌 아웃' : `${inj.total}경기`}${inj.temp ? ' · 일시교체 선수가 대신 뜁니다' : ''}`;
  return h('span', { class: `inj-tag inj-${inj.kind}`, title }, h('span', { class: 'inj-cross', 'aria-hidden': 'true' }, '✚'), ` ${full ? `${inj.part} · ` : ''}${leftText(inj)}`);
}

/** 일시교체로 들어온 선수 표시 */
export const tempTag = () => h('span', { class: 'inj-tag inj-temp', title: '외국선수 관리규정에 따라 부상 선수를 대신해 뛰는 일시교체 선수입니다. 부상 선수가 돌아오면 팀을 떠납니다' }, '일시교체');

/**
 * 부상 현황 카드(시즌 화면·라인업 화면 공용). 우리 구단 부상자(편성 영향 포함)와 리그 전체 부상자.
 * opts.compact: 우리 구단만(라인업 화면용)
 */
export function injuryCard(ctx, { compact = false } = {}) {
  const s = ctx.session, my = s.managerId;
  const all = s.injuries ?? [];
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const mine = all.filter((i) => i.teamId === my).sort((a, b) => b.left - a.left);
  const others = all.filter((i) => i.teamId !== my).sort((a, b) => b.left - a.left);
  const swaps = new Map((s.lineupSwaps ?? []).map((x) => [x.out.id, x.in]));
  const head = h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, '부상 현황'), h('span', { class: 'note' }, `우리 ${mine.length}명 · 리그 전체 ${all.length}명`));
  const rows = (list, withTeam) => table(list, [
    ...(withTeam ? [{ key: 'team', label: '구단', get: (i) => ctx.name(i.teamId), sort: false }] : []),
    { key: 'name', label: '선수', get: (i) => i.name, sort: false, render: (i) => playerLink(i.playerId, byId.get(i.playerId)?.name ?? i.name) },
    { key: 'pos', label: '포지션', get: (i) => POS_ORDER.indexOf(byId.get(i.playerId)?.position), sort: false, render: (i) => h('span', { class: 'pos' }, byId.get(i.playerId)?.position ?? '-') },
    { key: 'part', label: '부위', get: (i) => i.part, sort: false },
    { key: 'left', label: '결장', get: (i) => i.left, sort: false, render: (i) => injuryTag(i) },
    { key: 'note', label: '편성', get: () => 0, sort: false, render: (i) => {
      if (i.teamId !== my) return '';
      const sub = swaps.get(i.playerId);
      const p = byId.get(i.playerId);
      const bits = [];
      if (sub) bits.push(`${sub.name}이(가) 대신 뜸`); else bits.push('편성에서 제외');
      if (p?.origin === 'foreign' || p?.origin === 'asia') bits.push(i.temp ? '일시교체 중' : `${p.origin === 'asia' ? '아시아쿼터' : '외국인'} 교체 가능(로스터 화면)`);
      return h('span', { class: 'note' }, bits.join(' · '));
    } }
  ], { empty: '부상자가 없습니다' });
  const body = [head];
  body.push(mine.length ? rows(mine, false) : h('p', { class: 'muted', style: { margin: '8px 0 0' } }, '우리 구단에는 지금 부상자가 없습니다.'));
  if (!compact && others.length) body.push(h('details', { class: 'inj-others' }, h('summary', `다른 구단 부상자 ${others.length}명`), rows(others.slice(0, 20), true)));
  body.push(h('p', { class: 'note', style: { margin: '8px 0 0' } }, '부상 선수는 라인업에서 자동으로 빠지고, 직접 편성한 경우 건강한 선수가 같은 자리에 대신 서며 복귀하면 원래 편성으로 돌아갑니다. 부상 중에는 출전 시간과 기록이 쌓이지 않습니다. 남은 결장은 플레이오프 직전에 일부 회복되고, 오프시즌에 모두 해소됩니다.'));
  return h('div', { class: 'card inj-card' }, body);
}

/** 선수 한 명의 부상 이력(최신순): 이번 시즌 기록 + 지난 시즌 요약. [{ season, day, games, kind, part, current }] */
export function injuryHistory(session, playerId) {
  const out = [];
  const cur = session.injuryOf?.(playerId) ?? null;
  for (const e of (session.rosterLog ?? []).filter((x) => x.type === 'injury' && x.playerId === playerId)) {
    out.push({ season: session.season, day: e.day, games: e.games, kind: e.kind, part: e.part, current: Boolean(cur && cur.day === e.day) });
  }
  const log = [...(session.game.log ?? []), ...(session.game.seasonEnd ? [session.game.seasonEnd.entry] : [])];
  for (const entry of log) {
    for (const [id, , day, games, kind, part] of entry.roster?.inj ?? []) if (id === playerId) out.push({ season: entry.startYear, day, games, kind, part, current: false });
  }
  return out.sort((a, b) => b.season - a.season || b.day - a.day);
}
