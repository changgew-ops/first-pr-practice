// 시즌 허브: 정규리그를 하루씩·한 바퀴씩·끝까지 진행하고, 플레이오프를 라운드씩 진행하고, 시즌을 마무리한다.
// 세션 단계(stage)에 따라 regular / playoffs / offseason 화면을 보여 준다. 스타일은 css/season.css (sv- 접두).
import { h, table, stat, link } from '../lib/dom.js';
import { playerLink } from '../lib/player-info.js';
import { teamPower, seasonLabel } from '../lib/game.js';
import { injuryCard } from '../lib/injury-view.js';
import {
  standingsRows, formChips, streak, gameRow, boxTotals, bracketModel, seriesGameRows, seriesScore, advanceChoices, homeOrdinal, attendanceCalc, attendanceText
} from '../lib/season-view.js';

// 화면을 다시 그려도 유지할 보기 상태(보고 있는 경기일, 열어 둔 박스스코어)
const ui = { season: null, lastDay: -1, dayView: null, box: null, poBox: null };

const act = (ctx, fn) => { try { fn(); } catch (e) { console.error(e); ctx.toast(e.message); } ctx.refresh(); };
const pct3 = (v) => v.toFixed(3);
const signed1 = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

export function render(ctx) {
  const s = ctx.session;
  if (ui.season !== s.season || s.day < ui.lastDay) Object.assign(ui, { season: s.season, dayView: null, box: null });
  ui.lastDay = s.day;
  const body = s.stage === 'offseason' ? offseasonCard(ctx) : s.stage === 'playoffs' ? playoffsView(ctx) : regularView(ctx);
  return { title: '시즌', body };
}

// ---------- 공통 ----------
function topbar(ctx, crumb, title, extra) {
  return h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, crumb), h('h1', title)), extra ?? null);
}

function standingsTable(ctx, rows, caption) {
  const my = ctx.session.managerId;
  return h('div', { class: 'card flush sv-standings' },
    h('div', { class: 'pad' }, h('h2', { style: { margin: 0 } }, caption), h('p', { class: 'note', style: { margin: '4px 0 0' } }, '점선 위 6팀이 플레이오프에 진출합니다')),
    table(rows, [
      { key: 'rank', label: '순위', get: (r) => r.rank, align: 'r', sort: false },
      { key: 'team', label: '구단', get: (r) => ctx.name(r.id), render: (r) => link(`#/history/${r.id}`, ctx.name(r.id)), sort: false },
      { key: 'w', label: '승', get: (r) => r.wins, align: 'r', sort: false },
      { key: 'l', label: '패', get: (r) => r.losses, align: 'r', sort: false },
      { key: 'pct', label: '승률', get: (r) => r.pct, render: (r) => pct3(r.pct), align: 'r', sort: false },
      { key: 'gb', label: '게임차', get: (r) => r.gb, render: (r) => (r.gb === 0 ? '-' : r.gb.toFixed(1)), align: 'r', sort: false },
      { key: 'diff', label: '득실', get: (r) => r.diffPerGame, render: (r) => (r.games ? h('span', { class: r.diffPerGame >= 0 ? 'good' : 'bad' }, signed1(r.diffPerGame)) : '-'), align: 'r', sort: false, title: '경기당 득실 마진' }
    ], { rowClass: (r) => `${r.id === my ? 'me' : ''} ${r.cut ? 'cut' : ''}` }));
}

