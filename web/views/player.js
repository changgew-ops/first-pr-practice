import { h, radar, STAT_KEYS, STAT_LABELS, bar, ORIGIN_LABEL, RARITY_LABEL, eok, link, table, stat, tabs, deltaBadge } from '../lib/dom.js';
import { ovrDelta, statDelta } from '../../src/ovr-delta.mjs';
import { playerById, gameRecordRows } from '../lib/game.js';
import { careerRows, TYPE_LABEL } from '../../src/career.mjs';
import { sumRows } from '../../src/player-record.mjs';
import { contractButtons, contractBlock } from '../lib/contract-view.js';
import { avatarEl, AVATAR_NOTE } from '../lib/avatar.js';
import { colorOf } from '../lib/team-ui.js';
import { playerAwardHistory, awardHistoryText } from '../../src/awards.mjs';
import { injuryHistory, injuryTag, tempTag } from '../lib/injury-view.js';
import { KIND_LABEL } from '../../src/injuries.mjs';

export function render(ctx, [id]) {
  const { game } = ctx;
  const p = playerById(game, id);
  if (!p) return { title: '선수', body: h('div', { class: 'card' }, h('h2', '선수를 찾을 수 없습니다'), h('p', { class: 'muted' }, '은퇴했거나 다른 시즌의 선수일 수 있습니다.'), link('#/roster', '← 로스터')) };
  const prof = ctx.profiles.get(p.baseName ?? p.name);
  const official = ctx.data.careers[p.kblId]?.profile;
  const salary = p.origin === 'foreign' ? `$${(p.contract.salaryUsd / 1000).toFixed(0)}k` : eok(p.contract.salaryEok);
  const body = h('div', { class: 'stack' },
    h('div', { class: 'crumb' }, link('#/roster', '로스터'), ' / ', ctx.name(p.teamId)),
    h('div', { class: 'grid g2' },
      h('div', { class: `pcard r-${p.rarity}` },
        h('div', { class: 'num' }, p.number),
        avatarEl(p, { size: 112, teamColor: colorOf(p.teamId), number: p.number, decorative: false, cls: 'avatar-pcard' }),
        h('div', { class: 'row' }, h('div', { class: 'big-ovr' }, p.ovr, ovrDelta(p) ? h('span', { class: `big-ovr-d ${ovrDelta(p) > 0 ? 'up' : 'down'}`, title: '지난 시즌 종료 시점 대비' }, ` (${ovrDelta(p) > 0 ? '+' : '-'}${Math.abs(ovrDelta(p))})`) : null), h('div', h('div', { class: 'note' }, RARITY_LABEL[p.rarity]), h('div', { class: 'note' }, `코스트 ${p.cost}`))),
        h('h1', { style: { margin: '10px 0 2px' } }, p.name),
        h('div', { class: 'row' }, h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `${p.age}세 · ${ORIGIN_LABEL[p.origin]}${p.nationality ? ` · ${p.nationality}` : ''}`), h('span', { class: 'tag' }, p.real ? '실제 선수' : '가상 선수')),
        h('div', { style: { marginTop: '14px' } }, radar(p.stats)),
        h('p', { class: 'note', style: { marginBottom: '0' } }, AVATAR_NOTE)),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', '능력치'), h('div', { class: 'stack', style: { '--gap': '6px' } }, STAT_KEYS.map((k) => h('div', { class: 'statline' }, h('span', STAT_LABELS[k]), bar(p.stats[k], 100), h('b', { class: 'r' }, p.stats[k], deltaBadge(statDelta(p, k)))))),
          h('p', { class: 'note' }, `성장 한도(POT) ${p.potential}${p.age >= 27 ? ' · 27세 이상은 더 오르지 않습니다' : p.potential > p.ovr ? ` · 잠재력 +${p.potential - p.ovr}` : ''}`)),
        h('div', { class: 'card' }, h('h3', '계약'), h('div', { class: 'grid g3' }, stat('연봉', salary), stat('남은 계약', p.contract.yearsLeft <= 0 ? '만료' : `${p.contract.yearsLeft}년`), stat('소속', ctx.name(p.teamId))), p.teamId === game.managerId ? h('div', { class: 'ct-actions' }, contractButtons(ctx, p), contractBlock(ctx.session, p) ? h('span', { class: 'note' }, contractBlock(ctx.session, p)) : h('span', { class: 'note' }, '계약이 남아 있어도 연장 협상을 할 수 있고, 방출하면 남은 보수를 냅니다')) : null)),
    ),
    (official || prof) && h('div', { class: 'card' }, h('h3', '실제 프로필'), h('div', { class: 'grid g4' },
      stat('생년월일', official?.birth ?? prof?.birth), stat('신체', `${official?.heightCm ?? prof?.heightCm}cm${(official?.weightKg ?? prof?.weightKg) ? ` · ${official?.weightKg ?? prof?.weightKg}kg` : ''}`),
      stat('학교', official?.school ?? prof?.school ?? '-'), stat('포지션', official?.position ?? (prof?.position ?? []).join('/') ?? '-')),
      prof?.nationality && h('p', { class: 'note' }, `국적: ${prof?.nationality.join(' · ')}`),
      prof?.career && h('p', { class: 'note' }, 'KBL 경력: ', prof?.career.map((c) => `${ctx.name(c.team)} ${c.years}`).join(' → ')),
      h('p', { class: 'note' }, `출처: ${official ? 'KBL 공식 프로필(2026-10-23 조회; 신체·등번호는 조회 시점 값)' : prof.source}`)),
    awardLine(game, p),
    injuryLine(ctx, p),
    recordCard(ctx, p));
  return { title: p.name, body };
}

