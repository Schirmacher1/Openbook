/**
 * Tests for the published rules of thumb. These pin each benchmark to the
 * figure its source actually states, so a refactor can't quietly restate
 * someone else's advice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BENCHMARKS, evaluateBenchmarks, scoreBenchmarks, readiness } from '../assets/js/guidance.js';
import { compute, housingModel, solvePrice } from '../assets/js/calc.js';
import { createDefaultState } from '../assets/js/state.js';

const near = (actual, expected, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}, got ${actual}`);

const find = (evaluated, id) => evaluated.find((b) => b.id === id);

/* -------------------------------------------------------------------------- */

test('every benchmark is attributed and explained', () => {
  for (const benchmark of BENCHMARKS) {
    assert.ok(benchmark.name, `${benchmark.id} needs a name`);
    assert.ok(benchmark.rule, `${benchmark.id} needs its rule stated`);
    assert.ok(benchmark.note, `${benchmark.id} needs an explanation`);
    assert.ok(['string', 'function'].includes(typeof benchmark.note), `${benchmark.id} has an odd note`);
    // Openbook is our own line; every borrowed rule must name its source.
    if (!benchmark.isYou) assert.ok(benchmark.source, `${benchmark.id} must credit a source`);
  }
});

test('Ramsey: 25% of monthly take-home pay', () => {
  const state = createDefaultState();
  const result = compute(state);
  const ramsey = find(evaluateBenchmarks(result, state), 'ramsey');
  near(ramsey.budget, result.paycheck.netMonthly * 0.25, 0.01);
  near(ramsey.shareOfTakeHome, 0.25, 0.0001);
});

test('Ramsey is priced on a 15-year loan even when the form says 30', () => {
  const state = createDefaultState();
  state.term = 30;
  const result = compute(state);
  const ramsey = find(evaluateBenchmarks(result, state), 'ramsey');

  // The rule specifies 15 years, so the price must be solved on 15 years.
  const fifteen = housingModel({ ...state, term: 15 });
  near(ramsey.price, solvePrice(ramsey.budget, fifteen), 2);

  // A 15-year payment is higher, so the same budget buys less house than it
  // would over 30 years — the whole reason Ramsey's number comes out lowest.
  const thirty = housingModel({ ...state, term: 30 });
  assert.ok(ramsey.price < solvePrice(ramsey.budget, thirty));
});

test('The Money Guy: 25% of monthly gross income', () => {
  const state = createDefaultState();
  const result = compute(state);
  const mg = find(evaluateBenchmarks(result, state), 'moneyguy');
  near(mg.budget, result.grossMonthly * 0.25, 0.01);
  near(mg.shareOfGross, 0.25, 0.0001);
});

test('the cost-burden line sits at 30% of gross and is marked as a ceiling', () => {
  const state = createDefaultState();
  const result = compute(state);
  const hud = find(evaluateBenchmarks(result, state), 'hud');
  near(hud.budget, result.grossMonthly * 0.30, 0.01);
  assert.ok(hud.isCeiling, 'the cost-burden line is a warning, not a target');
});

test('a rule measured on gross allows more than the same percentage of take-home', () => {
  const state = createDefaultState();
  const result = compute(state);
  const evaluated = evaluateBenchmarks(result, state);
  // Both are "25%", but of different things — the point of showing them together.
  assert.ok(find(evaluated, 'moneyguy').budget > find(evaluated, 'ramsey').budget);
});

test('the verdict compares the payment you are actually contemplating', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 900000; // well past anything the rules allow
  const result = compute(state);
  const evaluated = evaluateBenchmarks(result, state);

  for (const benchmark of evaluated.filter((b) => !b.isYou)) {
    assert.ok(!benchmark.fits, `${benchmark.id} should not pass at a $900k test price`);
    near(benchmark.over, result.ledger.payment.total - benchmark.budget, 0.01);
  }
  assert.equal(scoreBenchmarks(evaluated).passed, 0);
});

test('a modest plan clears every rule', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 120000;
  const evaluated = evaluateBenchmarks(compute(state), state);
  const score = scoreBenchmarks(evaluated);
  assert.equal(score.passed, score.total);
});

test('scoring counts the guidance rules only — not Openbook, not the ceilings', () => {
  const state = createDefaultState();
  const evaluated = evaluateBenchmarks(compute(state), state);
  const score = scoreBenchmarks(evaluated);

  const ceilings = evaluated.filter((b) => b.isCeiling).length;
  assert.ok(ceilings >= 2, 'the cost-burden line and the approval limit are both ceilings');
  assert.equal(score.total, evaluated.length - 1 - ceilings);

  // Coming in under a limit is not an achievement, so it earns no credit.
  assert.ok(score.passed <= score.total);
  assert.ok(evaluated.find((b) => b.id === 'approval').isCeiling);
  assert.ok(evaluated.find((b) => b.id === 'hud').isCeiling);
});

