// 시즌 프리뷰: 시즌 시작 시점의 팀 전력으로 우승·플레이오프 확률, 기자단 예측, 예상 베스트5, 가상 배당을 만든다.
// 순수 함수(파일·브라우저 API 없음)이고 같은 입력이면 같은 결과다. 규칙값은 league-rules.json의 preview(게임용 가정).
// 확률은 가벼운 몬테카를로로 구한다: 정규리그는 두 팀의 전력 차이 → 한 경기 승리 확률(로지스틱) 모형으로 단순화하고, 플레이오프는 같은 모형의 시리즈 승리 확률로 뽑는다.
// 기자·배당은 모두 게임 안의 가상 콘텐츠다(실제 인물·매체·배당과 무관하고, 돈을 걸 수 없다).
import { mulberry32, hashString } from './rng.mjs';
import { OUTLETS } from './news.mjs';

export const DISCLAIMER = '기자단 예측과 배당은 게임이 만든 가상 콘텐츠입니다. 배당은 우승 확률을 보기 쉽게 바꾼 게임 안의 점수일 뿐이며 현금을 걸 수 없습니다.';

// 가상 기자(성·이름 모두 지어낸 조합이고 실제 기자와 무관). bias: 전력·전통·외국인 평가를 얼마나 중시하는가
const REPORTERS = [
  { name: '한서준', bias: { power: 1.0, tradition: 0.2, foreign: 0.2 } },
  { name: '윤태오', bias: { power: 0.5, tradition: 1.0, foreign: 0.1 } },
  { name: '구하람', bias: { power: 0.6, tradition: 0.2, foreign: 0.9 } },
  { name: '남도윤', bias: { power: 1.0, tradition: 0.4, foreign: 0.3 } },
  { name: '백지호', bias: { power: 0.7, tradition: 0.8, foreign: 0.2 } },
  { name: '석민재', bias: { power: 0.8, tradition: 0.1, foreign: 0.7 } },
  { name: '오세린', bias: { power: 0.9, tradition: 0.3, foreign: 0.4 } },
  { name: '차유진', bias: { power: 0.4, tradition: 0.9, foreign: 0.5 } },
  { name: '도건우', bias: { power: 1.0, tradition: 0.1, foreign: 0.5 } },
  { name: '문해린', bias: { power: 0.6, tradition: 0.6, foreign: 0.6 } },
  { name: '피승현', bias: { power: 0.7, tradition: 0.5, foreign: 0.3 } },
  { name: '엄다온', bias: { power: 0.5, tradition: 0.3, foreign: 1.0 } }
];

