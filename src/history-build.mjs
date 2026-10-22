// 팀 이력 빌드(순수 함수): 사이트 화면에서 옮긴 시즌별 원본을 검증하고 구단 id 기준으로 정리한다.
// 입출력은 호출하는 쪽(tools/build-history.mjs, 테스트)이 맡는다.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 사이트에 표시된 이름(공백 제거) → 현재 구단 id.
// 이름이 바뀌어도 같은 구단으로 이어지는 계보다. 새 이름이 나오면 여기에 추가한다.
const NAME_TO_FRANCHISE = {
  'seoul-sk': ['청주SK', '서울SK'],
  'seoul-samsung': ['수원삼성', '서울삼성'],
  'busan-kcc': ['대전현대', '전주KCC', '부산KCC'],
  'anyang-jungkwanjang': ['안양SBS', '안양KT&G', '안양한국인삼공사', '안양KGC', '안양정관장'],
  'changwon-lg': ['경남LG', '창원LG'],
  'wonju-db': ['원주나래', '원주삼보', '원주TG', '원주TG삼보', '원주동부', '원주DB'],
  'ulsan-hyundai-mobis': ['부산기아', '울산모비스', '울산현대모비스'],
  'suwon-kt': ['광주나산', '광주골드뱅크', '여수골드뱅크', '여수코리아텐더', '부산KTF', '부산KT', '수원KT'],
  'daegu-kogas': ['인천대우증권', '인천대우', '인천신세기', '인천SK', '인천전자랜드', '대구한국가스공사'],
  'goyang-sono': ['대구동양', '대구오리온스', '고양오리온스', '고양오리온', '고양캐롯', '고양소노']
};
const lookup = new Map();
for (const [id, names] of Object.entries(NAME_TO_FRANCHISE)) for (const n of names) lookup.set(n, id);
const norm = (s) => s.replace(/\s+/g, '');

