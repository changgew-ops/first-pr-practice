import { h, radar, STAT_KEYS, STAT_LABELS, bar, ORIGIN_LABEL, RARITY_LABEL, eok, link, table, stat } from '../lib/dom.js';
import { playerById, careerLines } from '../lib/game.js';

export function render(ctx, [id]) {
  const { game } = ctx;
  const p = playerById(game, id);
  if (!p) return { title: '선수', body: h('div', { class: 'card' }, h('h2', '선수를 찾을 수 없습니다'), h('p', { class: 'muted' }, '은퇴했거나 다른 시즌의 선수일 수 있습니다.'), link('#/roster', '← 로스터')) };
  const prof = ctx.profiles.get(p.name);
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
    prof && h('div', { class: 'card' }, h('h3', '실제 프로필'), h('div', { class: 'grid g4' },
      stat('생년월일', prof.birth), stat('신체', `${prof.heightCm}cm${prof.weightKg ? ` · ${prof.weightKg}kg` : ''}`), stat('학교', prof.school ?? '-'), stat('국적', (prof.nationality ?? []).join(' · '))),
      prof.career && h('p', { class: 'note' }, 'KBL 경력: ', prof.career.map((c) => `${ctx.name(c.team)} ${c.years}`).join(' → ')), h('p', { class: 'note' }, `출처: ${prof.source}`)),
    h('div', { class: 'card flush' }, h('div', { class: 'pad' }, h('h3', { style: { margin: 0 } }, '게임 내 시즌 기록')),
      career.length ? table(career, [
        { key: 'season', label: '시즌', get: (r) => r.season, sort: 'str' }, { key: 'g', label: '경기', get: (r) => r.games, align: 'r' }, { key: 'mpg', label: '출전(분)', get: (r) => r.mpg, render: (r) => r.mpg.toFixed(1), align: 'r' },
        { key: 'ppg', label: '득점', get: (r) => r.ppg, render: (r) => r.ppg.toFixed(1), align: 'r' }, { key: 'rpg', label: '리바운드', get: (r) => r.rpg, render: (r) => r.rpg.toFixed(1), align: 'r' }, { key: 'apg', label: '어시스트', get: (r) => r.apg, render: (r) => r.apg.toFixed(1), align: 'r' },
        { key: 'spg', label: '스틸', get: (r) => r.spg, render: (r) => r.spg.toFixed(1), align: 'r' }, { key: 'bpg', label: '블록', get: (r) => r.bpg, render: (r) => r.bpg.toFixed(1), align: 'r' }
      ], { sort: { key: 'season', dir: -1 } }) : h('p', { class: 'muted pad' }, '아직 진행한 시즌이 없습니다. 시즌을 진행하면 경기 기록이 쌓입니다.')));
  return { title: p.name, body };
}
