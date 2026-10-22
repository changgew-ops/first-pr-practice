import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const profiles = JSON.parse(read('data/players/profiles.json'));
const teams = JSON.parse(read('data/teams.json'));
const ids = new Set(teams.map((t) => t.id));
const teamCsv = (season) => new Map(read(`data/players/team-${season}.csv`).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && l !== 'name,team').map((l) => l.split(',').slice(0, 2)));
const seasonName = (y) => `${y}-${String(y + 1).slice(2)}`;

// "2021~2024" = 2021-22 ~ 2023-24 시즌, "2025" 한 해만 쓰면 그 해에 끝나는 시즌(2024-25), "2018~2019" = 2018-19
function seasonsOf(years) {
  const m = /^(\d{4})(?:~(\d{4}))?$/.exec(years);
  assert.ok(m, `경력 표기 ${years}`);
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : null;
  if (end === null) return [seasonName(start - 1)];
  return Array.from({ length: end - start }, (_, i) => seasonName(start + i));
}

test('프로필: 형식(생년월일·구단 id·키)이 올바르고 이름이 겹치지 않는다', () => {
  assert.equal(new Set(profiles.map((p) => p.name)).size, profiles.length);
  for (const p of profiles) {
    assert.match(p.birth, /^\d{4}-\d{2}-\d{2}$/, p.name);
    assert.ok(p.heightCm >= 160 && p.heightCm <= 230, p.name);
    assert.ok(Array.isArray(p.nationality) && p.nationality.length > 0, p.name);
    for (const c of p.career ?? []) assert.ok(ids.has(c.team), `${p.name} ${c.team}`);
    for (const s of p.seasons ?? []) assert.ok(ids.has(s.team), `${p.name} ${s.team}`);
  }
});

test('프로필의 KBL 경력이 시즌별 소속 CSV와 같다 (같은 이름이 CSV에 있는 시즌만)', () => {
  const csvs = new Map(['2021-22', '2022-23', '2023-24', '2024-25', '2025-26'].map((s) => [s, teamCsv(s)]));
  let checked = 0;
  for (const p of profiles) {
    const expected = [
      ...(p.career ?? []).flatMap((c) => seasonsOf(c.years).map((season) => ({ season, team: c.team }))),
      ...(p.seasons ?? []).map((s) => ({ season: s.season, team: s.team }))
    ];
    for (const { season, team } of expected) {
      const csv = csvs.get(season);
      if (!csv?.has(p.name)) continue; // 그 시즌 기록에 없는 이름(해외 리그 시즌, 아직 없는 시즌)
      assert.equal(csv.get(p.name), team, `${p.name} ${season}`);
      checked++;
    }
  }
  assert.ok(checked >= 12, `대조한 시즌 ${checked}개`);
});

test('프로필(정규시즌) + 구단 플레이오프 ≥ 선수 기록 시트(플레이오프 포함 누적): 정인덕', async () => {
  const { loadHistory } = await import('../src/history.mjs');
  const { seasons } = loadHistory();
  const poRecord = (season, team) => {
    let w = 0, l = 0;
    for (const r of seasons.find((x) => x.season === season).playoffs?.rounds ?? []) {
      for (const q of r.series) {
        if (q.a === team) { w += q.winsA; l += q.winsB; }
        if (q.b === team) { w += q.winsB; l += q.winsA; }
      }
    }
    return { w, l, g: w + l };
  };
  const p = profiles.find((x) => x.name === '정인덕');
  let compared = 0;
  for (const s of p.seasons) {
    let text;
    try { text = read(`data/stats/${s.season}.csv`); } catch { continue; } // 2016-17·2017-18 기록 시트는 아직 없다
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    const head = lines[0].split(',');
    const row = lines.slice(1).map((l) => l.split(',')).find((c) => c[0] === p.name);
    assert.ok(row, `${s.season} ${p.name}`);
    const col = (n) => Number(row[head.indexOf(n)]);
    const po = poRecord(s.season, s.team);
    // 시트 = 정규시즌(프로필) + 그 구단이 치른 플레이오프 중 일부
    const dg = col('games') - s.games, dw = col('w') - s.wins, dl = col('l') - s.losses;
    assert.ok(dg >= 0 && dg <= po.g, `${s.season} 경기 차 ${dg} (플레이오프 ${po.g}경기)`);
    assert.ok(dw >= 0 && dw <= po.w && dl >= 0 && dl <= po.l, `${s.season} 승패 차 ${dw}-${dl} (플레이오프 ${po.w}-${po.l})`);
    assert.equal(dw + dl, dg, `${s.season} 승+패`);
    if (po.g === 0) assert.equal(dg, 0, `${s.season}: 플레이오프가 없는 구단이면 시트와 프로필이 같다`);
    compared++;
  }
  assert.equal(compared, 5);
});