export function buildHistory(rawDir, teams) {
  const errors = [];
  const warnings = [];
  const franchiseIds = new Set(teams.map((t) => t.id));
  const fail = (season, msg) => errors.push(`[${season}] ${msg}`);
  const warn = (season, msg) => warnings.push(`[${season}] ${msg}`);

  // 시즌 이름 기준 정렬 (파일 이름으로 정렬하면 "1997-98.json"이 "1997.json"보다 앞에 온다)
  const sortKey = (file) => { const s = file.replace(/\.json$/, ''); return s === '1997' ? '1997-00' : s; };
  const files = readdirSync(rawDir).filter((f) => f.endsWith('.json')).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const seasons = [];

  function parseRecord(text) {
    const m = /^(\d+)-(\d+)$/.exec(text ?? '');
    return m ? { wins: Number(m[1]), losses: Number(m[2]) } : null;
  }

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(rawDir, file), 'utf8'));
    const season = raw.season;
    if (`${season}.json` !== file) fail(season, `파일 이름(${file})과 season이 다릅니다`);
    const expectedTeams = season === '1997' ? 8 : 10;
    if (raw.rows.length !== expectedTeams) fail(season, `구단 수 ${raw.rows.length} (기대 ${expectedTeams})`);

    const rows = raw.rows.map(([rank, display, wins, losses, pct, home, away]) => {
      const id = lookup.get(norm(display));
      if (!id) fail(season, `알 수 없는 구단 이름: "${display}" (NAME_TO_FRANCHISE에 추가 필요)`);
      return { rank, franchiseId: id, displayName: display, wins, losses, pct, home, away };
    });

    // 1) 한 시즌에 같은 구단이 두 번 나오면 안 된다
    const ids = rows.map((r) => r.franchiseId);
    if (new Set(ids).size !== ids.length) fail(season, '같은 구단이 두 번 나옵니다');

    // 2) 승패 합계, 승률, 순위 순서
    const sumW = rows.reduce((s, r) => s + r.wins, 0);
    const sumL = rows.reduce((s, r) => s + r.losses, 0);
    if (sumW !== sumL) fail(season, `승 합계 ${sumW} ≠ 패 합계 ${sumL}`);
    const games = rows.map((r) => r.wins + r.losses);
    if (Math.max(...games) - Math.min(...games) > 1) fail(season, `팀별 경기 수 차이가 큽니다 (${Math.min(...games)}~${Math.max(...games)})`);
    rows.forEach((r, i) => {
      const calc = r.wins / (r.wins + r.losses);
      if (Math.abs(calc - r.pct) > 0.0011) fail(season, `${r.displayName} 승률 ${r.pct} ≠ ${calc.toFixed(3)}`);
      if (i > 0 && r.pct > rows[i - 1].pct + 1e-9) fail(season, `${r.displayName}의 승률이 바로 위 순위보다 높습니다`);
      if (i > 0 && r.rank < rows[i - 1].rank) fail(season, `순위가 거꾸로입니다: ${r.displayName}`);
    });

    // 3) 홈·원정 합 (경고만: 사이트 표시값 자체가 어긋나는 시즌이 있다)
    for (const r of rows) {
      const h = parseRecord(r.home);
      const a = parseRecord(r.away);
      if (!h || !a) { warn(season, `${r.displayName} 홈/원정 형식 오류`); continue; }
      if (h.wins + a.wins !== r.wins || h.losses + a.losses !== r.losses) {
        warn(season, `${r.displayName} 홈·원정 합 ${h.wins + a.wins}-${h.losses + a.losses} ≠ ${r.wins}-${r.losses}`);
      }
    }

    // 3.5) 라운드별 순위(누적)와 라운드 MVP: 선택 항목. 마지막 라운드는 시즌 최종 순위와 같아야 한다.
    //      라운드가 경기 수가 아니라 일정(날짜)으로 나뉜 시즌은 팀마다 라운드 경기 수가 다를 수 있다(2023-24).
    let rounds = null;
    if (raw.rounds) {
      const perTeam = Math.max(...games);
      const prevByTeam = new Map();
      rounds = raw.rounds.map((rd, i) => {
        const label = `${i + 1}라운드`;
        const teams = rd.rows.map(([rank, display, g, wins, losses, pct, gamesBehind, rec]) => {
          const id = lookup.get(norm(display));
          if (!id) fail(season, `${label}에 알 수 없는 구단: "${display}"`);
          const roundRec = rec == null || rec === '' ? null : parseRecord(rec);
          if (rec != null && rec !== '' && !roundRec) fail(season, `${label} ${display} 라운드 전적 형식 오류: "${rec}"`);
          return { rank, franchiseId: id, games: g, wins, losses, pct, gamesBehind, roundWins: roundRec?.wins, roundLosses: roundRec?.losses };
        });
        if (new Set(teams.map((t) => t.franchiseId)).size !== teams.length || teams.length !== rows.length) fail(season, `${label} 구단 목록이 순위표와 다릅니다`);
        const leader = teams[0];
        for (const [j, t] of teams.entries()) {
          const who = `${label} ${t.franchiseId}`;
          const prev = prevByTeam.get(t.franchiseId) ?? { wins: 0, losses: 0 };
          if (t.wins + t.losses !== t.games) fail(season, `${who} 승+패 ${t.wins + t.losses} ≠ 경기 수 ${t.games}`);
          if (t.games > perTeam || t.wins < prev.wins || t.losses < prev.losses) fail(season, `${who} 누적 기록이 이전 라운드보다 줄었거나 시즌 경기 수를 넘습니다`);
          if (raw.uniformRounds !== false && t.games !== (perTeam / raw.rounds.length) * (i + 1)) fail(season, `${who} 경기 수 ${t.games} (균등 라운드 기대 ${(perTeam / raw.rounds.length) * (i + 1)})`);
          if (Math.abs(t.wins / t.games - t.pct) > 0.0011) fail(season, `${who} 승률 ${t.pct} ≠ ${(t.wins / t.games).toFixed(3)}`);
          if (j > 0 && t.pct > teams[j - 1].pct + 1e-9) fail(season, `${who} 승률이 바로 위 순위보다 높습니다`);
          const better = teams.filter((o) => o.pct > t.pct + 1e-9).length;
          const tied = teams.filter((o) => Math.abs(o.pct - t.pct) < 1e-9).length;
          // 승률이 같으면 같은 순위로 표시하거나(진행 중), 타이브레이크로 갈린 순위를 준다(최종)
          if (t.rank < better + 1 || t.rank > better + tied) fail(season, `${who} 순위 ${t.rank} (승률 기준 ${better + 1}~${better + tied})`);
          if (j > 0 && t.rank < teams[j - 1].rank) fail(season, `${who} 순위가 거꾸로입니다`);
          const gb = ((leader.wins - t.wins) + (t.losses - leader.losses)) / 2;
          if (Math.abs(gb - t.gamesBehind) > 1e-9) fail(season, `${who} 경기차 ${t.gamesBehind} ≠ ${gb}`);
          const dw = t.wins - prev.wins;
          const dl = t.losses - prev.losses;
          if (t.roundWins == null) { t.roundWins = dw; t.roundLosses = dl; } // 1라운드처럼 라운드 전적 열이 없으면 누적 변화로 채운다
          else if (dw !== t.roundWins || dl !== t.roundLosses) fail(season, `${who} 라운드 전적 ${t.roundWins}-${t.roundLosses} ≠ 누적 변화 ${dw}-${dl}`);
        }
        for (const t of teams) prevByTeam.set(t.franchiseId, { wins: t.wins, losses: t.losses });
        let mvp = null;
        if (rd.mvp) {
          const mvpTeam = lookup.get(norm(rd.mvp[1]));
          if (!mvpTeam) fail(season, `${label} MVP 소속 "${rd.mvp[1]}"을(를) 알 수 없습니다`);
          mvp = { name: rd.mvp[0], franchiseId: mvpTeam };
        }
        return { round: i + 1, teams, mvp };
      });
      const last = rounds.at(-1).teams;
      for (const r of rows) {
        const t = last.find((x) => x.franchiseId === r.franchiseId);
        if (!t || t.wins !== r.wins || t.losses !== r.losses) fail(season, `마지막 라운드 ${r.displayName} ${t?.wins}-${t?.losses}가 시즌 최종 ${r.wins}-${r.losses}와 다릅니다`);
      }
    }

    // 3.6) 팀 간 상대전적(승:패 행렬): 대칭이고 행 합계가 시즌 승패와 같아야 한다
    let headToHead = null;
    if (raw.headToHead) {
      const names = raw.headToHead.teams;
      const ids = names.map((n) => lookup.get(norm(n)));
      if (ids.some((x) => !x) || new Set(ids).size !== ids.length || ids.length !== rows.length) fail(season, '상대전적의 구단 목록이 순위표와 다릅니다');
      const pr = (x) => { const m = /^(\d+):(\d+)$/.exec(x); return m ? [Number(m[1]), Number(m[2])] : null; };
      const wins = names.map(() => names.map(() => null));
      names.forEach((_, i) => names.forEach((__, j) => {
        if (i === j) return;
        const cell = pr(raw.headToHead.matrix[i][j]);
        const back = pr(raw.headToHead.matrix[j][i]);
        if (!cell || !back) { fail(season, `상대전적 ${names[i]}-${names[j]} 형식 오류`); return; }
        if (cell[0] !== back[1] || cell[1] !== back[0]) fail(season, `상대전적이 대칭이 아닙니다: ${names[i]}-${names[j]} ${raw.headToHead.matrix[i][j]} / ${raw.headToHead.matrix[j][i]}`);
        wins[i][j] = cell[0];
      }));
      ids.forEach((id, i) => {
        const r = rows.find((x) => x.franchiseId === id);
        const w = wins[i].reduce((a, v) => a + (v ?? 0), 0);
        const total = names.reduce((a, _, j) => a + (i === j ? 0 : (pr(raw.headToHead.matrix[i][j])?.[0] ?? 0) + (pr(raw.headToHead.matrix[i][j])?.[1] ?? 0)), 0);
        if (r && (w !== r.wins || total - w !== r.losses)) fail(season, `${r.displayName} 상대전적 합 ${w}-${total - w} ≠ 시즌 ${r.wins}-${r.losses}`);
      });
      headToHead = { teams: ids, wins };
    }

    // 4) 플레이오프 정합성
    let playoffs = null;
    if (raw.playoffs) {
      const p = raw.playoffs;
      const idOf = (name) => {
        const id = lookup.get(norm(name));
        if (!id) fail(season, `플레이오프에 알 수 없는 구단: "${name}"`);
        return id;
      };
      const seed = Object.fromEntries(Object.entries(p.seeds).map(([n, s]) => [idOf(n), s]));
      const bySeed = Object.fromEntries(Object.entries(seed).map(([id, s]) => [s, id]));
      const series = (t) => ({ a: idOf(t[0]), winsA: t[1], b: idOf(t[2]), winsB: t[3], winner: t[1] > t[3] ? idOf(t[0]) : idOf(t[2]) });
      const r6 = p.r6.map(series);
      const r4 = p.r4.map(series);
      const fin = series(p.final);
      const needs = (list) => Math.max(...list.flatMap((s) => [s.winsA, s.winsB]));
      for (const [name, list] of [['6강', r6], ['4강', r4], ['결승', [fin]]]) {
        const need = needs(list);
        for (const s of list) {
          if (Math.max(s.winsA, s.winsB) !== need || Math.min(s.winsA, s.winsB) >= need) fail(season, `${name} 시리즈 점수가 이상합니다`);
        }
      }
      // 6강: 3-6, 4-5 / 4강: 1-(4·5 승자), 2-(3·6 승자) / 결승: 4강 승자끼리
      const pair = (s, x, y) => new Set([s.a, s.b]).size === 2 && [s.a, s.b].every((t) => [x, y].includes(t));
      const w36 = r6.find((s) => pair(s, bySeed[3], bySeed[6]));
      const w45 = r6.find((s) => pair(s, bySeed[4], bySeed[5]));
      if (!w36 || !w45) fail(season, '6강 대진이 3-6위, 4-5위가 아닙니다');
      else {
        const s14 = r4.find((s) => pair(s, bySeed[1], w45.winner));
        const s23 = r4.find((s) => pair(s, bySeed[2], w36.winner));
        if (!s14 || !s23) fail(season, '4강 대진이 6강 결과와 맞지 않습니다');
        else if (!pair(fin, s14.winner, s23.winner)) fail(season, '결승 진출팀이 4강 승자와 맞지 않습니다');
      }
      const top6 = rows.slice(0, 6).map((r) => r.franchiseId);
      if (!top6.every((id) => id in seed)) fail(season, '시드가 정규리그 상위 6팀과 다릅니다');
      for (const r of rows.slice(0, 6)) if (seed[r.franchiseId] !== r.rank) fail(season, `${r.displayName} 시드(${seed[r.franchiseId]})와 순위(${r.rank})가 다릅니다`);
      const bestOf = (list) => needs(list) * 2 - 1;
      playoffs = {
        seeds: seed,
        rounds: [
          { name: '6강', bestOf: bestOf(r6), series: r6 },
          { name: '4강', bestOf: bestOf(r4), series: r4 },
          { name: '결승', bestOf: bestOf([fin]), series: [fin] }
        ],
        championId: fin.winner,
        runnerUpId: fin.winner === fin.a ? fin.b : fin.a
      };
    }

    // 우승팀: 플레이오프 화면이 있으면 결승 승자, 없으면 raw의 champion(나무위키 구단별 우승 연도). 우승팀이 없는 시즌은 null
    let championId = playoffs ? playoffs.championId : null;
    if (raw.champion) {
      const c = lookup.get(norm(raw.champion));
      if (!c) fail(season, `champion "${raw.champion}"을(를) 알 수 없습니다`);
      else if (!rows.some((r) => r.franchiseId === c)) fail(season, `champion ${raw.champion}이(가) 순위표에 없습니다`);
      else if (championId && championId !== c) fail(season, `champion(${c})이 플레이오프 결승 승자(${championId})와 다릅니다`);
      else championId = c;
    }

    seasons.push({
      season,
      startYear: Number(season.slice(0, 4)),
      ...(raw.note ? { note: raw.note } : {}),
      gamesPerTeam: Math.max(...games),
      teams: rows,
      championId,
      ...(rounds ? { rounds } : {}),
      ...(headToHead ? { headToHead } : {}),
      ...(raw.awards ? { awards: raw.awards } : {}),
      playoffs
    });
  }

  // 타이틀 스폰서와 대회 명칭 (시즌 범위로 적은 파일을 시즌마다 펼친다). 모든 시즌이 한 번씩 덮여야 한다
  const sponsorFile = join(rawDir, '..', 'title-sponsors.json');
  if (existsSync(sponsorFile)) {
    const all = [...seasons.map((s) => s.season), ...JSON.parse(readFileSync(sponsorFile, 'utf8')).flatMap((r) => [r.from, r.to])];
    const order = [...new Set(all)].sort((a, b) => sortKey(`${a}.json`).localeCompare(sortKey(`${b}.json`)));
    const bySeason = new Map();
    for (const r of JSON.parse(readFileSync(sponsorFile, 'utf8'))) {
      const i = order.indexOf(r.from);
      const j = order.indexOf(r.to);
      if (j < i) { fail(r.from, `타이틀 스폰서 범위가 거꾸로입니다 (${r.from}~${r.to})`); continue; }
      for (const name of order.slice(i, j + 1)) {
        if (bySeason.has(name)) fail(name, '타이틀 스폰서가 두 번 정의됐습니다');
        bySeason.set(name, { sponsor: r.sponsor, name: r.name });
      }
    }
    for (const s of seasons) {
      if (!bySeason.has(s.season)) fail(s.season, '타이틀 스폰서가 없습니다');
      else s.titleSponsor = bySeason.get(s.season);
    }
  }

  // 5) 구단 계보: 모든 현재 구단이 모든 시즌에 한 번씩 나오는지 (1997년은 8개 구단 중 일부)
  const franchises = teams.map((t) => {
    const names = [];
    for (const s of seasons) {
      const row = s.teams.find((r) => r.franchiseId === t.id);
      if (!row) { if (s.season !== '1997') fail(s.season, `${t.name}이(가) 이 시즌 순위표에 없습니다`); continue; }
      const last = names.at(-1);
      if (last && last.name === row.displayName) last.to = s.season;
      else names.push({ name: row.displayName, from: s.season, to: s.season });
    }
    return { id: t.id, name: t.name, city: t.city, names };
  });
  for (const t of teams) {
    if (!franchiseIds.has(t.id)) fail('-', `알 수 없는 구단 id ${t.id}`);
  }
  // 1997년에 없던 구단은 경남LG·청주SK(1997-98 합류)뿐이어야 한다
  const s1997 = seasons.find((s) => s.season === '1997');
  if (s1997) {
    const missing = teams.filter((t) => !s1997.teams.some((r) => r.franchiseId === t.id)).map((t) => t.id).sort();
    if (missing.join() !== ['changwon-lg', 'seoul-sk'].sort().join()) fail('1997', `1997년에 없는 구단이 예상과 다릅니다: ${missing.join(', ')}`);
  }


  return { seasons, franchises, errors, warnings };
}

