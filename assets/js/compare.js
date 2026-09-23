/**
 * Openbook — comparing saved views.
 *
 * Saving several scenarios is only half the point; the other half is putting
 * them next to each other. This takes named states and returns the ledger for
 * each one, row for row, in the order the page already shows it: gross pay,
 * tax, payroll deductions, take-home, then everything you spend it on.
 *
 * Rows rather than prose because the interesting part is usually two rows down
 * from the headline — a scenario that buys less house because the 401(k) went
 * up reads very differently from one that buys less house because the car loan
 * came back, and a single price figure can't tell you which happened.
 *
 * Pure functions — no DOM, no storage. The page renders what these return.
 */

import { compute, parseNum, itemAmount } from './calc.js';

/**
 * Four columns is the practical limit: a fifth stops fitting on a laptop, and
 * on a phone you are already scrolling sideways to read the third.
 */
export const COMPARE_LIMIT = 4;

/**
 * The ledger, in ledger order. `sign` is -1 on the two rows the ledger card
 * itself prints as negatives — the ones taken out before the money is yours —
 * so the renderer can match the card without knowing what each key means.
 */
export const COMPARE_ROWS = [
  { key: 'price', label: 'Home price it supports', group: 'outcome', sign: 0 },
  { key: 'gross', label: 'Monthly gross pay', group: 'income', sign: 0 },
  { key: 'tax', label: 'Tax', group: 'deduction', sign: -1, opens: true },
  { key: 'payroll', label: '401(k) & pre-tax deductions', group: 'deduction', sign: -1, opens: true },
  { key: 'net', label: 'Monthly take-home pay', group: 'subtotal', sign: 0 },
  { key: 'savings', label: 'Savings (post-tax)', group: 'debit', sign: 0, opens: true },
  { key: 'debts', label: 'Debts', group: 'debit', sign: 0, opens: true },
  { key: 'expenses', label: 'Other recurring expenses', group: 'debit', sign: 0, opens: true },
  { key: 'housing', label: 'Housing payment', group: 'debit', sign: 0, opens: true },
  { key: 'debitsTotal', label: 'Total monthly debits', group: 'total', sign: 0 },
  { key: 'unallocated', label: 'Unallocated income', group: 'total', sign: 0 }
];

/* ---------------------------------------------------------------------------
 * What's inside a row
 *
 * A total that differs is the beginning of the question, not the answer:
 * "Debts: $730 against $280" invites "which debt?". So every row that has
 * parts can be opened to show them, one line per line item.
 * ------------------------------------------------------------------------- */

/** One line item, as it appears inside an openable row. */
function itemChild(item, netMonthly) {
  return {
    label: item.label || 'Untitled',
    // An excluded row is still in the list, and still worth showing — "the car
    // loan, ticked off" is exactly the comparison people come here to make.
    amount: item.excluded ? 0 : itemAmount(item, netMonthly),
    note: item.excluded
      ? 'excluded'
      : item.mode === 'pct' ? `${parseNum(item.value)}% of take-home` : ''
  };
}

/**
 * The parts of every openable row, for one view.
 *
 * `key` marks a part the calculation derives (tax, the payment); everything
 * else is a line the person typed, and is matched across views by its label.
 */
function partsFor(state, result) {
  const net = result.paycheck.netMonthly;
  const payment = result.ledger.payment;

  const payroll = [{
    key: 'k401',
    label: '401(k)',
    amount: result.k401Monthly,
    note: result.isTraditional ? 'traditional' : 'Roth'
  }];
  for (const item of state.savingsItems) {
    if (item.pretax && item.mode !== 'pct') payroll.push(itemChild(item, net));
  }
  for (const item of state.expenseItems) {
    if (item.pretax) payroll.push(itemChild(item, net));
  }

  return {
    tax: [
      { key: 'federal', label: 'Federal income tax', amount: result.paycheck.federalTax / 12 },
      { key: 'state', label: 'State income tax', amount: result.paycheck.stateTax / 12 },
      { key: 'fica', label: 'Social Security & Medicare', amount: result.paycheck.ficaTax / 12 }
    ],
    payroll,
    savings: state.savingsItems
      .filter((item) => !(item.pretax && item.mode !== 'pct'))
      .map((item) => itemChild(item, net)),
    debts: state.debtItems.map((item) => itemChild(item, net)),
    expenses: state.expenseItems.filter((item) => !item.pretax).map((item) => itemChild(item, net)),
    housing: [
      { key: 'pi', label: 'Principal & interest', amount: payment.pi },
      { key: 'proptax', label: 'Property tax', amount: payment.tax },
      { key: 'insurance', label: 'Insurance', amount: payment.insurance },
      { key: 'pmi', label: 'Mortgage insurance (PMI)', amount: payment.pmi },
      { key: 'hoa', label: 'HOA dues', amount: payment.hoa }
    ]
  };
}