// 우승 후보로 꼽은 이유(가장 크게 반영한 항목)별 한 줄 코멘트. {team}은 구단 이름, {star}는 그 구단의 간판 선수 이름
const COMMENT_TEMPLATES = {
  power: [
    '{team}의 전력이 한 수 위다. 주전과 벤치 모두 리그 상위권이라 긴 레이스에서 유리하다.',
    '숫자가 말해 준다. 라인업 평균 능력치가 가장 안정적인 팀은 {team}.',
    '{team}의 짜임새가 가장 좋아 보인다. 중심에는 {star}.',
    '약점이 가장 적은 팀을 꼽으라면 {team}이다. 54경기를 버티는 힘이 다르다.',
    '{star}가 이끄는 {team}, 라인업만 놓고 보면 리그에서 가장 완성도가 높다.',
    '냉정하게 전력만 비교했다. {team}이 앞서 있다.'
  ],
  tradition: [
    '우승 DNA는 쉽게 사라지지 않는다. 큰 경기 경험이 많은 팀, {team}을 꼽았다.',
    '전통의 힘을 믿는다. 위기 때 버티는 법을 아는 팀은 {team}.',
    '플레이오프는 경험 싸움이다. 그 점에서 앞서는 팀은 {team}.',
    '{team}의 역사가 말해 준다. 단기전에서는 이름값이 곧 자신감이다.',
    '숫자 밖의 요소, 우승 경험까지 더하면 {team}이 가장 앞선다.',
    '큰 무대에서 흔들리지 않는 팀이라면 {team}. 올해도 그럴 것이다.'
  ],
  foreign: [
    '외국 선수 활약이 변수인데 {team}의 구성이 가장 낫다. 시즌을 끌고 갈 선수는 {star}.',
    '외국 선수 복이 있는 팀, {team}이 한 발 앞선다고 봤다.',
    '외국 선수 두 명의 합이 좋은 팀은 {team}. 우승 후보로 충분하다.',
    '코트를 지배하는 외국 선수를 가진 {team}이 시즌 내내 유리하다.',
    '{team}의 외국 선수 조합은 리그 최고 수준이다. {star}와의 호흡도 좋다.',
    '결국 외국 선수 싸움이다. 그 부분에서 {team}에 점수를 줬다.'
  ],
  depth: [
    '한두 명에 기대지 않는 {team}의 선수층이 시즌 후반에 힘을 낼 것이다.',
    '부상이 변수지만 대체 자원이 탄탄한 팀, {team}이 안전한 선택이다.',
    '뚜렷한 우세 팀이 없어 보인다. 그래서 가장 균형 잡힌 {team}을 골랐다.',
    '올해는 혼전이다. 그래도 한 번쯤 웃을 팀을 꼽는다면 {team}.'
  ]
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 1) => { const m = 10 ** d; return Math.round(v * m) / m; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 한 경기 승리 확률: 전력 차이 diff(OVR 점수) × k의 로지스틱 */
export const gameWinProb = (diff, k) => 1 / (1 + Math.exp(-diff * k));

/** bestOf판 시리즈에서 한 경기 승리 확률 p인 팀이 이길 확률 */
export function seriesWinProb(p, bestOf) {
  const need = (bestOf + 1) / 2, q = 1 - p;
  let sum = 0, c = 1;
  for (let k = 0; k < need; k++) {
    sum += c * p ** need * q ** k;
    c = (c * (need + k)) / (k + 1);
  }
  return sum;
}

/** 확률 → 가상 배당(소수 한 자리): 1 / (확률 × (1 + 마진)), 하한 minOdds·상한 maxOdds(화면에서 "99배↑") */
export function oddsOf(prob, { margin, minOdds, maxOdds = 99 }) {
  if (!(prob > 0)) return maxOdds;
  return round(clamp(1 / (prob * (1 + margin)), minOdds, maxOdds), 1);
}

/**
 * 시즌 몬테카를로. powers: { 구단 id: 전력 }, 반환: { 구단 id: { avgWins, playoffP, topSeedP, finalP, titleP } }
 * 시즌마다 전력에 정규분포 잡음(strengthSd)을 더해 "아직 모르는 변수(부상·영입·훈련)"를 반영한다.
 * 한 팀이 상대마다 같은 수의 경기를 치르고(games ÷ 9, 54경기면 6경기), 순위는 승수 → 무작위 순서로 정한다.
 */
export function simulateOdds(powers, { games, playoffs, cfg, seedKey }) {
  const ids = Object.keys(powers);
  const n = ids.length;
  const rng = mulberry32(hashString(`preview:${seedKey}`));
  const per = Math.max(1, Math.round(games / (n - 1)));
  const qualify = playoffs.qualify;
  const bo = playoffs.rounds.map((r) => r.bestOf);
  const acc = Object.fromEntries(ids.map((id) => [id, { wins: 0, playoff: 0, top: 0, final: 0, title: 0 }]));
  const seriesP = (hi, lo, s, round) => {
    const pg = gameWinProb(s[hi] - s[lo], cfg.gameTemp);
    return seriesWinProb(pg, bo[round]);
  };
  for (let m = 0; m < cfg.mcSeasons; m++) {
    const s = {};
    for (const id of ids) s[id] = powers[id] + gauss(rng) * cfg.strengthSd;
    const w = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = gameWinProb(s[ids[i]] - s[ids[j]], cfg.gameTemp);
        for (let g = 0; g < per; g++) { if (rng() < p) w[ids[i]]++; else w[ids[j]]++; }
      }
    }
    const order = ids.map((id) => ({ id, w: w[id], r: rng() })).sort((a, b) => b.w - a.w || a.r - b.r).map((x) => x.id);
    for (const id of ids) acc[id].wins += w[id];
    acc[order[0]].top++;
    const seeds = order.slice(0, qualify);
    seeds.forEach((id) => acc[id].playoff++);
    // 6강(3-6, 4-5) → 4강(1위 vs 6강 낮은 시드 승자, 2위 vs 높은 시드 승자) → 챔피언결정전. 시드가 높은 쪽이 상대 전력 차 그대로 승리 확률을 갖는다.
    const win = (a, b, round) => (rng() < seriesP(a, b, s, round) ? a : b);
    const q1 = win(seeds[2], seeds[5], 0), q2 = win(seeds[3], seeds[4], 0);
    const f1 = win(seeds[0], q2, 1), f2 = win(seeds[1], q1, 1);
    acc[f1].final++; acc[f2].final++;
    acc[win(f1, f2, 2)].title++;
  }
  const M = cfg.mcSeasons;
  return Object.fromEntries(ids.map((id) => [id, { avgWins: acc[id].wins / M, topSeedP: acc[id].top / M, playoffP: acc[id].playoff / M, finalP: acc[id].final / M, titleP: acc[id].title / M }]));
}

// ---------- 기자단 ----------
function zOf(values) { const m = mean(values), s = sd(values); return (v) => (v - m) / s; }

