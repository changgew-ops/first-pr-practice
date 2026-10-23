// 시즌 어워드: 정규리그 MVP·신인상·베스트5·수비상·기량발전상·부문 1위·챔피언결정전 MVP를 시즌 기록으로 정한다. 순수 함수(파일·브라우저 API 없음).
// 항목 이름은 data/history/awards.csv의 KBL 공식 수상 항목을 따르고, 선정 기준은 게임 가정이다(규칙 league-rules.json의 awards 키).
// 같은 입력이면 항상 같은 결과다: 점수가 같으면 OVR → 경기당 득점 → 선수 id 순으로 가른다.
import { playoffSplits } from './player-record.mjs';

export const AWARD_LABELS = {
  mvp: '정규시즌 MVP', rookie: '신인상', best5: '베스트5', defense: '최우수 수비상', improved: '기량발전상',
  pts: '득점상', reb: '리바운드상', ast: '어시스트상', stl: '스틸상', blk: '블록상', finalsMvp: '챔피언결정전 MVP'
};
export const AWARD_ORDER = ['mvp', 'finalsMvp', 'best5', 'rookie', 'defense', 'improved', 'pts', 'reb', 'ast', 'stl', 'blk'];
// 부문 1위: 어워드 키 → [합계 키, 라벨 단위]
const LEADER_KEYS = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks' };
const GROUP = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' };

const perGame = (t, k) => t[k] / Math.max(1, t.games);
/** 경기당 기여도: 득점 + 리바 × 1.2 + 어시 × 1.5 + 스틸 × 2 + 블록 × 2 (가중치는 규칙 awards.valueWeights) */
export const valueOf = (t, weights) => Object.entries(weights).reduce((s, [k, w]) => s + w * perGame(t, k), 0);