test('a breached ceiling is reported separately from a missed rule', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 2_000_000; // past everything, approval included
  const score = scoreBenchmarks(evaluateBenchmarks(compute(state), state));

  assert.equal(score.passed, 0);
  assert.equal(score.ceilingsBreached.length, 2);
  assert.ok(score.ceilingsBreached.some((b) => b.id === 'approval'));
});

test('a plan inside every rule breaches no ceiling', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 120000;
  const score = scoreBenchmarks(evaluateBenchmarks(compute(state), state));
  assert.equal(score.passed, score.total);
  assert.equal(score.ceilingsBreached.length, 0);
});

/* -------------------------------------------------------------------------- */

test('readiness reports an unentered emergency fund as unknown, not as a failure', () => {
  const state = createDefaultState();
  state.emergencyFund = 0;
  const check = readiness(compute(state), state).find((c) => c.id === 'emergency');
  assert.equal(check.status, 'unknown');
  assert.match(check.detail, /three months/i);
});

test('readiness grades the emergency fund against post-purchase essentials', () => {
  const state = createDefaultState();
  const result = compute(state);
  const essentials = result.ledger.payment.total + result.debtsMonthly + result.expensesTotalMonthly;

  state.emergencyFund = essentials * 6.5;
  assert.equal(readiness(compute(state), state).find((c) => c.id === 'emergency').status, 'pass');

  state.emergencyFund = essentials * 1;
  assert.equal(readiness(compute(state), state).find((c) => c.id === 'emergency').status, 'caution');
});

test('readiness flags outstanding debt and clears a debt-free buyer', () => {
  const withDebt = createDefaultState();
  assert.equal(readiness(compute(withDebt), withDebt).find((c) => c.id === 'debt').status, 'caution');

  const debtFree = createDefaultState();
  debtFree.debtItems = [];
  assert.equal(readiness(compute(debtFree), debtFree).find((c) => c.id === 'debt').status, 'pass');
});

test('readiness passes a 20% down payment whichever home this is', () => {
  for (const firstHome of [true, false]) {
    const state = createDefaultState();
    state.firstHome = firstHome;
    state.priceTestMode = 'manual';
    state.testPrice = state.downpayment * 5; // exactly 20%
    assert.equal(readiness(compute(state), state).find((c) => c.id === 'down').status, 'pass');
  }
});

test("the 3% floor is a first-home allowance, not a general one", () => {
  const at10 = (firstHome) => {
    const state = createDefaultState();
    state.firstHome = firstHome;
    state.priceTestMode = 'manual';
    state.testPrice = state.downpayment * 10; // 10% down
    return readiness(compute(state), state).find((c) => c.id === 'down');
  };

  // A first-time buyer at 10% is inside 3/5/25 — allowed, with PMI to pay.
  const first = at10(true);
  assert.equal(first.status, 'caution');
  assert.match(first.detail, /as little as 3% down on a first home/);

  // A repeat buyer at 10% is below The Money Guy's 20%, so it isn't a caution.
  const repeat = at10(false);
  assert.equal(repeat.status, 'fail');
  assert.match(repeat.detail, /first home only/);
  assert.doesNotMatch(repeat.label, /first home/);
});

test('a repeat buyer below 20% fails even at 19%', () => {
  const state = createDefaultState();
  state.firstHome = false;
  state.priceTestMode = 'manual';
  state.testPrice = state.downpayment / 0.19;
  const check = readiness(compute(state), state).find((c) => c.id === 'down');
  assert.equal(check.status, 'fail');
});

test("The Money Guy's note states the branch that applies", () => {
  const first = createDefaultState();
  first.firstHome = true;
  const firstNote = evaluateBenchmarks(compute(first), first).find((b) => b.id === 'moneyguy').note;
  assert.match(firstNote, /at least 3% down/);
  assert.match(firstNote, /five years/);

  const repeat = createDefaultState();
  repeat.firstHome = false;
  const repeatNote = evaluateBenchmarks(compute(repeat), repeat).find((b) => b.id === 'moneyguy').note;
  assert.match(repeatNote, /20% down/);
  assert.match(repeatNote, /five to seven years/);
  assert.match(repeatNote, /first-home allowance only/);
});

test('readiness counts only the 401(k) toward the retirement rate, and says so', () => {
  const state = createDefaultState();
  state.k401 = { pct: 16, mode: 'pct', type: 'traditional' };
  const pass = readiness(compute(state), state).find((c) => c.id === 'retirement');
  assert.equal(pass.status, 'pass');
  assert.match(pass.detail, /Openbook can only see your 401\(k\)|only sees your 401\(k\)/);

  state.k401 = { pct: 3, mode: 'pct', type: 'traditional' };
  assert.equal(readiness(compute(state), state).find((c) => c.id === 'retirement').status, 'caution');
});

test('readiness calls out a severely cost-burdened payment', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = 1500000;
  const check = readiness(compute(state), state).find((c) => c.id === 'share');
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /severely cost burdened/i);
});

