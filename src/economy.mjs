// 물가(인플레이션): 샐러리캡·연봉 수준이 시간이 갈수록 조금씩 오르게 한다(규칙값 rules.economy, 게임용 가정).
// rulesFor(rules, season)는 그 시즌 기준으로 금액 상수에 물가 지수를 곱한 규칙 객체를 돌려준다. 원본은 바뀌지 않고, 같은 입력이면 같은 객체(캐시)다.
// 시작 시즌(2026-27)은 지수 1이라 원본과 같다. 엔진 진입점(beginSeason·settleYear·runOffseason)이 이것을 불러 쓰므로,
// 호출하는 쪽은 원본 규칙이든 이미 시즌에 맞춘 규칙이든 그대로 넘기면 된다(항상 원본에서 다시 계산).
// 시즌 번호는 league.season(시즌 시작 연도). 오프시즌 중의 계약은 다음 시즌 선수단을 위한 것이라 '다음 시즌(league.season + 1)' 규칙을 쓴다.

/** 시즌 시작 연도 → 물가 지수(시작 연도 이전은 1) */
export function inflationIndex(season, rules) {
  const e = (rules.econ?.base ?? rules).economy;
  if (!e) return 1;
  return (1 + e.inflation) ** Math.max(0, season - e.startYear);
}

const cache = new WeakMap();

/** 그 시즌의 규칙: 금액 상수에 지수를 곱하고(반올림 단위는 아래), 구한 지수를 rules.econ.index에 남긴다 */
export function rulesFor(rules, season) {
  const base = rules.econ?.base ?? rules;
  const idx = inflationIndex(season, base);
  if (idx === 1) return base;
  let bySeason = cache.get(base);
  if (!bySeason) cache.set(base, (bySeason = new Map()));
  if (bySeason.has(season)) return bySeason.get(season);
  const m = (v, step) => Number((Math.round((v * idx) / step) * step).toFixed(6));
  const cap = base.salaryCap, off = base.offseason, rs = off.rookieSalaryEok, aq = base.asiaQuota, dp = base.devProgram, fa = base.transactions.freeAgency;
  const out = {
    ...base,
    salaryCap: {
      ...cap,
      domesticEok: m(cap.domesticEok, 0.1),
      foreignUsdTotal: m(cap.foreignUsdTotal, 10000),
      foreignUsdPerPlayer: m(cap.foreignUsdPerPlayer, 10000),
      ...(cap.foreignMinUsd != null ? { foreignMinUsd: m(cap.foreignMinUsd, 10000) } : {}),
      minSalaryEok: m(cap.minSalaryEok, 0.01),
      soft: { ...cap.soft, exemptContractEok: m(cap.soft.exemptContractEok, 0.01) }
    },
    offseason: {
      ...off,
      rookieSalaryEok: { ...rs, bands: rs.bands.map((b) => ({ ...b, from: m(b.from, 0.01), to: m(b.to, 0.01) })), min: m(rs.min, 0.01) },
      emergencySalaryEok: m(off.emergencySalaryEok, 0.01)
    },
    asiaQuota: { ...aq, salaryEok: aq.salaryEok.map((v) => m(v, 0.1)) },
    transactions: { ...base.transactions, freeAgency: { ...fa, reserveFundsEok: m(fa.reserveFundsEok, 1) } },
    econ: { base, season, index: idx }
  };
  if (base.cards?.foreignUsd) out.cards = { ...base.cards, foreignUsd: { ...base.cards.foreignUsd, min: m(base.cards.foreignUsd.min, 10000), max: m(base.cards.foreignUsd.max, 10000) } };
  if (dp) out.devProgram = { ...dp, ...(dp.dleague ? { dleague: { ...dp.dleague, costEok: m(dp.dleague.costEok, 0.01) } } : {}), ...(dp.abroad ? { abroad: { ...dp.abroad, feeEok: m(dp.abroad.feeEok, 0.01) } } : {}) };
  bySeason.set(season, out);
  return out;
}

/** 그 시즌 규칙의 물가 지수(rulesFor가 만든 규칙이면 그 값, 원본이면 1) */
export const indexOf = (rules) => rules?.econ?.index ?? 1;
