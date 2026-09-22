/**
 * Tests for the levers — the "what each change is worth" section.
 *
 * Everything here is a claim about someone's money, so the thing worth pinning
 * is that each figure is the real result of the change it describes, and that
 * nothing is asserted from data the calculator was never given.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { levers, debtRateNote } from '../assets/js/levers.js';
import { compute, cashToClose, housingModel } from '../assets/js/calc.js';
import { createDefaultState } from '../assets/js/state.js';
import { CREDIT_BANDS, CLOSING_FEE_PCT, ESCROW_MONTHS_TAX, ESCROW_MONTHS_INSURANCE } from '../assets/js/data.js';

const near = (actual, expected, tolerance = 1, what = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${what ? what + ': ' : ''}expected ~${expected}, got ${actual}`);

const all = (state) => levers(compute(state), state, CREDIT_BANDS);
const find = (state, id) => all(state).find((l) => l.id.startsWith(id));

/* --------------------------------------------------------------------------
 * Clearing a debt
 * ------------------------------------------------------------------------ */

test('clearing a debt is worth exactly what removing it produces', () => {
  const state = createDefaultState();
  const base = compute(state);
  const lever = find(state, 'debt:');

  const without = compute({
    ...state,
    debtItems: state.debtItems.map((d, i) => (i === 0 ? { ...d, excluded: true } : d))
  });
  near(lever.gainPrice, without.price - base.price, 0.01);
  near(lever.gainMonthly, Number(state.debtItems[0].value), 0.01);
});

test('every debt with a payment gets a line, and none without', () => {
  const state = createDefaultState();
  const debts = state.debtItems.filter((d) => !d.excluded && Number(d.value) > 0);
  const lines = all(state).filter((l) => l.kind === 'debt');
  assert.equal(lines.length, debts.length);

  // The zero-payment row in the default state has nothing to free.
  const zero = state.debtItems.find((d) => Number(d.value) === 0);
  assert.ok(zero, 'the fixture needs a zero-value debt');
  assert.ok(!lines.some((l) => l.title.includes(zero.label)));
});

test('a known balance turns the lever into a decision', () => {
  const state = createDefaultState();
  state.debtItems[0].balance = 3100;
  const lever = find(state, 'debt:');
  assert.equal(lever.cost, 3100);
  assert.match(lever.note, /7 more payments/); // 3100 / 450
});

test('without a balance it says what it cannot know, and asserts no cost', () => {
  const state = createDefaultState();
  const lever = find(state, 'debt:');
  assert.equal(lever.cost, null);
  assert.match(lever.note, /Add the balance/);
});

test('when the 28% cap binds, clearing a debt is honest about buying no more house', () => {
  // At this salary the budget is held by the rule, not by what's left over.
  const state = createDefaultState();
  state.salary = 400000;
  const result = compute(state);
  assert.equal(result.cappedByRule, true, 'the fixture needs the cap to bind');

  const lever = levers(result, state, CREDIT_BANDS).find((l) => l.kind === 'debt');
  near(lever.gainPrice, 0, 1);
  assert.match(lever.detail, /wouldn't raise the estimate/);
  assert.ok(lever.gainMonthly > 0, 'the freed payment is still real');
});

test('the rate note never claims to know your rate', () => {
  const note = debtRateNote();
  assert.match(note, /never asks what rate/);
  assert.match(note, /11\.4%/); // the published used-car average
});

/* --------------------------------------------------------------------------
 * Down payment thresholds
 * ------------------------------------------------------------------------ */

test('the 20% lever lands on a deposit that really is 20%', () => {
  const state = createDefaultState();
  const lever = find(state, 'down:20');
  const down = Math.max(0, state.downpayment) + lever.cost;
  const after = compute({ ...state, downpayment: down });

  near(after.payment.downPct, 20, 0.05, 'the solved deposit should sit on 20%');
  near(after.payment.pmi, 0, 0.01, 'and the insurance should be gone');
  near(lever.gainMonthly, compute(state).ledger.payment.pmi, 0.01);
});

test('no down-payment levers once you are already at 20%', () => {
  const state = createDefaultState();
  state.downpayment = 200000;
  assert.equal(compute(state).payment.downPct >= 20, true);
  assert.equal(all(state).some((l) => l.kind === 'down'), false);
});

test('a tier lever only appears when it saves something', () => {
  const state = createDefaultState();
  for (const lever of all(state).filter((l) => l.kind === 'down')) {
    assert.ok(lever.gainMonthly > 0, `${lever.id} claims no saving`);
    assert.ok(lever.cost > 0, `${lever.id} claims no cost`);
  }
});

/* --------------------------------------------------------------------------
 * Credit and term
 * ------------------------------------------------------------------------ */

test('the credit lever moves up a tier, never down', () => {
  const keys = Object.keys(CREDIT_BANDS);
  for (let i = 0; i < keys.length - 1; i++) {
    const state = createDefaultState();
    state.credit = keys[i];
    const lever = find(state, 'credit');
    assert.ok(lever, `${keys[i]} should have a tier above it`);
    assert.ok(lever.gainMonthly > 0, 'a better tier must cost less each month');
    assert.ok(CREDIT_BANDS[keys[i + 1]].rate30 < CREDIT_BANDS[keys[i]].rate30);
  }
});

test('the top credit tier has no lever to pull', () => {
  const state = createDefaultState();
  state.credit = Object.keys(CREDIT_BANDS).at(-1);
  assert.equal(find(state, 'credit'), undefined);
});

test('the 15-year is presented as a trade, and sorts last', () => {
  const state = createDefaultState();
  const list = all(state);
  const term = list.find((l) => l.id === 'term');
  assert.equal(term.kind, 'tradeoff');
  assert.ok(term.gainPrice < 0, 'it buys less house');
  assert.ok(term.gainMonthly < 0, 'and costs more each month');
  assert.equal(list.at(-1).id, 'term', 'a trade belongs after the gains');
  assert.match(term.detail, /interest over the life of the loan falls/);
});

test('no 15-year lever when you are already on one', () => {
  const state = createDefaultState();
  state.term = 15;
  assert.equal(find(state, 'term'), undefined);
});

test('the gains are sorted biggest first, on the rank that ranks them', () => {
  const state = createDefaultState();
  const gains = all(state).filter((l) => l.kind !== 'tradeoff').map((l) => l.rank);
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] <= gains[i - 1] + 0.01, 'levers should descend by what they are worth');
  }
});

