/**
 * Openbook — the whole calculation, as pure functions.
 *
 * Nothing here touches the DOM or storage, so the same code runs in the browser
 * and under `npm test`. compute() takes the app state and returns every figure
 * the interface displays.
 */

import {
  BRACKETS, STD_DED, ADDL_MEDICARE_THRESHOLD, SS_WAGE_BASE, SS_RATE,
  MEDICARE_RATE, ADDL_MEDICARE_RATE, PAY_FREQ, CREDIT_BANDS, TERM_15_DISCOUNT,
  STATE_DATA, INS_TIER_RATE, DTI_FRONT_END, DTI_BACK_END, DTI_APPROVAL, PMI_RATE_CAP,
  CLOSING_FEE_PCT, ESCROW_MONTHS_TAX, ESCROW_MONTHS_INSURANCE, PREPAID_INTEREST_DAYS
} from './data.js';

/* ---------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------- */

/** Pull a number out of anything a text input might hold ("1,250" → 1250). */
export function parseNum(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Marginal tax over a [lowerBound, rate] table. Used for federal and for states with brackets. */
export function bracketTax(taxableIncome, brackets) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lower, rate] = brackets[i];
    if (taxableIncome <= lower) break;
    const upper = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    tax += (Math.min(taxableIncome, upper) - lower) * rate;
  }
  return tax;
}

