// 시즌 허브: 정규리그를 하루씩·한 바퀴씩·끝까지 진행하고, 플레이오프를 라운드씩 진행하고, 시즌을 마무리한다.
// 세션 단계(stage)에 따라 regular / playoffs / offseason 화면을 보여 준다. 스타일은 css/season.css (sv- 접두).
import { h, table, stat, link } from '../lib/dom.js';
import { playerLink } from '../lib/player-info.js';
import { seasonLabel } from '../lib/game.js';
import { injuryCard, injuryTag, injuryMap } from '../lib/injury-view.js';
import { conditionCard, condBar, conditionOf } from '../lib/tactics-view.js';
import { tacticList } from '../../src/tactics.mjs';
import {
  standingsRows, formChips, streak, gameRow, boxTotals, bracketModel, seriesGameRows, seriesScore, advanceChoices, homeOrdinal, attendanceCalc, attendanceText
} from '../lib/season-view.js';

// 화면을 다시 그려도 유지할 보기 상태(보고 있는 경기일, 열어 둔 박스스코어)
const ui = { season: null, lastDay: -1, dayView: null, box: null, poBox: null };

const act = (ctx, fn) => { try { fn(); } catch (e) { console.error(e); ctx.toast(e.message); } ctx.refresh(); };
// 여러 날 진행: 중요한 일이 생기면 그 날에서 멈추고 이유를 알린다(세션 lastStop). 이유는 시즌 화면 위의 카드에도 남는다
const goDays = (ctx, n) => act(ctx, () => { ui.dayView = null; ui.box = null; const s = ctx.session; s.advance(n, { stopOnEvents: true }); if (s.lastStop?.length) ctx.toast(`진행을 멈췄습니다 — ${s.lastStop[0].text}`); });
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
  const stopped = alertsCard(ctx);
  if (stopped) parts.push(stopped);
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
  const power = (id) => s.teamPower(id).power; // 다음 경기에 실제로 쓰일 편성(부상·휴식·직접 편성 반영) 기준
  const mp = power(s.managerId), op = power(next.oppId);
  return h('div', { class: 'card sv-next' },
    h('div', { class: 'row between' },
      h('div', h('div', { class: 'note' }, `다음 경기 · ${next.day}일차`),
        h('h2', { style: { margin: '2px 0 0' } }, next.home ? '홈' : '원정', ' vs ', link(`#/roster/${next.oppId}`, ctx.name(next.oppId)))),
      h('span', { class: `tag ${next.home ? 'hot' : ''}` }, next.home ? '홈 경기' : '원정 경기')),
    h('div', { class: 'grid g3 sv-next-stats' },
      stat('상대 전적', `${opp.wins}승 ${opp.losses}패`, `${opp.rank}위 · 득실 ${signed1(opp.diffPerGame)}`),
      stat('전력(출전 편성)', `${op.toFixed(1)}`, `우리 ${mp.toFixed(1)} (${mp - op >= 0 ? '+' : ''}${(mp - op).toFixed(1)}) · 스타팅 70% + 벤치 30%`),
      stat('우리 순위', `${mine.rank}위`, `${mine.wins}승 ${mine.losses}패`)));
}

function actionBar(ctx) {
  const s = ctx.session;
  const choices = advanceChoices(s.day, s.totalDays);
  const go = (n) => goDays(ctx, n);
  if (!choices.length) return h('div', { class: 'card sv-actions' }, h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: () => act(ctx, () => s.startPlayoffs()) }, '플레이오프 시작')));
  return h('div', { class: 'card sv-actions' },
    h('div', { class: 'row' }, choices.map((c, i) => h('button', { class: `btn ${i === 0 ? 'primary big' : ''}`, onclick: () => go(c.days) }, c.days === 1 && s.day === 0 ? '시즌 시작 (1일 진행)' : c.label))),
    h('p', { class: 'note', style: { margin: '8px 0 0' } }, '매일 리그 전체 5경기가 열립니다. 라인업과 훈련은 진행 도중에도 바꿀 수 있습니다.'));
}

