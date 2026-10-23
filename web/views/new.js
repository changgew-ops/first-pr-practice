// 새 게임: 단장 이름과 맡을 구단을 정한다.
import { h, eok } from '../lib/dom.js';
import { Session } from '../lib/session.js';
import { powerRanking, prestigeOf, payrollInfo } from '../lib/game.js';
import { colorOf } from '../lib/team-ui.js';

// 흔한 성 + 고유어 이름을 섞은 가상의 이름이다("OOO 단장"으로 불린다). 실존 인물을 가리키지 않는다.
const SUGGEST = ['김가온', '이나래', '박하늘', '최다온', '정바다', '한그루', '오라온', '서보람', '윤새봄', '장누리'];
const STARS = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const LEVEL = ['', '쉬움', '보통', '어려움'];

/** 구단 성격: 전력 순위, 캡 여유 순위(연봉이 적은 순), 전통 점수 순위에서 규칙으로 뽑는다(새 숫자를 만들지 않는다) */
export function teamTraits({ rank, teams, capRoomRank, prestigeRank }) {
  const level = rank <= Math.ceil(teams * 0.3) ? 1 : rank <= Math.ceil(teams * 0.7) ? 2 : 3;
  const tags = [];
  if (level === 1) tags.push('우승 도전');
  if (level === 3) tags.push('리빌딩 도전');
  if (prestigeRank <= 3) tags.push('전통 명문');
  if (capRoomRank <= 3) tags.push('캡 여유');
  if (level === 1 && capRoomRank <= 5) tags.push('초보 추천');
  return { level, tags };
}

