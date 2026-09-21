/**
 * Openbook — published rules of thumb.
 *
 * Each benchmark below is a summary of guidance its source states publicly. The
 * point of showing them side by side isn't to crown a winner: it's that they
 * disagree, they disagree for reasons, and most of them are measured against
 * gross pay — which is exactly what Openbook argues you shouldn't budget from.
 *
 * Openbook is not affiliated with, endorsed by or connected to any source named
 * here. Figures were taken from each source's own published guidance; see
 * `url` on each benchmark.
 *
 * Pure functions — no DOM, no storage.
 */

import { housingModel, solvePrice, parseNum } from './calc.js';

/* ---------------------------------------------------------------------------
 * The benchmarks
 * ------------------------------------------------------------------------- */

export const BENCHMARKS = [
  {
    id: 'openbook',
    name: 'Openbook',
    rule: 'Whatever your paycheck actually leaves',
    basis: 'take-home pay, after everything you listed',
    isYou: true,
    budget: (r) => r.housingBudget,
    term: null, // your own choice of term
    note: 'Not a rule of thumb at all — it is your own take-home pay minus the savings, debts and expenses you entered. It is the only line here that knows about your childcare, your student loan or your 401(k).'
  },
  {
    id: 'ramsey',
    name: 'Ramsey',
    rule: '25% of take-home pay, on a 15-year fixed',
    basis: 'monthly take-home pay',
    source: 'Ramsey Solutions',
    url: 'https://www.ramseysolutions.com/real-estate/how-much-house-can-i-afford',
    budget: (r) => r.paycheck.netMonthly * 0.25,
    term: 15, // the rule is specific about this, so the price is solved on 15 years
    note: 'The 25% covers principal, interest, property tax, insurance, PMI and HOA. Ramsey also says to be debt-free with a fully funded emergency fund before you buy — and because the rule specifies a 15-year loan, the payment is higher and the price it allows is lower.'
  },
  {
    id: 'moneyguy',
    name: 'The Money Guy — 3/5/25',
    rule: '25% of gross income',
    basis: 'monthly gross income',
    source: 'The Money Guy Show',
    url: 'https://moneyguy.com/guide/home-buying/',
    budget: (r) => r.grossMonthly * 0.25,
    term: null,
    note: (r, state) => state.firstHome
      ? 'The other two numbers, for a first home: put at least 3% down, and plan to stay at least five years so the transaction costs have time to pay for themselves.'
      : 'The other two numbers, for a home after your first: put 20% down, and plan to stay five to seven years. The 3% floor is a first-home allowance only.'
  },
  {
    id: 'conventional',
    name: 'The 28/36 rule',
    rule: '28% of gross for housing, 36% including all debt',
    basis: 'monthly gross income',
    source: 'The classic underwriting rule of thumb',
    budget: (r) => r.ruleOfThumb.housingBudget,
    term: null,
    note: 'The figure textbooks and advice columns quote, and the one most affordability calculators are built on. Worth knowing that it is advice rather than a limit: no lender enforces it, and the line below shows what one will actually sign off on.'
  },
  {
    id: 'approval',
    name: 'What a lender will approve',
    rule: '45% of gross, counting all debt',
    basis: 'monthly gross income',
    source: 'Fannie Mae / conventional underwriting',
    url: 'https://selling-guide.fanniemae.com/sel/b3-6-02/debt-income-ratios',
    isCeiling: true,
    budget: (r) => r.approval.housingBudget,
    term: null,
    note: 'Not a recommendation — the ceiling. A conventional loan applies no front-end housing cap, so total debt-to-income is the only constraint, and Fannie Mae\'s automated underwriter allows up to 50%; FHA stretches to 57% with strong compensating factors. 45% is modelled here as where a typical approval lands, so if anything this is the conservative end. It counts the debts on your credit report and nothing else — not your 401(k), your groceries, your childcare, or the tax you actually pay.'
  },
  {
    id: 'hud',
    name: 'The cost-burden line',
    rule: '30% of gross income',
    basis: 'monthly gross income',
    source: 'HUD',
    url: 'https://www.huduser.gov/portal/pdredge/pdr_edge_featd_article_092214.html',
    isCeiling: true,
    budget: (r) => r.grossMonthly * 0.30,
    term: null,
    note: 'Not advice — a measuring stick. Federal housing statistics count a household paying more than 30% of income for housing as "cost burdened", and 50% or more as "severely cost burdened".'
  }
];