// ---------- 정규리그 ----------
function regularView(ctx) {
  const s = ctx.session, { rules } = ctx.data, my = s.managerId;
  const qualify = rules.playoffs.qualify;
  const rows = standingsRows(s.standings(), qualify);
  const mine = rows.find((r) => r.id === my);
  const myGames = s.myGames();
  const run = streak(myGames);
  const parts = [topbar(ctx, '시즌', `${seasonLabel(s.season)} 정규리그`)];

  parts.push(h('div', { class: 'grid g4' },
    stat('진행', `${s.day} / ${s.totalDays}일차`, s.day === 0 ? '시즌 시작 전' : s.regularDone ? '정규리그 종료' : `${s.totalDays - s.day}일 남음`),
    stat('우리 전적', `${mine.wins}승 ${mine.losses}패`, `승률 ${pct3(mine.pct)}`),
    stat('순위', `${mine.rank}위`, mine.rank <= qualify ? '플레이오프권' : `6위와 ${Math.abs(rows[qualify - 1].wins - mine.wins)}승 차`),
    stat('흐름', run === 0 ? '-' : run > 0 ? `${run}연승` : `${-run}연패`, `경기당 득실 ${signed1(mine.diffPerGame)}`)));

  // 시즌 시작 전 안내 / 다음 경기 / 종료
  if (s.day === 0) {
    parts.push(h('div', { class: 'card sv-prep' },
      h('h2', '시즌 시작 전'),
      h('p', { class: 'muted' }, '선수단 점검을 끝냈다면 시즌을 시작하세요. 시즌이 시작된 뒤에도 라인업과 훈련은 바꿀 수 있습니다.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/lineup' }, '라인업 편성'), h('a', { class: 'btn', href: '#/training' }, '훈련 지정'), h('a', { class: 'btn', href: '#/roster' }, '로스터'))));
  }
  const next = s.nextGame();
  if (next) parts.push(nextGameCard(ctx, next, rows));
  parts.push(actionBar(ctx));
  parts.push(injuryCard(ctx)); // 부상 현황(우리 구단·리그)

  const chips = formChips(myGames, ctx.name, 10);
  if (chips.length) parts.push(h('div', { class: 'card sv-form' }, h('h3', '최근 10경기'), h('div', { class: 'timeline' }, chips.map((c) => h('span', { class: `d ${c.win ? 'w' : 'l'}`, title: c.title }, c.label)))));

  if (s.regularDone) parts.push(finalCard(ctx, rows, qualify));

  parts.push(h('div', { class: 'grid split sv-cols' }, resultsPanel(ctx), standingsTable(ctx, rows, s.regularDone ? '최종 순위' : '현재 순위')));
  return h('div', { class: 'stack sv' }, parts);
}

function nextGameCard(ctx, next, rows) {
  const s = ctx.session;
  const opp = rows.find((r) => r.id === next.oppId), mine = rows.find((r) => r.id === s.managerId);
  const power = (id) => teamPower(ctx.game, ctx.data, id).power;
  const mp = power(s.managerId), op = power(next.oppId);
  return h('div', { class: 'card sv-next' },
    h('div', { class: 'row between' },
      h('div', h('div', { class: 'note' }, `다음 경기 · ${next.day}일차`),
        h('h2', { style: { margin: '2px 0 0' } }, next.home ? '홈' : '원정', ' vs ', link(`#/roster/${next.oppId}`, ctx.name(next.oppId)))),
      h('span', { class: `tag ${next.home ? 'hot' : ''}` }, next.home ? '홈 경기' : '원정 경기')),
    h('div', { class: 'grid g3 sv-next-stats' },
      stat('상대 전적', `${opp.wins}승 ${opp.losses}패`, `${opp.rank}위 · 득실 ${signed1(opp.diffPerGame)}`),
      stat('전력', `${op.toFixed(1)}`, `우리 ${mp.toFixed(1)} (${mp - op >= 0 ? '+' : ''}${(mp - op).toFixed(1)})`),
      stat('우리 순위', `${mine.rank}위`, `${mine.wins}승 ${mine.losses}패`)));
}

function actionBar(ctx) {
  const s = ctx.session;
  const choices = advanceChoices(s.day, s.totalDays);
  const go = (n) => act(ctx, () => { ui.dayView = null; ui.box = null; s.advance(n); });
  if (!choices.length) return h('div', { class: 'card sv-actions' }, h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: () => act(ctx, () => s.startPlayoffs()) }, '플레이오프 시작')));
  return h('div', { class: 'card sv-actions' },
    h('div', { class: 'row' }, choices.map((c, i) => h('button', { class: `btn ${i === 0 ? 'primary big' : ''}`, onclick: () => go(c.days) }, c.days === 1 && s.day === 0 ? '시즌 시작 (1일 진행)' : c.label))),
    h('p', { class: 'note', style: { margin: '8px 0 0' } }, '매일 리그 전체 5경기가 열립니다. 라인업과 훈련은 진행 도중에도 바꿀 수 있습니다.'));
}

function finalCard(ctx, rows, qualify) {
  const my = ctx.session.managerId;
  const qual = rows.slice(0, qualify);
  const inPo = qual.some((r) => r.id === my);
  return h('div', { class: 'card sv-final' },
    h('h2', '정규리그 종료'),
    h('p', { class: inPo ? 'good' : 'muted' }, inPo ? `${qual.findIndex((r) => r.id === my) + 1}위로 플레이오프에 진출했습니다.` : '아쉽게 플레이오프에 진출하지 못했습니다. 플레이오프는 구경만 하게 됩니다.'),
    h('div', { class: 'sv-seeds' }, qual.map((r) => h('span', { class: `chip ${r.id === my ? 'mine' : ''}` }, h('b', r.rank), ' ', ctx.name(r.id)))));
}