/**
 * 신인 드래프트 원본(data/history/drafts/<연도>.json)을 검증하고 구단 id 기준으로 정리한다.
 * 지명 순서 규칙: 1라운드 = 추첨 순번, 2라운드 = 1라운드의 역순(원래 구단 기준), 3라운드 = 1라운드와 같음, 4라운드 = 3라운드의 역순.
 * 지명권 트레이드(tradedPicks)는 그 라운드의 지명 구단만 바꾼다. 지명을 포기한 순번은 기록하지 않는다.
 */
export function buildDrafts(draftDir, teams) {
  const errors = [];
  const franchiseIds = new Set(teams.map((t) => t.id));
  const files = readdirSync(draftDir).filter((f) => f.endsWith('.json')).sort();
  const drafts = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(draftDir, file), 'utf8'));
    const y = raw.draftYear;
    const fail = (msg) => errors.push(`[${y} 드래프트] ${msg}`);
    if (`${y}.json` !== file) fail(`파일 이름(${file})과 draftYear가 다릅니다`);
    const id = (name, where) => {
      const f = lookup.get(norm(name));
      if (!f || !franchiseIds.has(f)) fail(`${where}: 알 수 없는 구단 "${name}"`);
      return f;
    };
    // 추첨: 10개 구단, 순번 1~10이 한 번씩, 추첨 공 합계 200
    const lottery = raw.lottery.map(([team, balls, slot]) => ({ franchiseId: id(team, '추첨'), balls, slot }));
    if (lottery.length !== 10 || new Set(lottery.map((l) => l.slot)).size !== 10 || lottery.some((l) => l.slot < 1 || l.slot > 10)) fail('추첨 순번이 1~10을 한 번씩 쓰지 않습니다');
    if (new Set(lottery.map((l) => l.franchiseId)).size !== lottery.length) fail('추첨에 같은 구단이 두 번 나옵니다');
    if (lottery.reduce((s, l) => s + l.balls, 0) !== 200) fail(`추첨 공 합계 ${lottery.reduce((s, l) => s + l.balls, 0)} (기대 200)`);
    const slotTeam = Object.fromEntries(lottery.map((l) => [l.slot, l.franchiseId]));
    const baseOrder = { 1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => slotTeam[n]) };
    baseOrder[2] = [...baseOrder[1]].reverse();
    baseOrder[3] = [...baseOrder[1]];
    baseOrder[4] = [...baseOrder[1]].reverse();
    const traded = (raw.tradedPicks ?? []).map((t) => ({ round: t.round, originalTeam: id(t.originalTeam, '지명권 트레이드'), owner: id(t.owner, '지명권 트레이드'), note: t.note }));
    const owner = (round, pick) => {
      const original = baseOrder[round]?.[pick - 1];
      const t = traded.find((x) => x.round === round && x.originalTeam === original);
      return { original, owner: t ? t.owner : original };
    };
    // 지명권 트레이드는 짝을 이뤄야 한다(양쪽이 서로 바꾸거나, 한 방향 양도)
    for (const t of traded) if (!baseOrder[t.round]) fail(`지명권 트레이드의 라운드 ${t.round}가 이상합니다`);

    const participantsKnown = Array.isArray(raw.participants);
    const participants = (raw.participants ?? []).map(([name, birth, position, height, weight, school, status]) => ({ name, birth: birth.replace(/\./g, '-'), position, height, weight, school, status }));
    const seenPart = new Set();
    for (const p of participants) {
      const k = `${p.name}|${p.school}`;
      if (seenPart.has(k)) fail(`참가자 중복: ${k}`);
      seenPart.add(k);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.birth)) fail(`${p.name} 생년월일 형식 오류: ${p.birth}`);
    }

    const picks = [];
    const seenSlot = new Set();
    const seenPlayer = new Set();
    for (const pk of raw.picks) {
      const where = `${pk.round}라운드 ${pk.pick}순위 ${pk.name}`;
      if (!baseOrder[pk.round] || pk.pick < 1 || pk.pick > 10) { fail(`${where}: 라운드·순번이 이상합니다`); continue; }
      const slotKey = `${pk.round}-${pk.pick}`;
      if (seenSlot.has(slotKey)) fail(`${where}: 같은 순번에 두 명`);
      seenSlot.add(slotKey);
      const exp = owner(pk.round, pk.pick);
      const team = id(pk.team, where);
      if (team !== exp.owner) fail(`${where}: 지명 구단 ${pk.team}이(가) 기대(${exp.owner})와 다릅니다`);
      const orig = pk.originalTeam ? id(pk.originalTeam, where) : team;
      if (orig !== exp.original) fail(`${where}: 원래 구단이 기대(${exp.original})와 다릅니다`);
      if (participantsKnown && !seenPart.has(`${pk.name}|${pk.school}`)) fail(`${where}: 참가자 명단에 없습니다 (${pk.name}, ${pk.school})`);
      if (seenPlayer.has(`${pk.name}|${pk.school}`)) fail(`${where}: 두 번 지명됨`);
      seenPlayer.add(`${pk.name}|${pk.school}`);
      if (!['G', 'F', 'C'].includes(pk.position)) fail(`${where}: 포지션 ${pk.position}`);
      const info = participants.find((p) => p.name === pk.name && p.school === pk.school);
      picks.push({ round: pk.round, pick: pk.pick, franchiseId: team, originalFranchiseId: orig, name: pk.name, school: pk.school, position: pk.position, ...(info ? { birth: info.birth, height: info.height, weight: info.weight } : {}) });
    }
    // 순서대로 정렬돼 있어야 읽기 쉽다
    const order = picks.map((p) => p.round * 100 + p.pick);
    if (order.some((v, i) => i > 0 && v < order[i - 1])) fail('지명 목록이 라운드·순번 순이 아닙니다');
    for (const t of raw.territorialPicks ?? []) id(t.team, `연고지명 ${t.name}`);

    drafts.push({
      draftYear: y, season: raw.season, date: raw.date, venue: raw.venue, ...(raw.note ? { note: raw.note } : {}),
      participantsKnown, lottery, tradedPicks: traded,
      territorialPicks: (raw.territorialPicks ?? []).map((t) => ({ franchiseId: id(t.team, '연고지명'), name: t.name, school: t.school })),
      participants, picks
    });
  }
  return { drafts, errors };
}

