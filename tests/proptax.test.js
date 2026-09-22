/**
 * Tests for the property-tax pipeline: the generated owner-rate table, the
 * hand-maintained buyer adjustment on top of it, and the override loop in
 * data.js that connects the two to what the page actually uses.
 *
 * The property that matters most here isn't any single number — it's that the
 * three pieces agree with each other, and that merging the automation changed
 * nothing about what the page showed before it existed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROPTAX_OWNER_RATE, PROPTAX_SOURCE } from '../assets/js/proptax.generated.js';
import { PROPTAX_BUYER_ADJUSTMENT, buyerRate } from '../assets/js/proptax-adjust.js';
import { STATE_DATA } from '../assets/js/data.js';

const CODES = Object.keys(STATE_DATA);

test('every state plus DC has a generated owner rate', () => {
  assert.equal(CODES.length, 51);
  for (const code of CODES) {
    assert.ok(PROPTAX_OWNER_RATE[code] > 0, `${code} is missing an owner rate`);
  }
  // And nothing extra — a stray code in the generated table would silently
  // never be read, which is its own kind of bug worth catching.
  assert.deepEqual(Object.keys(PROPTAX_OWNER_RATE).sort(), [...CODES].sort());
});

test('an owner rate outside a plausible range would be a fetch gone wrong', () => {
  // Not a claim about any specific state — a sanity fence. The real range
  // published for 2026 runs from Hawaii's ~0.3% to New Jersey's ~2.1%; a
  // figure outside roughly double that band means something upstream broke,
  // not that a state's tax policy became remarkable overnight.
  for (const [code, rate] of Object.entries(PROPTAX_OWNER_RATE)) {
    assert.ok(rate > 0.05 && rate < 5, `${code}: ${rate}% is outside a plausible range`);
  }
});

test('STATE_DATA.proptax is the generated rate with the adjustment applied, for every state', () => {
  for (const code of CODES) {
    const expected = buyerRate(code, PROPTAX_OWNER_RATE[code]);
    assert.equal(STATE_DATA[code].proptax, expected, `${code} did not get its generated+adjusted rate`);
  }
});

test('only the states in the adjustment list actually move from the owner figure', () => {
  for (const code of CODES) {
    const moved = STATE_DATA[code].proptax !== PROPTAX_OWNER_RATE[code];
    const listed = code in PROPTAX_BUYER_ADJUSTMENT;
    assert.equal(moved, listed, `${code}: adjustment applied = ${moved}, listed = ${listed}`);
  }
});

test('the adjustment list is exactly CA and TX, each with a stated reason', () => {
  assert.deepEqual(Object.keys(PROPTAX_BUYER_ADJUSTMENT).sort(), ['CA', 'TX']);
  for (const [code, entry] of Object.entries(PROPTAX_BUYER_ADJUSTMENT)) {
    assert.ok(entry.multiplier > 1, `${code}'s multiplier should raise the owner figure, not lower it`);
    assert.ok(entry.reason && entry.reason.length > 20, `${code} needs a real citation, not a stub`);
  }
});

test('buyerRate leaves an unlisted state untouched, including a non-finite guard', () => {
  assert.equal(buyerRate('CO', 0.55), 0.55);
  assert.equal(buyerRate('XX', 0.55), 0.55); // not a real code — still shouldn't throw
  assert.equal(buyerRate('CA', 0), 0); // a zero or missing rate is left as-is, not multiplied into a lie
  assert.equal(buyerRate('CA', undefined), undefined);
});

test('California is adjusted up, materially, not by a rounding error', () => {
  const owner = PROPTAX_OWNER_RATE.CA;
  const buyer = STATE_DATA.CA.proptax;
  assert.ok(buyer > owner * 1.3, `CA buyer rate (${buyer}%) should be well above the owner rate (${owner}%)`);
});

test('the generated file declares where it came from', () => {
  assert.ok(PROPTAX_SOURCE.dataset, 'PROPTAX_SOURCE.dataset must say what produced this table');
  assert.ok('fetched' in PROPTAX_SOURCE, 'PROPTAX_SOURCE.fetched must exist, even if null pending the first real run');
});

/* --------------------------------------------------------------------------
 * The bootstrap: merging the pipeline changed nothing
 *
 * proptax.generated.js is seeded from the figures that were already shipping
 * before this pipeline existed, not a real fetch (the environment this was
 * built in has no route to the Census API). This pins that the seed, run
 * through the same adjustment every real fetch will go through, reproduces
 * exactly what was live before — so merging the automation was not itself a
 * silent change to what the page tells anyone they can afford.
 * ------------------------------------------------------------------------ */

test('the seeded figures reproduce exactly what shipped before this pipeline existed', () => {
  // The 51 values assets/js/data.js hard-coded, by hand, before proptax.generated.js
  // and proptax-adjust.js existed — copied here once, specifically so a future
  // change to the seed or the adjustment maths has to justify moving off them,
  // rather than drifting unnoticed. This is the one place that old table is
  // allowed to still exist.
  const previouslyShipped = {
    AK: 1.04, AL: 0.37, AR: 0.52, AZ: 0.48, CA: 1.15, CO: 0.55, CT: 1.91, DC: 0.46,
    DE: 0.53, FL: 0.71, GA: 0.72, HI: 0.29, IA: 1.29, ID: 0.49, IL: 1.96, IN: 0.71,
    KS: 1.19, KY: 0.72, LA: 0.42, MA: 1.02, MD: 0.98, ME: 1.02, MI: 1.24, MN: 0.93,
    MO: 0.81, MS: 0.52, MT: 0.62, NC: 0.63, ND: 0.90, NE: 1.35, NH: 1.89, NJ: 2.07,
    NM: 0.61, NV: 0.44, NY: 1.30, OH: 1.36, OK: 0.75, OR: 0.76, PA: 1.29, RI: 1.17,
    SC: 0.49, SD: 1.02, TN: 0.51, TX: 1.40, UT: 0.48, VA: 0.75, VT: 1.83, WA: 0.76,
    WI: 1.38, WV: 0.51, WY: 0.51
  };
  assert.equal(Object.keys(previouslyShipped).length, 51);

  for (const [code, rate] of Object.entries(previouslyShipped)) {
    assert.equal(STATE_DATA[code].proptax, rate, `${code}: pipeline changed a figure it should have reproduced`);
  }
});