// 중요 사건 카드: 방금 진행이 멈춘 이유(lastStop)와 아직 해소되지 않은 사건. 같은 사건은 한 번만 나오고 해소되면 사라진다
const ALERT_LABEL = { injury: '부상', shortage: '인원 부족', waiver: '웨이버', bubble: '플레이오프 경계' };
export function alertsCard(ctx) {
  const s = ctx.session;
  const open = s.openAlerts;
  const stopIds = new Set((s.lastStop ?? []).map((a) => a.id));
  const rows = [...(s.lastStop ?? []).filter((a) => a.resolved), ...open];
  if (!rows.length) return null;
  const link = (a) => a.kind === 'injury' || a.kind === 'shortage' ? h('a', { class: 'btn', href: '#/roster' }, a.replaceable ? '교체·영입 보기' : '로스터 보기') : a.kind === 'bubble' ? h('a', { class: 'btn', href: '#/lineup' }, '라인업 점검') : null;
  return h('div', { class: `card sv-alerts ${stopIds.size ? 'stopped' : ''}`, role: 'status' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, stopIds.size ? '진행을 멈췄습니다' : '확인할 일'),
      h('span', { class: 'note' }, stopIds.size ? '아래 일을 확인하고 계속 진행하세요.' : '해소되면 사라집니다.')),
    h('ul', { class: 'sv-alert-list' }, rows.map((a) => h('li', { class: `sv-alert ${stopIds.has(a.id) ? 'new' : ''}` },
      h('span', { class: `tag ${a.kind === 'injury' || a.kind === 'shortage' ? 'bad' : ''}` }, ALERT_LABEL[a.kind] ?? a.kind), h('span', { class: 'grow' }, ' ', `${a.day}일차 · ${a.text}`), link(a)))));
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
  const model = bracketModel(po.seeds, po.series, rules, po.current);
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
    const mine = s.myPlayoffSeries;
    const last = playoffLastGame(ctx);
    if (last) parts.push(last);
    parts.push(mine ? playoffNextCard(ctx, mine, po) : spectateCard(ctx, po));
  } else {
    const last = playoffLastGame(ctx);
    if (last) parts.push(last);
    const champ = po.result().championId;
    parts.push(h('div', { class: `card sv-champ ${champ === my ? 'mine' : ''}` },
      h('div', { class: 'note' }, `${seasonLabel(s.season)} 시즌 챔피언`), h('h2', { style: { margin: '4px 0 12px' } }, ctx.name(champ)),
      h('button', { class: 'btn primary big', onclick: () => act(ctx, () => { s.endSeason(); ctx.go('offseason'); }) }, '시즌 마무리 → 오프시즌')));
  }

  const played = model.filter((m) => m.played || m.partial);
  if (played.length) {
    parts.push(h('div', { class: 'card sv-series-detail' }, h('h2', '경기 결과'),
      ...[2, 1, 0].filter((r) => played.some((m) => m.round === r)).map((r) => h('div', { class: 'stack' },
        h('h3', roundsMeta[r].name),
        h('div', { class: 'grid g2' }, played.filter((m) => m.round === r).map((m) => seriesDetail(ctx, m)))))));
  }
  return h('div', { class: 'stack sv' }, parts);
}

// ---------- 플레이오프 경기 사이: 상대 확인 · 피로 점검 · 진행 ----------
const nameOfPlayer = (ctx, id) => ctx.session.players.find((p) => p.id === id)?.name ?? id;
const tacticName = (rules, id) => (id ? tacticList(rules).find((t) => t.id === id)?.name ?? id : '균형');

/** 상대 확인 패널: 엔진이 다음 경기에 실제로 쓸 편성(run.lineupOf), 부상 현황, 상대 전술(엔진이 정한 값) */
function opponentPanel(ctx, oppId) {
  const s = ctx.session, rules = ctx.data.rules;
  const lu = s.lineupOf(oppId);
  const hurt = new Map((s.injuries ?? []).filter((i) => i.teamId === oppId).map((i) => [i.playerId, i]));
  const mod = s.teamMods?.[oppId];
  const condOf = conditionOf(s, rules);
  const power = s.teamPower(oppId).power;
  return h('div', { class: 'sv-opp' },
    h('h3', { style: { margin: '0 0 6px' } }, `상대 확인 · ${ctx.name(oppId)}`),
    h('p', { class: 'note', style: { margin: '0 0 6px' } }, `전력(출전 편성) ${power.toFixed(1)} · 전술 ${tacticName(rules, mod?.tactic)}${mod ? ` (적합도 ${mod.fit >= 0 ? '+' : ''}${mod.fit.toFixed(2)})` : ''}${hurt.size ? ` · 결장 ${hurt.size}명` : ''}`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'sv-opp-t' },
      h('thead', h('tr', h('th', '스타팅'), h('th', '포지션'), h('th', { class: 'r' }, 'OVR'), condOf ? h('th', { class: 'r' }, '컨디션') : null)),
      h('tbody', (lu?.starters ?? []).map((p) => h('tr', h('td', playerLink(p.id, p.name), hurt.has(p.id) ? injuryTag(hurt.get(p.id)) : null), h('td', p.position), h('td', { class: 'r' }, p.ovr), condOf ? h('td', { class: 'r' }, condBar(condOf(p.id), { compact: true })) : null))))),
    hurt.size ? h('p', { class: 'note', style: { margin: '6px 0 0' } }, `결장: ${[...hurt.values()].map((i) => `${nameOfPlayer(ctx, i.playerId)}(${i.kind === 'season' ? '시즌 아웃' : `${i.left}경기`})`).join(', ')}`) : null);
}

