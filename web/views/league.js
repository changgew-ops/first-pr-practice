// 리그 화면: 순위 · 플레이오프 · 선수 기록(전체) · 팀 기록(전체) · 수상.
// 기록의 출처는 시즌마다 다르다: 진행 중인 시즌은 게임의 박스스코어 집계, 게임에서 끝난 시즌은 저장된 선수 줄,
// 실제 시즌(1997~2025-26)은 공식 기록(data/history/stats/<시즌>.json, 선택한 시즌만 불러온다).
import { h, table, tabs, link } from '../lib/dom.js';
import { playerLink } from '../lib/player-info.js';
import { fullHistory, liveSeason, logToHistory, playerById } from '../lib/game.js';
import { awardRows } from '../../src/awards.mjs';
import { colorOf } from '../lib/team-ui.js';
import { loadSeasonStats } from '../lib/season-stats.js';
import {
  STAT_COLS, COL, LEADER_COLS, LEADER_TITLE, TEAM_COLS, valueOf, formatValue, teamValue, formatTeamValue, aggregateGames, aggregateStats, aggregateLines,
  filterPlayers, sortRecords, leadersOf, columnMax, qualifyGames, hasData, teamOrder
} from '../lib/league-view.js';

export function seriesCard(ctx, s, my) {
  const win = (id) => s.winner === id;
  const row = (id, w) => h('div', { class: `t ${win(id) ? 'win' : 'lose'}` }, h('span', {}, link(`#/history/${id}`, ctx.name(id)), id === my ? ' ★' : ''), h('b', w));
  return h('div', { class: 'series' }, row(s.a, s.winsA), row(s.b, s.winsB));
}

export function bracket(ctx, season, my) {
  const po = season.playoffs;
  if (!po) return h('p', { class: 'muted pad' }, '이 시즌은 플레이오프 기록이 없습니다.');
  return h('div', { class: 'bracket' }, po.rounds.map((r) => h('div', h('h3', `${r.name} (${r.bestOf}전 ${Math.ceil(r.bestOf / 2)}선승)`), r.series.map((s) => seriesCard(ctx, s, my)))));
}

// 화면을 다시 그려도(시즌·탭을 바꿔도) 남는 보기 설정
const ui = { season: null, mode: 'avg', gt: 'r', q: '', team: 'all', qualified: false, shown: 50, sort: { players: { key: 'pts', dir: -1 }, teams: { key: 'wpct', dir: -1 } } };
const PAGE = 50;
const WORSE_IS_HIGHER = new Set(['pa', 'to']); // 팀 기록에서 낮을수록 좋은 열

const dot = (id) => h('i', { class: 'lg-dot', style: { background: colorOf(id) }, 'aria-hidden': 'true' });
const sortArrow = (cfg, key) => (cfg.key === key ? (cfg.dir < 0 ? ' ▾' : ' ▴') : '');

/** 시즌 종류와 기록 출처: 'live' | 'game' | 'real' */
function kindOf(season, entry) {
  if (season.live) return 'live';
  if (season.simulated) return entry?.lines ? 'game' : 'none';
  return 'real';
}

/** 기록 불러오기: Promise<{ players, teams, teamsEstimated }> */
function resolveRecords(ctx, season, entry, kind, gt) {
  if (kind === 'live') return Promise.resolve(aggregateGames(ctx.session.dayResults));
  if (kind === 'game') return Promise.resolve(aggregateLines(entry));
  return loadSeasonStats(season.season).then((d) => aggregateStats(d, gt === 'r' ? ['r'] : ['p', 'f'], gt === 'r' ? season.teams : null));
}

const NOTE = {
  live: '게임이 시즌 진행 중 계산한 기록입니다(정규리그). 시뮬레이션은 공격/수비 리바운드를 만들지 않아 그 열은 표시하지 않습니다. 턴오버·파울은 경기마다 기록만 합니다(득점에는 영향 없음).',
  game: '게임에서 진행한 시즌의 저장된 기록입니다. 구단의 득점·실점·승패는 순위표, 나머지는 선수 기록의 합입니다(시즌 중에 이적한 선수는 시즌 끝 소속에 합산). 이전 버전에서 저장한 시즌은 슈팅 기록이 없어 "-"로 나옵니다.',
  real: 'KBL 공식 기록입니다. 구단 기록은 그 구단 선수 기록의 합이고, 경기 수와 승패는 그 시즌 순위표입니다. 구단 실점·득실은 자료가 없어 표시하지 않습니다.',
  realPo: 'KBL 공식 기록(플레이오프와 챔피언결정전 합산)입니다. 구단의 경기 수와 승패는 선수 기록에서 가장 많이 뛴 선수 기준으로 추정했고, 구단 실점·득실은 자료가 없어 표시하지 않습니다.'
};

