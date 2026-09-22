/**
 * Tests for the saved-view comparison.
 *
 * The comparison is the one place two different people's — or two different
 * moods' — numbers sit side by side, so the thing worth pinning is that each
 * column is internally consistent and that a difference is a difference in the
 * thing named, not in something two rows away.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compareLedgers, COMPARE_ROWS, COMPARE_LIMIT } from '../assets/js/compare.js';
import { compute } from '../assets/js/calc.js';
import { createDefaultState, hydrate, serialize } from '../assets/js/state.js';

const near = (actual, expected, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}, got ${actual}`);

const row = (table, key) => table.rows.find((r) => r.key === key);

const entry = (name, mutate = () => {}) => {
  const state = createDefaultState();
  mutate(state);
  return { id: name, name, state };
};

/* -------------------------------------------------------------------------- */

test('two identical views differ in nothing', () => {
  const table = compareLedgers([entry('A'), entry('B')]);
  assert.equal(table.columns.length, 2);
  assert.equal(table.diffable, true);
  for (const r of table.rows) {
    near(r.diff, 0, 0.01);
    near(r.values[0], r.values[1], 0.01);
  }
});

test('every row is present, in ledger order', () => {
  const table = compareLedgers([entry('A')]);
  assert.deepEqual(table.rows.map((r) => r.key), COMPARE_ROWS.map((r) => r.key));
  // Gross comes before take-home, which comes before what take-home is spent on.
  const order = table.rows.map((r) => r.key);
  assert.ok(order.indexOf('gross') < order.indexOf('tax'));
  assert.ok(order.indexOf('tax') < order.indexOf('net'));
  assert.ok(order.indexOf('net') < order.indexOf('housing'));
  assert.ok(order.indexOf('housing') < order.indexOf('unallocated'));
});

test('each column reconciles on its own', () => {
  const views = [
    entry('Base'),
    entry('Big earner', (s) => { s.salary = 400000; }),
    entry('Roth', (s) => { s.k401 = { pct: 15, mode: 'pct', type: 'roth' }; })
  ];
  const table = compareLedgers(views);

  table.columns.forEach((column, i) => {
    const v = column.values;
    near(v.gross - v.tax - v.payroll, v.net, 0.01);
    near(v.savings + v.debts + v.expenses + v.housing, v.debitsTotal, 0.01);
    near(v.net - v.debitsTotal, v.unallocated, 0.01);
    // And the table's own rows agree with the column they came from.
    for (const r of table.rows) near(r.values[i], v[r.key], 0.0001);
  });
});

test('a bigger 401(k) shows up as payroll up and take-home down', () => {
  const table = compareLedgers([
    entry('8%', (s) => { s.salary = 200000; s.k401 = { pct: 8, mode: 'pct', type: 'traditional' }; }),
    entry('20%', (s) => { s.salary = 200000; s.k401 = { pct: 20, mode: 'pct', type: 'traditional' }; })
  ]);

  // 12 more points of a $200,000 salary is $2,000 a month into the account.
  near(row(table, 'payroll').diff, 2000, 1);
  assert.ok(row(table, 'net').diff < 0, 'take-home must fall');
  assert.ok(row(table, 'gross').diff === 0, 'gross pay is untouched');
  // Traditional, so the tax bill falls as well — which is exactly the sort of
  // second-order effect the single price figure hides.
  assert.ok(row(table, 'tax').diff < 0, 'traditional lowers the tax too');

  // At this salary both scenarios are held to 28% of gross, so the price does
  // not move at all — the rule is binding, not the paycheck. Two views with an
  // identical headline for a reason you cannot see in the headline is the whole
  // argument for comparing the ledger rather than the price.
  near(row(table, 'price').diff, 0, 1);
  assert.ok(table.columns.every((c) => c.cappedByRule), 'both are capped by the rule');
  assert.ok(row(table, 'unallocated').diff !== 0, 'the difference lands in unallocated income');
});

