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

import { compute } from './calc.js';

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
  { key: 'tax', label: 'Tax', group: 'deduction', sign: -1 },
  { key: 'payroll', label: '401(k) & pre-tax deductions', group: 'deduction', sign: -1 },
  { key: 'net', label: 'Monthly take-home pay', group: 'subtotal', sign: 0 },
  { key: 'savings', label: 'Savings (post-tax)', group: 'debit', sign: 0 },
  { key: 'debts', label: 'Debts', group: 'debit', sign: 0 },
  { key: 'expenses', label: 'Other recurring expenses', group: 'debit', sign: 0 },
  { key: 'housing', label: 'Housing payment', group: 'debit', sign: 0 },
  { key: 'debitsTotal', label: 'Total monthly debits', group: 'total', sign: 0 },
  { key: 'unallocated', label: 'Unallocated income', group: 'total', sign: 0 }
];

/** Every figure one column of the table needs, from one saved state. */
function columnFor(entry) {
  const result = compute(entry.state);
  const { ledger } = result;

  return {
    id: entry.id,
    name: entry.name,
    isCurrent: Boolean(entry.isCurrent),

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
    return {
      ...row,
      values,
      diff: diffable ? values[1] - values[0] : null
    };
  });

  return { columns, rows, diffable };
}