// 관중 계산기(읽기 전용): 구단 수입 정산과 같은 모델·키를 쓴다(web/lib/season-view.js)
function attCalc(ctx) {
  const lg = ctx.game.league;
  return attendanceCalc({ teamData: ctx.data.teams, standings: ctx.session.standings(), att: lg.att ?? null, season: lg.season, rules: ctx.data.rules });
}

// 경기일별 결과 + 박스스코어
function resultsPanel(ctx) {
  const s = ctx.session, my = s.managerId;
  const days = s.dayResults;
  const panel = h('div', { class: 'card sv-results' });
  if (!days.length) { panel.append(h('h2', '경기 결과'), h('p', { class: 'muted' }, '아직 치른 경기가 없습니다.')); return panel; }
  const shown = ui.dayView ?? days.at(-1).day;
  const idx = days.findIndex((d) => d.day === shown);
  const dayRes = days[idx] ?? days.at(-1);
  const to = (day) => { ui.dayView = day; ui.box = null; ctx.refresh(); };
  const attOf = attCalc(ctx);
  const gameAtt = (i) => attOf(dayRes.games[i], { key: `r${homeOrdinal(days, dayRes.day, i)}` });
  panel.append(
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, `${dayRes.day}일차 결과`),
      h('div', { class: 'row' },
        h('button', { class: 'btn', disabled: idx <= 0, 'aria-label': '이전 경기일', onclick: () => to(days[idx - 1].day) }, '◀'),
        h('select', { 'aria-label': '경기일 선택', onchange: (e) => to(Number(e.target.value)) }, [...days].reverse().map((d) => h('option', { value: d.day, selected: d.day === dayRes.day }, `${d.day}일차`))),
        h('button', { class: 'btn', disabled: idx >= days.length - 1, 'aria-label': '다음 경기일', onclick: () => to(days[idx + 1].day) }, '▶'))),
    h('p', { class: 'note' }, '경기를 누르면 박스스코어를 봅니다.'),
    h('div', { class: 'sv-games' }, dayRes.games.map((g, i) => {
      const r = gameRow(g, my);
      const open = ui.box && ui.box.day === dayRes.day && ui.box.i === i;
      return h('button', { type: 'button', class: `sv-game ${r.mine ? 'mine' : ''}`, 'aria-pressed': String(Boolean(open)), onclick: () => { ui.box = open ? null : { day: dayRes.day, i }; ctx.refresh(); } },
        h('span', { class: `sv-team ${r.homeWon ? 'won' : ''}` }, ctx.name(r.awayId)),
        h('span', { class: 'sv-score' }, h('b', { class: r.homeWon ? '' : 'won' }, r.awayPts), ' : ', h('b', { class: r.homeWon ? 'won' : '' }, r.homePts), r.ot ? h('small', ` 연장${r.ot > 1 ? r.ot : ''}`) : null),
        h('span', { class: `sv-team right ${r.homeWon ? 'won' : ''}` }, ctx.name(r.homeId), h('small', ' (홈)')),
        h('span', { class: 'sv-att' }, attendanceText(gameAtt(i))));
    })));
  if (ui.box && ui.box.day === dayRes.day) panel.append(boxScore(ctx, dayRes.games[ui.box.i], undefined, gameAtt(ui.box.i)));
  return panel;
}