test('below the 28% cap, a bigger 401(k) does buy less house', () => {
  const table = compareLedgers([
    entry('8%', (s) => { s.salary = 120000; s.k401 = { pct: 8, mode: 'pct', type: 'traditional' }; }),
    entry('20%', (s) => { s.salary = 120000; s.k401 = { pct: 20, mode: 'pct', type: 'traditional' }; })
  ]);
  assert.equal(table.columns[1].cappedByRule, false);
  assert.ok(row(table, 'price').diff < 0, 'here the paycheck is what binds');
  assert.ok(row(table, 'housing').diff < 0);
});

test('clearing a debt moves the debt row by exactly that debt', () => {
  const withDebt = entry('As things are');
  const cleared = entry('Car paid off', (s) => {
    s.debtItems = s.debtItems.map((item, i) => (i === 0 ? { ...item, excluded: true } : item));
  });
  const removed = Number(withDebt.state.debtItems[0].value);
  assert.ok(removed > 0, 'the fixture needs a debt to clear');

  const table = compareLedgers([withDebt, cleared]);
  near(row(table, 'debts').diff, -removed, 1);
  near(row(table, 'net').diff, 0, 0.01);
  assert.ok(row(table, 'housing').diff > 0, 'the freed payment goes to housing');
  assert.ok(row(table, 'price').diff > 0);
});

test('a view running a what-if price is compared on that price', () => {
  const asking = 420000;
  const whatIf = entry('That house on Elm', (s) => {
    s.priceTestMode = 'manual';
    s.testPrice = String(asking);
  });
  const table = compareLedgers([entry('Estimate'), whatIf]);

  assert.equal(table.columns[1].usingTestPrice, true);
  assert.equal(table.columns[0].usingTestPrice, false);
  near(row(table, 'price').values[1], asking, 1);

  // The housing row and the price row have to describe the same house.
  const result = compute(whatIf.state);
  near(row(table, 'housing').values[1], result.ledger.payment.total, 0.01);
  assert.notEqual(Math.round(result.price), asking);
});

test('the difference column only appears when a difference is unambiguous', () => {
  assert.equal(compareLedgers([entry('A')]).diffable, false);
  assert.equal(compareLedgers([entry('A'), entry('B')]).diffable, true);
  assert.equal(compareLedgers([entry('A'), entry('B'), entry('C')]).diffable, false);
  for (const r of compareLedgers([entry('A'), entry('B'), entry('C')]).rows) {
    assert.equal(r.diff, null);
  }
});

test('more columns than fit are dropped, not thrown', () => {
  const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => entry(n));
  const table = compareLedgers(many);
  assert.equal(table.columns.length, COMPARE_LIMIT);
  assert.deepEqual(table.columns.map((c) => c.name), ['A', 'B', 'C', 'D']);
  for (const r of table.rows) assert.equal(r.values.length, COMPARE_LIMIT);
});

test('nothing to compare is not an error', () => {
  for (const input of [[], undefined, null, 'nonsense']) {
    const table = compareLedgers(input);
    assert.equal(table.columns.length, 0);
    assert.equal(table.diffable, false);
    for (const r of table.rows) assert.deepEqual(r.values, []);
  }
});

test('a name from storage is carried through untouched, however hostile', () => {
  // Names are sanitised on the way into storage and rendered with textContent;
  // this pins that the comparison itself neither trusts nor mangles them.
  const nasty = '<img src=x onerror=alert(1)>';
  const stored = hydrate(serialize(createDefaultState()));
  const table = compareLedgers([{ id: 'x', name: nasty, state: stored }]);
  assert.equal(table.columns[0].name, nasty);
  assert.ok(Number.isFinite(table.columns[0].values.price));
});

test('a view saved before the comparison existed still compares', () => {
  // Round-tripping through the storage format is how every real view arrives.
  const state = createDefaultState();
  state.salary = 95000;
  const table = compareLedgers([
    { id: 'stored', name: 'From storage', state: hydrate(serialize(state)) },
    { id: 'live', name: 'On screen now', state, isCurrent: true }
  ]);
  assert.equal(table.columns[1].isCurrent, true);
  for (const r of table.rows) near(r.diff, 0, 0.01);
});
