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
import { BRACKETS, CREDIT_BANDS, SS_WAGE_BASE, STATE_DATA } from '../assets/js/data.js';
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
  // amount taken after tax.
  assert.ok(b.housingBudget > a.housingBudget);
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
