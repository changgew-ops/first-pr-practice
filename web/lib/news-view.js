// 뉴스 화면이 쓰는 계산(브라우저 API 없음). 세션 → 뉴스 생성기 입력 → 기사 목록.
import { buildNews } from '../../src/news.mjs';
import { powerRanking, seasonLabel } from './game.js';
import { Session } from './session.js';

// 오프시즌에는 세션이 지난 시즌의 일별 결과를 버린다. 기사를 계속 보여 주려고 마지막 시즌의 일별 결과를 기억해 둔다.
let dayMemo = { key: null, dayResults: [], totalDays: null };
// 같은 상태에서 화면 몇 곳이 뉴스를 요청해도 한 번만 만든다.
let cache = { key: null, news: null };

/** 세션의 지금 상태에서 뉴스 생성기 입력을 만든다 */
export function newsSource(session, data) {
  const g = session.game;
  const sy = session.season;
  const memoKey = `${g.seed}:${sy}`;
  if (session.stage !== 'offseason') dayMemo = { key: memoKey, dayResults: session.dayResults, totalDays: session.totalDays };
  if (session.stage === 'offseason' && dayMemo.key !== memoKey) {
    // 오프시즌에서 바로 불러온 저장이라 기억해 둔 일별 결과가 없다: 같은 시드로 시즌을 한 번 다시 돌려 얻는다
    const replay = new Session(data, { ...g, stage: 'playoffs', day: g.day, poRounds: 3, seasonEnd: null, decisions: {} });
    dayMemo = { key: memoKey, dayResults: replay.dayResults, totalDays: replay.totalDays };
  }
  const dayResults = session.stage === 'offseason' ? dayMemo.dayResults : session.dayResults;
  const log = [...g.log, ...(g.seasonEnd ? [g.seasonEnd.entry] : [])];
  const names = new Map(session.players.map((p) => [p.id, { name: p.name }]));
  for (const e of log) for (const [id, name] of Object.entries(e.playerNames ?? {})) if (!names.has(id)) names.set(id, { name });
  const changes = session.stage === 'offseason' ? session.offseasonChanges() : null;
  const teams = data.teams.map((t) => t.id);
  const name = new Map(data.teams.map((t) => [t.id, t.name]));
  return {
    seed: g.seed, myTeamId: g.managerId, teams, startYear: sy, season: seasonLabel(sy), games: data.rules.regularSeasonGames,
    capEok: data.rules.salaryCap.domesticEok, teamName: (id) => name.get(id) ?? id, log, names,
    power: session.stage === 'regular' && session.day === 0 ? powerRanking(session.view, data) : null,
    current: {
      stage: session.stage, day: session.day, totalDays: dayMemo.key === memoKey ? dayMemo.totalDays : data.rules.regularSeasonGames, dayResults,
      playoffSeries: session.stage === 'playoffs' ? (session.playoffs?.series ?? []) : [],
      offseason: changes ? { retired: changes.retired, progressed: changes.progressed } : null
    }
  };
}

/** 뉴스 전체: { items(최신순), mood } */
export function getNews(session, data) {
  const g = session.game;
  const key = `${g.seed}:${session.season}:${session.stage}:${session.day}:${session.playoffs?.round ?? 0}:${Object.keys(g.decisions ?? {}).length}:${g.log.length}:${g.actions.length}`;
  if (cache.key === key) return cache.news;
  const news = buildNews(newsSource(session, data));
  cache = { key, news };
  return news;
}

export const TABS = [['all', '전체'], ['my', '우리 팀'], ['league', '리그'], ['move', '이적'], ['community', '커뮤니티']];

/** 탭별 기사: 우리 팀=my, 리그=league, 이적=move(트레이드·FA·재계약·드래프트·은퇴) */
export function filterItems(items, tab) {
  if (tab === 'my') return items.filter((i) => i.scope === 'my' || i.scope === 'move');
  if (tab === 'league') return items.filter((i) => i.scope === 'league');
  if (tab === 'move') return items.filter((i) => i.scope === 'move' || i.tags.some((t) => ['이적', 'FA', '트레이드', '드래프트', '재계약', '은퇴'].includes(t)));
  if (tab === 'community') return items.filter((i) => i.comments.length);
  return items;
}

/** 커뮤니티 탭: 댓글을 최신 기사 순으로 펴 놓은 목록 */
export function communityPosts(items, limit = 60) {
  const out = [];
  for (const it of items) for (const c of it.comments) { out.push({ ...c, article: it }); if (out.length >= limit) return out; }
  return out;
}

export const MOOD_TONE = { 환호: 'good', 기대: 'good', 불안: 'warn', 격앙: 'bad', 체념: 'bad' };
