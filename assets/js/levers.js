/**
 * Openbook — what each lever is worth.
 *
 * Not advice. Every line here is the same calculation run again with one thing
 * changed, so the answer is in the only unit that settles an argument about a
 * house: dollars of house, and dollars a month.
 *
 * The rule this module follows is that it never asserts anything it cannot
 * compute from what the person entered. Openbook does not know the interest
 * rate on your car loan, so it does not tell you what clearing it saves in
 * interest; it tells you what the freed payment is worth in house, which it
 * knows exactly, and leaves the rate comparison as the note it is.
 *
 * Pure functions — no DOM, no storage.
 */

import { compute, housingModel, solvePrice, parseNum } from './calc.js';
import { AUTO_LOAN_APR, PMI_TIERS } from './data.js';

/** Re-run the whole calculation with one thing changed. */
const withChange = (state, change) => compute({ ...state, ...change });

/**
 * The down payment at which the solved price lands on a given loan-to-value.
 *
 * It has to be solved rather than multiplied out: raising the down payment
 * raises the price the same budget supports, so "20% of the price" is a moving
 * target. price(D) - D/(ratio) falls as D rises, so a bisection is stable.
 */
function downForRatio(budget, state, ratioPct) {
  const priceAt = (down) => {
    const model = housingModel({ ...state, downpayment: down });
    return budget > 0 ? solvePrice(budget, model) : down;
  };

  let lo = Math.max(0, state.downpayment);
  let hi = Math.max(lo, priceAt(lo)); // all cash is always enough
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (priceAt(mid) * (ratioPct / 100) > mid) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Clearing a debt.
 *
 * The payment is what a lender counts and what the paycheck feels, so a small
 * balance attached to a large payment is the most leverage in the whole model:
 * it is the one change that buys more house without earning a dollar more.
 * When the balance is known the cost of pulling the lever is known too, which
 * is the difference between a suggestion and a decision.
 */
function debtLevers(result, state) {
  const out = [];

  state.debtItems.forEach((item, index) => {
    const payment = parseNum(item.value);
    if (item.excluded || payment <= 0) return;

    const after = withChange(state, {
      debtItems: state.debtItems.map((d, i) => (i === index ? { ...d, excluded: true } : d))
    });

    const balance = parseNum(item.balance);
    const gainPrice = after.price - result.price;
    const months = balance > 0 ? Math.ceil(balance / payment) : 0;

    out.push({
      id: `debt:${item.id}`,
      kind: 'debt',
      title: `Clear ${item.label || 'this debt'}`,
      gainPrice,
      gainMonthly: payment,
      cost: balance > 0 ? balance : null,
      costLabel: balance > 0 ? 'to pay it off' : null,
      // The two cases are genuinely different advice, so they get different words.
      detail: gainPrice > 1
        ? `That ${money(payment)} a month is money a lender counts against you and your paycheck never sees. Freeing it raises what you can afford by ${money(gainPrice)}.`
        : `Freeing ${money(payment)} a month wouldn't raise the estimate: your housing budget is already held at 28% of gross, not by what's left over. It would go straight into savings, or into the down payment.`,
      note: balance > 0
        ? `${money(balance)} left at ${money(payment)} a month is about ${months} more payment${months === 1 ? '' : 's'}.`
        : 'Add the balance left on this debt and Openbook can tell you what clearing it costs, not just what it buys.',
      rank: gainPrice
    });
  });

  return out;
}

/** Down payment thresholds: the next mortgage-insurance tier, and 20%. */
function downPaymentLevers(result, state) {
  const out = [];
  const downPct = result.ledger.payment.downPct;
  if (!(downPct < 20) || result.housingBudget <= 0) return out;

  // The tier boundaries mortgage insurance actually prices at, plus the one
  // where it stops altogether.
  const targets = PMI_TIERS.filter((t) => t > downPct + 0.05);

  for (const target of targets) {
    const down = downForRatio(result.housingBudget, state, target);
    const extra = down - Math.max(0, state.downpayment);
    if (extra <= 0) continue;

    const after = withChange(state, { downpayment: down });
    const saved = result.ledger.payment.pmi - after.payment.pmi;

    // Only worth a line if it removes or meaningfully cuts the insurance.
    if (target < 20 && saved < 5) continue;

    const months = saved > 0 ? Math.ceil(extra / saved) : 0;
    const gain = after.price - result.price;

    // Most of that "more house" is the deposit itself, simply turned into
    // equity. What the lever is actually worth is the borrowing the freed
    // insurance supports — and saying otherwise would rank a transfer of your
    // own money above clearing a debt.
    const leverage = gain - extra;

    out.push({
      id: `down:${target}`,
      kind: 'down',
      title: target >= 20 ? 'Put 20% down' : `Get the deposit to ${target}%`,
      gainPrice: gain,
      gainMonthly: saved,
      cost: extra,
      costLabel: 'more in the deposit',
      detail: target >= 20
        ? `At 20% the mortgage insurance stops: ${money(result.ledger.payment.pmi)} a month back, for good.`
        : `${target}% is the next tier mortgage insurance prices at, worth ${money(saved)} a month.`,
      note: (leverage > 0
        ? `${money(extra)} of that extra house is just your own cash becoming equity — the part the freed `
          + `insurance actually buys is ${money(leverage)}. `
        : 'It buys no more house than the cash you put into it: the insurance saved doesn\'t cover the tax and '
          + 'insurance on a bigger place. What it does do is cut the payment on whatever you buy. ')
        + (months > 0 && months < 600
          ? `The deposit pays itself back in about ${months} month${months === 1 ? '' : 's'} of insurance you no longer owe, and it has to be cash at closing on top of the closing fees.`
          : 'It has to be cash at closing, on top of the closing fees.'),
      rank: leverage
    });
  }

  return out;
}

/** One credit tier up. */
function creditLever(result, state, bands) {
  const keys = Object.keys(bands);
  const index = keys.indexOf(String(state.credit));
  if (index < 0 || index === keys.length - 1) return []; // unknown tier, or already the top one

  const better = keys[index + 1];
  const after = withChange(state, { credit: better });
  const here = housingModel({ ...state, credit: better }).paymentAt(result.ledger.payment.price);
  const saved = result.ledger.payment.total - here.total;
  if (saved <= 1) return [];

  return [{
    id: 'credit',
    kind: 'credit',
    title: `Reach the ${bands[better].label.split(' ')[0]} credit tier`,
    gainPrice: after.price - result.price,
    gainMonthly: saved,
    cost: null,
    costLabel: null,
    detail: `${bands[better].rate30.toFixed(2)}% instead of ${bands[String(state.credit)].rate30.toFixed(2)}%`
      + `${here.pmi < result.ledger.payment.pmi ? ', and cheaper mortgage insurance too' : ''}`
      + ` — ${money(saved)} a month on this same house.`,
    note: 'Openbook prices credit in tiers, so this is what crossing the boundary is worth, not what one point is.',
    rank: after.price - result.price
  }];
}

/** The 15-year trade: less house now, far less interest over the loan. */
function termLever(result, state) {
  if (Number(state.term) !== 30) return [];

  const after = withChange(state, { term: 15 });
  const here = housingModel({ ...state, term: 15 }).paymentAt(result.ledger.payment.price);
  const interest30 = result.ledger.payment.pi * 360 - result.ledger.payment.loan;
  const interest15 = here.pi * 180 - here.loan;

  return [{
    id: 'term',
    kind: 'tradeoff',
    title: 'Take the 15-year instead',
    gainPrice: after.price - result.price,
    gainMonthly: -(here.total - result.ledger.payment.total),
    cost: null,
    costLabel: null,
    detail: `On this house the payment goes up ${money(here.total - result.ledger.payment.total)} a month, `
      + `and the interest over the life of the loan falls from ${money(interest30)} to ${money(interest15)}.`,
    note: `Held to the same monthly budget it buys ${money(Math.abs(after.price - result.price))} less house — `
      + 'which is why Ramsey\'s line, priced on 15 years, sits lowest of all of them.',
    rank: -1 // a trade, not a gain: it goes last
  }];
}

/**
 * Every lever, biggest first, with the trades after the gains.
 *
 * `bands` is passed in rather than imported so the caller decides what tier
 * table is in play — the same reason the rest of the engine takes its data.
 */
export function levers(result, state, bands) {
  const all = [
    ...debtLevers(result, state),
    ...downPaymentLevers(result, state),
    ...creditLever(result, state, bands),
    ...termLever(result, state)
  ];

  // Gains first, biggest leverage down; the trades afterwards, because they are
  // a different question from "what should I do first".
  const trade = (l) => (l.kind === 'tradeoff' ? 1 : 0);
  return all.sort((a, b) => trade(a) - trade(b) || b.rank - a.rank);
}

/**
 * Why a car loan is usually the first one worth pulling, in one sentence that
 * doesn't pretend to know your rate.
 */
export function debtRateNote() {
  return `A used-car loan averages around ${AUTO_LOAN_APR.used.toFixed(1)}% and a new one around `
    + `${AUTO_LOAN_APR.new.toFixed(1)}% (September 2026). Anything above your mortgage rate is costing you more `
    + 'than the house would, so clearing it first is usually both the cheaper money and the bigger lever. '
    + 'Openbook never asks what rate you\'re paying, so check yours before you act on that.';
}

function money(n) {
  return `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;
}
