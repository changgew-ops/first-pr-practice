// 자동 단장: 사람이 단장일 때 내리는 결정(트레이드 수락, 재계약, FA 제안, 보상 선택, 드래프트)을
// 단순한 규칙으로 대신한다. 엔진의 단장 콜백(policy)이 실제로 동작하는지 검증하고, 화면 없이 효과를 비교하는 데 쓴다.
import { teamWorth } from './trade.mjs';
import { capAllows, compensationFor } from './freeagency.mjs';
import { domesticOf, payrollEok, valueOf, demandEok, needBonus } from './valuation.mjs';

const round1 = (v) => Math.round(v * 10) / 10;

export function createManagerBot(teamId, rules, { tradeMargin = 1.05 } = {}) {
  const fa = rules.transactions.freeAgency;
  return {
    // 내 입장에서 받는 가치가 보내는 가치의 tradeMargin배 이상일 때만 수락
    trade({ offers, league, ctx }) {
      return offers
        .filter((o) => {
          const inW = o.give.reduce((s, p) => s + teamWorth(p, teamId, league, ctx, rules), 0);
          const outW = o.get.reduce((s, p) => s + teamWorth(p, teamId, league, ctx, rules), 0);
          return inW >= outW * tradeMargin;
        })
        .map((o) => o.id);
    },

    // 가치 상위 9명 또는 성장 가능성이 큰 젊은 선수만 요구 연봉으로 재계약, 캡은 넘기지 않는다
    resign({ expiring, league }) {
      const mine = domesticOf(league.players, teamId);
      const rank = new Map([...mine].sort((a, b) => valueOf(b) - valueOf(a)).map((p, i) => [p.id, i + 1]));
      let payroll = payrollEok(mine.filter((p) => p.contract.yearsLeft > 0), teamId);
      const out = {};
      for (const p of [...expiring].sort((a, b) => valueOf(b) - valueOf(a))) {
        const keep = rank.get(p.id) <= 9 || (p.age <= 24 && p.potential >= p.ovr + 6);
        const salary = round1(demandEok(p) * 1.02);
        if (keep && capAllows(payroll, salary, rules)) {
          out[p.id] = { salaryEok: salary, years: p.age <= 26 ? 3 : 2 };
          payroll += salary;
        }
      }
      return out;
    },

    // 빈 자리 수만큼 효용(가치 + 포지션 필요 − 가격 − 보상금)이 높은 FA에게 제안
    freeAgency({ pool, state, demandNow }) {
      const roster = domesticOf(state.players, teamId);
      const slots = rules.roster.domestic - roster.length;
      if (slots <= 0) return [];
      const payroll = payrollEok(state.players, teamId);
      const cands = [];
      for (const p of pool) {
        if (p.origin !== 'domestic') continue;
        const salary = round1(demandNow(p) * 1.05);
        if (!capAllows(payroll, salary, rules)) continue;
        const comp = compensationFor(p, rules);
        cands.push({ p, salary, utility: valueOf(p) + needBonus(roster, p.position) - fa.priceWeight * salary - fa.compensationWeight * (comp?.cashOnly ?? 0) });
      }
      cands.sort((a, b) => b.utility - a.utility);
      return cands.slice(0, slots + 2).map((c) => ({ playerId: c.p.id, salaryEok: c.salary, years: c.p.age <= 26 ? 3 : 2 }));
    },

    compensation: () => ({ type: 'cash' }),

    // 외국인 카드: AI와 같은 기준(OVR − 가격/5만 달러)으로 가장 좋은 후보
    foreign({ candidates }) {
      return [...candidates].sort((a, b) => (b.player.ovr - b.usd / 50000) - (a.player.ovr - a.usd / 50000) || a.player.id.localeCompare(b.player.id))[0]?.player.id;
    },

    draft({ available, team }) {
      const mine = domesticOf([], team);
      return [...available].sort((a, b) => (b.potential * 0.6 + b.ovr * 0.4 + needBonus(mine, b.position)) - (a.potential * 0.6 + a.ovr * 0.4 + needBonus(mine, a.position)))[0]?.id;
    }
  };
}
