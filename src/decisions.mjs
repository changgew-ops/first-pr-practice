// 단장의 결정을 "기록 + 다시 돌리기"로 받는 오프시즌 진행.
// 엔진(runOffseason)의 단장 콜백은 동기 함수라 사람의 입력을 기다릴 수 없다. 그래서 같은 시드로 오프시즌을 처음부터 다시 돌리며,
// 지금까지 받은 결정(decisions)은 그대로 쓰고, 아직 받지 못한 결정 앞에서 멈춘다(NeedDecision). 결정이 늘 때마다 다시 돌려도 결과가 같다.
// 결정 키: trade · resign · fa:<라운드> · comp:<n번째 보상 선택> · draft:<n번째 지명> · foreign:<n번째 외국인 영입>
//   trade   { accept: [제안 id], proposals: [{ teamA, teamB, giveA, giveB }], release?: [방출할 선수 id] }
//   resign  { [선수 id]: { salaryEok, years }, extend?: { [선수 id]: { salaryEok, years(총 기간) } } }   (없는 선수는 재계약하지 않는다. extend는 계약이 남은 선수의 연장 계약)
//   fa:<r>  [{ playerId, salaryEok, years }]
//   comp:<n> { type: 'cash' } | { type: 'player', playerId }
//   draft:<n> 신인 id
//   foreign:<n> 영입할 외국인 카드 선수 id
// decisions.auto === true 이면 아직 없는 결정은 자동 단장(fallback)이 대신 내린다.
import { runOffseason } from './offseason.mjs';

export class NeedDecision extends Error {
  constructor(key, kind, payload) {
    super(`결정이 필요합니다: ${key}`);
    this.key = key; this.kind = kind; this.payload = payload;
  }
}

export function createReplayPolicy(decisions = {}, fallback = null) {
  const counters = { comp: 0, draft: 0, foreign: 0 };
  const need = (key, kind, payload, auto) => {
    if (key in decisions) return decisions[key];
    if (decisions.auto && auto) return auto();
    throw new NeedDecision(key, kind, payload);
  };
  return {
    trade: (a) => need('trade', 'trade', a, () => ({ accept: fallback?.trade?.(a) ?? [], proposals: [] })).accept ?? [],
    proposals: () => decisions.trade?.proposals ?? [],
    release: () => decisions.trade?.release ?? [],
    resign: (a) => need('resign', 'resign', a, () => fallback?.resign?.(a) ?? {}),
    freeAgency: (a) => need(`fa:${a.round}`, 'freeAgency', a, () => fallback?.freeAgency?.(a) ?? []),
    compensation: (a) => need(`comp:${counters.comp++}`, 'compensation', a, () => fallback?.compensation?.(a) ?? { type: 'cash' }),
    draft: (a) => need(`draft:${counters.draft++}`, 'draft', a, () => fallback?.draft?.(a)),
    foreign: (a) => need(`foreign:${counters.foreign++}`, 'foreign', a, () => fallback?.foreign?.(a))
  };
}

/**
 * 오프시즌을 결정 기록(decisions)으로 진행한다.
 * 반환: { done: true, league, report } | { done: false, key, kind, payload } (payload: 화면이 보여줄 상황)
 */
export function runOffseasonWith(league, standings, teamData, rules, rng, { manager, decisions = {}, fallback = null, cards = null }) {
  try {
    const { league: next, report } = runOffseason(league, standings, teamData, rules, rng, { manager, policy: createReplayPolicy(decisions, fallback), cards });
    return { done: true, league: next, report };
  } catch (e) {
    if (e instanceof NeedDecision) return { done: false, key: e.key, kind: e.kind, payload: e.payload };
    throw e;
  }
}