/** Standard amortized payment. A 0% loan just repays principal evenly. */
export function monthlyPI(loanAmount, annualRatePct, termYears) {
  if (loanAmount <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loanAmount / n;
  return (loanAmount * r) / (1 - Math.pow(1 + r, -n));
}

export function rateForTerm(band, term) {
  return term === 30 ? band.rate30 : band.rate30 - TERM_15_DISCOUNT;
}

/** Base annual PMI rate (% of loan) by down-payment percentage, before the credit multiplier. */
export function pmiBaseForDownPct(pct) {
  if (pct >= 20) return 0;
  if (pct >= 15) return 0.12;
  if (pct >= 10) return 0.28;
  if (pct >= 5) return 0.41;
  if (pct >= 3) return 0.55;
  return 0.65;
}

/* ---------------------------------------------------------------------------
 * Paycheck
 * ------------------------------------------------------------------------- */

/**
 * Federal, state and FICA tax on a salary, and what's left afterwards.
 *
 * The two 401(k) types have to be passed separately, because they do different
 * things and it is easy to conflate them:
 *
 *   traditional — lowers taxable income AND leaves the paycheck
 *   Roth        — leaves the paycheck, taxed on the way out
 *
 * Neither lowers FICA wages. Pre-tax payroll items (health premiums, an HSA
 * through payroll) lower both taxable income and FICA wages.
 */
export function computePaycheck({
  salary, filing, stateCode,
  traditional401kAnnual = 0, roth401kAnnual = 0, pretaxAnnual = 0
}) {
  const gross = Math.max(0, salary);
  const brackets = BRACKETS[filing] || BRACKETS.single;
  const stateInfo = STATE_DATA[stateCode] || STATE_DATA.CO;

  const taxableIncome = Math.max(0, gross - (STD_DED[filing] ?? STD_DED.single) - traditional401kAnnual - pretaxAnnual);
  const federalTax = bracketTax(taxableIncome, brackets);
  const stateTax = typeof stateInfo.tax === 'number'
    ? taxableIncome * stateInfo.tax
    : bracketTax(taxableIncome, stateInfo.tax);

  // FICA ignores the 401(k) — it is withheld on pre-tax payroll items only.
  const ficaWages = Math.max(0, gross - pretaxAnnual);
  const socialSecurity = Math.min(ficaWages, SS_WAGE_BASE) * SS_RATE;
  let medicare = ficaWages * MEDICARE_RATE;
  const addlThreshold = ADDL_MEDICARE_THRESHOLD[filing] ?? ADDL_MEDICARE_THRESHOLD.single;
  if (ficaWages > addlThreshold) medicare += (ficaWages - addlThreshold) * ADDL_MEDICARE_RATE;
  const ficaTax = socialSecurity + medicare;

  // Both kinds of contribution are gone before payday. Only the traditional one
  // reduced the tax charged on the way.
  const netAnnual = gross - federalTax - stateTax - ficaTax
    - traditional401kAnnual - roth401kAnnual - pretaxAnnual;

  return {
    gross,
    taxableIncome,
    federalTax,
    stateTax,
    ficaTax,
    socialSecurity,
    medicare,
    netAnnual,
    netMonthly: netAnnual / 12,
    effectiveRate: gross > 0 ? (federalTax + stateTax + ficaTax) / gross : 0
  };
}

/* ---------------------------------------------------------------------------
 * Housing
 * ------------------------------------------------------------------------- */

/**
 * Build the cost model for one set of home/loan inputs. Returns a
 * `paymentAt(price)` function plus the pricing assumptions behind it.
 */
export function housingModel(state) {
  const band = CREDIT_BANDS[state.credit] || CREDIT_BANDS['670'];
  const stateInfo = STATE_DATA[state.stateCode] || STATE_DATA.CO;
  const rate = rateForTerm(band, state.term);
  const downpayment = Math.max(0, state.downpayment);
  const hoaMonthly = Math.max(0, state.hoa);
  const insTier = stateInfo.ins;

  const insuranceAt = (price) => state.insMode === 'manual'
    ? Math.max(0, state.insManual)
    : (price * (INS_TIER_RATE[insTier] / 100)) / 12;

  function paymentAt(price) {
    const p = Math.max(0, price);
    const loan = Math.max(0, p - downpayment);
    const downPct = p > 0 ? (downpayment / p) * 100 : 100;
    // Held to a ceiling a real rate card could quote: the tier multipliers put
    // the weakest credit past 5% a year otherwise, which no insurer writes.
    const pmiRate = downPct >= 20
      ? 0
      : Math.min(pmiBaseForDownPct(downPct) * band.pmiMult, PMI_RATE_CAP);
    const pmi = (loan * (pmiRate / 100)) / 12;
    const pi = monthlyPI(loan, rate, state.term);
    const tax = (p * (stateInfo.proptax / 100)) / 12;
    const insurance = insuranceAt(p);
    return {
      price: p, loan, pi, tax, insurance, pmi, hoa: hoaMonthly, downPct, pmiRate,
      total: pi + tax + insurance + pmi + hoaMonthly
    };
  }

  return { band, stateInfo, rate, downpayment, hoaMonthly, insTier, insuranceAt, paymentAt };
}

/**
 * Largest home price whose total monthly payment fits `budget`.
 *
 * The payment is non-strictly increasing in price at a fixed dollar down payment,
 * so bisection stays stable across the PMI-tier steps that make it non-smooth.
 */
export function solvePrice(budget, model) {
  if (!(budget > 0)) return model.downpayment;
  let lo = model.downpayment;
  let hi = model.downpayment + 4_000_000;
  while (model.paymentAt(hi).total < budget && hi < 50_000_000) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (model.paymentAt(mid).total <= budget) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * A price that sits exactly on a PMI tier boundary leaves a sliver of budget
 * unspent: one dollar more of house would jump PMI into a pricier tier and
 * overshoot. That is real, not a solver artifact — detect it so the interface
 * can say so.
 */
export function isPmiTierLimited(price, model) {
  if (!(price > 0)) return false;
  const nudge = Math.max(1, price * 0.001);
  const pctNow = (model.downpayment / price) * 100;
  const pctNudged = (model.downpayment / (price + nudge)) * 100;
  const tierNow = pctNow >= 20 ? 0 : pmiBaseForDownPct(pctNow);
  const tierNudged = pctNudged >= 20 ? 0 : pmiBaseForDownPct(pctNudged);
  return tierNudged > tierNow;
}

/**
 * What you have to bring to the closing table.
 *
 * The down payment is the part everyone knows about and the only part this
 * calculator used to model, which quietly implied that someone with $40,000
 * saved can put $40,000 down. They can't: the fees and the escrow a lender
 * collects up front come out of the same pot, and they are not small.
 *
 * Nothing here changes the monthly payment, so nothing here changes what you
 * can afford month to month. It changes whether the purchase can happen at all,
 * which is a different question the page had not been asking.
 */
export function cashToClose(payment, model) {
  const fees = payment.price * (CLOSING_FEE_PCT / 100);
  const escrowTax = payment.tax * ESCROW_MONTHS_TAX;
  const escrowInsurance = payment.insurance * ESCROW_MONTHS_INSURANCE;
  const prepaidInterest = payment.loan * (model.rate / 100 / 365) * PREPAID_INTEREST_DAYS;
  const down = Math.max(0, payment.price - payment.loan);
  const costs = fees + escrowTax + escrowInsurance + prepaidInterest;

  return { down, fees, escrowTax, escrowInsurance, prepaidInterest, costs, total: down + costs };
}

/* ---------------------------------------------------------------------------
 * The whole picture
 * ------------------------------------------------------------------------- */

const active = (items) => (items || []).filter((it) => !it.excluded);

/** Monthly dollars a line item costs, resolving % rows against take-home pay. */
export function itemAmount(item, netMonthly) {
  return item.mode === 'pct' ? netMonthly * (parseNum(item.value) / 100) : parseNum(item.value);
}

export function compute(state) {
  const gross = Math.max(0, state.salary);
  const grossMonthly = gross / 12;

  // 401(k): a percentage is of gross pay; a dollar figure is a flat monthly amount.
  const k401Monthly = state.k401.mode === 'pct' ? grossMonthly * (state.k401.pct / 100) : Math.max(0, state.k401.pct);
  const k401Annual = k401Monthly * 12;
  const isTraditional = state.k401.type === 'traditional';

  // Pre-tax payroll items leave before tax, so they shrink taxable income rather
  // than take-home pay. Only flat dollar rows can be pre-tax — a percentage of
  // take-home isn't well defined before tax comes out.
  const expensePretaxMonthly = active(state.expenseItems)
    .filter((it) => it.pretax)
    .reduce((sum, it) => sum + parseNum(it.value), 0);
  const savingsPretaxMonthly = active(state.savingsItems)
    .filter((it) => it.pretax && it.mode !== 'pct')
    .reduce((sum, it) => sum + parseNum(it.value), 0);
  const pretaxMonthly = expensePretaxMonthly + savingsPretaxMonthly;

  const paycheck = computePaycheck({
    salary: gross,
    filing: state.filing,
    stateCode: state.stateCode,
    traditional401kAnnual: isTraditional ? k401Annual : 0,
    roth401kAnnual: isTraditional ? 0 : k401Annual,
    pretaxAnnual: pretaxMonthly * 12
  });

  const netMonthly = paycheck.netMonthly;
  const freq = PAY_FREQ[state.payfreq] || PAY_FREQ.monthly;
  const takeHomePerPeriod = paycheck.netAnnual / freq.divisor;

  // Post-tax savings are the only savings that actually leave take-home pay;
  // pre-tax ones already came out of the paycheck above.
  const savingsPostTaxMonthly = active(state.savingsItems)
    .filter((it) => !(it.pretax && it.mode !== 'pct'))
    .reduce((sum, it) => sum + itemAmount(it, netMonthly), 0);
  const debtsMonthly = active(state.debtItems).reduce((sum, it) => sum + parseNum(it.value), 0);
  const expensesMonthly = active(state.expenseItems)
    .filter((it) => !it.pretax)
    .reduce((sum, it) => sum + parseNum(it.value), 0);

  // What's actually left once everything the person listed is paid for.
  const leftover = Math.max(0, netMonthly - savingsPostTaxMonthly - debtsMonthly - expensesMonthly);

  // ...but never more than the 28/36 rule allows on housing. Without this the
  // budget is simply "every spare dollar", which for anyone with light expenses
  // recommends a payment no adviser would stand behind. The cap only ever
  // lowers the figure, so the recommendation is the stricter of the two tests:
  // what your paycheck leaves, and what the rule permits.
  const ruleCap = grossMonthly * DTI_FRONT_END;
  const housingBudget = Math.min(leftover, ruleCap);
  const cappedByRule = leftover > ruleCap + 0.01;

  const model = housingModel(state);
  const price = housingBudget > 0 ? solvePrice(housingBudget, model) : model.downpayment;
  const payment = model.paymentAt(price);

  // What a lender will actually approve. A conventional loan applies no front-end
  // housing cap — total debt-to-income is the constraint — so this is one
  // subtraction, not a min() against 28% of gross. See DTI_APPROVAL.
  const approvalBudget = Math.max(0, grossMonthly * DTI_APPROVAL - debtsMonthly);
  const approvalPrice = approvalBudget > 0 ? solvePrice(approvalBudget, model) : model.downpayment;
  const approvalPayment = model.paymentAt(approvalPrice);

  // The 28% half on its own: "don't spend more than 28% of gross on housing".
  // Shown as its own figure because it is the number people actually quote, and
  // because the combined rule below usually reports the 36% half instead — so
  // without this the 28% price never appears anywhere.
  const rule28Budget = ruleCap;
  const rule28Price = rule28Budget > 0 ? solvePrice(rule28Budget, model) : model.downpayment;
  const rule28Payment = model.paymentAt(rule28Price);

  // The 28/36 rule of thumb, kept separate because it is advice rather than
  // underwriting: housing under 28% of gross, everything under 36%, whichever
  // binds first.
  const ruleOfThumbBudget = Math.max(0, Math.min(
    grossMonthly * DTI_FRONT_END,
    grossMonthly * DTI_BACK_END - debtsMonthly
  ));
  const ruleOfThumbPrice = ruleOfThumbBudget > 0 ? solvePrice(ruleOfThumbBudget, model) : model.downpayment;
  const ruleOfThumbPayment = model.paymentAt(ruleOfThumbPrice);

  // The Income & debits ledger can be run against the estimate or a price you type in.
  const usingTestPrice = state.priceTestMode === 'manual';
  const ledgerPayment = usingTestPrice
    ? model.paymentAt(Math.max(0, parseNum(state.testPrice)))
    : payment;

  const debits = {
    savings: savingsPostTaxMonthly,
    debts: debtsMonthly,
    expenses: expensesMonthly,
    housing: ledgerPayment.total
  };
  const debitsTotal = debits.savings + debits.debts + debits.expenses + debits.housing;
  const unallocated = netMonthly - debitsTotal;

  // "Where every dollar goes" has to start at the first dollar. The two rows
  // above take-home pay are the ones nobody chooses to spend: tax, and the
  // payroll deductions that never reach the account. By construction
  // grossMonthly - tax - payroll === netMonthly, so the cascade reconciles
  // exactly rather than approximately.
  const deductions = {
    tax: (paycheck.federalTax + paycheck.stateTax + paycheck.ficaTax) / 12,
    payroll: k401Monthly + pretaxMonthly
  };
  const deductionsTotal = deductions.tax + deductions.payroll;

  return {
    gross,
    grossMonthly,
    paycheck,
    freq,
    takeHomePerPeriod,
    k401Monthly,
    k401Annual,
    isTraditional,
    pretaxMonthly,
    expensePretaxMonthly,
    savingsPretaxMonthly,
    savingsPostTaxMonthly,
    savingsTotalMonthly: k401Monthly + savingsPostTaxMonthly + savingsPretaxMonthly,
    debtsMonthly,
    expensesMonthly,
    expensesTotalMonthly: expensesMonthly + expensePretaxMonthly,
    housingBudget,
    leftover,
    ruleCap,
    cappedByRule,
    model,
    price,
    payment,
    pmiTierLimited: !usingTestPrice && !cappedByRule && housingBudget > 0 && unallocated > 1
      && isPmiTierLimited(price, model),
    approval: { housingBudget: approvalBudget, price: approvalPrice, payment: approvalPayment },
    rule28: { housingBudget: rule28Budget, price: rule28Price, payment: rule28Payment },
    ruleOfThumb: {
      housingBudget: ruleOfThumbBudget, price: ruleOfThumbPrice, payment: ruleOfThumbPayment,
      // Which half of 28/36 produced the figure — the 36 usually wins.
      boundBy: ruleOfThumbBudget < rule28Budget - 0.01 ? 'back' : 'front'
    },
    // Cash at closing for the payment actually on the table — the estimate
    // normally, or the what-if price once one is entered.
    cash: cashToClose(ledgerPayment, model),

    ledger: {
      usingTestPrice, payment: ledgerPayment,
      grossMonthly, deductions, deductionsTotal, netMonthly,
      debits, debitsTotal, unallocated
    },
    // Both denominators, because they are the whole argument. Take-home is the
    // number a lender never asks about; gross is the one every published rule is
    // written in. Quoting one without naming it invites the reader to measure it
    // against a rule written in the other.
    // Both halves of a debt-to-income ratio, for each figure on the page. The
    // front end is housing against gross — what 28/36's 28 measures. The back
    // end adds every other debt payment — what its 36 measures. Printing one
    // without the other invites it to be read against the wrong limit.
    //
    // Two sets, because two different payments are in play and pairing a
    // payment with the other one's ratios is how you end up showing $1,913/mo
    // at 58% of gross. `estimate*` describes the affordability estimate, which
    // is what the headline comparison is about. The unprefixed ones describe
    // the payment actually on the table — the estimate normally, or the what-if
    // price once one is entered — which is what the readiness checks and the
    // rules verdict are judging.
    estimateShareOfTakeHome: netMonthly > 0 ? payment.total / netMonthly : 0,
    estimateFrontEnd: grossMonthly > 0 ? payment.total / grossMonthly : 0,
    estimateBackEnd: grossMonthly > 0 ? (payment.total + debtsMonthly) / grossMonthly : 0,

    housingShareOfTakeHome: netMonthly > 0 ? ledgerPayment.total / netMonthly : 0,
    frontEnd: grossMonthly > 0 ? ledgerPayment.total / grossMonthly : 0,
    backEnd: grossMonthly > 0 ? (ledgerPayment.total + debtsMonthly) / grossMonthly : 0,

    approvalShareOfTakeHome: netMonthly > 0 ? approvalPayment.total / netMonthly : 0,
    approvalFrontEnd: grossMonthly > 0 ? approvalPayment.total / grossMonthly : 0,
    approvalBackEnd: grossMonthly > 0 ? (approvalPayment.total + debtsMonthly) / grossMonthly : 0
  };
}