// 점수 내림차순, 동률이면 OVR 높은 쪽 → 경기당 득점 높은 쪽 → id 사전순
function rank(list) {
  return [...list].sort((a, b) => b.score - a.score || b.p.ovr - a.p.ovr || perGame(b.t, 'points') - perGame(a.t, 'points') || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
}

/**
 * 시즌 어워드. 반환: { mvp, finalsMvp, best5: [id×5], rookie, defense, improved, pts, reb, ast, stl, blk } (해당자 없으면 null, 후보가 모자라면 best5가 짧을 수 있다)
 *  players: 시즌 끝 선수들(id·position·ovr·ovrWas·age·origin·teamId·stats), totals: Map<선수 id, 시즌 합계(src/stats.mjs 모양)>,
 *  standings: [{ id, wins, losses, pointsAgainst }], playoffs: { series, championId }(없으면 챔피언결정전 MVP 없음), finalName: 마지막 라운드 이름,
 *  rookieIds: 이번 시즌 신인으로 볼 선수 id 집합(null이면 규칙의 첫 시즌 기준: 국내 선수 중 어린 선수), rules: league-rules.json
 */
export function computeAwards({ players, totals, standings, playoffs = null, finalName = '챔피언결정전', rookieIds = null, rules }) {
  const cfg = rules.awards;
  const teamGames = Math.max(1, ...standings.map((s) => s.wins + s.losses));
  const minGames = Math.ceil(teamGames * cfg.minGamesShare);
  const winPct = new Map(standings.map((s) => [s.id, s.wins / Math.max(1, s.wins + s.losses)]));
  const leagueAllowed = standings.reduce((s, r) => s + (r.pointsAgainst ?? 0), 0) / Math.max(1, standings.length * teamGames);
  const allowedPg = new Map(standings.map((s) => [s.id, s.pointsAgainst == null ? leagueAllowed : s.pointsAgainst / Math.max(1, s.wins + s.losses)]));
  const teamFactor = (id, w) => 1 + w * (2 * (winPct.get(id) ?? 0.5) - 1);

  const pool = [];
  for (const p of players) {
    const t = totals.get(p.id);
    if (!t || t.games < minGames || t.minutes / t.games < cfg.minMinutes) continue;
    pool.push({ p, t });
  }
  const scored = (fn, list = pool) => rank(list.map(({ p, t }) => ({ p, t, score: fn(p, t) })));
  const value = (t) => valueOf(t, cfg.valueWeights);

  const mvpRank = scored((p, t) => value(t) * teamFactor(p.teamId, cfg.teamWeight));
  const out = { mvp: mvpRank[0]?.p.id ?? null };

  // 베스트5: 포지션 칸별 상위, 칸이 모자라면 남은 선수 중 점수 높은 순
  const b5 = scored((p, t) => value(t) * teamFactor(p.teamId, cfg.teamWeight / 2));
  const picked = [];
  for (const [group, n] of Object.entries(cfg.best5)) picked.push(...b5.filter((x) => GROUP[x.p.position] === group).slice(0, n));
  const want = Object.values(cfg.best5).reduce((a, b) => a + b, 0);
  for (const x of b5) { if (picked.length >= want) break; if (!picked.includes(x)) picked.push(x); }
  out.best5 = picked.map((x) => x.p.id);

  // 신인상: 신인 후보 중 경기당 기여도 1위(최소 경기는 일반 시상보다 낮다)
  const rookieMin = Math.ceil(teamGames * cfg.rookie.minGamesShare);
  const isRookie = rookieIds ? (p) => rookieIds.has(p.id) : (p) => p.origin === 'domestic' && p.age <= cfg.rookie.firstSeasonMaxAge;
  const rookies = players.filter(isRookie).map((p) => ({ p, t: totals.get(p.id) })).filter(({ t }) => t && t.games > 0);
  // 후보가 규정 경기에 못 미치면(신인은 출전이 적다) 한 단계 낮춘 기준(rookie.fallbackGames)으로 한 번 더 찾는다
  const qualified = (min, mpg) => rookies.filter(({ t }) => t.games >= min && t.minutes / t.games >= mpg);
  const rookiePool = qualified(rookieMin, cfg.minMinutes / 2);
  out.rookie = scored((p, t) => value(t), rookiePool.length ? rookiePool : qualified(cfg.rookie.fallbackGames, 0))[0]?.p.id ?? null;

  // 최우수 수비상
  const d = cfg.defense;
  out.defense = scored((p, t) => d.steals * perGame(t, 'steals') + d.blocks * perGame(t, 'blocks') + d.rebounds * perGame(t, 'rebounds') + d.defenseStat * p.stats.defense + d.teamDefense * (leagueAllowed - (allowedPg.get(p.teamId) ?? leagueAllowed)))[0]?.p.id ?? null;

  // 기량발전상: 지난 시즌 종료 시점(ovrWas)보다 OVR이 가장 많이 오른 선수
  const imp = scored((p, t) => p.ovr - p.ovrWas + value(t) / 1000, pool.filter(({ p }) => p.ovrWas != null && p.age <= cfg.improved.maxAge && p.ovr - p.ovrWas >= cfg.improved.minGain));
  out.improved = imp[0]?.p.id ?? null;

  // 부문 1위(경기당 평균, 규정 경기 이상)
  for (const [key, field] of Object.entries(LEADER_KEYS)) out[key] = scored((p, t) => perGame(t, field))[0]?.p.id ?? null;

  // 챔피언결정전 MVP: 우승 구단 선수 중 챔피언결정전(없으면 플레이오프 전체) 경기당 기여도 1위
  out.finalsMvp = null;
  if (playoffs?.championId && playoffs.series?.length) {
    const sp = playoffSplits(playoffs.series, finalName);
    const src = sp.f.size ? sp.f : sp.p;
    const byId = new Map(players.map((p) => [p.id, p]));
    const cand = [];
    for (const [id, byTeam] of src) {
      const t = byTeam.get(playoffs.championId);
      const p = byId.get(id);
      if (t && p && t.games >= cfg.finalsMvp.minGames) cand.push({ p, t });
    }
    out.finalsMvp = scored((p, t) => value(t), cand)[0]?.p.id ?? null;
  }
  return out;
}

/** 어워드가 들어 있는 시즌 결과(entry)에서 화면용 줄: [{ key, label, ids: [선수 id] }] (해당자 없는 항목은 ids가 빈 배열). 어워드가 없는 이전 저장은 null */
export function awardRows(entry) {
  const a = entry?.awards;
  if (!a) return null;
  return AWARD_ORDER.map((key) => ({ key, label: AWARD_LABELS[key], ids: key === 'best5' ? [...(a.best5 ?? [])] : a[key] ? [a[key]] : [] }));
}

/** 한 선수의 수상 이력: 게임 로그에서 [{ season, keys: ['mvp', 'best5', …] }] (시즌순) */
export function playerAwardHistory(log, id) {
  const out = [];
  for (const e of log ?? []) {
    const a = e.awards;
    if (!a) continue;
    const keys = AWARD_ORDER.filter((k) => (k === 'best5' ? a.best5?.includes(id) : a[k] === id));
    if (keys.length) out.push({ season: e.season, keys });
  }
  return out;
}

/** 한 선수의 수상 이력 한 줄 글: "2027-28 MVP·베스트5 / 2028-29 득점상". 없으면 '' */
export const awardHistoryText = (history) => history.map((h) => `${h.season} ${h.keys.map((k) => (k === 'mvp' ? 'MVP' : k === 'finalsMvp' ? '챔프전 MVP' : AWARD_LABELS[k])).join('·')}`).join(' / ');