/** 우리 시리즈의 다음 경기 카드와 진행 버튼 세 가지(한 경기 · 시리즈 끝까지 · 라운드 전체) */
function playoffNextCard(ctx, mine, po) {
  const s = ctx.session, rules = ctx.data.rules, my = s.managerId;
  const n = mine.games.length + 1;
  const pattern = rules.playoffs.homePattern[mine.bestOf];
  const higherHome = pattern[(n - 1) % pattern.length] === 1;
  const homeId = higherHome ? mine.higherId : mine.lowerId;
  const oppId = mine.higherId === my ? mine.lowerId : mine.higherId;
  const myW = mine.wins[my], oppW = mine.wins[oppId];
  const mp = s.teamPower(my).power, op = s.teamPower(oppId).power;
  const mod = s.teamMods?.[my];
  const say = (r) => { const m = r.mine; if (!m) return; const g = m.game, won = g.winnerId === my, myPts = g.homeId === my ? g.homePts : g.awayPts, oppPts = g.homeId === my ? g.awayPts : g.homePts; ctx.toast(`${m.round} ${m.n}차전 ${won ? '승리' : '패배'} ${myPts}:${oppPts}${m.seriesDone ? ` · 시리즈 ${won ? '승리' : '탈락'}` : ''}`); };
  const go = (fn) => act(ctx, () => { ui.poBox = null; const r = fn(); [].concat(r).forEach(say); });
  const champ = mine.round === rules.playoffs.rounds.at(-1).name;
  return h('div', { class: 'card sv-next sv-po-next' },
    h('div', { class: 'row between' },
      h('div', h('div', { class: 'note' }, `다음 경기 · ${mine.round} ${n}차전 (${mine.bestOf}전 ${Math.ceil(mine.bestOf / 2)}선승)`),
        h('h2', { style: { margin: '2px 0 0' } }, homeId === my ? '홈' : '원정', ' vs ', link(`#/roster/${oppId}`, ctx.name(oppId)))),
      h('span', { class: `tag ${homeId === my ? 'hot' : ''}` }, homeId === my ? '홈 경기' : '원정 경기')),
    h('div', { class: 'grid g3 sv-next-stats' },
      stat('시리즈 전적', `${myW} : ${oppW}`, myW === oppW ? '동률' : myW > oppW ? `${myW - oppW}승 앞서 있음` : `${oppW - myW}승 뒤처짐`),
      stat('전력(출전 편성)', op.toFixed(1), `우리 ${mp.toFixed(1)} (${mp - op >= 0 ? '+' : ''}${(mp - op).toFixed(1)}) · 스타팅 70% + 벤치 30%`),
      stat('우리 보정', mod ? `${mod.edge >= 0 ? '+' : ''}${mod.edge.toFixed(2)}점` : '-', mod ? `전술 ${tacticName(rules, mod.tactic)} · 컨디션 ${mod.parts.cond >= 0 ? '+' : ''}${mod.parts.cond.toFixed(2)}` : '보정 없음')),
    h('div', { class: 'row sv-po-actions', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary big', onclick: () => go(() => s.playoffStep()) }, `${n}차전 진행`),
      h('button', { class: 'btn', onclick: () => go(() => s.playoffSeries()) }, '이 시리즈 끝까지'),
      h('button', { class: 'btn', onclick: () => act(ctx, () => { ui.poBox = null; s.playoffRound(); }) }, `${rules.playoffs.rounds[po.round].name} 전체 진행`),
      h('a', { class: 'btn', href: '#/lineup' }, '라인업·전술')),
    h('p', { class: 'note', style: { margin: '8px 0 0' } }, champ ? '결승은 7전 4선승입니다.' : '한 경기씩 진행하면 경기 사이에 편성·전술·휴식을 바꿀 수 있습니다. 시리즈 끝까지·라운드 전체는 바꾸지 않고 연달아 진행합니다.'),
    h('div', { class: 'grid split sv-po-panels', style: { marginTop: '12px' } }, opponentPanel(ctx, oppId), conditionCard(ctx, s.players.filter((p) => p.teamId === my), { onChange: ctx.refresh })));
}

/** 우리 구단이 이 라운드에 없을 때(탈락·미진출): 라운드 전체 진행만 */
function spectateCard(ctx, po) {
  const s = ctx.session, rules = ctx.data.rules;
  return h('div', { class: 'card sv-actions' }, h('div', { class: 'row' },
    h('button', { class: 'btn primary big', onclick: () => act(ctx, () => s.playoffRound()) }, `${rules.playoffs.rounds[po.round].name} 진행`)));
}

/** 우리가 가장 최근에 치른 플레이오프 경기 요약: 점수·박스스코어·그 경기에 실제 적용된 보정(원인이 아니라 적용된 값) */
function playoffLastGame(ctx) {
  const s = ctx.session, my = s.managerId, rules = ctx.data.rules;
  const list = s.myPlayoffGames();
  const last = list.at(-1);
  if (!last) return null;
  const g = last.game, won = g.winnerId === my, home = g.homeId === my;
  const myPts = home ? g.homePts : g.awayPts, oppPts = home ? g.awayPts : g.homePts, oppId = home ? g.awayId : g.homeId;
  const mySide = home ? g.fx?.home : g.fx?.away, oppSide = home ? g.fx?.away : g.fx?.home;
  const key = `last:${last.round}:${last.n}`;
  const open = ui.poBox === key;
  const sgn = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  const fxLine = (side, label) => side ? h('li', h('b', label), ` 전술 ${tacticName(rules, side.tactic)}${side.tactic ? ` (적합도 ${sgn(side.fit)})` : ''} · 팀 보정 ${sgn(side.edge)}점${side.parts ? ` (감독 ${sgn(side.parts.coach)} · 전술 ${sgn(side.parts.tactic)} · 컨디션 ${sgn(side.parts.cond)})` : ''}`,
    side.rested.length ? ` · 휴식 ${side.rested.map((id) => nameOfPlayer(ctx, id)).join(', ')}` : '', side.injured.length ? ` · 결장 ${side.injured.map((id) => nameOfPlayer(ctx, id)).join(', ')}` : '') : null;
  const attInfo = attCalc(ctx)(g, { key: `p${last.roundIndex}:${last.n - 1}`, round: last.round });
  const att = attendanceText(attInfo);
  return h('div', { class: `card sv-po-last ${won ? 'won' : 'lost'}` },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, `직전 경기 · ${last.round} ${last.n}차전`), h('span', { class: `tag ${won ? 'hot' : ''}` }, won ? '승리' : '패배')),
    h('p', { style: { margin: '6px 0' } }, h('b', `${ctx.name(my)} ${myPts} : ${oppPts} ${ctx.name(oppId)}`), g.overtimes ? ` (연장${g.overtimes > 1 ? g.overtimes : ''})` : '', h('span', { class: 'note' }, ` · ${att}`)),
    h('p', { class: 'note', style: { margin: '0 0 4px' } }, '이 경기에 실제로 적용된 보정입니다(경기 계산에 쓰인 값이며, 결과의 원인을 뜻하지는 않습니다).'),
    h('ul', { class: 'sv-fx' }, fxLine(mySide, ctx.name(my)), fxLine(oppSide, ctx.name(oppId))),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'aria-pressed': String(open), onclick: () => { ui.poBox = open ? null : key; ctx.refresh(); } }, open ? '박스스코어 닫기' : '박스스코어 보기')),
    open && g.box ? boxScore(ctx, g, () => { ui.poBox = null; ctx.refresh(); }, attInfo) : null);
}

