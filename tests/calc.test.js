/**
 * Tests for the calculation engine. These pin down the arithmetic that the
 * interface is only allowed to display — run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseNum, bracketTax, monthlyPI, rateForTerm, pmiBaseForDownPct,
  computePaycheck, housingModel, solvePrice, compute
} from '../assets/js/calc.js';
import { BRACKETS, CREDIT_BANDS, SS_WAGE_BASE, STATE_DATA, PMI_RATE_CAP } from '../assets/js/data.js';
import { createDefaultState, createEmptyState } from '../assets/js/state.js';

const near = (actual, expected, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}, got ${actual}`);

/* -------------------------------------------------------------------------- */

test('parseNum strips formatting', () => {
  assert.equal(parseNum('95,000'), 95000);
  assert.equal(parseNum('$1,250/mo'), 1250);
  assert.equal(parseNum(''), 0);
  assert.equal(parseNum('abc'), 0);
});

test('bracketTax charges each bracket only on the slice inside it', () => {
  assert.equal(bracketTax(0, BRACKETS.single), 0);
  assert.equal(bracketTax(-500, BRACKETS.single), 0);
  // Entirely inside the 10% bracket.
  near(bracketTax(10000, BRACKETS.single), 1000);
  // 10% on the first 12,400, then 12% on the rest.
  near(bracketTax(20000, BRACKETS.single), 12400 * 0.1 + 7600 * 0.12);
});

test('monthlyPI matches the amortization formula', () => {
  near(monthlyPI(300000, 6.6, 30), 1915.98, 0.02);
  near(monthlyPI(300000, 6.6, 15), 2629.84, 0.05);
  assert.equal(monthlyPI(0, 6.6, 30), 0);
  // A 0% loan just repays principal.
  near(monthlyPI(120000, 0, 10), 1000);
});

test('a 15-year fixed prices below a 30-year', () => {
  const band = CREDIT_BANDS['740'];
  assert.ok(rateForTerm(band, 15) < rateForTerm(band, 30));
});

test('PMI steps down as the down payment grows, and stops at 20%', () => {
  assert.equal(pmiBaseForDownPct(25), 0);
  assert.equal(pmiBaseForDownPct(20), 0);
  assert.ok(pmiBaseForDownPct(19) > 0);
  const tiers = [19, 14, 9, 4, 2].map(pmiBaseForDownPct);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i] > tiers[i - 1], 'a smaller down payment must cost more PMI');
  }
});

/* -------------------------------------------------------------------------- */

test('a no-income-tax state charges no state tax', () => {
  const pay = computePaycheck({ salary: 120000, filing: 'single', stateCode: 'TX' });
  assert.equal(pay.stateTax, 0);
  assert.ok(pay.federalTax > 0 && pay.ficaTax > 0);
});

test('Social Security stops at the wage base, Medicare does not', () => {
  const high = computePaycheck({ salary: 400000, filing: 'single', stateCode: 'TX' });
  near(high.socialSecurity, SS_WAGE_BASE * 0.062, 0.01);
  // Base Medicare on all wages, plus the 0.9% surtax above $200k.
  near(high.medicare, 400000 * 0.0145 + 200000 * 0.009, 0.01);
});

test('traditional 401(k) lowers income tax but not FICA', () => {
  const base = { salary: 100000, filing: 'single', stateCode: 'CO' };
  const withNone = computePaycheck(base);
  const withTrad = computePaycheck({ ...base, traditional401kAnnual: 10000 });
  assert.ok(withTrad.federalTax < withNone.federalTax);
  assert.ok(withTrad.stateTax < withNone.stateTax);
  near(withTrad.ficaTax, withNone.ficaTax, 0.01);
});

test('pre-tax payroll deductions lower FICA too', () => {
  const base = { salary: 100000, filing: 'single', stateCode: 'CO' };
  const withNone = computePaycheck(base);
  const withPretax = computePaycheck({ ...base, pretaxAnnual: 6000 });
  assert.ok(withPretax.ficaTax < withNone.ficaTax);
  assert.ok(withPretax.federalTax < withNone.federalTax);
});