/**
 * 가상 기자 cfg.reporters명의 예측. 팀 점수 = 전력·전통·외국인 평가의 z점수를 기자의 성향(bias)으로 가중한 합 + 기자별 잡음.
 * rows: [{ id, name, power, prestige, foreignOvr, star }] — 반환: { reporters: [{ name, outlet, titlePick, finalPick, playoffPicks, comment }], votes: { 구단 id: { title, final, playoff } } }
 */
export function reporterPoll(rows, { cfg, seedKey, names }) {
  const zp = zOf(rows.map((r) => r.power)), zt = zOf(rows.map((r) => r.prestige)), zf = zOf(rows.map((r) => r.foreignOvr));
  const nameOf = (id) => names[id] ?? id;
  const votes = Object.fromEntries(rows.map((r) => [r.id, { title: 0, final: 0, playoff: 0 }]));
  const reporters = [];
  const usedLines = new Set();
  for (let i = 0; i < Math.min(cfg.reporters, REPORTERS.length); i++) {
    const rep = REPORTERS[i];
    const rng = mulberry32(hashString(`poll:${seedKey}:${rep.name}`));
    const scored = rows.map((r) => {
      const parts = { power: rep.bias.power * zp(r.power), tradition: rep.bias.tradition * zt(r.prestige), foreign: rep.bias.foreign * zf(r.foreignOvr) };
      return { r, parts, score: parts.power + parts.tradition + parts.foreign + gauss(rng) * cfg.reporterNoise };
    }).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
    const top = scored[0];
    // 고른 이유: 우승 후보로 꼽은 팀에서 가장 크게 반영한 항목. 점수가 모두 낮으면 선수층(depth)
    const best = Object.entries(top.parts).sort((a, b) => b[1] - a[1])[0];
    const reason = best[1] > 0.3 ? best[0] : 'depth';
    const pool = COMMENT_TEMPLATES[reason];
    // 같은 이유의 코멘트가 겹치지 않게, 앞 기자들이 쓰지 않은 문장 중에서 고른다(다 쓰였으면 처음부터 다시)
    let free = pool.map((_, k) => k).filter((k) => !usedLines.has(`${reason}:${k}`));
    if (!free.length) { pool.forEach((_, k) => usedLines.delete(`${reason}:${k}`)); free = pool.map((_, k) => k); }
    const pick = free[Math.floor(rng() * free.length)];
    usedLines.add(`${reason}:${pick}`);
    const line = pool[pick].replaceAll('{team}', nameOf(top.r.id)).replaceAll('{star}', top.r.star ?? '에이스');
    votes[top.r.id].title++;
    scored.slice(0, 2).forEach((x) => votes[x.r.id].final++);
    scored.slice(0, cfg.playoffPicks).forEach((x) => votes[x.r.id].playoff++);
    reporters.push({
      name: `${rep.name} 기자`, outlet: OUTLETS[hashString(`outlet:${rep.name}`) % OUTLETS.length], titlePick: top.r.id, finalPick: scored[1].r.id,
      playoffPicks: scored.slice(0, cfg.playoffPicks).map((x) => x.r.id), reason, comment: line
    });
  }
  return { reporters, votes };
}

// ---------- 예상 베스트 ----------
const POS_GROUP = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' };
export const GROUP_LABEL = { G: '가드', F: '포워드', C: '센터' };
const SLOTS = [['G', 2], ['F', 2], ['C', 1]];

/** 기록이 아니라 능력치 기준 지표: OVR 기준(costWeight가 0이 아니면 코스트 가중). 가드 2·포워드 2·센터 1, 그 외 포지션 표기는 건너뛴다 */
export function expectedBest(players, cfg) {
  const index = (p) => p.ovr + cfg.costWeight * (p.cost ?? 0);
  const sorted = [...players].filter((p) => POS_GROUP[p.position]).sort((a, b) => index(b) - index(a) || b.ovr - a.ovr || a.id.localeCompare(b.id));
  const best = [];
  for (const [g, n] of SLOTS) best.push(...sorted.filter((p) => POS_GROUP[p.position] === g).slice(0, n).map((p) => ({ ...p, group: g, index: round(index(p)) })));
  return best;
}

/** 주목할 선수: 젊고 잠재력이 큰 선수(신인급)와 외국 선수·아시아쿼터 최상위 */
export function spotlight(players, cfg) {
  const young = [...players].filter((p) => p.origin === 'domestic' && p.age <= cfg.rookieAge).sort((a, b) => (b.potential ?? b.ovr) - (a.potential ?? a.ovr) || b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, 2);
  const foreign = [...players].filter((p) => p.origin === 'foreign').sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, 2);
  const asia = [...players].filter((p) => p.origin === 'asia').sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, 1);
  return { rookies: young, foreign, asia };
}