function seriesCard(ctx, m, seeds) {
  const my = ctx.session.managerId;
  const mine = m.a === my || m.b === my;
  const row = (id, label, w) => {
    const won = m.played && m.winnerId === id, lost = m.played && m.winnerId && m.winnerId !== id;
    const shown = m.played || m.partial;
    return h('div', { class: `sv-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id === my ? 'me' : ''}` },
      h('span', { class: 'sv-seed' }, id && seeds.get(id) ? seeds.get(id) : ''),
      h('span', { class: 'sv-name' }, id ? ctx.name(id) : h('i', label)),
      h('b', { class: 'sv-wins' }, shown ? w : ''));
  };
  const open = () => {
    ui.poBox = `${m.round}:${m.a}:${m.b}:${m.games.length}`; ctx.refresh();
    setTimeout(() => document.getElementById(`po-${m.round}-${m.a}-${m.b}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
  };
  return h('div', (m.played || m.partial) && m.games?.length
    ? { class: `sv-series pickable played ${mine ? 'mine' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${ctx.name(m.a)} 대 ${ctx.name(m.b)} 경기 결과 보기`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } }
    : { class: `sv-series ${m.played ? 'played' : ''} ${m.partial ? 'partial' : ''} ${mine ? 'mine' : ''}` },
    row(m.a, m.aLabel, m.played || m.partial ? m.wins[m.a] : ''), row(m.b, m.bLabel, m.played || m.partial ? m.wins[m.b] : ''));
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
    h('div', { class: 'row between' }, h('b', `${ctx.name(m.a)} ${seriesScore({ wins: m.wins, higherId: m.a, lowerId: m.b })} ${ctx.name(m.b)}`), m.played ? h('span', { class: 'tag' }, `${ctx.name(m.winnerId)} 승`) : h('span', { class: 'tag hot' }, `진행 중 · ${m.bestOf}전 ${Math.ceil(m.bestOf / 2)}선승`)),
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