test('every state has the fields the calculation needs', () => {
  for (const [code, info] of Object.entries(STATE_DATA)) {
    assert.ok(info.name, `${code} needs a name`);
    assert.ok(Number.isFinite(info.proptax), `${code} needs a property tax rate`);
    assert.ok(['high', 'medium', 'low', 'co'].includes(info.ins), `${code} has an unknown insurance tier`);
    const pay = computePaycheck({ salary: 90000, filing: 'single', stateCode: code });
    assert.ok(pay.stateTax >= 0 && Number.isFinite(pay.stateTax), `${code} produced a bad state tax`);
    assert.ok(pay.netAnnual > 0, `${code} produced a bad take-home figure`);
  }
});

/* -------------------------------------------------------------------------- */

test('solvePrice finds the largest price that fits the budget', () => {
  const state = { ...createDefaultState(), downpayment: 40000, insMode: 'manual', insManual: 120 };
  const model = housingModel(state);
  const budget = 2200;
  const price = solvePrice(budget, model);
  assert.ok(model.paymentAt(price).total <= budget + 0.01, 'the solved price must fit');
  // One percent more house must not also fit, or the solver stopped short.
  assert.ok(model.paymentAt(price * 1.01).total > budget, 'the solved price must be the largest that fits');
});

test('a bigger budget buys a bigger house; a worse credit tier buys less', () => {
  const state = createDefaultState();
  const model = housingModel(state);
  assert.ok(solvePrice(3000, model) > solvePrice(2000, model));

  const poorCredit = housingModel({ ...state, credit: '580' });
  assert.ok(solvePrice(2500, poorCredit) < solvePrice(2500, model));
});

test('20% down removes PMI entirely', () => {
  const model = housingModel({ ...createDefaultState(), downpayment: 100000 });
  assert.equal(model.paymentAt(500000).pmi, 0);
  assert.ok(model.paymentAt(600000).pmi > 0);
});

/* -------------------------------------------------------------------------- */

test('compute: the estimated payment uses up the housing budget', () => {
  const result = compute(createDefaultState());
  assert.ok(result.housingBudget > 0);
  assert.ok(result.payment.total <= result.housingBudget + 0.01);
  // Nothing should be left unallocated beyond a PMI-tier sliver.
  assert.ok(result.ledger.unallocated < result.housingBudget * 0.25);
});

test('compute: excluded rows drop out of every total', () => {
  const base = createDefaultState();
  const withDebt = compute(base);

  const excluded = createDefaultState();
  excluded.debtItems[0].excluded = true;
  const withoutDebt = compute(excluded);

  assert.ok(withoutDebt.debtsMonthly < withDebt.debtsMonthly);
  assert.ok(withoutDebt.housingBudget > withDebt.housingBudget);
  assert.ok(withoutDebt.price > withDebt.price);
});

test('compute: a pre-tax savings row is not also charged against take-home', () => {
  const posttax = createDefaultState();
  posttax.savingsItems = [{ id: 'a', label: 'HSA', value: 200, mode: 'dollar' }];
  const pretax = createDefaultState();
  pretax.savingsItems = [{ id: 'a', label: 'HSA', value: 200, mode: 'dollar', pretax: true }];

  const a = compute(posttax);
  const b = compute(pretax);

  // Pre-tax leaves before tax, so it costs less of the budget than the same
  // amount taken after tax. Compared on `leftover` rather than `housingBudget`
  // because both of these households are rich enough to sit at the 28% cap,
  // which would hide the difference.
  assert.ok(b.leftover > a.leftover);
  assert.equal(b.savingsPostTaxMonthly, 0);
  near(a.savingsPostTaxMonthly, 200);
});

test('compute: a percentage savings row tracks take-home pay', () => {
  const state = createDefaultState();
  state.savingsItems = [{ id: 'a', label: 'Investing', value: 10, mode: 'pct' }];
  const result = compute(state);
  near(result.savingsPostTaxMonthly, result.paycheck.netMonthly * 0.1, 0.01);
});