const topN = (players, teamId, n) => players.filter((p) => p.teamId === teamId).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, n);

/**
 * 프리뷰 전체.
 * input: { season(예: '2026-27'), myId, teams: [{ id, name }], players: [{ id, name, baseName, teamId, position, ovr, potential, cost, age, origin }],
 *          powers: { 구단 id: 전력 }, prestige: { 구단 id: 전통 점수 }, games, playoffs: rules.playoffs, rules: rules.preview }
 * 반환: { season, rows(우승 확률 순), reporters, expectedBest, spotlight, keyPlayers, my, disclaimer }
 */
export function buildPreview(input) {
  const { season, myId, teams, powers, prestige = {}, games, playoffs } = input;
  const players = input.players.filter((p) => p.teamId); // 소속이 있는 선수만(FA 풀은 제외)
  const cfg = input.rules;
  const names = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const seedKey = `${season}:${Object.keys(powers).sort().map((id) => `${id}=${round(powers[id], 2)}`).join(',')}`;
  const sim = simulateOdds(powers, { games, playoffs, cfg, seedKey });
  const rankOf = new Map(Object.entries(powers).sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
  const rosterOf = (id) => players.filter((p) => p.teamId === id);
  const rows = teams.map((t) => {
    const foreign = rosterOf(t.id).filter((p) => p.origin === 'foreign').sort((a, b) => b.ovr - a.ovr).slice(0, 2);
    return { id: t.id, power: powers[t.id], prestige: prestige[t.id] ?? 0.5, foreignOvr: foreign.length ? mean(foreign.map((p) => p.ovr)) : 0, star: topN(players, t.id, 1)[0]?.baseName ?? topN(players, t.id, 1)[0]?.name ?? null };
  });
  const poll = reporterPoll(rows, { cfg, seedKey, names });
  const odds = (p) => oddsOf(p, cfg);
  const out = rows.map((r) => {
    const s = sim[r.id];
    return {
      id: r.id, name: names[r.id], power: round(r.power, 2), powerRank: rankOf.get(r.id), avgWins: round(s.avgWins, 1),
      titleP: s.titleP, finalP: s.finalP, playoffP: s.playoffP, topSeedP: s.topSeedP,
      titleOdds: odds(s.titleP), playoffOdds: odds(s.playoffP), topSeedOdds: odds(s.topSeedP),
      votes: poll.votes[r.id]
    };
  }).sort((a, b) => b.titleP - a.titleP || a.powerRank - b.powerRank);
  const keyPlayers = Object.fromEntries(teams.map((t) => [t.id, topN(players, t.id, 3).map((p) => p.id)]));
  const my = out.find((r) => r.id === myId) ?? null;
  const favorite = out[0];
  const myLine = my
    ? `${my.name}의 우승 확률은 ${round(my.titleP * 100, 1)}%(가상 배당 ${my.titleOdds ?? '-'}배), 플레이오프 진출 확률은 ${Math.round(my.playoffP * 100)}%, 예상 승수는 ${my.avgWins}승이다. 우승 후보 1순위는 ${favorite.name}(${round(favorite.titleP * 100, 1)}%).`
    : null;
  return {
    season, myId, rows: out, reporters: poll.reporters, reporterCount: poll.reporters.length,
    expectedBest: expectedBest(players, cfg), spotlight: spotlight(players, cfg), keyPlayers, my, myLine, favoriteId: favorite.id, disclaimer: DISCLAIMER
  };
}

/** 뉴스 기사 변수: 기자단 우승 후보 득표와 가상 배당을 글로 만든다 */
export function previewNewsVars(pv, nameOf = (id) => id) {
  const byVotes = [...pv.rows].filter((r) => r.votes.title > 0).sort((a, b) => b.votes.title - a.votes.title || b.titleP - a.titleP);
  const top = byVotes[0];
  const my = pv.my;
  const quoter = top ? pv.reporters.find((r) => r.titlePick === top.id) : null;
  return {
    pollCount: pv.reporterCount,
    pollText: byVotes.slice(0, 3).map((r) => `${nameOf(r.id)} ${r.votes.title}표`).join(', '),
    pollTop: top ? nameOf(top.id) : '',
    pollTopVotes: top?.votes.title ?? 0,
    ...(quoter ? { quoteName: quoter.name, quoteOutlet: quoter.outlet, quoteText: quoter.comment } : {}),
    oddsFav: nameOf(pv.favoriteId),
    oddsFavValue: pv.rows[0].titleOdds,
    oddsFavPct: round(pv.rows[0].titleP * 100, 1),
    ...(my ? { oddsMy: my.titleOdds, oddsMyPct: round(my.titleP * 100, 1), playoffMyPct: Math.round(my.playoffP * 100), winsMy: my.avgWins, myTitleVotes: my.votes.title } : {})
  };
}
