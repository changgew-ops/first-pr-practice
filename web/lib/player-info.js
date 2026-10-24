// 선수 정보 창: 오프시즌·트레이드 화면에서 선수 이름을 누르면 능력치·계약·기록을 한 창에 보여 준다.
// 순수 계산(positionAverages·statRows·contractLabel·seasonLine·recentCareer·extraFacts)은 DOM 없이 테스트할 수 있다.
import { h, ovrChip, STAT_KEYS, STAT_LABELS, ORIGIN_LABEL, RARITY_LABEL, eok } from './dom.js';
import { careerRows } from '../../src/career.mjs';
import { demandEok } from '../../src/valuation.mjs';
import { avatarEl, AVATAR_NOTE } from './avatar.js';
import { colorOf } from './team-ui.js';

/** 같은 포지션 선수들의 능력치 평균: Map<포지션, { shooting: 61.2, … }> (players: 리그 전체 선수 목록) */
export function positionAverages(players) {
  const acc = new Map();
  for (const p of players) {
    if (!p.stats) continue;
    const a = acc.get(p.position) ?? { n: 0, sum: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) };
    a.n += 1;
    for (const k of STAT_KEYS) a.sum[k] += p.stats[k];
    acc.set(p.position, a);
  }
  return new Map([...acc].map(([pos, a]) => [pos, Object.fromEntries(STAT_KEYS.map((k) => [k, a.sum[k] / a.n]))]));
}

/** 능력치 여섯 줄: { key, label, value, avg(같은 포지션 평균, 없으면 null), diff(반올림한 차이) } */
export function statRows(p, avgs) {
  const avg = avgs?.get(p.position);
  return STAT_KEYS.map((key) => ({ key, label: STAT_LABELS[key], value: p.stats[key], avg: avg ? avg[key] : null, diff: avg ? Math.round(p.stats[key] - avg[key]) : null }));
}

export function contractLabel(p) {
  const c = p.contract ?? {};
  const years = c.yearsLeft > 0 ? `${c.yearsLeft}년` : (c.salaryEok != null || c.salaryUsd != null ? '계약 만료' : '계약 없음');
  if (c.salaryUsd != null) return `연봉 $${Math.round(c.salaryUsd / 1000)}k · ${years}`;
  if (c.salaryEok != null) return `연봉 ${eok(c.salaryEok)} · ${years}`;
  return years;
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');

/** 게임에서 뛴 시즌 기록 한 줄(진행 중이면 이번 시즌, 아니면 마지막으로 끝난 시즌). 없으면 null */
export function seasonLine(ctx, p) {
  const s = ctx.session;
  const t = s?.run?.totals?.get?.(p.id);
  if (t && t.games > 0) return { label: '이번 시즌(게임)', gp: t.games, mpg: t.minutes / t.games, ppg: t.points / t.games, rpg: t.rebounds / t.games, apg: t.assists / t.games };
  const last = s?.game?.log?.at?.(-1);
  const l = last?.lines?.[p.id];
  if (l && l[0] > 0) return { label: `${last.season} 시즌(게임)`, gp: l[0], mpg: l[1] / l[0], ppg: l[2] / l[0], rpg: l[3] / l[0], apg: l[4] / l[0] };
  return null;
}

/** KBL 공식 기록의 최근 n시즌(정규시즌): careers.json에 있는 선수만. 없으면 빈 배열 */
export function recentCareer(ctx, p, n = 3) {
  const entry = p.kblId ? ctx.data.careers?.[p.kblId] : null;
  return careerRows(entry, ['r']).slice(-n);
}

/** 선수 객체에 있는 정보로 "상황" 줄을 만든다: [라벨, 값][] */
export function extraFacts(ctx, p) {
  const out = [];
  if (p.card) {
    const per = p.card.gp ? ` · ${p.card.gp}경기 평균 ${Math.round(p.card.minutes / p.card.gp)}분` : '';
    out.push(['시즌 카드', `${p.card.label}년 카드${p.card.teamId ? ` · 당시 ${ctx.name(p.card.teamId)}` : ''}${per}. 능력치는 그 시즌 기록으로 만든 값입니다.`]);
  }
  if (p.prevTeamId) out.push(['원소속', `${ctx.name(p.prevTeamId)}${p.prevSalaryEok != null ? ` · 전 시즌 보수 ${eok(p.prevSalaryEok)}` : ''}${p.prevRank && p.prevRank < 900 ? ` · 보수 ${p.prevRank}위` : ''}`]);
  if (p.origin === 'domestic' && p.contract && p.teamId && p.contract.yearsLeft <= 0) out.push(['재계약 요구 연봉(추정)', eok(demandEok(p))]);
  else if (p.origin === 'domestic' && p.prevTeamId) out.push(['FA 요구 연봉(추정)', eok(demandEok(p))]);
  if (p.origin === 'domestic' && !p.teamId && !p.prevTeamId && p.contract?.yearsLeft === 0) out.push(['신인 후보', '지명 순번에 따라 신인 보수가 정해지고 캡에서 면제됩니다.']);
  return out;
}

let bound = null;
/** 오프시즌·트레이드 화면이 그려질 때 한 번 호출해 두면 playerLine 같은 부품이 ctx 없이도 정보 창을 열 수 있다 */
export function bindInfoCtx(ctx) { bound = ctx; }

/** 선수 이름 버튼: 누르면 정보 창. 밑줄 점선으로 눌러지는 것이라는 걸 보인다. 행 선택과 겹치지 않게 이벤트 전파를 막는다 */
export function nameButton(p, { ctx = bound, extra = [], cls = '' } = {}) {
  return h('button', {
    class: `pl-name ${cls}`.trim(), type: 'button', title: '눌러서 선수 정보 보기', 'aria-haspopup': 'dialog',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); if (ctx) openPlayerInfo(ctx, p, extra); }
  }, p.name);
}