/** 지금의 부상과 게임에서 겪은 부상 이력(최신순). 둘 다 없으면 그리지 않는다. 이전 저장에는 지난 시즌 기록이 없다 */
function injuryLine(ctx, p) {
  const s = ctx.session;
  const now = s.injuryOf?.(p.id) ?? null;
  const hist = injuryHistory(s, p.id);
  if (!now && !hist.length && !p.temp) return null;
  const label = (seasonStart) => `${seasonStart}-${String(seasonStart + 1).slice(2)}`;
  return h('div', { class: 'card inj-history' }, h('h3', '부상'),
    now ? h('p', { style: { margin: '0 0 6px' } }, injuryTag(now, { full: true }), ' ', h('span', { class: 'note' }, `진단 ${now.kind === 'season' ? '시즌 아웃' : `${now.total}경기`}${now.temp ? ' · 일시교체 선수가 대신 뜁니다' : ''}`)) : null,
    p.temp ? h('p', { style: { margin: '0 0 6px' } }, tempTag(), ' ', h('span', { class: 'note' }, '부상 선수를 대신해 뛰는 일시교체 선수입니다')) : null,
    hist.length ? h('ul', { class: 'inj-hist-list', style: { margin: 0, paddingLeft: '18px' } }, hist.slice(0, 12).map((e) => h('li', `${label(e.season)} ${e.day}일차 · ${e.part} · ${KIND_LABEL[e.kind] ?? '부상'}(${e.games >= 99 ? '시즌 아웃' : `${e.games}경기 결장`})${e.current ? ' · 지금 결장 중' : ''}`))) : null,
    h('p', { class: 'note', style: { margin: '6px 0 0' } }, '게임에서 진행한 시즌의 부상입니다(우리 구단 선수는 전부, 다른 구단 선수는 5경기 이상만 지난 시즌 기록에 남습니다).'));
}