test('compute: the 28/36 rule of thumb binds on whichever half is tighter', () => {
  const state = createDefaultState();
  const result = compute(state);
  const grossMonthly = state.salary / 12;
  const expected = Math.min(grossMonthly * 0.28, grossMonthly * 0.36 - result.debtsMonthly);
  near(result.ruleOfThumb.housingBudget, expected, 0.01);
  assert.ok(result.ruleOfThumb.payment.total <= result.ruleOfThumb.housingBudget + 0.01);
});

test('compute: approval uses total DTI with no front-end cap', () => {
  const state = createDefaultState();
  const result = compute(state);
  const grossMonthly = state.salary / 12;

  // A conventional loan caps total debt-to-income only — 28% of gross never binds.
  near(result.approval.housingBudget, grossMonthly * 0.45 - result.debtsMonthly, 0.01);
  assert.ok(result.approval.housingBudget > grossMonthly * 0.28,
    'the approval budget must be free to exceed the 28% housing guideline');
  assert.ok(result.approval.payment.total <= result.approval.housingBudget + 0.01);
});

test('compute: a lender approves materially more than the rule of thumb', () => {
  const result = compute(createDefaultState());
  assert.ok(result.approval.price > result.ruleOfThumb.price,
    'approval must exceed the advice rule, or the comparison is meaningless');
  assert.ok(result.approval.price > result.price * 1.2,
    'the approved figure should be far above what the paycheck supports');
});

test('compute: debts reduce the approval budget dollar for dollar', () => {
  const noDebt = createDefaultState();
  noDebt.debtItems = [];
  const withDebt = createDefaultState();

  const a = compute(noDebt);
  const b = compute(withDebt);
  near(a.approval.housingBudget - b.approval.housingBudget, b.debtsMonthly, 0.01);
});

test('compute: a spent-out budget never produces a negative price', () => {
  const state = createDefaultState();
  state.expenseItems = [{ id: 'x', label: 'Everything', value: 100000 }];
  const result = compute(state);
  assert.equal(result.housingBudget, 0);
  assert.ok(result.price >= 0);
  assert.ok(result.ledger.unallocated < 0, 'an overspent budget should show as negative');
});

test('compute: an empty state produces zeros rather than NaN', () => {
  const result = compute(createEmptyState());
  for (const value of [result.price, result.payment.total, result.housingBudget, result.paycheck.netMonthly]) {
    assert.ok(Number.isFinite(value), 'every headline figure must be a real number');
  }
  assert.equal(result.price, 0);
});

test('compute: the ledger honours a manually entered test price', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 250000;
  const result = compute(state);
  near(result.ledger.payment.price, 250000);
  assert.ok(result.ledger.usingTestPrice);
  // The headline estimate is untouched by the what-if price.
  assert.ok(result.price !== 250000);
});

test('compute: hero ratios describe the estimate, plan ratios follow the what-if', () => {
  const state = createDefaultState();
  const base = compute(state);

  // With no what-if price the two sets agree, because they describe one payment.
  near(base.estimateFrontEnd, base.frontEnd, 1e-9);
  near(base.estimateShareOfTakeHome, base.housingShareOfTakeHome, 1e-9);

  // Enter a what-if price and they must part company: the estimate is unchanged,
  // the plan follows the price being tested.
  state.priceTestMode = 'manual';
  state.testPrice = 600000;
  const tested = compute(state);

  near(tested.estimateFrontEnd, base.estimateFrontEnd, 1e-9);
  near(tested.estimateShareOfTakeHome, base.estimateShareOfTakeHome, 1e-9);
  assert.ok(tested.frontEnd > tested.estimateFrontEnd,
    'the plan ratio must follow the what-if price');

  // Each ratio pairs with its own payment — this is the mismatch being guarded.
  near(tested.estimateFrontEnd, tested.payment.total / tested.grossMonthly, 1e-9);
  near(tested.frontEnd, tested.ledger.payment.total / tested.grossMonthly, 1e-9);
});