/**
 * The maximum home price each benchmark implies, plus how the payment you are
 * actually contemplating measures up against it.
 */
export function evaluateBenchmarks(result, state) {
  const planned = result.ledger.payment.total;

  return BENCHMARKS.map((benchmark) => {
    const budget = Math.max(0, benchmark.budget(result));

    // A benchmark that specifies a loan term is solved on that term, not the
    // one selected in the form — otherwise the rule isn't the rule.
    const model = benchmark.term && benchmark.term !== state.term
      ? housingModel({ ...state, term: benchmark.term })
      : result.model;

    const price = budget > 0 ? solvePrice(budget, model) : model.downpayment;
    const over = planned - budget;

    return {
      ...benchmark,
      note: typeof benchmark.note === 'function' ? benchmark.note(result, state) : benchmark.note,
      budget,
      price,
      over,
      fits: over <= 1,
      // How much of the relevant income this benchmark allows, for the caption.
      shareOfTakeHome: result.paycheck.netMonthly > 0 ? budget / result.paycheck.netMonthly : 0,
      shareOfGross: result.grossMonthly > 0 ? budget / result.grossMonthly : 0
    };
  });
}

/**
 * How many of the guidance rules the plan satisfies.
 *
 * Openbook's own line isn't a rule, and neither are the ceilings — coming in
 * under a limit you'd have to be reckless to breach isn't an achievement, and
 * counting them would flatter the score. Breached ceilings are reported
 * separately, because those are alarming rather than merely worth noting.
 */
export function scoreBenchmarks(evaluated) {
  const rules = evaluated.filter((b) => !b.isYou && !b.isCeiling);
  return {
    passed: rules.filter((b) => b.fits).length,
    total: rules.length,
    missed: rules.filter((b) => !b.fits),
    ceilingsBreached: evaluated.filter((b) => b.isCeiling && !b.fits)
  };
}

/* ---------------------------------------------------------------------------
 * Readiness
 *
 * The published guidance is about more than the payment. These checks use only
 * what the calculator already knows, and say so when they can't know.
 * ------------------------------------------------------------------------- */

export const RETIREMENT_FLOOR = 0.15;  // Ramsey, Baby Step 4
export const RETIREMENT_TARGET = 0.25; // The Money Guy

