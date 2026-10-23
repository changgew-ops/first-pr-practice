import { h, radar, STAT_KEYS, STAT_LABELS, bar, ORIGIN_LABEL, RARITY_LABEL, eok, link, table, stat, tabs } from '../lib/dom.js';
import { playerById, careerLines } from '../lib/game.js';
import { careerRows, careerTotals, TYPE_LABEL } from '../../src/career.mjs';

export function render(ctx, [id]) {
  const { game } = ctx;
  const p = playerById(game, id);
  if (!p) return { title: '선수', body: h('div', { class: 'card' }, h('h2', '선수를 찾을 수 없습니다'), h('p', { class: 'muted' }, '은퇴했거나 다른 시즌의 선수일 수 있습니다.'), link('#/roster', '← 로스터')) };
  const prof = ctx.profiles.get(p.baseName ?? p.name);
  const official = ctx.data.careers[p.kblId]?.profile;
  const career = careerLines(game, p.id);
  const salary = p.origin === 'foreign' ? `$${(p.contract.salaryUsd / 1000).toFixed(0)}k` : eok(p.contract.salaryEok);
  const body = h('div', { class: 'stack' },
    h('div', { class: 'crumb' }, link('#/roster', '로스터'), ' / ', ctx.name(p.teamId)),
    h('div', { class: 'grid g2' },
      h('div', { class: `pcard r-${p.rarity}` },
        h('div', { class: 'num' }, p.number),
        h('div', { class: 'row' }, h('div', { class: 'big-ovr' }, p.ovr), h('div', h('div', { class: 'note' }, RARITY_LABEL[p.rarity]), h('div', { class: 'note' }, `코스트 ${p.cost}`))),
        h('h1', { style: { margin: '10px 0 2px' } }, p.name),
        h('div', { class: 'row' }, h('span', { class: 'pos' }, p.position), h('span', { class: 'note' }, `${p.age}세 · ${ORIGIN_LABEL[p.origin]}${p.nationality ? ` · ${p.nationality}` : ''}`), h('span', { class: 'tag' }, p.real ? '실제 선수' : '가상 선수')),
        h('div', { style: { marginTop: '14px' } }, radar(p.stats))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', '능력치'), h('div', { class: 'stack', style: { '--gap': '6px' } }, STAT_KEYS.map((k) => h('div', { class: 'statline' }, h('span', STAT_LABELS[k]), bar(p.stats[k], 100), h('b', { class: 'r' }, p.stats[k])))),
          h('p', { class: 'note' }, `성장 한도(POT) ${p.potential}${p.age >= 27 ? ' · 27세 이상은 더 오르지 않습니다' : p.potential > p.ovr ? ` · 잠재력 +${p.potential - p.ovr}` : ''}`)),
        h('div', { class: 'card' }, h('h3', '계약'), h('div', { class: 'grid g3' }, stat('연봉', salary), stat('남은 계약', p.contract.yearsLeft <= 0 ? '만료' : `${p.contract.yearsLeft}년`), stat('소속', ctx.name(p.teamId))))),
    ),
    (official || prof) && h('div', { class: 'card' }, h('h3', '실제 프로필'), h('div', { class: 'grid g4' },
      stat('생년월일', official?.birth ?? prof.birth), stat('신체', `${official?.heightCm ?? prof.heightCm}cm${(official?.weightKg ?? prof.weightKg) ? ` · ${official?.weightKg ?? prof.weightKg}kg` : ''}`),
      stat('학교', official?.school ?? prof.school ?? '-'), stat('포지션', official?.position ?? (prof?.position ?? []).join('/') ?? '-')),
      prof?.nationality && h('p', { class: 'note' }, `국적: ${prof.nationality.join(' · ')}`),
      prof?.career && h('p', { class: 'note' }, 'KBL 경력: ', prof.career.map((c) => `${ctx.name(c.team)} ${c.years}`).join(' → ')),
      h('p', { class: 'note' }, `출처: ${official ? 'KBL 공식 프로필(2026-10-23 조회; 신체·등번호는 조회 시점 값)' : prof.source}`)),
    careerCard(ctx, p),
    h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h3', { style: { margin: 0 } }, '게임 내 시즌 기록')),
      career.length ? table(career, [
        { key: 'season', label: '시즌', get: (r) => r.season, sort: 'str' }, { key: 'g', label: '경기', get: (r) => r.games, align: 'r' }, { key: 'mpg', label: '출전(분)', get: (r) => r.mpg, render: (r) => r.mpg.toFixed(1), align: 'r' },
        { key: 'ppg', label: '득점', get: (r) => r.ppg, render: (r) => r.ppg.toFixed(1), align: 'r' }, { key: 'rpg', label: '리바운드', get: (r) => r.rpg, render: (r) => r.rpg.toFixed(1), align: 'r' }, { key: 'apg', label: '어시스트', get: (r) => r.apg, render: (r) => r.apg.toFixed(1), align: 'r' },
        { key: 'spg', label: '스틸', get: (r) => r.spg, render: (r) => r.spg.toFixed(1), align: 'r' }, { key: 'bpg', label: '블록', get: (r) => r.bpg, render: (r) => r.bpg.toFixed(1), align: 'r' }
      ], { sort: { key: 'season', dir: -1 } }) : h('p', { class: 'muted pad' }, '아직 진행한 시즌이 없습니다. 시즌을 진행하면 경기 기록이 쌓입니다.')));
  return { title: p.name, body };
}

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}`);
const f1 = (v) => (v == null ? '-' : v.toFixed(1));

/** KBL 공식 시즌 기록(1997~2026-27, 이 선수가 뛴 시즌). 게임에서 진행한 시즌은 아래 표에 따로 쌓인다 */
function careerCard(ctx, p) {
  const entry = ctx.data.careers[p.kblId];
  if (!entry?.rows.length) return null;
  const host = h('div');
  const draw = (kind) => {
    const rows = careerRows(entry, kind === 'po' ? ['p', 'f'] : ['r']);
    if (!rows.length) { host.replaceChildren(h('p', { class: 'muted pad' }, '이 구분의 기록이 없습니다.')); return; }
    const list = [...rows, careerTotals(rows)];
    const cols = [
      { key: 'season', label: '시즌', get: (r) => r.season, render: (r) => (r.season === '통산' ? h('b', '통산') : r.season) },
      { key: 'team', label: '팀', get: (r) => r.teamId ?? '', render: (r) => (r.teamId ? h('a', { href: `#/history/${r.teamId}` }, ctx.name(r.teamId)) : '') },
      ...(kind === 'po' ? [{ key: 'kind', label: '구분', get: (r) => r.type, render: (r) => (r.season === '통산' ? '' : TYPE_LABEL[r.type]) }] : []),
      { key: 'gp', label: '경기', get: (r) => r.gp, align: 'r' }, { key: 'wl', label: '승-패', get: (r) => r.w, render: (r) => `${r.w}-${r.l}`, align: 'r' },
      { key: 'mpg', label: '출전(분)', get: (r) => r.mpg, render: (r) => f1(r.mpg), align: 'r' }, { key: 'ppg', label: '득점', get: (r) => r.ppg, render: (r) => f1(r.ppg), align: 'r' },
      { key: 'rpg', label: '리바', get: (r) => r.rpg, render: (r) => f1(r.rpg), align: 'r' }, { key: 'apg', label: '어시', get: (r) => r.apg, render: (r) => f1(r.apg), align: 'r' },
      { key: 'spg', label: '스틸', get: (r) => r.spg, render: (r) => f1(r.spg), align: 'r' }, { key: 'bpg', label: '블록', get: (r) => r.bpg, render: (r) => f1(r.bpg), align: 'r' },
      { key: 'fg', label: 'FG%', get: (r) => r.fgPct, render: (r) => pct(r.fgPct), align: 'r' }, { key: 'tp', label: '3P%', get: (r) => r.tpPct, render: (r) => pct(r.tpPct), align: 'r' }, { key: 'ft', label: 'FT%', get: (r) => r.ftPct, render: (r) => pct(r.ftPct), align: 'r' }
    ].map((c) => ({ ...c, sort: false }));
    host.replaceChildren(table(list, cols, { rowClass: (r) => (r.season === '통산' ? 'total' : '') }));
  };
  const tabBar = h('div', { class: 'pad', style: { paddingBottom: '0' } });
  const draw2 = (kind) => { tabBar.replaceChildren(tabs([['reg', '정규시즌'], ['po', '플레이오프']], kind, draw2)); draw(kind); };
  draw2('reg');
  return h('div', { class: 'card flush' }, h('div', { class: 'pad', style: { paddingBottom: '0' } }, h('h3', { style: { margin: 0 } }, 'KBL 공식 시즌 기록 (실제)'), h('p', { class: 'note' }, '1997년 이후 이 선수가 실제로 뛴 시즌. 2026-27은 아직 진행 중인 실제 기록이고, 게임에서 진행한 시즌은 아래 표에 따로 쌓입니다. 같은 시즌 이적은 팀마다 줄이 나뉩니다. 출처: KBL 공식 기록(2026-10-23 조회)')), tabBar, host);
}