test('compute: a back-end ratio is the front end plus the debt load', () => {
  const result = compute(createDefaultState());
  const debtShare = result.debtsMonthly / result.grossMonthly;
  near(result.estimateBackEnd, result.estimateFrontEnd + debtShare, 1e-9);
  near(result.approvalBackEnd, result.approvalFrontEnd + debtShare, 1e-9);

  // The approval model is built on a 45% total DTI, so its back end lands there.
  near(result.approvalBackEnd, 0.45, 0.0005);
});

test('compute: the housing budget never exceeds the rule\'s 28% of gross', () => {
  // Someone with almost nothing going out would otherwise be handed every
  // spare dollar as a mortgage payment.
  const state = createDefaultState();
  state.debtItems = [];
  state.expenseItems = [];
  state.savingsItems = [];
  state.k401 = { pct: 0, mode: 'pct', type: 'traditional' };

  const result = compute(state);
  assert.ok(result.leftover > result.ruleCap, 'this household should have spare income');
  assert.ok(result.cappedByRule, 'the cap must bind here');
  near(result.housingBudget, result.ruleCap, 0.01);
  near(result.estimateFrontEnd, 0.28, 0.0005);
});

test('compute: the cap leaves the paycheck test in charge when it is tighter', () => {
  const result = compute(createDefaultState());
  assert.ok(result.leftover < result.ruleCap, 'the example household is under the cap');
  assert.equal(result.cappedByRule, false);
  near(result.housingBudget, result.leftover, 0.01);
});

test('compute: a capped budget shows the held-back money as unallocated', () => {
  const state = createDefaultState();
  state.expenseItems = [];
  state.debtItems = [];
  const result = compute(state);

  assert.ok(result.cappedByRule);
  // The difference isn't lost — it shows up as income the plan hasn't spent.
  assert.ok(result.ledger.unallocated > 1);
  near(result.ledger.unallocated, result.leftover - result.housingBudget, 1);
  // ...and it must not be explained away as a PMI-tier rounding sliver.
  assert.equal(result.pmiTierLimited, false);
});

test('compute: every household lands inside the rule on housing', () => {
  const cases = [
    (s) => { s.salary = 40000; },
    (s) => { s.salary = 250000; s.expenseItems = []; s.debtItems = []; },
    (s) => { s.debtItems = []; s.savingsItems = []; },
    (s) => { s.stateCode = 'TX'; s.expenseItems = []; },
    (s) => { s.filing = 'mfj'; s.salary = 180000; s.expenseItems = []; }
  ];
  for (const mutate of cases) {
    const state = createDefaultState();
    mutate(state);
    const result = compute(state);
    assert.ok(result.estimateFrontEnd <= 0.28 + 0.0005,
      `housing came to ${(result.estimateFrontEnd * 100).toFixed(1)}% of gross, over the rule`);
  }
});

test('compute: the 28% rule gets its own figure, stated as the rule states it', () => {
  const state = createDefaultState();
  const result = compute(state);

  near(result.rule28.housingBudget, result.grossMonthly * 0.28, 0.01);
  assert.ok(result.rule28.payment.total <= result.rule28.housingBudget + 0.01);

  // It must not be the same number as the combined rule whenever debts make the
  // 36% half tighter — that conflation is why the 28% price was never on screen.
  assert.ok(result.debtsMonthly > 0);
  assert.ok(result.rule28.price > result.ruleOfThumb.price);
  assert.equal(result.ruleOfThumb.boundBy, 'back');
});

test('compute: with no other debts the two halves agree and the 28% binds', () => {
  const state = createDefaultState();
  state.debtItems = [];
  const result = compute(state);

  near(result.ruleOfThumb.housingBudget, result.rule28.housingBudget, 0.01);
  assert.equal(result.ruleOfThumb.boundBy, 'front');
});

test('compute: the paycheck figure can never exceed the 28% rule figure', () => {
  for (const mutate of [
    (s) => {},
    (s) => { s.expenseItems = []; s.debtItems = []; },
    (s) => { s.salary = 300000; s.savingsItems = []; },
    (s) => { s.salary = 45000; }
  ]) {
    const state = createDefaultState();
    mutate(state);
    const result = compute(state);
    assert.ok(result.price <= result.rule28.price + 1,
      'the cap should keep the recommendation at or under the rule');
  }
});

