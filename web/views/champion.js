// 우승 축하: 우승 직후 한 번 뜨는 창(단체 사진 일러스트 + 짧은 멘트)과 다시 볼 수 있는 화면(#/champion, 연출 미리보기 #/champion/demo).
// 계산은 web/lib/champion.js(순수 함수), 스타일은 css/champion.css(ch- 접두). 저장 형식은 바뀌지 않는다 — 필요한 값은 모두 지금 상태에서 다시 계산한다.
import { h } from '../lib/dom.js';
import { seasonLabel } from '../lib/game.js';
import { logoHref } from '../lib/emblem.js';
import { colorOf } from '../lib/team-ui.js';
import { buildLineup } from '../../src/lineup.mjs';
import { computeAwards } from '../../src/awards.mjs';
import { CHAMPION_NOTE, titleStats, championTexts, championPhotoSvg, photoRoster } from '../lib/champion.js';

const seen = new Set(); // 이번 접속에서 이미 자동으로 띄운 우승(시드:시즌) — 화면을 다시 그려도 한 번만 뜬다
let openDlg = null;

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** 우승한 시즌에서 연출에 필요한 값을 모은다. 우승 상태가 아니면 null. 반환: { key, data(사진), input(멘트) } */
export function championSnapshot(ctx) {
  const s = ctx.session;
  if (!s) return null;
  const my = s.managerId, rules = ctx.data.rules;
  let champId, series, standings, startYear, finalsMvpId = null, players, includesCurrent;
  if (s.stage === 'playoffs' && s.playoffs?.done) {
    const po = s.playoffs;
    champId = po.result().championId; series = po.series; standings = s.standings(); startYear = s.season; players = s.players; includesCurrent = false;
    try {
      finalsMvpId = computeAwards({ players, totals: s.run.totals, standings, playoffs: { series, championId: champId }, finalName: rules.playoffs.rounds.at(-1).name, rules }).finalsMvp;
    } catch { finalsMvpId = null; }
  } else if (s.stage === 'offseason' && s.state.seasonEnd) {
    const e = s.state.seasonEnd.entry;
    champId = e.championId; series = e.series; standings = s.standings(); startYear = e.startYear; players = s.state.seasonEnd.league.players; finalsMvpId = e.awards?.finalsMvp ?? null; includesCurrent = true;
  } else return null;
  if (champId !== my) return null;
  const fin = series.at(-1);
  const row = standings.find((r) => r.id === my);
  const oppId = fin.higherId === my ? fin.lowerId : fin.higherId;
  const roster = players.filter((p) => p.teamId === my);
  const lineup = lineupFor(roster, rules, s, my);
  const mvp = finalsMvpId ? players.find((p) => p.id === finalsMvpId) : null;
  const myWins = fin.wins[my] ?? 0, oppWins = fin.wins[oppId] ?? 0;
  const records = s.state.league.legacy?.[my] ?? [];
  const { titles, streak } = titleStats(records, { includesCurrent });
  const gmTitles = Math.max(0, records.filter((r) => r.stage === '우승' && Number(String(r.season).slice(0, 4)) >= 2026).length - (includesCurrent ? 1 : 0));
  return build(ctx, {
    key: `${s.state.seed}:${startYear}`, teamId: my, season: seasonLabel(startYear), gmName: s.game.gm.name, regRank: row?.rank ?? 1, wins: row?.wins ?? 0, losses: row?.losses ?? 0,
    oppId, myWins, oppWins, games: fin.games.length, bestOf: fin.bestOf ?? rules.playoffs.rounds.at(-1).bestOf, titles, streak, gmTitles, lineup, mvp, mvpLine: mvpLineOf(s, mvp)
  });
}

function lineupFor(roster, rules, s, my) {
  try { const l = s.lineupOf(my); if (l?.starters?.length) return l; } catch { /* 아래 자동 편성 */ }
  try { return buildLineup(roster, rules); } catch { return { starters: [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 5), bench: [...roster].sort((a, b) => b.ovr - a.ovr).slice(5, 12) }; }
}

/** 챔프전 MVP의 시즌 기록 한 줄(합계가 있을 때만) */
function mvpLineOf(s, p) {
  const t = p && s.run?.totals?.get?.(p.id);
  return t?.games ? `${f1(t.points / t.games)}점 ${f1(t.rebounds / t.games)}리바 ${f1(t.assists / t.games)}어시` : null;
}

function build(ctx, v) {
  const oppName = ctx.name(v.oppId), teamName = ctx.name(v.teamId);
  const roster = photoRoster({ starters: v.lineup.starters, bench: v.lineup.bench, finalsMvp: v.mvp });
  const input = {
    teamName, season: v.season, gmName: v.gmName, regRank: v.regRank, wins: v.wins, losses: v.losses, titles: v.titles, streak: v.streak, gmTitles: v.gmTitles,
    opp: oppName, myWins: v.myWins, oppWins: v.oppWins, games: v.games, bestOf: v.bestOf, mvpName: v.mvp?.name ?? null, mvpLine: v.mvpLine
  };
  const data = { teamId: v.teamId, teamName, season: v.season, regRank: v.regRank, wins: v.wins, losses: v.losses, opp: oppName, myWins: v.myWins, oppWins: v.oppWins, mvpName: v.mvp?.name ?? null, roster };
  return { key: v.key, input, data, texts: championTexts(input) };
}

