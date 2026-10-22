// 팀 이력 빌드(순수 함수): 사이트 화면에서 옮긴 시즌별 원본을 검증하고 구단 id 기준으로 정리한다.
// 입출력은 호출하는 쪽(tools/build-history.mjs, 테스트)이 맡는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function buildHistory(rawDir, teams) {
  const errors = [];
  const warnings = [];
  const franchiseIds = new Set(teams.map((t) => t.id));
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

    seasons.push({
      season,
      startYear: Number(season.slice(0, 4)),
      ...(raw.note ? { note: raw.note } : {}),
      gamesPerTeam: Math.max(...games),
      teams: rows,
      playoffs
    });
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