test('every readiness check carries a status, a detail and a source', () => {
  const state = createDefaultState();
  for (const check of readiness(compute(state), state)) {
    assert.ok(['pass', 'caution', 'fail', 'unknown'].includes(check.status), `${check.id} has an odd status`);
    assert.ok(check.label && check.detail && check.source, `${check.id} is missing copy`);
  }
});

test('guidance survives an empty state without throwing', () => {
  const state = createDefaultState();
  state.salary = 0;
  state.savingsItems = [];
  state.debtItems = [];
  state.expenseItems = [];
  state.downpayment = 0;
  const result = compute(state);

  for (const benchmark of evaluateBenchmarks(result, state)) {
    assert.ok(Number.isFinite(benchmark.price), `${benchmark.id} produced a bad price`);
    assert.ok(Number.isFinite(benchmark.budget), `${benchmark.id} produced a bad budget`);
  }
  assert.equal(readiness(result, state).length, 5);
});

/* --------------------------------------------------------------------------
 * The retirement check against the IRS limit
 *
 * A percentage target is only reachable while the account can hold it. Above
 * roughly $163,000, 15% of gross is more than §402(g) allows into a 401(k), so
 * a check that kept asking for the rate would be warning people about the law.
 * ------------------------------------------------------------------------ */

const retirementCheck = (state) => readiness(compute(state), state).find((c) => c.id === 'retirement');
const shareCheck = (state) => readiness(compute(state), state).find((c) => c.id === 'share');

const withSalary = (salary, pct) => {
  const state = createDefaultState();
  state.salary = salary;
  state.k401 = { pct, mode: 'pct', type: 'traditional' };
  return state;
};

test('12% of $200k passes: it is all a 401(k) can hold', () => {
  // 15% of $200,000 is $30,000 — $5,500 more than the 2026 limit allows in.
  const check = retirementCheck(withSalary(200000, 12));
  assert.equal(check.status, 'pass');
  assert.match(check.detail, /24,500/);
  assert.match(check.detail, /IRA|taxable/);
});

test('12% of $80k is still short: the limit is nowhere near binding', () => {
  // 15% of $80,000 is $12,000, which fits in a 401(k) with room to spare.
  const check = retirementCheck(withSalary(80000, 12));
  assert.equal(check.status, 'caution');
  assert.match(check.detail, /15% of gross/);
});

test('15% of $80k passes', () => {
  assert.equal(retirementCheck(withSalary(80000, 15)).status, 'pass');
});

test('a maxed-out 401(k) says so in the label', () => {
  const state = createDefaultState();
  state.salary = 300000;
  state.k401 = { pct: 24500 / 12, mode: 'dollar', type: 'traditional' };
  const check = retirementCheck(state);
  assert.equal(check.status, 'pass');
  assert.match(check.label, /IRS limit/);
});

test('the verdict never contradicts the percentage on the label', () => {
  // Salaries either side of the point where the limit starts to bind, at the
  // rate each one's label would print.
  for (const salary of [60000, 120000, 163000, 200000, 400000]) {
    const state = createDefaultState();
    state.salary = salary;
    const capRate = 24500 / salary;
    const rate = Math.min(0.15, capRate) * 100;
    state.k401 = { pct: rate, mode: 'pct', type: 'traditional' };
    const check = retirementCheck(state);
    assert.equal(check.status, 'pass', `${salary} at ${rate.toFixed(1)}% should pass`);
  }
});

/* --------------------------------------------------------------------------
 * The housing-share check
 *
 * Three of the four lines measure gross pay; only Ramsey measures take-home,
 * and his is much the strictest. Failing the whole check on his line alone
 * marked plans that clear every other published figure.
 * ------------------------------------------------------------------------ */

/** A state whose ledger housing payment is a given share of gross. */
const atShareOfGross = (share) => {
  const state = createDefaultState();
  state.salary = 200000;
  state.priceTestMode = 'manual';
  const result = compute(state);
  const target = result.grossMonthly * share;
  // Solve a price whose payment hits the target share.
  state.testPrice = String(Math.round(solvePrice(target, housingModel(state))));
  return state;
};

test('under 25% of gross passes even when Ramsey\'s take-home line is missed', () => {
  const state = atShareOfGross(0.21);
  const result = compute(state);
  const check = shareCheck(state);
  assert.ok(result.housingShareOfTakeHome > 0.25, 'the take-home share must exceed Ramsey\'s 25%');
  assert.equal(check.status, 'pass');
  assert.match(check.detail, /Ramsey/);
  assert.match(check.detail, /strictest/);
});

test('over 25% but under 30% of gross is a caution', () => {
  assert.equal(shareCheck(atShareOfGross(0.27)).status, 'caution');
});

test('over 30% of gross fails: the cost-burden line', () => {
  const check = shareCheck(atShareOfGross(0.34));
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /cost burdened/);
});

test('over half of gross fails as severely cost burdened', () => {
  assert.match(shareCheck(atShareOfGross(0.55)).detail, /severely cost burdened/);
});
