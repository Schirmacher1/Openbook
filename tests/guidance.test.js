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

test('scoring never counts Openbook as one of the rules', () => {
  const state = createDefaultState();
  const evaluated = evaluateBenchmarks(compute(state), state);
  assert.equal(scoreBenchmarks(evaluated).total, evaluated.length - 1);
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

test('readiness passes a 20% down payment and cautions below it', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';

  state.testPrice = state.downpayment * 5; // exactly 20%
  assert.equal(readiness(compute(state), state).find((c) => c.id === 'down').status, 'pass');

  state.testPrice = state.downpayment * 10; // 10%
  assert.equal(readiness(compute(state), state).find((c) => c.id === 'down').status, 'caution');
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
