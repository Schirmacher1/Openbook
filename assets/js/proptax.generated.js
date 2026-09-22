/**
 * Per-state property tax rates, as a percent of home value a year — what
 * someone who already OWNS pays, before the buyer adjustment in
 * proptax-adjust.js is applied.
 *
 * GENERATED — do not hand-edit. Run `node scripts/fetch-proptax.mjs`, or let
 * the quarterly workflow (.github/workflows/proptax.yml) do it and open a
 * pull request. assets/js/data.js applies proptax-adjust.js on top of this
 * table to get the figure the page actually uses.
 *
 * THIS FILE IS A MANUAL-RESEARCH SEED, NOT YET A REAL AUTOMATED FETCH. The
 * sandbox this was written in has no route to api.census.gov or any other
 * government data host — only github.com is reachable from it — so these
 * fifty-one figures are the same ones already shipped in data.js before this
 * automation existed, carried over so merging this file changes nothing
 * about what the page shows today. The first run of the quarterly workflow,
 * which executes on a real GitHub Actions runner with ordinary internet
 * access, overwrites this file with the real ACS figures and opens a PR
 * showing exactly what moved. Trigger it immediately after merging with
 * `gh workflow run proptax.yml` rather than waiting for the schedule, if you
 * want real numbers sooner than the first quarter mark.
 *
 * Source (once real): U.S. Census Bureau, ACS median real estate taxes paid
 *                      (B25103_001E) ÷ median home value (B25077_001E),
 *                      owner-occupied units.
 * Source (this seed):  assets/js/data.js as committed, manually researched
 *                      against published 2026 property-tax rankings.
 * Fetched:             seeded, not fetched — see above
 */

export const PROPTAX_SOURCE = {
  dataset: 'manual seed — not yet an ACS fetch',
  method: 'carried over from the hand-researched figures already in data.js',
  fetched: null
};

/** Postal code to the owner-occupied effective rate, in percent. */
export const PROPTAX_OWNER_RATE = {
  AK: 1.04,
  AL: 0.37,
  AR: 0.52,
  AZ: 0.48,
  CA: 0.71,
  CO: 0.55,
  CT: 1.91,
  DC: 0.46,
  DE: 0.53,
  FL: 0.71,
  GA: 0.72,
  HI: 0.29,
  IA: 1.29,
  ID: 0.49,
  IL: 1.96,
  IN: 0.71,
  KS: 1.19,
  KY: 0.72,
  LA: 0.42,
  MA: 1.02,
  MD: 0.98,
  ME: 1.02,
  MI: 1.24,
  MN: 0.93,
  MO: 0.81,
  MS: 0.52,
  MT: 0.62,
  NC: 0.63,
  ND: 0.90,
  NE: 1.35,
  NH: 1.89,
  NJ: 2.07,
  NM: 0.61,
  NV: 0.44,
  NY: 1.30,
  OH: 1.36,
  OK: 0.75,
  OR: 0.76,
  PA: 1.29,
  RI: 1.17,
  SC: 0.49,
  SD: 1.02,
  TN: 0.51,
  TX: 1.24,
  UT: 0.48,
  VA: 0.75,
  VT: 1.83,
  WA: 0.76,
  WI: 1.38,
  WV: 0.51,
  WY: 0.51
};