export function readiness(result, state) {
  const checks = [];
  const planned = result.ledger.payment;
  const takeHome = result.paycheck.netMonthly;

  /* --- Consumer debt ---------------------------------------------------- */
  checks.push(result.debtsMonthly <= 0
    ? {
        id: 'debt',
        label: 'No monthly debt payments',
        status: 'pass',
        detail: 'Nothing on the debt list, which is where Ramsey says you want to be before you buy.',
        source: 'Ramsey'
      }
    : {
        id: 'debt',
        label: 'Consumer debt still outstanding',
        status: 'caution',
        detail: `${currency(result.debtsMonthly)}/mo in debt payments. Ramsey's guidance is to clear these before buying at all; a lender will simply count them against the 36% limit.`,
        source: 'Ramsey'
      });

  /* --- Emergency fund --------------------------------------------------- */
  // Essentials the fund would have to cover: the new housing payment, debts and
  // the recurring expenses already listed.
  const monthlyEssentials = planned.total + result.debtsMonthly + result.expensesTotalMonthly;
  const fund = Math.max(0, parseNum(state.emergencyFund));

  if (!fund) {
    checks.push({
      id: 'emergency',
      label: 'Emergency fund not entered',
      status: 'unknown',
      detail: `Both Ramsey and The Money Guy want a funded emergency fund in place before a house. At ${currency(monthlyEssentials)}/mo of essentials after buying, three months would be ${currency(monthlyEssentials * 3)} and six months ${currency(monthlyEssentials * 6)}.`,
      source: 'Ramsey · The Money Guy'
    });
  } else {
    const months = monthlyEssentials > 0 ? fund / monthlyEssentials : 0;
    checks.push({
      id: 'emergency',
      label: `Emergency fund covers ${months.toFixed(1)} months`,
      status: months >= 6 ? 'pass' : months >= 3 ? 'pass' : 'caution',
      detail: months >= 6
        ? `${currency(fund)} against ${currency(monthlyEssentials)}/mo of essentials once you own the house — a full six months or more.`
        : months >= 3
          ? `${currency(fund)} against ${currency(monthlyEssentials)}/mo of essentials once you own the house. That's inside the usual three-to-six-month range; six months would be ${currency(monthlyEssentials * 6)}.`
          : `${currency(fund)} against ${currency(monthlyEssentials)}/mo of essentials once you own the house. Three months would be ${currency(monthlyEssentials * 3)}. A house is when the boiler breaks, so this is the check worth fixing first.`,
      source: 'Ramsey · The Money Guy'
    });
  }

  /* --- Down payment ----------------------------------------------------- */
  // The 3% floor in 3/5/25 is a first-home allowance. On any home after that,
  // The Money Guy's figure is 20% — the same place Ramsey starts.
  const downPct = planned.downPct;
  const firstHome = state.firstHome !== false;
  const floor = firstHome ? 3 : 20;

  checks.push({
    id: 'down',
    label: `${downPct.toFixed(0)}% down${firstHome ? ' on a first home' : ''}`,
    status: downPct >= 20 ? 'pass' : downPct >= floor ? 'caution' : 'fail',
    detail: downPct >= 20
      ? 'At or above 20%, so no mortgage insurance — where Ramsey starts, and what The Money Guy asks for on any home after your first.'
      : firstHome
        ? downPct >= 3
          ? `The Money Guy's 3/5/25 allows as little as 3% down on a first home, provided you plan to stay five years. You'll pay ${currency(planned.pmi)}/mo in PMI until you reach 20% equity.`
          : 'Below the 3% floor that 3/5/25 allows even on a first home, and well below the 20% that avoids mortgage insurance.'
        : `The 3% floor in 3/5/25 applies to a first home only — after that The Money Guy's figure is 20%, and Ramsey's is the same. You'd pay ${currency(planned.pmi)}/mo in PMI until you reach 20% equity.`,
    source: 'The Money Guy · Ramsey'
  });

  /* --- Retirement ------------------------------------------------------- */
  // Deliberately counts the 401(k) only: Openbook can't see an IRA, a brokerage
  // account or an employer match, so anything else would be a guess.
  const retirementRate = result.gross > 0 ? result.k401Annual / result.gross : 0;
  checks.push({
    id: 'retirement',
    label: `401(k) at ${(retirementRate * 100).toFixed(0)}% of gross`,
    status: retirementRate >= RETIREMENT_TARGET ? 'pass' : retirementRate >= RETIREMENT_FLOOR ? 'pass' : 'caution',
    detail: retirementRate >= RETIREMENT_TARGET
      ? 'At or above the 25% of gross The Money Guy targets, and comfortably past Ramsey\'s 15%.'
      : retirementRate >= RETIREMENT_FLOOR
        ? 'Past Ramsey\'s 15% of gross; The Money Guy aims for 25%. Openbook can only see your 401(k), so an IRA, a brokerage account or an employer match would push this higher.'
        : `Below the 15% of gross Ramsey suggests — ${currency(result.gross * RETIREMENT_FLOOR / 12)}/mo would get you there. Openbook only sees your 401(k), so an IRA or employer match isn't counted.`,
    source: 'Ramsey · The Money Guy'
  });

  /* --- Share of income -------------------------------------------------- */
  const shareTakeHome = takeHome > 0 ? planned.total / takeHome : 0;
  const shareGross = result.grossMonthly > 0 ? planned.total / result.grossMonthly : 0;
  checks.push({
    id: 'share',
    label: `Housing takes ${(shareTakeHome * 100).toFixed(0)}% of take-home, ${(shareGross * 100).toFixed(0)}% of gross`,
    status: shareGross >= 0.5 ? 'fail' : shareTakeHome <= 0.25 && shareGross <= 0.25 ? 'pass' : shareGross <= 0.30 ? 'caution' : 'fail',
    detail: shareGross >= 0.5
      ? 'Above half of gross income — the threshold federal statistics call "severely cost burdened".'
      : shareTakeHome <= 0.25 && shareGross <= 0.25
        ? 'Inside 25% on both measures, so it clears Ramsey and The Money Guy at once.'
        : shareGross <= 0.30
          ? 'Over 25% of at least one measure, but still under the 30% of gross where federal statistics would call you "cost burdened".'
          : 'Over 30% of gross — the line above which federal housing statistics count a household as "cost burdened".',
    source: 'Ramsey · The Money Guy · HUD'
  });

  return checks;
}

function currency(n) {
  return `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;
}