/** 게임에서 받은 수상 이력 한 줄(시즌별). 이전 저장이나 수상이 없으면 그리지 않는다 */
function awardLine(game, p) {
  const hist = playerAwardHistory(game.log, p.id);
  if (!hist.length) return null;
  return h('div', { class: 'card aw-history' }, h('h3', '수상 이력'), h('p', { class: 'aw-hist-line' }, awardHistoryText(hist)),
    h('p', { class: 'note' }, '게임에서 진행한 시즌의 수상입니다(MVP·신인상·베스트5·수비상·기량발전상·부문 1위·챔피언결정전 MVP).'));
}

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}`);
const f1 = (v) => (v == null ? '-' : v.toFixed(1));
// 턴오버·파울이 없는 줄: 값이 없거나(이전 저장의 게임 시즌), 공식 기록이 비어 둘 다 0으로 들어 있는 옛 시즌
const missing = (r) => r.to == null || (r.to === 0 && r.pf === 0 && r.gp > 0);

/**
 * 시즌 기록 한 표: KBL 공식 기록(실제) 줄 바로 아래에 게임에서 진행한 시즌 줄이 같은 열로 이어진다(흐린 줄, "게임" 표지).
 * 통산은 실제 + 게임 합산. 정규시즌/플레이오프 탭도 하나.
 */
function recordCard(ctx, p) {
  const entry = ctx.data.careers[p.kblId];
  const gameRows = gameRecordRows(ctx.game, p.id, ctx.session);
  const host = h('div');
  const tabBar = h('div', { class: 'pad', style: { paddingBottom: '0' } });
  const draw = (kind) => {
    const kinds = kind === 'po' ? ['p', 'f'] : ['r'];
    const real = careerRows(entry, kinds);
    const game = gameRows.filter((r) => kinds.includes(r.type));
    const rows = [...real, ...game];
    if (!rows.length) { host.replaceChildren(h('p', { class: 'muted pad' }, kind === 'po' ? '이 구분의 기록이 없습니다.' : '아직 기록이 없습니다. 시즌을 진행하면 경기 기록이 이 표에 이어서 쌓입니다.')); return; }
    const total = sumRows(rows);
    const list = [...rows, total];
    const cols = [
      { key: 'season', label: '시즌', get: (r) => r.season, render: (r) => (r.season === '통산' ? h('b', '통산') : r.game ? h('span', r.season, ' ', h('span', { class: 'rec-badge' }, r.live ? '게임·진행 중' : '게임')) : r.season) },
      { key: 'team', label: '팀', get: (r) => r.teamId ?? '', render: (r) => (r.teamId ? h('a', { href: `#/history/${r.teamId}` }, ctx.name(r.teamId)) : '') },
      ...(kind === 'po' ? [{ key: 'kind', label: '구분', get: (r) => r.type, render: (r) => (r.season === '통산' ? '' : TYPE_LABEL[r.type]) }] : []),
      { key: 'gp', label: '경기', get: (r) => r.gp, align: 'r' }, { key: 'wl', label: '승-패', get: (r) => r.w, render: (r) => (r.w == null ? '-' : `${r.w}-${r.l}`), align: 'r' },
      { key: 'mpg', label: '출전(분)', get: (r) => r.mpg, render: (r) => f1(r.mpg), align: 'r' }, { key: 'ppg', label: '득점', get: (r) => r.ppg, render: (r) => f1(r.ppg), align: 'r' },
      { key: 'rpg', label: '리바', get: (r) => r.rpg, render: (r) => f1(r.rpg), align: 'r' }, { key: 'apg', label: '어시', get: (r) => r.apg, render: (r) => f1(r.apg), align: 'r' },
      { key: 'spg', label: '스틸', get: (r) => r.spg, render: (r) => f1(r.spg), align: 'r' }, { key: 'bpg', label: '블록', get: (r) => r.bpg, render: (r) => f1(r.bpg), align: 'r' },
      { key: 'topg', label: '턴오버', get: (r) => r.topg, render: (r) => f1(missing(r) ? null : r.topg), align: 'r' }, { key: 'pfpg', label: '파울', get: (r) => r.pfpg, render: (r) => f1(missing(r) ? null : r.pfpg ?? (r.pf != null && r.gp > 0 ? r.pf / r.gp : null)), align: 'r' },
      { key: 'fg', label: 'FG%', get: (r) => r.fgPct, render: (r) => pct(r.fgPct), align: 'r' }, { key: 'tp', label: '3P%', get: (r) => r.tpPct, render: (r) => pct(r.tpPct), align: 'r' }, { key: 'ft', label: 'FT%', get: (r) => r.ftPct, render: (r) => pct(r.ftPct), align: 'r' }
    ].map((c) => ({ ...c, sort: false }));
    const realTotal = real.length && game.length ? sumRows(real) : null;
    host.replaceChildren(h('div',
      h('div', { class: 'rec-scroll' }, table(list, cols, { rowClass: (r) => (r.season === '통산' ? 'total' : r.game ? 'game-row' : '') })),
      realTotal ? h('p', { class: 'note pad', style: { margin: 0 } }, `통산은 실제 + 게임 합산입니다. 실제만 ${realTotal.gp}경기 ${f1(realTotal.ppg)}점 → 게임 포함 ${total.gp}경기 ${f1(total.ppg)}점.`) : null));
  };
  const draw2 = (kind) => { tabBar.replaceChildren(tabs([['reg', '정규시즌'], ['po', '플레이오프']], kind, draw2)); draw(kind); };
  draw2('reg');
  return h('div', { class: 'card flush' }, h('div', { class: 'pad', style: { paddingBottom: '0' } }, h('h3', { style: { margin: 0 } }, '시즌 기록'),
    h('p', { class: 'note' }, entry?.rows.length ? 'KBL 공식 기록(2026-10-23 조회). 흐린 줄은 게임에서 진행한 시즌입니다.' : '게임에서 진행한 시즌 기록입니다.')), tabBar, host);
}