/**
 * Line up one row's parts across every column.
 *
 * Derived parts match on their key. A typed line matches on its label, not its
 * stored id: two views can hold the same "Car loan" with different ids — one
 * arrived in a share code, the other was typed — and to the reader they are
 * plainly the same debt. A label used twice inside one view stays two rows.
 *
 * A column with no such line at all gets `null` rather than zero, because "not
 * in this scenario" and "zero this month" are different answers.
 */
function mergeParts(perColumn, diffable) {
  const order = [];
  const byKey = new Map();
  const width = perColumn.length;

  perColumn.forEach((parts, column) => {
    const seen = new Map();
    for (const part of parts) {
      const base = part.key ? `k:${part.key}` : `l:${part.label.trim().toLowerCase()}`;
      const nth = (seen.get(base) || 0) + 1;
      seen.set(base, nth);
      const key = nth > 1 ? `${base}#${nth}` : base;

      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: part.label,
          derived: Boolean(part.key),
          values: new Array(width).fill(null),
          notes: new Array(width).fill('')
        });
        order.push(key);
      }
      const child = byKey.get(key);
      child.values[column] = part.amount;
      child.notes[column] = part.note || '';
    }
  });

  return order
    .map((key) => byKey.get(key))
    // A derived part that is zero everywhere is noise — no PMI in any of these
    // scenarios is not a difference. A line someone typed stays, even at zero:
    // it is in their list, and they put it there.
    .filter((child) => !(child.derived && child.values.every((v) => !v)))
    .map((child) => ({
      ...child,
      diff: diffable ? (child.values[1] ?? 0) - (child.values[0] ?? 0) : null
    }));
}

/** Every figure one column of the table needs, from one saved state. */
function columnFor(entry) {
  const result = compute(entry.state);
  const { ledger } = result;

  return {
    id: entry.id,
    name: entry.name,
    isCurrent: Boolean(entry.isCurrent),
    parts: partsFor(entry.state, result),

    // A view running a what-if price has a ledger built around that price, not
    // around its own estimate. Printing the estimate here while the housing row
    // below came from a different price would be two answers to one question.
    usingTestPrice: ledger.usingTestPrice,
    cappedByRule: result.cappedByRule,

    values: {
      price: ledger.payment.price,
      gross: ledger.grossMonthly,
      tax: ledger.deductions.tax,
      payroll: ledger.deductions.payroll,
      net: ledger.netMonthly,
      savings: ledger.debits.savings,
      debts: ledger.debits.debts,
      expenses: ledger.debits.expenses,
      housing: ledger.debits.housing,
      debitsTotal: ledger.debitsTotal,
      unallocated: ledger.unallocated
    }
  };
}

/**
 * The comparison table.
 *
 * `entries` are `{ id, name, state, isCurrent? }`. Anything past COMPARE_LIMIT
 * is dropped rather than rejected — the caller stops you selecting a fifth, and
 * a stored library that somehow holds more shouldn't throw on the way in.
 *
 * A difference column appears only with exactly two columns, where "the
 * difference" means something. With three or more it would have to pick a
 * baseline, and the reader can't see which one it picked.
 */
export function compareLedgers(entries) {
  const columns = (Array.isArray(entries) ? entries : []).slice(0, COMPARE_LIMIT).map(columnFor);
  const diffable = columns.length === 2;

  const rows = COMPARE_ROWS.map((row) => {
    const values = columns.map((column) => column.values[row.key]);
    const children = row.opens
      ? mergeParts(columns.map((column) => column.parts[row.key] || []), diffable)
      : [];
    return {
      ...row,
      values,
      diff: diffable ? values[1] - values[0] : null,
      // `opens` says the row has parts; an empty list means this particular
      // comparison has none to show, so the renderer leaves off the toggle.
      children,
      opens: Boolean(row.opens) && children.length > 0
    };
  });

  return { columns, rows, diffable };
}