/* --------------------------------------------------------------------------
 * Cash to close
 *
 * The down payment used to be the only cash the page modelled, which implied
 * that someone with $40,000 saved can put $40,000 down. They can't.
 * ------------------------------------------------------------------------ */

test('cash to close is the deposit plus fees plus the escrow a lender collects', () => {
  const state = createDefaultState();
  const result = compute(state);
  const cash = result.cash;
  const payment = result.ledger.payment;

  near(cash.down, state.downpayment, 1);
  near(cash.fees, payment.price * (CLOSING_FEE_PCT / 100), 0.01);
  near(cash.escrowTax, payment.tax * ESCROW_MONTHS_TAX, 0.01);
  near(cash.escrowInsurance, payment.insurance * ESCROW_MONTHS_INSURANCE, 0.01);
  near(cash.costs, cash.fees + cash.escrowTax + cash.escrowInsurance + cash.prepaidInterest, 0.01);
  near(cash.total, cash.down + cash.costs, 0.01);
  assert.ok(cash.costs > 0, 'there is always more than the deposit');
});

test('the prepaid interest is charged on the loan, not the price', () => {
  const state = createDefaultState();
  const allCash = compute({ ...state, downpayment: 2_000_000 });
  near(allCash.cash.prepaidInterest, 0, 0.01, 'no loan, no prepaid interest');
  assert.ok(allCash.cash.fees > 0, 'but the fees are still owed');
});

test('cash to close follows the what-if price, like the rest of the page', () => {
  const state = createDefaultState();
  state.priceTestMode = 'manual';
  state.testPrice = '500000';
  const result = compute(state);
  near(result.cash.fees, 500000 * (CLOSING_FEE_PCT / 100), 0.01);
  assert.notEqual(Math.round(result.price), 500000);
});

test('the escrow is this buyer\'s own tax and insurance, not an average', () => {
  const cheap = compute({ ...createDefaultState(), stateCode: 'HI' });  // 0.29% property tax
  const dear = compute({ ...createDefaultState(), stateCode: 'NJ' });   // 2.07%
  assert.ok(dear.cash.escrowTax > cheap.cash.escrowTax * 2,
    'a higher property tax must mean a bigger escrow deposit');
});

test('cashToClose can be called on any payment, standalone', () => {
  const state = createDefaultState();
  const model = housingModel(state);
  const cash = cashToClose(model.paymentAt(400000), model);
  near(cash.down, state.downpayment, 1);
  near(cash.total, cash.down + cash.costs, 0.01);
});

/* --------------------------------------------------------------------------
 * Ordering
 *
 * "More house" and "more house because you put more of your own money in" are
 * not the same claim, and ranking them together would put a transfer of your
 * own cash above clearing a debt.
 * ------------------------------------------------------------------------ */

test('a deposit lever is ranked by what it buys beyond the cash itself', () => {
  const state = createDefaultState();
  const lever = find(state, 'down:20');
  near(lever.rank, lever.gainPrice - lever.cost, 0.01);
  assert.ok(lever.rank < lever.gainPrice, 'the cash put in is not leverage');
  assert.match(lever.note, /your own cash becoming equity/);
});

test('a deposit step that buys nothing says so', () => {
  const state = createDefaultState();
  const lever = all(state).find((l) => l.kind === 'down' && l.rank <= 0);
  if (!lever) return; // not every set of numbers has one
  assert.match(lever.note, /no more house than the cash you put into it/);
  assert.ok(lever.gainMonthly > 0, 'it still cuts the payment');
});

test('clearing a debt is ranked on the whole gain, since that cash does not become equity', () => {
  const state = createDefaultState();
  state.debtItems[0].balance = 3100;
  const lever = find(state, 'debt:');
  near(lever.rank, lever.gainPrice, 0.01);
});

test('a debt beats a deposit step of the same headline size', () => {
  const state = createDefaultState();
  const list = all(state).filter((l) => l.kind !== 'tradeoff');
  const firstDown = list.findIndex((l) => l.kind === 'down');
  const lastDebt = list.map((l) => l.kind).lastIndexOf('debt');
  assert.ok(lastDebt < firstDown || firstDown === -1, 'debts come before deposit steps here');
});