const BOX_COLS = [['minutes', '분'], ['points', '득점'], ['rebounds', '리바'], ['assists', '어시'], ['steals', '스틸'], ['blocks', '블록'], ['turnovers', 'TO'], ['fouls', 'PF']];
function boxTable(ctx, teamId, pts, lines, won) {
  const tot = { ...boxTotals(lines), turnovers: lines.reduce((s, p) => s + (p.turnovers ?? 0), 0), fouls: lines.reduce((s, p) => s + (p.fouls ?? 0), 0) };
  const row = (p, total) => h('tr', { class: total ? 'total' : '' },
    h('td', total ? h('b', '합계') : p.id ? playerLink(p.id, p.name) : p.name),
    ...BOX_COLS.map(([k]) => h('td', { class: 'r' }, k === 'minutes' ? Math.round(p[k]) : p[k] ?? '-')),
    h('td', { class: 'r' }, `${p.fgm}/${p.fga}`), h('td', { class: 'r' }, `${p.tpm}/${p.tpa}`), h('td', { class: 'r' }, `${p.ftm}/${p.fta}`));
  return h('div', { class: 'sv-box-team' },
    h('h3', ctx.name(teamId), ' ', h('span', { class: won ? 'good' : 'muted' }, pts)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'sv-box' },
      h('thead', h('tr', h('th', '선수'), ...BOX_COLS.map(([, l]) => h('th', { class: 'r' }, l)), h('th', { class: 'r' }, 'FG'), h('th', { class: 'r' }, '3P'), h('th', { class: 'r' }, 'FT'))),
      h('tbody', [...lines].sort((a, b) => b.minutes - a.minutes).map((p) => row(p, false)), row(tot, true)))));
}
function boxScore(ctx, g, close = () => { ui.box = null; ctx.refresh(); }, att = null) {
  return h('div', { class: 'sv-box-wrap' },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, '박스스코어'), h('button', { class: 'btn ghost', onclick: close }, '닫기')),
    att ? h('p', { class: 'note sv-box-att' }, `${ctx.name(g.homeId)} 홈 경기 · ${attendanceText(att)}`) : null,
    boxTable(ctx, g.awayId, g.awayPts, g.box.away, g.winnerId === g.awayId),
    boxTable(ctx, g.homeId, g.homePts, g.box.home, g.winnerId === g.homeId));
}

// ---------- 플레이오프 ----------
function playoffsView(ctx) {
  const s = ctx.session, { rules } = ctx.data, my = s.managerId, po = s.playoffs;
  const status = s.playoffStatus();
  const model = bracketModel(po.seeds, po.series, rules);
  const roundsMeta = rules.playoffs.rounds;
  const parts = [topbar(ctx, '시즌', `${seasonLabel(s.season)} 플레이오프`)];

  const banner = {
    alive: ['hot', '우리 구단이 플레이오프를 치르고 있습니다.'], out: ['', '우리 구단은 탈락했습니다. 남은 시리즈를 지켜보세요.'],
    champion: ['champ', '우리 구단이 우승했습니다!'], notQualified: ['', '우리 구단은 플레이오프에 진출하지 못했습니다.']
  }[status];
  if (s.injuries?.some((i) => i.teamId === s.managerId)) parts.push(injuryCard(ctx, { compact: true }));
  if (banner) parts.push(h('div', { class: 'card sv-status' }, h('span', { class: `tag ${banner[0]}` }, { alive: '진행 중', out: '탈락', champion: '우승', notQualified: '미진출' }[status]), ' ', banner[1]));

  parts.push(h('div', { class: 'card' }, h('h2', '대진표'),
    h('div', { class: 'sv-bracket' }, [0, 1, 2].map((r) => h('div', { class: 'sv-round' },
      h('h3', `${roundsMeta[r].name} (${roundsMeta[r].bestOf}전 ${Math.ceil(roundsMeta[r].bestOf / 2)}선승)`,
        po.round > r ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, '종료') : po.round === r && !po.done ? h('span', { class: 'tag hot', style: { marginLeft: '8px' } }, '다음') : null),
      model.filter((m) => m.round === r).map((m) => seriesCard(ctx, m, po.seeds)))))));

  if (!po.done) {
    parts.push(h('div', { class: 'card sv-actions' }, h('div', { class: 'row' },
      h('button', { class: 'btn primary big', onclick: () => act(ctx, () => s.playoffRound()) }, `${roundsMeta[po.round].name} 진행`),
      h('a', { class: 'btn', href: '#/lineup' }, '라인업 편성'))));
  } else {
    const champ = po.result().championId;
    parts.push(h('div', { class: `card sv-champ ${champ === my ? 'mine' : ''}` },
      h('div', { class: 'note' }, `${seasonLabel(s.season)} 시즌 챔피언`), h('h2', { style: { margin: '4px 0 12px' } }, ctx.name(champ)),
      h('button', { class: 'btn primary big', onclick: () => act(ctx, () => { s.endSeason(); ctx.go('offseason'); }) }, '시즌 마무리 → 오프시즌')));
  }

  const played = model.filter((m) => m.played);
  if (played.length) {
    parts.push(h('div', { class: 'card sv-series-detail' }, h('h2', '경기 결과'),
      ...[2, 1, 0].filter((r) => played.some((m) => m.round === r)).map((r) => h('div', { class: 'stack' },
        h('h3', roundsMeta[r].name),
        h('div', { class: 'grid g2' }, played.filter((m) => m.round === r).map((m) => seriesDetail(ctx, m)))))));
  }
  return h('div', { class: 'stack sv' }, parts);
}