/* ---------------------------------------------------------------------------
 * Roth vs traditional
 *
 * The distinction is easy to get wrong in one specific way: a Roth contribution
 * does not reduce taxable income, but it very much does reduce take-home pay.
 * Treating "doesn't lower tax" as "doesn't leave the paycheck" hands a Roth
 * contributor a housing budget as though they saved nothing.
 * ------------------------------------------------------------------------- */

const withK401 = (type, pct, salary = 200000) => {
  const state = createDefaultState();
  state.salary = salary;
  state.savingsItems = [];
  state.debtItems = [];
  state.expenseItems = [];
  state.k401 = { pct, mode: 'pct', type };
  return compute(state);
};

test('a percentage contribution is that share of gross pay', () => {
  const result = withK401('roth', 12);
  near(result.k401Annual, 24000);
  near(result.k401Monthly, 2000);
  // Same figure whichever type it is — only its tax treatment differs.
  near(withK401('traditional', 12).k401Annual, 24000);
});

test('a Roth contribution leaves the paycheck', () => {
  const none = withK401('roth', 0);
  const twelve = withK401('roth', 12);
  near(none.paycheck.netMonthly - twelve.paycheck.netMonthly, 2000, 0.01);
  assert.ok(twelve.paycheck.netMonthly < none.paycheck.netMonthly,
    'contributing must reduce take-home pay, Roth included');
});

test('a Roth contribution does not reduce taxable income', () => {
  const none = withK401('roth', 0);
  const twelve = withK401('roth', 12);
  near(twelve.paycheck.taxableIncome, none.paycheck.taxableIncome, 0.01);
  near(twelve.paycheck.federalTax, none.paycheck.federalTax, 0.01);
});

test('Roth costs more take-home than traditional, by exactly the tax on it', () => {
  const trad = withK401('traditional', 12);
  const roth = withK401('roth', 12);

  const extraTax = (roth.paycheck.federalTax + roth.paycheck.stateTax)
    - (trad.paycheck.federalTax + trad.paycheck.stateTax);
  near(trad.paycheck.netAnnual - roth.paycheck.netAnnual, extraTax, 0.01);
  assert.ok(extraTax > 0, 'the Roth contributor pays tax on the contribution');
});

test('neither type of contribution changes FICA', () => {
  const none = withK401('roth', 0);
  near(withK401('roth', 12).paycheck.ficaTax, none.paycheck.ficaTax, 0.01);
  near(withK401('traditional', 12).paycheck.ficaTax, none.paycheck.ficaTax, 0.01);
});

test('the tax breakdown reconciles to take-home pay for both types', () => {
  for (const type of ['traditional', 'roth']) {
    const r = withK401(type, 12);
    // The rows the interface prints, in order, must sum to the total it prints.
    const shown = r.gross
      - r.paycheck.federalTax
      - r.paycheck.stateTax
      - r.paycheck.ficaTax
      - (r.k401Annual + r.pretaxMonthly * 12);
    near(shown, r.paycheck.netAnnual, 0.01);
  }
});

test('a Roth contribution reduces the housing budget', () => {
  const none = withK401('roth', 0);
  const twelve = withK401('roth', 12);
  assert.ok(twelve.leftover < none.leftover,
    'money going into a Roth cannot also be available for a mortgage');
  near(none.leftover - twelve.leftover, 2000, 0.01);
});

/* --------------------------------------------------------------------------
 * The ledger cascade
 *
 * "Where every dollar goes" starts at the first dollar, so the ledger runs
 * gross → tax → payroll deductions → take-home → debits. The first half has to
 * reconcile exactly, or the card is telling two different stories about the
 * same paycheck.
 * ------------------------------------------------------------------------ */