// ---------- 선수 기록 ----------
function playersPanel(ctx, rec, season, kind, my, nameFor) {
  const { players, teams } = rec;
  const mode = () => ui.mode;
  const cols = STAT_COLS.filter((c) => c.key === 'gp' || c.key === 'min' || hasData(players, c.key));
  const ids = new Set((ctx.session?.players ?? []).map((p) => p.id));
  const minGames = Math.max(1, qualifyGames(teams, 0.5));
  const teamIds = [...new Set(players.flatMap((p) => p.teamIds?.length ? p.teamIds : [p.teamId]).filter(Boolean))].sort((a, b) => nameFor(a).localeCompare(nameFor(b), 'ko'));
  const cfg = ui.sort.players;
  if (cfg.key !== 'name' && cfg.key !== 'team' && !cols.some((c) => c.key === cfg.key)) { cfg.key = 'pts'; cfg.dir = -1; }

  const host = h('div', { class: 'stack' });
  const leadersHost = h('div', { class: 'lg-leaders' });
  const tableHost = h('div', { class: 'lg-tablebox card flush' });
  const countEl = h('span', { class: 'note', 'aria-live': 'polite' });

  const view = () => {
    const rows = filterPlayers(players, { q: ui.q, team: ui.team, minGames: ui.qualified ? minGames : 0 });
    return sortRecords(rows, cfg.key, cfg.dir, { mode: mode(), nameOf: (r) => r.name, teamNameOf: (r) => nameFor(r.teamId) });
  };

  const drawLeaders = () => {
    const pool = players.filter((p) => p.gp > 0);
    leadersHost.replaceChildren(...LEADER_COLS.filter((k) => hasData(players, k)).map((key) => {
      const top = leadersOf(pool, key, 5, { mode: mode(), minGames: mode() === 'avg' ? minGames : 0 });
      const max = top[0]?.value || 1;
      return h('section', { class: 'lg-leader card', 'aria-label': `${LEADER_TITLE[key]} 상위` },
        h('header', {}, h('h3', LEADER_TITLE[key]), h('button', { type: 'button', class: 'lg-more', onclick: () => { cfg.key = key; cfg.dir = -1; ui.shown = PAGE; drawTable(); tableHost.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '전체 ▸')),
        h('ol', top.map(({ rec: p, value }, i) => h('li', { class: `${p.teamIds?.includes(my) || p.teamId === my ? 'me' : ''}` },
          h('span', { class: `lg-rank r${i + 1}` }, i + 1),
          h('span', { class: 'lg-who' }, p.id && ids.has(p.id) ? playerLink(p.id, p.name) : h('span', p.name), h('small', {}, dot(p.teamId), nameFor(p.teamId))),
          h('b', { class: 'lg-val' }, formatValue(value, key, mode())),
          h('span', { class: 'lg-meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(4, (value / max) * 100)}%`, background: colorOf(p.teamId) } }))))));
    }));
    if (!leadersHost.childElementCount) leadersHost.replaceChildren(h('p', { class: 'muted pad' }, '집계할 기록이 아직 없습니다.'));
  };

  const drawTable = () => {
    const rows = view();
    const shown = rows.slice(0, ui.shown);
    const maxOf = Object.fromEntries(cols.filter((c) => c.bar).map((c) => [c.key, columnMax(rows, c.key, mode())]));
    countEl.textContent = `${rows.length}명${ui.qualified ? ` · 경기 ${minGames} 이상` : ''}`;
    const head = h('tr', {},
      h('th', { class: 'lg-c-rank r', scope: 'col' }, '#'),
      h('th', { class: `lg-c-name ${cfg.key === 'name' ? 'sorted' : ''}`, scope: 'col', 'aria-sort': cfg.key === 'name' ? (cfg.dir < 0 ? 'descending' : 'ascending') : 'none' },
        h('button', { type: 'button', onclick: () => { cfg.dir = cfg.key === 'name' ? -cfg.dir : 1; cfg.key = 'name'; drawTable(); } }, `선수${sortArrow(cfg, 'name')}`)),
      h('th', { class: `lg-c-team ${cfg.key === 'team' ? 'sorted' : ''}`, scope: 'col', 'aria-sort': cfg.key === 'team' ? (cfg.dir < 0 ? 'descending' : 'ascending') : 'none' },
        h('button', { type: 'button', onclick: () => { cfg.dir = cfg.key === 'team' ? -cfg.dir : 1; cfg.key = 'team'; drawTable(); } }, `구단${sortArrow(cfg, 'team')}`)),
      cols.map((c) => h('th', { class: `r ${cfg.key === c.key ? 'sorted' : ''}`, scope: 'col', title: c.title, 'aria-sort': cfg.key === c.key ? (cfg.dir < 0 ? 'descending' : 'ascending') : 'none' },
        h('button', { type: 'button', onclick: () => { cfg.dir = cfg.key === c.key ? -cfg.dir : -1; cfg.key = c.key; drawTable(); } }, `${c.label}${sortArrow(cfg, c.key)}`))));
    const sortedByStat = cols.some((c) => c.key === cfg.key) && cfg.dir < 0;
    const body = shown.map((p, i) => {
      const mine = p.teamIds?.includes(my) || p.teamId === my;
      return h('tr', { class: mine ? 'me' : '' },
        h('td', { class: `lg-c-rank r ${sortedByStat && i < 3 ? `m${i + 1}` : ''}` }, i + 1),
        h('td', { class: 'lg-c-name' }, p.id && ids.has(p.id) ? playerLink(p.id, p.name) : h('span', p.name), p.card ? h('em', { class: 'lg-card' }, p.card) : null),
        h('td', { class: 'lg-c-team' }, h('span', { class: 'lg-team' }, dot(p.teamId), nameFor(p.teamId)), (p.teamIds?.length ?? 0) > 1 ? h('em', { class: 'lg-multi', title: p.teamIds.map(nameFor).join(' → ') }, `+${p.teamIds.length - 1}`) : null),
        cols.map((c) => {
          const v = valueOf(p, c.key, mode());
          const w = c.bar && v != null && maxOf[c.key] ? Math.round((v / maxOf[c.key]) * 100) : null;
          return h('td', { class: `r ${cfg.key === c.key ? 'sorted' : ''} ${w != null ? 'lg-bar' : ''}`, style: w != null ? { '--w': `${w}%` } : null }, formatValue(v, c.key, mode()));
        }));
    });
    const more = rows.length > shown.length
      ? h('div', { class: 'lg-more-row' }, h('button', { type: 'button', class: 'btn', onclick: () => { ui.shown += PAGE; drawTable(); } }, `더 보기 (+${Math.min(PAGE, rows.length - shown.length)})`),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { ui.shown = rows.length; drawTable(); } }, `전체 ${rows.length}명 보기`)) : null;
    tableHost.replaceChildren(rows.length
      ? h('div', {}, h('div', { class: 'table-wrap lg-wrap' }, h('table', { class: 'lg-table' }, h('caption', { class: 'sr-only' }, `${season.season} 선수 기록`), h('thead', head), h('tbody', body))), more)
      : h('p', { class: 'muted pad' }, '조건에 맞는 선수가 없습니다.'));
  };

  const redraw = () => { ui.shown = PAGE; drawLeaders(); drawTable(); };
  const seg = (items, value, onPick, label) => h('div', { class: 'lg-seg', role: 'group', 'aria-label': label }, items.map(([k, t]) => h('button', { type: 'button', class: value() === k ? 'on' : '', 'aria-pressed': String(value() === k), onclick: (e) => { onPick(k); e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('on', items[i][0] === k); b.setAttribute('aria-pressed', String(items[i][0] === k)); }); } }, t)));
  const search = h('input', { type: 'search', class: 'lg-search', placeholder: '선수 이름 검색', value: ui.q, 'aria-label': '선수 이름 검색', oninput: (e) => { ui.q = e.target.value; ui.shown = PAGE; drawTable(); } });
  const teamSel = h('select', { class: 'lg-select', 'aria-label': '구단 필터', onchange: (e) => { ui.team = e.target.value; ui.shown = PAGE; drawTable(); } },
    h('option', { value: 'all' }, '전체 구단'), teamIds.map((id) => h('option', { value: id, selected: ui.team === id }, nameFor(id))));
  const qual = h('label', { class: 'lg-check', title: `리그에서 가장 많이 뛴 구단 경기 수의 절반(${minGames}경기) 이상` }, h('input', { type: 'checkbox', checked: ui.qualified, onchange: (e) => { ui.qualified = e.target.checked; ui.shown = PAGE; drawTable(); } }), `규정 출전만 (경기 ${minGames}+)`);
  if (ui.team !== 'all' && !teamIds.includes(ui.team)) ui.team = 'all';
  teamSel.value = ui.team;

  host.append(
    leadersHost,
    h('div', { class: 'lg-controls' },
      seg([['avg', '경기당'], ['total', '합계']], mode, (k) => { ui.mode = k; redraw(); }, '집계 방식'),
      search, teamSel, qual, countEl),
    tableHost);
  drawLeaders(); drawTable();
  return host;
}

// ---------- 팀 기록 ----------
function teamsPanel(ctx, rec, season, kind, my, nameFor) {
  const { teams } = rec;
  const cfg = ui.sort.teams;
  if (cfg.key !== 'name' && !TEAM_COLS.some((c) => c.key === cfg.key)) { cfg.key = 'wpct'; cfg.dir = -1; }
  const noAgainst = teams.every((t) => t.pa == null);
  const cols = TEAM_COLS.filter((c) => (!c.stat || c.key === 'pts' || hasData(teams, c.key)) && !(c.special && noAgainst));
  const host = h('div', { class: 'stack' });
  const boxHost = h('div', { class: 'lg-tablebox card flush' });
  const mode = () => ui.mode;
  const sorted = () => {
    const key = cfg.key;
    return [...teams].sort((a, b) => {
      if (key === 'name') return nameFor(a.id).localeCompare(nameFor(b.id), 'ko') * cfg.dir;
      const x = teamValue(a, key, mode()), y = teamValue(b, key, mode());
      if (x == null && y == null) return teamOrder(a, b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * cfg.dir || teamOrder(a, b);
    });
  };
  const drawTable = () => {
    const rows = sorted();
    const best = {};
    for (const c of cols) {
      const vals = teams.map((t) => teamValue(t, c.key, mode())).filter((v) => v != null);
      if (vals.length && !['gp', 'w', 'l'].includes(c.key)) best[c.key] = WORSE_IS_HIGHER.has(c.key) ? Math.min(...vals) : Math.max(...vals);
    }
    const maxOf = Object.fromEntries(cols.filter((c) => c.bar).map((c) => [c.key, Math.max(0, ...teams.map((t) => teamValue(t, c.key, mode()) ?? 0))]));
    const avg = (key) => {
      const vals = teams.map((t) => teamValue(t, key, mode())).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const head = h('tr', {},
      h('th', { class: 'lg-c-rank r', scope: 'col' }, '#'),
      h('th', { class: `lg-c-name ${cfg.key === 'name' ? 'sorted' : ''}`, scope: 'col', 'aria-sort': cfg.key === 'name' ? (cfg.dir < 0 ? 'descending' : 'ascending') : 'none' },
        h('button', { type: 'button', onclick: () => { cfg.dir = cfg.key === 'name' ? -cfg.dir : 1; cfg.key = 'name'; drawTable(); } }, `구단${sortArrow(cfg, 'name')}`)),
      cols.map((c) => h('th', { class: `r ${cfg.key === c.key ? 'sorted' : ''}`, scope: 'col', title: c.title, 'aria-sort': cfg.key === c.key ? (cfg.dir < 0 ? 'descending' : 'ascending') : 'none' },
        h('button', { type: 'button', onclick: () => { cfg.dir = cfg.key === c.key ? -cfg.dir : (WORSE_IS_HIGHER.has(c.key) ? 1 : -1); cfg.key = c.key; drawTable(); } }, `${c.label}${sortArrow(cfg, c.key)}`))));
    const cell = (t, c) => {
      const v = teamValue(t, c.key, mode());
      const w = c.bar && v != null && maxOf[c.key] ? Math.round((v / maxOf[c.key]) * 100) : null;
      const isBest = v != null && best[c.key] === v;
      return h('td', { class: `r ${cfg.key === c.key ? 'sorted' : ''} ${w != null ? 'lg-bar' : ''} ${isBest ? 'best' : ''} ${c.key === 'diff' && v != null ? (v > 0 ? 'good' : v < 0 ? 'bad' : '') : ''}`, style: w != null ? { '--w': `${w}%` } : null }, ['gp', 'w', 'l', 'wpct'].includes(c.key) ? formatTeamValue(v, c.key, mode()) : formatTeamValue(v, c.key, mode()));
    };
    const body = rows.map((t, i) => h('tr', { class: t.id === my ? 'me' : '' },
      h('td', { class: 'lg-c-rank r' }, i + 1),
      h('td', { class: 'lg-c-name' }, h('span', { class: 'lg-team' }, dot(t.id), link(`#/history/${t.id}`, nameFor(t.id)))),
      cols.map((c) => cell(t, c))));
    const foot = h('tr', { class: 'total' }, h('td', { class: 'lg-c-rank' }), h('td', { class: 'lg-c-name' }, '리그 평균'),
      cols.map((c) => h('td', { class: 'r' }, ['gp', 'w', 'l'].includes(c.key) ? '' : formatTeamValue(avg(c.key), c.key, mode()))));
    boxHost.replaceChildren(h('div', { class: 'table-wrap lg-wrap' }, h('table', { class: 'lg-table' }, h('caption', { class: 'sr-only' }, `${season.season} 구단 기록`), h('thead', head), h('tbody', body), h('tfoot', foot))));
  };
  const seg = h('div', { class: 'lg-seg', role: 'group', 'aria-label': '집계 방식' }, [['avg', '경기당'], ['total', '합계']].map(([k, t]) => h('button', { type: 'button', class: ui.mode === k ? 'on' : '', 'aria-pressed': String(ui.mode === k), onclick: (e) => { ui.mode = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => { const on = i === (k === 'avg' ? 0 : 1); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); drawTable(); } }, t)));
  host.append(h('div', { class: 'lg-controls' }, seg, h('span', { class: 'note' }, '열 이름을 누르면 정렬합니다. 굵은 초록 숫자가 리그 1위입니다.')), boxHost);
  drawTable();
  return host;
}

// ---------- 기록 탭(선수/팀 공통 틀: 불러오기·오류·정규/플레이오프 토글) ----------
function recordsTab(ctx, which, season, entry, my) {
  const kind = kindOf(season, entry);
  const nameFor = (id) => season.teams?.find((t) => t.franchiseId === id)?.displayName ?? (id ? ctx.name(id) : '-');
  const host = h('div', { class: 'stack lg-records' });
  const body = h('div', { class: 'stack' });
  const note = h('p', { class: 'note lg-note' });
  if (kind === 'none') return h('p', { class: 'muted card pad' }, '이 시즌은 저장된 선수 기록이 없습니다(이전 버전에서 저장한 시즌).');
  const gt = kind === 'real' ? ui.gt : 'r';
  const load = (g) => {
    body.replaceChildren(h('p', { class: 'muted card pad' }, '기록을 불러오는 중…'));
    resolveRecords(ctx, season, entry, kind, g).then((rec) => {
      if (!body.isConnected && !host.isConnected) { /* 화면이 바뀌었으면 그려도 무해하다 */ }
      if (!rec.players.length) { body.replaceChildren(h('p', { class: 'muted card pad' }, kind === 'live' ? '아직 치른 경기가 없습니다.' : '이 구분의 기록이 없습니다.')); return; }
      note.textContent = kind === 'real' ? (g === 'r' ? NOTE.real : NOTE.realPo) : NOTE[kind];
      body.replaceChildren(which === 'players' ? playersPanel(ctx, rec, season, kind, my, nameFor) : teamsPanel(ctx, rec, season, kind, my, nameFor));
    }).catch((e) => body.replaceChildren(h('div', { class: 'callout' }, `기록을 불러오지 못했습니다: ${e.message}`)));
  };
  if (kind === 'real') {
    host.append(h('div', { class: 'lg-controls' }, h('div', { class: 'lg-seg', role: 'group', 'aria-label': '경기 구분' }, [['r', '정규시즌'], ['p', '플레이오프']].map(([k, t]) => h('button', { type: 'button', class: gt === k ? 'on' : '', 'aria-pressed': String(gt === k), onclick: (e) => { ui.gt = k; ui.shown = PAGE; e.currentTarget.parentElement.querySelectorAll('button').forEach((b, i) => { const on = i === (k === 'r' ? 0 : 1); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); load(k); } }, t)))));
  }
  host.append(body, note);
  load(gt);
  return host;
}

// ---------- 시즌 어워드(게임에서 진행한 시즌) ----------
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** 수상 줄에 붙는 기록: 부문 1위는 그 부문 값, 수비상은 스틸·블록, 나머지는 득점·리바·어시. 기록이 없으면 '' */
function awardStat(entry, key, id) {
  const l = entry.lines?.[id];
  if (!l || !l[0]) return '';
  const pg = (i) => f1(l[i] / l[0]);
  if (key === 'pts') return `${pg(2)}점`; if (key === 'reb') return `${pg(3)}리바`; if (key === 'ast') return `${pg(4)}어시`;
  if (key === 'stl') return `${pg(5)}스틸`; if (key === 'blk') return `${pg(6)}블록`;
  if (key === 'defense') return `스틸 ${pg(5)} · 블록 ${pg(6)}`;
  if (key === 'improved') return '';
  if (key === 'finalsMvp') { const f = (entry.po?.[id] ?? []).find((r) => r[0] === 'f'); return f ? `챔프전 ${f1(f[6] / f[2])}점 ${f1(f[7] / f[2])}리바 ${f1(f[8] / f[2])}어시` : ''; }
  return `${pg(2)}점 ${pg(3)}리바 ${pg(4)}어시`;
}

/** 시즌 어워드 카드: 항목마다 수상자(우리 구단 선수는 강조). entry는 게임에서 끝난 시즌 결과(awards가 있어야 한다) */
export function awardsCard(ctx, entry, my, { title = '시즌 어워드' } = {}) {
  const rows = awardRows(entry);
  if (!rows) return null;
  const who = (key, id) => {
    const teamId = entry.lines?.[id]?.[13] ?? null;
    const name = (entry.playerNames?.[id] ?? id).replace(/^(?:\d{2}|97초)\s+/u, '');
    const stat = awardStat(entry, key, id);
    return h('li', { class: `aw-who ${teamId === my ? 'aw-mine' : ''}` },
      playerById(ctx.game, id) ? playerLink(id, name) : h('span', name),
      teamId ? h('small', { class: 'note' }, ctx.name(teamId)) : null, stat ? h('small', { class: 'aw-stat' }, stat) : null);
  };
  return h('div', { class: 'card aw-card' }, h('h3', title),
    h('div', { class: 'aw-grid' }, rows.map((r) => h('div', { class: `aw-item aw-${r.key}` }, h('span', { class: 'aw-label' }, r.label),
      r.ids.length ? h('ul', { class: 'aw-list' }, r.ids.map((id) => who(r.key, id))) : h('span', { class: 'note' }, '해당자 없음')))),
    h('p', { class: 'note aw-foot' }, '게임 가정: 공식 기자단 투표가 아니라 기록과 팀 성적으로 정합니다(MVP는 개인 기록 × 팀 승률, 신인상은 직전 드래프트 지명자 중 기록 1위 등). 항목 이름은 KBL 공식 수상 항목을 따랐습니다.'));
}

export function render(ctx, [seasonParam, tabParam]) {
  const { game, data } = ctx;
  const my = game.managerId;
  const hist = fullHistory(game, data);
  const live = liveSeason(ctx.session);
  // 정규리그·플레이오프는 끝났고 오프시즌 결정 중인 시즌은 아직 로그에 없으므로 따로 끼워 넣는다
  const ended = ctx.session.stage === 'offseason' ? ctx.session.game.seasonEnd?.entry ?? null : null;
  const seasons = [...(live ? [live] : []), ...(ended ? [logToHistory(ended)] : []), ...[...hist.seasons].reverse()];
  const season = seasons.find((s) => s.season === seasonParam) ?? seasons[0];
  const entry = (ended?.season === season.season ? ended : null) ?? game.log.find((e) => e.season === season.season) ?? null;
  if (ui.season !== season.season) { ui.season = season.season; ui.team = 'all'; ui.q = ''; ui.shown = PAGE; } // 시즌을 바꾸면 검색·구단 필터는 처음으로
  const tabList = [['standings', '순위'], ['playoffs', '플레이오프'], ['players', '선수 기록'], ['teams', '팀 기록'], ...(season.awards || entry?.awards ? [['awards', '수상']] : [])];
  const wanted = tabParam === 'leaders' ? 'players' : tabParam;
  const tab = tabList.some(([k]) => k === wanted) ? wanted : 'standings';
  const top = season.teams[0];
  const nav = (t) => ctx.go(`league/${season.season}/${t}`);
  const nameFor = (id) => season.teams?.find((t) => t.franchiseId === id)?.displayName ?? (id ? ctx.name(id) : '-');

  let content;
  if (tab === 'standings') {
    const rows = season.teams.map((t) => ({ ...t, gb: ((top.wins - t.wins) + (t.losses - top.losses)) / 2 }));
    content = h('div', { class: 'card flush' }, table(rows, [
      { key: 'rank', label: '순위', get: (r) => r.rank, align: 'r' },
      { key: 'team', label: '구단', get: (r) => ctx.name(r.franchiseId), sort: 'str', render: (r) => h('span', { class: 'lg-team' }, dot(r.franchiseId), link(`#/history/${r.franchiseId}`, nameFor(r.franchiseId))) },
      { key: 'w', label: '승', get: (r) => r.wins, align: 'r' }, { key: 'l', label: '패', get: (r) => r.losses, align: 'r' },
      { key: 'pct', label: '승률', get: (r) => r.wins / (r.wins + r.losses), render: (r) => (r.wins / (r.wins + r.losses)).toFixed(3), align: 'r' },
      { key: 'gb', label: '게임차', get: (r) => r.gb, render: (r) => (r.gb === 0 ? '-' : r.gb.toFixed(1)), align: 'r' },
      ...(top.pointsFor != null ? [{ key: 'diff', label: '득실', get: (r) => r.pointsFor - r.pointsAgainst, render: (r) => { const d = r.pointsFor - r.pointsAgainst; return h('span', { class: d > 0 ? 'good' : 'bad' }, `${d > 0 ? '+' : ''}${(d / (r.wins + r.losses)).toFixed(1)}`); }, align: 'r', title: '경기당 득실 마진' }] : []),
      ...(season.teams[0].home ? [{ key: 'home', label: '홈', get: (r) => r.home ?? '', sort: 'str', align: 'r' }, { key: 'away', label: '원정', get: (r) => r.away ?? '', sort: 'str', align: 'r' }] : [])
    ], { sort: { key: 'rank', dir: 1 }, rowClass: (r) => `${r.franchiseId === my ? 'me' : ''} ${r.rank === 6 && season.playoffs ? 'cut' : ''}` }));
  } else if (tab === 'playoffs') {
    const champ = season.championId;
    content = h('div', { class: 'card' }, champ && h('p', {}, h('span', { class: 'tag champ' }, '우승'), ' ', h('b', ctx.name(champ))), bracket(ctx, season, my));
  } else if (tab === 'players' || tab === 'teams') {
    content = recordsTab(ctx, tab, season, entry ?? (season.live ? {} : null), my);
  } else {
    const a = season.awards;
    content = !a ? awardsCard(ctx, entry, my, { title: '시즌 수상' }) : h('div', { class: 'card' }, h('h3', '시즌 수상'), h('ul', { class: 'plain' }, Object.entries(a).map(([k, v]) => h('li', h('span', { class: 'grow note' }, k), h('b', Array.isArray(v) ? v.join(', ') : v)))));
  }

  const body = h('div', { class: 'stack lg' },
    h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, '리그'), h('h1', `${season.season} 시즌`), season.simulated && h('span', { class: 'tag hot' }, season.live ? '진행 중' : '게임에서 진행')),
      h('select', { class: 'lg-select', 'aria-label': '시즌 선택', onchange: (e) => ctx.go(`league/${e.target.value}/${tab}`) }, seasons.map((s) => h('option', { value: s.season, selected: s.season === season.season }, `${s.season}${s.live ? ' (진행 중)' : s.simulated ? ' (게임)' : ''}`)))),
    tabs(tabList, tab, nav),
    content);
  return { title: `리그 ${season.season}`, body };
}