// 이벤트 파일의 구단 표기(나무위키는 줄임말을 많이 쓴다)
const SHORT_NAMES = {
  'seoul-sk': ['SK', '서울SK', '서울SK나이츠'], 'seoul-samsung': ['삼성', '서울삼성', '서울삼성썬더스'], 'busan-kcc': ['KCC', '전주KCC', '부산KCC', '부산KCC이지스'],
  'anyang-jungkwanjang': ['정관장', 'KGC', 'KGC인삼공사', '안양KGC인삼공사', '안양정관장', '안양정관장레드부스터스'], 'changwon-lg': ['LG', '창원LG', '창원LG세이커스'],
  'wonju-db': ['DB', '원주DB', '원주DB프로미'], 'ulsan-hyundai-mobis': ['현대모비스', '울산현대모비스', '울산현대모비스피버스'],
  'suwon-kt': ['KT', 'kt', '수원KT', '수원KT소닉붐'], 'daegu-kogas': ['한국가스공사', '가스공사', '대구한국가스공사', '대구한국가스공사페가수스'],
  'goyang-sono': ['소노', '데이원', '고양데이원', '고양데이원점퍼스', '고양소노', '고양소노스카이거너스']
};
const EVENT_LOOKUP = new Map([...lookup, ...Object.entries(SHORT_NAMES).flatMap(([id, names]) => names.map((n) => [norm(n), id]))]);