/** 연출 미리보기용: 지금 구단(없으면 첫 구단)의 현재 로스터로 가짜 우승을 만든다 */
function demoSnapshot(ctx) {
  const s = ctx.session, rules = ctx.data.rules;
  const teamId = s?.managerId ?? ctx.data.teams[0].id;
  const oppId = ctx.data.teams.find((t) => t.id !== teamId).id;
  const all = s ? s.players : ctx.data.players;
  const roster = all.filter((p) => p.teamId === teamId);
  const lineup = lineupFor(roster, rules, { lineupOf: () => null }, teamId);
  const mvp = lineup.starters[0] ?? null;
  return build(ctx, { key: 'demo', teamId, season: seasonLabel(s?.season ?? 2026), gmName: s?.game.gm.name ?? '단장', regRank: 3, wins: 33, losses: 21, oppId, myWins: 4, oppWins: 2, games: 6, bestOf: 7, titles: 2, streak: 2, gmTitles: 0, lineup, mvp, mvpLine: null });
}

// ---------- PNG 저장 ----------
async function dataUrl(href) {
  try {
    const blob = await (await fetch(href)).blob();
    return await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  } catch { return null; }
}
/** 단체 사진 SVG → PNG(1920×1080). 로고는 데이터 주소로 바꿔 넣어야 그림에 들어간다 */
export async function savePhoto(snap) {
  const href = logoHref(snap.data.teamId);
  const logo = href ? await dataUrl(href) : null;
  const svg = championPhotoSvg(snap.data, { logoHref: logo });
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 1080;
  c.getContext('2d').drawImage(img, 0, 0, 1920, 1080);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('이미지를 만들지 못했습니다');
  const a = h('a', { href: URL.createObjectURL(blob), download: `champion-${snap.data.season}-${snap.data.teamId}.png` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- 화면 ----------
function photoBox(snap) {
  const box = h('div', { class: 'ch-photo', role: 'img', 'aria-label': `${snap.data.teamName} ${snap.data.season} 시즌 우승 단체 사진(자동 생성 일러스트)` });
  box.innerHTML = championPhotoSvg(snap.data, { logoHref: logoHref(snap.data.teamId) });
  return box;
}

function content(ctx, snap, { onClose = null } = {}) {
  const t = snap.texts;
  const saveBtn = h('button', { class: 'btn', type: 'button' }, '사진 저장 (PNG)');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try { await savePhoto(snap); } catch (e) { console.error(e); ctx.toast('사진을 저장하지 못했습니다'); }
    saveBtn.disabled = false;
  });
  return h('div', { class: 'ch', style: { '--team': colorOf(snap.data.teamId) } },
    h('div', { class: 'ch-conf', 'aria-hidden': 'true' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { '--i': i } }))),
    h('div', { class: 'ch-kicker' }, `${snap.data.season} 시즌 챔피언`),
    h('h2', { class: 'ch-head' }, t.headline),
    h('div', { class: 'ch-chips' }, t.chips.map((c) => h('span', { class: 'tag champ' }, c))),
    photoBox(snap),
    h('div', { class: 'ch-quotes' },
      [t.gm, t.owner, t.fans, t.next].filter(Boolean).map((q, i) => h('p', { class: i === 3 ? 'ch-next' : 'ch-quote' }, q))),
    h('p', { class: 'note ch-note' }, CHAMPION_NOTE),
    h('div', { class: 'ch-actions' }, saveBtn, onClose ? h('button', { class: 'btn primary', type: 'button', onclick: onClose }, '계속') : null));
}

/** 우승 직후 창: 이 우승을 이번 접속에서 처음 보면 띄운다(화면을 다시 그려도 한 번만) */
export function maybeCelebrate(ctx) {
  const snap = championSnapshot(ctx);
  if (!snap || seen.has(snap.key)) return;
  seen.add(snap.key);
  openCelebration(ctx, snap);
}

export function openCelebration(ctx, snap = championSnapshot(ctx)) {
  if (!snap) { ctx.toast('보여 줄 우승이 없습니다'); return; }
  if (openDlg) openDlg.close();
  const dlg = h('dialog', { class: 'ch-dialog', 'aria-label': `${snap.data.teamName} 우승 축하` });
  const close = () => dlg.close();
  dlg.append(content(ctx, snap, { onClose: close }));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (openDlg === dlg) openDlg = null; });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  openDlg = dlg;
}

export function render(ctx, params = []) {
  const demo = params[0] === 'demo';
  if (demo && !ctx.data) return { title: '우승 축하', body: h('div', '데이터를 불러오는 중') };
  const snap = demo ? demoSnapshot(ctx) : championSnapshot(ctx);
  const body = snap
    ? h('div', { class: 'stack' },
      h('div', { class: 'topbar' }, h('div', h('div', { class: 'crumb' }, demo ? '연출 미리보기' : '우승'), h('div', { class: 'title' }, h('h1', '우승 축하'))),
        h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/season' }, '시즌으로'))),
      h('div', { class: 'card ch-page' }, content(ctx, snap)))
    : h('div', { class: 'card' }, h('h2', '우승 축하'), h('p', { class: 'muted' }, '지금 보여 줄 우리 구단의 우승이 없습니다. 우승하면 이곳에서 단체 사진을 다시 볼 수 있습니다.'),
      h('a', { class: 'btn', href: '#/season' }, '시즌으로'));
  return { title: '우승 축하', body };
}