test('gross minus tax minus payroll deductions is take-home pay', () => {
  for (const type of ['traditional', 'roth']) {
    const state = createDefaultState();
    state.salary = 200000;
    state.k401 = { pct: 12, mode: 'pct', type };
    const { ledger, paycheck } = compute(state);

    near(ledger.grossMonthly, 200000 / 12, 0.01);
    near(
      ledger.grossMonthly - ledger.deductions.tax - ledger.deductions.payroll,
      paycheck.netMonthly,
      0.01
    );
    near(ledger.netMonthly, paycheck.netMonthly, 0.01);
    near(ledger.deductionsTotal, ledger.deductions.tax + ledger.deductions.payroll, 0.01);
  }
});

test('the tax row is federal, state and FICA only', () => {
  const state = createDefaultState();
  const { ledger, paycheck } = compute(state);
  near(
    ledger.deductions.tax,
    (paycheck.federalTax + paycheck.stateTax + paycheck.ficaTax) / 12,
    0.01
  );
});

test('the payroll row carries the whole 401(k), Roth included', () => {
  const state = createDefaultState();
  state.salary = 150000;
  state.k401 = { pct: 10, mode: 'pct', type: 'roth' };
  const result = compute(state);
  near(result.ledger.deductions.payroll, result.k401Monthly + result.pretaxMonthly, 0.01);
  assert.ok(result.ledger.deductions.payroll > 0);
});

test('take-home minus every debit is the unallocated figure', () => {
  const state = createDefaultState();
  const { ledger } = compute(state);
  const debits = ledger.debits;
  near(ledger.debitsTotal, debits.savings + debits.debts + debits.expenses + debits.housing, 0.01);
  near(ledger.netMonthly - ledger.debitsTotal, ledger.unallocated, 0.01);
});

/* --------------------------------------------------------------------------
 * Mortgage insurance has a ceiling
 *
 * The credit-tier multipliers, unchecked, took the weakest tier past 5% of the
 * loan a year. Published MI rate cards top out around 1.5%-2% at 95% LTV, and
 * conventional mortgage insurance is generally not written below 620 at all, so
 * a figure like that is not a product — it is arithmetic nobody would sell.
 * ------------------------------------------------------------------------ */

test('no credit tier can be quoted a PMI rate above the cap', () => {
  for (const credit of Object.keys(CREDIT_BANDS)) {
    for (const downPct of [1, 3, 5, 10, 15, 19.9]) {
      const state = createDefaultState();
      state.credit = credit;
      state.downpayment = 10000;
      const model = housingModel(state);
      const price = 10000 / (downPct / 100);
      const { pmiRate } = model.paymentAt(price);
      assert.ok(pmiRate <= PMI_RATE_CAP + 1e-9,
        `${credit} at ${downPct}% down quotes ${pmiRate.toFixed(2)}%`);
      assert.ok(pmiRate > 0, `${credit} at ${downPct}% down should carry PMI`);
    }
  }
});

test('the cap binds only where it should', () => {
  // Strong credit is nowhere near it; the weakest tier is held by it.
  const at = (credit, downPct) => {
    const state = createDefaultState();
    state.credit = credit;
    state.downpayment = 10000;
    return housingModel(state).paymentAt(10000 / (downPct / 100)).pmiRate;
  };
  assert.ok(at('800', 5) < 0.5, 'excellent credit at 5% down should be well under 0.5%');
  assert.ok(at('740', 5) < 0.6);
  assert.equal(at('300', 3), PMI_RATE_CAP);
  assert.ok(at('300', 15) < PMI_RATE_CAP, 'a bigger deposit should still cost less');
});

test('rates line up with the survey they are anchored to', () => {
  // The 740-799 tier sits at the PMMS 30-year figure, and the 15-year discount
  // is the gap the same survey week reported.
  assert.equal(CREDIT_BANDS['740'].rate30, 6.95);
  assert.equal(rateForTerm(CREDIT_BANDS['740'], 15), 6.95 - 0.69);
  // Better credit is cheaper, worse credit dearer, with no ties.
  const order = ['800', '740', '670', '580', '300'].map((k) => CREDIT_BANDS[k].rate30);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], 'rates must rise as credit falls');
});