/**
 * 시즌 이벤트(data/history/events/<시즌>.json): 오프시즌·시즌 중 트레이드, 외국인 선수 계약, 은퇴, 임의탈퇴, 군 입대·전역, FA(대상자·계약·미체결), 코칭스태프 변경.
 * seasonTeams: Map<시즌, Map<선수 이름, 구단 id>> — 그 시즌 소속(선수 CSV). FA 새 소속이 그 시즌 소속과 다르면 경고만 한다(시즌 중 이적일 수 있다).
 * 반환: { events, errors, warnings }
 */
export function buildEvents(eventDir, teams, { seasonTeams = new Map() } = {}) {
  const errors = [];
  const warnings = [];
  const franchiseIds = new Set(teams.map((t) => t.id));
  const files = existsSync(eventDir) ? readdirSync(eventDir).filter((f) => f.endsWith('.json')).sort() : [];
  const events = [];
  const GROUP_NONE = '계약 미체결';
  const SPECIAL_GROUPS = new Set([GROUP_NONE, '해외 복귀']); // 구단이 아닌 FA 대상 묶음
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(eventDir, file), 'utf8'));
    const season = raw.season;
    const fail = (msg) => errors.push(`[${season} 이벤트] ${msg}`);
    const warn = (msg) => warnings.push(`[${season} 이벤트] ${msg}`);
    if (`${season}.json` !== file) fail(`파일 이름(${file})과 season이 다릅니다`);
    const id = (name, where) => {
      const f = EVENT_LOOKUP.get(norm(String(name)));
      if (!f || !franchiseIds.has(f)) fail(`${where}: 알 수 없는 구단 "${name}"`);
      return f;
    };
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
    const names = (list, where) => {
      if (!Array.isArray(list) || list.length === 0 || list.some((n) => typeof n !== 'string' || !n.trim())) fail(`${where}: 이름 목록이 비었거나 형식이 이상합니다`);
      return list;
    };
    const groupList = (arr, where) => (arr ?? []).map((g) => ({ franchiseId: id(g.team, where), names: names(g.names, `${where} ${g.team}`) }));

    const coaching = (raw.coaching ?? []).map((c) => {
      if (!c.name || !c.to) fail(`코칭스태프: 이름/새 직책이 없습니다 (${JSON.stringify(c)})`);
      return { franchiseId: id(c.team, '코칭스태프'), name: c.name, from: c.from ?? null, to: c.to };
    });

    const trades = (raw.trades ?? []).map((t) => {
      const where = `트레이드 ${t.date ?? '?'} ${t.teamA}↔${t.teamB}`;
      const a = id(t.teamA, where);
      const b = id(t.teamB, where);
      if (a && a === b) fail(`${where}: 같은 구단끼리입니다`);
      if (!isDate(t.date)) fail(`${where}: 날짜 형식 오류`);
      if (!['offseason', 'inseason'].includes(t.phase)) fail(`${where}: phase는 offseason/inseason`);
      if (!Array.isArray(t.giveA) || !Array.isArray(t.giveB)) fail(`${where}: giveA/giveB는 배열(무상·지명권만이면 빈 배열이나 지명권 문자열)`);
      if ((t.giveA ?? []).length + (t.giveB ?? []).length === 0) fail(`${where}: 오가는 선수나 지명권이 없습니다`);
      return { date: t.date, phase: t.phase, teamA: a, giveA: t.giveA, teamB: b, giveB: t.giveB, ...(t.note ? { note: t.note } : {}) };
    });

    const foreign = (raw.foreign ?? []).map((f) => {
      const where = `외국인 선수 ${f.name}`;
      if (!['센터', '포워드', '가드'].includes(f.position)) fail(`${where}: 포지션 ${f.position}`);
      if (!f.kind) fail(`${where}: 구분(재계약/신규 계약 등)이 없습니다`);
      if (!Array.isArray(f.nationality) || f.nationality.length === 0) fail(`${where}: 국적이 없습니다`);
      return { franchiseId: id(f.team, where), name: f.name, position: f.position, nationality: f.nationality, kind: f.kind, asiaQuota: Boolean(f.asiaQuota), ...(f.flags?.length ? { flags: f.flags } : {}), ...(f.note ? { note: f.note } : {}) };
    });

    const retirements = groupList(raw.retirements, '은퇴');
    const voluntaryLeave = groupList(raw.voluntaryLeave, '임의 탈퇴');
    const military = { enlist: groupList(raw.military?.enlist, '군 입대'), discharge: groupList(raw.military?.discharge, '군 전역') };

    // FA: 대상자 = 계약 + 미체결 (구단별로 이름 집합이 정확히 같아야 한다)
    let fa = null;
    if (raw.fa) {
      const groupId = (g, where) => (SPECIAL_GROUPS.has(g) ? g : id(g, where));
      const targets = new Map();
      for (const g of raw.fa.targets ?? []) {
        const gid = groupId(g.team, 'FA 대상자');
        if (targets.has(gid)) fail(`FA 대상자에 ${g.team}이(가) 두 번 나옵니다`);
        targets.set(gid, names(g.names, `FA 대상자 ${g.team}`));
      }
      const seenContract = new Set();
      const contracts = (raw.fa.contracts ?? []).map((c) => {
        const where = `FA 계약 ${c.name}`;
        const from = groupId(c.fromTeam, where);
        const to = c.toTeam === '잔류' ? from : id(c.toTeam, where);
        if (c.toTeam === '잔류' && SPECIAL_GROUPS.has(from)) fail(`${where}: 구단이 없는 묶음의 FA는 잔류가 아닙니다`);
        if (!targets.get(from)?.includes(c.name)) fail(`${where}: ${c.fromTeam}의 FA 대상자 명단에 없습니다`);
        if (seenContract.has(`${from}|${c.name}`)) fail(`${where}: 계약이 두 번 나옵니다`);
        seenContract.add(`${from}|${c.name}`);
        if (!isDate(c.date)) fail(`${where}: 날짜 형식 오류`);
        if (!Number.isInteger(c.years) || c.years < 1 || c.years > 6) fail(`${where}: 계약 기간 ${c.years}`);
        if (typeof c.salaryEok !== 'number' || !(c.salaryEok > 0)) fail(`${where}: 보수총액(억 원) ${c.salaryEok}`);
        const want = seasonTeams.get(season)?.get(c.name);
        if (want && to && !SPECIAL_GROUPS.has(to) && want !== to) warn(`${where}: 새 소속 ${c.toTeam}이(가) 그 시즌 소속 CSV(${want})와 다릅니다`);
        return { fromFranchiseId: from, name: c.name, position: c.position ?? null, toFranchiseId: to, stayed: c.toTeam === '잔류', date: c.date, years: c.years, salaryEok: c.salaryEok, compensation: c.compensation ?? '없음', window: c.window ?? null, ...(c.note ? { note: c.note } : {}) };
      });
      const unsigned = new Map();
      for (const g of raw.fa.unsigned ?? []) unsigned.set(groupId(g.team, 'FA 미체결'), names(g.names, `FA 미체결 ${g.team}`));
      // 대상자였지만 계약도 미체결도 아닌 경우(은퇴 등): withdrawn
      const withdrawn = new Map();
      for (const g of raw.fa.withdrawn ?? []) withdrawn.set(groupId(g.team, 'FA 제외'), names(g.names, `FA 제외 ${g.team}`));
      for (const [gid, list] of targets) {
        const signed = contracts.filter((c) => c.fromFranchiseId === gid).map((c) => c.name);
        const un = [...(unsigned.get(gid) ?? []), ...(withdrawn.get(gid) ?? [])];
        const all = [...signed, ...un];
        if (new Set(all).size !== all.length) fail(`FA ${gid}: 계약과 미체결에 같은 이름이 겹칩니다`);
        const missing = list.filter((n) => !all.includes(n));
        const extra = all.filter((n) => !list.includes(n));
        if (missing.length || extra.length) fail(`FA ${gid}: 대상자 ≠ 계약+미체결+제외 (빠짐: ${missing.join(', ') || '-'}, 초과: ${extra.join(', ') || '-'})`);
      }
      for (const gid of unsigned.keys()) if (!targets.has(gid)) fail(`FA 미체결 ${gid}: 대상자 명단에 그 구단이 없습니다`);
      fa = { withdrawn: [...withdrawn].map(([franchiseId, n]) => ({ franchiseId, names: n })), targets: [...targets].map(([franchiseId, n]) => ({ franchiseId, names: n })), contracts, unsigned: [...unsigned].map(([franchiseId, n]) => ({ franchiseId, names: n })) };
    }
    events.push({ season, ...(raw.note ? { note: raw.note } : {}), coaching, trades, foreign, retirements, voluntaryLeave, military, ...(fa ? { fa } : {}) });
  }
  return { events, errors, warnings };
}
