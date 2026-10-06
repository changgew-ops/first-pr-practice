/* UI 렌더링. 게임 로직은 Engine(src/engine.js)이 전담한다. */
(function () {
  const E = window.Engine;
  const D = window.GameData;
  const $ = (s) => document.querySelector(s);
  let state = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
  const labelColor = (id) => (D.labels.find((l) => l.id === id) || {}).color || '#666';

  function avatar(c, cls) {
    const img = c.protagonist ? `<img src="assets/char/${c.id}.png" alt="" onerror="this.remove()">` : '';
    return `<div class="avatar ${cls || ''}" style="background:${c.color || labelColor(c.label)}">${esc(c.name.charAt(0))}${img}</div>`;
  }
  const lb = (c) => `<span class="lb" style="background:${c.color}">${esc(c.labelName)}</span>`;

  // ───────────── 주인공 선택 ─────────────
  function showSelect() {
    state = null;
    $('#weekTag').textContent = '';
    $('#weekTag').className = 'week-tag';
    const cards = D.protagonists.map((p) => {
      const lab = D.labels.find((l) => l.id === p.label);
      return `<button class="card" data-act="pick" data-id="${p.id}">
        <div class="row">${avatar({ ...p, color: lab.color, protagonist: true })}
          <div><h3>${esc(p.name)} <span class="meta">(${p.age})</span></h3>
          <div class="star" title="난이도">${stars(p.star)}</div>
          <div class="meta">${esc(lab.name)} · ${esc(p.concept)}</div></div></div>
        <dl><dt>강점</dt><dd>${esc(p.strength)}</dd><dt>약점</dt><dd>${esc(p.weakness)}</dd><dt>억까</dt><dd>${esc(p.edit.kind)}</dd><dt>서사</dt><dd>${esc(p.arc.name)}</dd></dl>
        <div class="go">이 연습생의 매니저가 된다</div></button>`;
    }).join('');
    $('#app').innerHTML = `
      <div class="hero">
        <h1>Mnet 걸그룹 서바이벌 — 매니저 모드</h1>
        <p>101명의 연습생 중 담당 연습생을 골라 12주 동안 이끌어 TOP 11 데뷔를 노리세요. 순위는 팬이 생기고, 그 팬이 투표해서 결정됩니다.</p>
        <div class="rules">
          <span class="chip">준비 주간 ➜ 방송 주간</span><span class="chip">투표: 11명 → 5명 → 3명 → 1명</span>
          <span class="chip">101 → 60 → 35 → 22 → 16 → 13 → 11</span><span class="chip">주당 집중 행동 2개</span>
        </div>
      </div>
      <div class="cards">${cards}</div>`;
  }

  // ───────────── 게임 화면 ─────────────
  function step() { render(E.next(state)); }

  function render(sc) {
    const v = E.view(state);
    const tag = $('#weekTag');
    tag.textContent = `${v.info.title} · ${v.vote.text}`;
    tag.className = 'week-tag ' + v.info.phase;
    $('#app').innerHTML = `<div class="game"><div id="sceneWrap">${sc ? sceneHtml(sc) : ''}</div>${sideHtml(v)}</div>`;
    window.scrollTo({ top: 0 });
  }

  function lineHtml(l) {
    const cls = l.startsWith('▸') ? 'fx' : /^(⚠|📺)/.test(l) ? 'bad' : /^🔎/.test(l) ? 'hint' : /^(📊|📈|📝|🔍|💬)/.test(l) ? 'dim' : '';
    return `<p class="${cls}">${esc(l).replace(/\n/g, '<br>')}</p>`;
  }

  function sceneHtml(sc) {
    const head = `<div class="scene-bg bg-${esc(sc.bg || 'practice')}"><h2>${esc(sc.title)}</h2></div>`;
    const lines = (sc.lines || []).map(lineHtml).join('');
    let body = '';
    switch (sc.type) {
      case 'text':
        body = `${sc.warn ? '<span class="badge-warn">컨디션</span>' : ''}${lines}<button class="btn right" data-act="next">다음 ▶</button>`;
        break;
      case 'event':
        body = `${lines}<div class="choices">${sc.choices.map((c, i) => `<button class="choice" data-act="choose" data-i="${i}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}${c.disabled ? ' (자금 부족)' : ''}</button>`).join('')}</div>`;
        break;
      case 'actions': {
        const pips = [0, 1].map((i) => `<span class="pip ${i < sc.slots ? 'on' : ''}"></span>`).join('');
        const menu = sc.menu.map((m) => `<button class="choice" data-act="action" data-id="${m.id}" ${sc.slots <= 0 ? 'disabled' : ''}><b>${esc(m.label)}</b><small>${esc(m.desc)}</small></button>`).join('');
        body = `${lines}<div class="slotbar">${pips}<span class="dim">남은 슬롯 ${sc.slots}</span></div>
          ${sc.slots > 0 ? `<div class="menu">${menu}</div>` : ''}
          ${sc.log.length ? `<div class="log">${esc(sc.log.join('\n'))}</div>` : ''}
          ${sc.done ? '<button class="btn right" data-act="next">이번 주 진행 ▶</button>' : ''}`;
        break;
      }
      case 'rank':
        body = rankTable(sc) + '<button class="btn right" data-act="next">다음 ▶</button>';
        break;
      case 'ending': {
        const s = sc.summary;
        body = `${lines}<div class="ending-summary">
            <div><b>${s.rank}위</b><small>최종 순위</small></div><div><b>${s.week}주</b><small>진행</small></div>
            <div><b>${s.trust}</b><small>매니저 신뢰</small></div><div><b>${s.arcOk ? '달성' : '미달성'}</b><small>${esc(s.arc)}</small></div></div>
          <button class="btn right" data-act="restart">다른 연습생으로 다시 하기</button>`;
        break;
      }
      default: body = lines;
    }
    return `<section class="scene">${head}<div class="scene-body">${body}</div></section>`;
  }

  function rankTable(sc) {
    const list = E.ranking(state);
    const me = E.player(state);
    const cutN = D.cuts[state.info.round];
    const show = [];
    list.forEach((c) => { if (c.rank <= 15 || Math.abs(c.rank - me.rank) <= 2) show.push(c); });
    let prev = 0;
    const rows = show.map((c) => {
      const gap = c.rank - prev > 1 ? `<tr><td colspan="5" class="dim" style="text-align:center">⋮</td></tr>` : '';
      prev = c.rank;
      const d = c.prevRank - c.rank;
      const mv = d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '<span class="flat">–</span>';
      const cut = sc.official && cutN && c.rank === cutN ? ' cut' : '';
      return `${gap}<tr class="row ${c.player ? 'me' : ''}${cut}" data-act="detail" data-id="${c.id}"><td>${c.rank}</td><td>${esc(c.name)}${c.player ? ' ⭐' : ''}</td><td>${lb(c)}</td><td class="num">${sc.official ? fmt(c.votes) : '추세'}</td><td class="num">${mv}</td></tr>`;
    }).join('');
    return `<table class="rank"><thead><tr><th>#</th><th>이름</th><th>소속</th><th class="num">${sc.official ? '득표' : ''}</th><th class="num">변동</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="dim" style="margin-top:8px">이름을 누르면 상세 카드를 볼 수 있습니다.${sc.official && cutN ? ` 점선 아래는 탈락선(${cutN}위)입니다.` : ''}</p>`;
  }

  // ───────────── 사이드 패널 ─────────────
  function bar(label, val, cls) {
    const v = Math.max(0, Math.min(100, val));
    return `<div class="bar"><span>${label}</span><div class="track"><div class="fill ${cls || ''} ${cls && v < 30 ? 'low' : ''}" style="width:${v}%"></div></div><span>${Math.round(val)}</span></div>`;
  }

  function sideHtml(v) {
    const p = v.player;
    const d = p.prevRank - p.rank;
    const mv = d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '<span class="flat">–</span>';
    const alerts = [];
    if (v.crisis >= 2) alerts.push('<div class="alert red">⚠ 위기: 수행 능력 저하 중</div>');
    else if (v.crisis === 1) alerts.push('<div class="alert">컨디션 경고</div>');
    if (v.chain) alerts.push(`<div class="alert">📺 제작진 주목 중 · 편집 위험 가중 ${v.chain.risk}%</div>`);
    const top = E.ranking(state).slice(0, 5).map((c) => `<div class="r ${c.player ? 'me' : ''}"><i>${c.rank}</i><span>${esc(c.name)}</span>${lb(c)}</div>`).join('');
    return `<aside class="side">
      <div class="panel"><div class="who">${avatar(p, 'lg')}<div><b>${esc(p.name)}</b><small>${lb(p)} · ${p.age}세</small><small class="star">${stars(p.star)}</small></div>
        <div class="rankbig"><div class="n">${p.rank}위</div><small>${mv} ${v.rankMode === 'official' ? '공식' : '추세'}</small></div></div>
        <div class="bars">${bar('체력', p.stamina, 'hp')}${bar('멘탈', p.mental, 'mp')}${bar('인지도', p.awareness)}${bar('호감도', p.favor)}${bar('팬덤결속', p.coh)}</div>
        <div class="kv"><span>고정 팬</span><b>${fmt(p.fans)}명</b></div>${alerts.join('')}</div>
      <div class="panel"><h4>실력</h4><div class="bars">${E.SKILLS.map((k) => bar(E.SKILL_KO[k], p.skills[k])).join('')}</div></div>
      <div class="panel"><h4>매니저</h4>
        <div class="kv"><span>자금</span><b>${v.mgr.funds}</b></div><div class="kv"><span>신뢰도</span><b>${Math.round(v.mgr.trust)}</b></div>
        <div class="kv"><span>서사 [${esc(v.arc.name)}]</span><b>${v.arc.points > 0 ? '+' + v.arc.points : v.arc.points}</b></div></div>
      <div class="panel"><h4>생존 ${v.alive}명 · 상위 5</h4><div class="mini">${top}</div>
        <button class="btn ghost" style="margin-top:10px;width:100%" data-act="ranking">전체 순위표</button></div>
    </aside>`;
  }

  // ───────────── 모달 ─────────────
  function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); }

  function showRanking() {
    openModal(`<div class="head"><h3>전체 순위 (${E.alive(state).length}명)</h3><button class="btn ghost" data-act="close">닫기</button></div>
      <input class="search" placeholder="이름·소속 검색" id="q">
      <div id="rtable">${fullTable('')}</div>`);
    $('#q').addEventListener('input', (e) => { $('#rtable').innerHTML = fullTable(e.target.value.trim()); });
  }
  function fullTable(q) {
    const list = E.ranking(state).filter((c) => !q || c.name.includes(q) || c.labelName.includes(q));
    const official = state.rankMode === 'official';
    return `<table class="rank"><thead><tr><th>#</th><th>이름</th><th>소속</th><th class="num">인지</th><th class="num">호감</th><th class="num">팬</th><th class="num">변동</th></tr></thead><tbody>${list.map((c) => {
      const d = c.prevRank - c.rank;
      return `<tr class="row ${c.player ? 'me' : ''}" data-act="detail" data-id="${c.id}"><td>${c.rank}</td><td>${esc(c.name)}${c.player ? ' ⭐' : ''}</td><td>${lb(c)}</td><td class="num">${Math.round(c.awareness)}</td><td class="num">${Math.round(c.favor)}</td><td class="num">${fmt(c.fans)}</td><td class="num">${d > 0 ? '<span class="up">▲' + d + '</span>' : d < 0 ? '<span class="down">▼' + -d + '</span>' : '<span class="flat">–</span>'}</td></tr>`;
    }).join('')}</tbody></table>${official ? '' : '<p class="dim">현재는 비공식 예상 순위(추세)입니다.</p>'}`;
  }

  function showDetail(id) {
    const dt = E.detail(state, id);
    const c = dt.c;
    const d = dt.delta;
    const rel = (r, t) => `<div class="kv"><span>${t}</span><b>${esc(r.name)} (${esc(r.label)}${r.rank ? ' · ' + r.rank + '위' : ' · 탈락'})</b></div>`;
    const vp = c.vparts || {};
    openModal(`<div class="head"><h3>참가자 상세 카드</h3><button class="btn ghost" data-act="close">닫기</button></div>
      <div class="who">${avatar(c, 'lg')}<div><b>${esc(c.name)}</b> <small>${c.age}세</small>
        <small>${lb(c)} ${c.alive ? '' : '· 탈락'}</small>${c.star ? `<small class="star">${stars(c.star)}</small>` : ''}<small>${esc(c.concept || '')}</small></div>
        <div class="rankbig"><div class="n">${c.alive ? c.rank + '위' : '탈락'}</div><small>${d > 0 ? '<span class="up">▲' + d + '</span>' : d < 0 ? '<span class="down">▼' + -d + '</span>' : '변동 없음'}</small></div></div>
      <div class="grid2" style="margin-top:12px">
        <div><h4>실력</h4><div class="bars">${E.SKILLS.map((k) => bar(E.SKILL_KO[k], c.skills[k])).join('')}</div></div>
        <div><h4>팬덤·투표</h4><div class="bars">${bar('인지도', c.awareness)}${bar('호감도', c.favor)}${bar('결속', c.coh)}</div>
          <div class="kv" style="margin-top:6px"><span>고정 팬</span><b>${fmt(c.fans)}명</b></div>
          ${vp.fan != null ? `<div class="kv"><span>득표 구성</span><b>팬 ${fmt(vp.fan)} · 일반 ${fmt(vp.gen)}${vp.bonus ? ' · 베네핏 ' + fmt(vp.bonus) : ''}</b></div>` : ''}</div></div>
      <h4 style="margin-top:12px">최근 순위 변동 요인</h4>
      <div class="tagline">${(dt.reasons.length ? dt.reasons : ['뚜렷한 변동 요인 없음']).map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</div>
      <h4 style="margin-top:12px">관계</h4>${rel(dt.friend, '친한 참가자')}${rel(dt.rival, '라이벌')}`);
  }

  // ───────────── 이벤트 위임 ─────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (e.target.id === 'modal') closeModal(); return; }
    const act = el.dataset.act;
    switch (act) {
      case 'pick': state = E.newGame(el.dataset.id, Date.now()); step(); break;
      case 'next': step(); break;
      case 'choose': E.choose(state, +el.dataset.i); step(); break;
      case 'action': E.doAction(state, el.dataset.id); render(state.scene); break;
      case 'ranking': showRanking(); break;
      case 'detail': showDetail(el.dataset.id); break;
      case 'close': closeModal(); break;
      case 'restart': showSelect(); break;
      default:
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  window.UI = { showSelect };
  showSelect();
})();