/** id로 선수 이름 버튼: 지금 리그에 있는 선수면 정보 창 버튼, 아니면(은퇴·리그 밖) 예전처럼 선수 페이지 링크. 기록 표·결산 같은 곳에서 쓴다 */
export function playerLink(id, name, { ctx = bound, cls = '' } = {}) {
  const p = ctx?.session?.players?.find((x) => x.id === id);
  if (!p) return h('a', { href: `#/player/${id}`, class: cls || null }, name);
  return nameButton({ ...p, name: name ?? p.name }, { ctx, cls });
}

let open = null;

/** 정보 창 열기. extra: [라벨, 값(문자열 또는 노드)][] — 화면이 덧붙이는 상황 정보 */
export function openPlayerInfo(ctx, p, extra = []) {
  if (open) open.close();
  const all = ctx.session?.players ?? [];
  const rows = statRows(p, positionAverages(all));
  const inLeague = all.some((x) => x.id === p.id);
  const line = seasonLine(ctx, p);
  const career = recentCareer(ctx, p);
  const titleId = `pi-title-${p.id}`;
  const dlg = h('dialog', { class: 'pi-dialog', 'aria-labelledby': titleId },
    h('div', { class: 'pi-head' },
      avatarEl(p, { size: 56, teamColor: p.teamId ? colorOf(p.teamId) : null, cls: 'avatar-pi' }),
      ovrChip(p),
      h('div', { class: 'pi-id' },
        h('h2', { id: titleId }, p.name),
        h('div', { class: 'note' }, `${p.position} · ${p.age}세 · ${ORIGIN_LABEL[p.origin] ?? p.origin} · ${RARITY_LABEL[p.rarity] ?? ''}${p.teamId ? ` · ${ctx.name(p.teamId)}` : ''}`)),
      h('button', { class: 'btn ghost pi-close', type: 'button', 'aria-label': '닫기', onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'pi-nums' },
      h('div', h('span', { class: 'note' }, 'OVR'), h('b', p.ovr)), h('div', h('span', { class: 'note' }, 'POT'), h('b', p.potential ?? '-')),
      h('div', h('span', { class: 'note' }, '계약'), h('b', contractLabel(p)))),
    h('div', { class: 'pi-stats', role: 'list', 'aria-label': '능력치 (같은 포지션 리그 평균과 비교)' },
      rows.map((r) => h('div', { class: 'pi-stat', role: 'listitem' },
        h('span', { class: 'pi-stat-label' }, r.label),
        h('span', { class: 'pi-bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(2, Math.min(100, r.value))}%` } }), r.avg != null ? h('u', { style: { left: `${Math.max(0, Math.min(100, r.avg))}%` }, title: `같은 포지션 평균 ${f1(r.avg)}` }) : null),
        h('b', r.value),
        h('span', { class: `pi-diff ${r.diff > 0 ? 'good' : r.diff < 0 ? 'bad' : ''}`, title: `같은 포지션(${p.position}) 평균 ${f1(r.avg)}` }, r.diff == null ? '' : r.diff > 0 ? `+${r.diff}` : `${r.diff}`)))),
    h('p', { class: 'note' }, '막대의 세로 눈금과 오른쪽 숫자는 같은 포지션 선수들의 현재 리그 평균과의 차이입니다.'),
    h('p', { class: 'note' }, AVATAR_NOTE),
    ...[...extraFacts(ctx, p), ...extra].map(([k, v]) => h('div', { class: 'pi-fact' }, h('span', { class: 'note' }, k), h('span', v))),
    line ? h('div', { class: 'pi-fact' }, h('span', { class: 'note' }, line.label), h('span', `${line.gp}경기 · ${f1(line.mpg)}분 · ${f1(line.ppg)}점 ${f1(line.rpg)}리바 ${f1(line.apg)}어시`)) : null,
    career.length ? h('div', { class: 'pi-career' }, h('div', { class: 'note' }, 'KBL 공식 기록(최근)'),
      career.map((r) => h('div', { class: 'pi-fact' }, h('span', { class: 'note' }, `${r.season}${r.teamId ? ` ${ctx.name(r.teamId)}` : ''}`), h('span', `${r.gp}경기 · ${f1(r.mpg)}분 · ${f1(r.ppg)}점 ${f1(r.rpg)}리바 ${f1(r.apg)}어시`)))) : null,
    h('div', { class: 'pi-foot' }, inLeague ? h('a', { class: 'btn', href: `#/player/${p.id}`, onclick: () => dlg.close() }, '상세 페이지 열기') : h('span', { class: 'note' }, '아직 우리 리그 로스터에 없는 선수입니다.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => dlg.close() }, '닫기')));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥(어두운 배경) 클릭
  dlg.addEventListener('close', () => { dlg.remove(); if (open === dlg) open = null; });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  open = dlg;
  return dlg;
}