export function render(ctx) {
  const { data } = ctx;
  const preview = Session.create(data, { managerId: data.teams[0].id, gmName: '-', seed: 1 }).view;
  const power = new Map(powerRanking(preview, data).map((r) => [r.id, r]));
  const prestige = prestigeOf(preview, data);
  const prestigeRank = new Map([...data.teams].sort((a, b) => prestige[b.id].score - prestige[a.id].score).map((t, i) => [t.id, i + 1]));
  const capRoomRank = new Map([...data.teams].sort((a, b) => { const f = (t) => { const p = payrollInfo(preview, data, t.id); return p.cap - p.domestic; }; return f(b) - f(a); }).map((t, i) => [t.id, i + 1]));
  const randomSeed = () => Math.floor(Math.random() * 1e6);

  const name = h('input', { type: 'text', id: 'gm-name', maxlength: 10, placeholder: '예: 김가온', autocomplete: 'off', 'aria-describedby': 'gm-hint' });
  const seed = { value: randomSeed() }; // 게임 번호(시드)는 늘 무작위로 정한다. 화면에는 단장증 번호로만 보인다
  let teamId = null;

  // 단장증 미리보기
  const idName = h('div', { class: 'st-id-name' });
  const idTeam = h('div', { class: 'st-id-team' });
  const idNo = h('div', { class: 'st-id-no' });
  const idCard = h('div', { class: 'st-id', 'aria-live': 'polite' },
    h('div', { class: 'st-id-band' }, h('span', 'KBL GM'), h('span', '단장증')),
    h('div', { class: 'st-id-body' }, h('div', { class: 'st-id-photo', 'aria-hidden': 'true' }, h('span', { html: '<svg viewBox="0 0 40 40"><circle cx="20" cy="15" r="8"/><path d="M4 40c0-10 7-16 16-16s16 6 16 16z"/></svg>' })), h('div', idName, idTeam, idNo)));

  const go = h('button', { class: 'btn primary big', disabled: true }, '단장 취임');
  const goNote = h('p', { class: 'note st-go-note' });
  const cards = [];
  const sync = () => {
    const n = name.value.trim(), t = teamId ? ctx.team(teamId) : null;
    idName.textContent = n ? `${n} 단장` : '이름을 정해 주세요';
    idName.classList.toggle('empty', !n);
    idTeam.textContent = t ? t.name : '구단을 골라 주세요';
    idNo.textContent = `No. ${String(seed.value || 0).padStart(6, '0')}`;
    idCard.style.setProperty('--team', t ? colorOf(t.id) : 'var(--muted)');
    go.disabled = !(n && t);
    go.textContent = n && t ? `${n} 단장, ${t.name}에 취임` : '이름과 구단을 정해 주세요';
    if (t) {
      const r = power.get(t.id), pay = payrollInfo(preview, data, t.id), tr = teamTraits({ rank: r.rank, teams: data.teams.length, capRoomRank: capRoomRank.get(t.id), prestigeRank: prestigeRank.get(t.id) });
      goNote.textContent = `${t.name}은(는) 전력 ${r.rank}위, 국내 연봉 ${eok(pay.domestic)} / 캡 ${eok(pay.cap, 0)}. 난이도 ${LEVEL[tr.level]}${tr.tags.length ? ` · ${tr.tags.join(', ')}` : ''}. 취임하면 2026-27 시즌 시작 전 화면에서 시작합니다.`;
    } else goNote.textContent = '구단 카드를 눌러 선택하세요. 전력이 약한 구단일수록 어렵지만 키울 재미가 큽니다.';
  };
  name.addEventListener('input', sync);
  go.addEventListener('click', () => ctx.newGame({ gmName: name.value.trim(), teamId, seed: Number(seed.value) }));

  const suggest = h('button', { type: 'button', class: 'btn', onclick: () => {
    const pool = SUGGEST.filter((s) => s !== name.value);
    name.value = pool[Math.floor(Math.random() * pool.length)]; sync(); name.focus();
  } }, '🎲 이름 추천');

  const list = h('div', { class: 'grid g3 st-teams' }, [...data.teams].sort((a, b) => power.get(a.id).rank - power.get(b.id).rank).map((t) => {
    const pay = payrollInfo(preview, data, t.id), pr = prestige[t.id], r = power.get(t.id);
    const tr = teamTraits({ rank: r.rank, teams: data.teams.length, capRoomRank: capRoomRank.get(t.id), prestigeRank: prestigeRank.get(t.id) });
    const card = h('button', { class: 'team-card st-team', type: 'button', 'aria-pressed': 'false', style: { '--team': colorOf(t.id) }, onclick: () => {
      teamId = t.id; cards.forEach((c) => c.setAttribute('aria-pressed', String(c === card))); sync();
    } },
      h('div', { class: 'st-team-head' },
        h('span', { class: 'st-emblem', 'aria-hidden': 'true' }, t.name.replace(/\s/g, '')[0]),
        h('div', h('h3', t.name), h('div', { class: 'note' }, `${t.city} · ${t.arena}`))),
      h('div', { class: 'st-level', title: `난이도 ${LEVEL[tr.level]}` }, h('span', { class: 'st-stars', 'aria-hidden': 'true' }, STARS(tr.level)), h('span', `난이도 ${LEVEL[tr.level]}`)),
      h('div', { class: 'st-tags' }, tr.tags.map((x) => h('span', { class: `tag ${x === '초보 추천' || x === '우승 도전' ? 'hot' : ''}` }, x))),
      h('dl', h('dt', '전력 순위'), h('dd', `${r.rank}위`), h('dt', '전통 점수'), h('dd', pr.score.toFixed(2)), h('dt', '통산 우승'), h('dd', `${pr.titles}회`), h('dt', '국내 연봉'), h('dd', `${eok(pay.domestic)} / ${eok(pay.cap, 0)}`)));
    cards.push(card);
    return card;
  }));

  sync();
  return { title: '새 게임', body: h('div', { class: 'intro stack st-wrap' },
    h('button', { class: 'btn ghost', onclick: () => ctx.go('intro') }, '← 소개'),
    h('div', { class: 'st-hero' }, h('h1', '단장 취임'), h('p', { class: 'muted' }, '이름을 정하고, 맡을 구단을 고르세요. 2026-27 시즌 로스터에서 시작합니다.')),
    h('div', { class: 'card st-name' },
      h('div', { class: 'st-name-form stack' },
        h('label', { for: 'gm-name', class: 'field-label' }, '단장님의 이름은?'),
        h('div', { class: 'row' }, name, suggest),
        h('p', { class: 'note', id: 'gm-hint' }, '게임 안에서 "OOO 단장"으로 불립니다. 나중에 바꿀 수 없습니다.')),
      idCard),
    h('div', h('h2', '맡을 구단'), h('p', { class: 'note' }, '전력이 약한 구단일수록 어렵지만 키울 재미가 큽니다. 순서는 지금 로스터의 전력순입니다. 난이도와 성격 태그는 전력 순위·캡 여유·전통 점수에서 자동으로 뽑은 안내입니다.'), list),
    h('div', { class: 'card st-go' }, goNote, h('div', { class: 'row' }, go))) };
}