function seriesCard(ctx, m, seeds) {
  const my = ctx.session.managerId;
  const mine = m.a === my || m.b === my;
  const row = (id, label, w) => {
    const won = m.played && m.winnerId === id, lost = m.played && m.winnerId && m.winnerId !== id;
    return h('div', { class: `sv-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id === my ? 'me' : ''}` },
      h('span', { class: 'sv-seed' }, id && seeds.get(id) ? seeds.get(id) : ''),
      h('span', { class: 'sv-name' }, id ? ctx.name(id) : h('i', label)),
      h('b', { class: 'sv-wins' }, m.played ? w : ''));
  };
  const open = () => {
    ui.poBox = `${m.round}:${m.a}:${m.b}:${m.games.length}`; ctx.refresh();
    setTimeout(() => document.getElementById(`po-${m.round}-${m.a}-${m.b}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
  };
  return h('div', m.played && m.games?.length
    ? { class: `sv-series pickable played ${mine ? 'mine' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${ctx.name(m.a)} 대 ${ctx.name(m.b)} 경기 결과 보기`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } }
    : { class: `sv-series ${m.played ? 'played' : ''} ${mine ? 'mine' : ''}` },
    row(m.a, m.aLabel, m.played ? m.wins[m.a] : ''), row(m.b, m.bLabel, m.played ? m.wins[m.b] : ''));
}

function seriesDetail(ctx, m) {
  const my = ctx.session.managerId;
  const mine = m.a === my || m.b === my;
  const rows = seriesGameRows({ games: m.games });
  const key = (n) => `${m.round}:${m.a}:${m.b}:${n}`;
  const openN = ui.poBox && ui.poBox.startsWith(`${m.round}:${m.a}:${m.b}:`) ? Number(ui.poBox.split(':').pop()) : null;
  const toggle = (n) => { ui.poBox = ui.poBox === key(n) ? null : key(n); ctx.refresh(); };
  const openGame = openN != null ? m.games[openN - 1] : null;
  const attOf = attCalc(ctx);
  const poAtt = (g, n) => attOf(g, { key: `p${m.round}:${n - 1}`, round: m.round });
  return h('div', { class: `sv-detail ${mine ? 'mine' : ''} ${openN != null ? 'has-box' : ''}`, id: `po-${m.round}-${m.a}-${m.b}` },
    h('div', { class: 'row between' }, h('b', `${ctx.name(m.a)} ${seriesScore({ wins: m.wins, higherId: m.a, lowerId: m.b })} ${ctx.name(m.b)}`), h('span', { class: 'tag' }, `${ctx.name(m.winnerId)} 승`)),
    h('p', { class: 'note', style: { margin: '4px 0' } }, '경기를 누르면 박스스코어를 봅니다.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'sv-sg' }, h('tbody', rows.map((g) => h('tr', {
      class: `pick ${g.winnerId === my ? 'win' : ''} ${openN === g.n ? 'open' : ''}`, tabindex: 0, role: 'button', 'aria-pressed': String(openN === g.n), 'aria-label': `${g.n}차전 박스스코어`,
      onclick: () => toggle(g.n), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g.n); } }
    },
      h('td', `${g.n}차전`),
      h('td', { class: g.winnerId === g.awayId ? 'won' : '' }, ctx.name(g.awayId)),
      h('td', { class: 'r' }, h('b', `${g.awayPts} : ${g.homePts}`), g.ot ? h('small', ' 연장') : null),
      h('td', { class: `r ${g.winnerId === g.homeId ? 'won' : ''}` }, ctx.name(g.homeId), h('small', ' (홈)')),
      h('td', { class: 'r sv-att' }, attendanceText(poAtt(g, g.n)).replace('관중 ', ''))))))),
    openGame?.box ? boxScore(ctx, openGame, () => { ui.poBox = null; ctx.refresh(); }, poAtt(openGame, openN)) : null);
}

// ---------- 오프시즌 ----------
function offseasonCard(ctx) {
  return h('div', { class: 'stack sv' }, topbar(ctx, '시즌', `${seasonLabel(ctx.session.season)} 시즌 종료`),
    h('div', { class: 'card' }, h('h2', '오프시즌 진행 중'),
      h('p', { class: 'muted' }, '시즌이 끝났습니다. 트레이드 제안, 재계약, FA, 드래프트를 결정해야 다음 시즌이 시작됩니다.'),
      h('button', { class: 'btn primary big', onclick: () => ctx.go('offseason') }, '오프시즌으로')));
}
