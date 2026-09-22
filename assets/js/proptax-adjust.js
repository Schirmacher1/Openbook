/**
 * Openbook — property tax, adjusted from owner to buyer.
 *
 * `proptax.generated.js` measures what people who ALREADY OWN pay: median real
 * estate tax divided by median home value, from the Census Bureau's American
 * Community Survey. Every user of this calculator is a BUYER, and in a state
 * that caps how fast an assessment can rise, a buyer is reassessed at the
 * price they pay — a different number, sometimes by a wide margin.
 *
 * This file is the complete, hand-maintained list of where that gap is large
 * enough, and well enough documented, to correct for. It is short on purpose:
 * most states reassess close to market value on a sale, so the owner-average
 * and the buyer figure are close enough that a correction would be false
 * precision dressed up as rigor. Two states are not close enough:
 *
 *   CA — Proposition 13 resets the assessment to the purchase price, so a
 *        buyer pays the 1% constitutional base plus voter-approved bonds —
 *        typically 1.10%-1.35% (checked September 2026) — while decades of
 *        capped growth pull the owner-average down to roughly 0.7%. Using the
 *        owner average understates a California buyer's tax by around 40%.
 *   TX — A homestead's assessed value can rise no more than 10% a year once
 *        homesteaded, which pulls the owner-average below what a new buyer's
 *        first-year bill actually is.
 *
 * Nothing else in the fifty states plus DC gets a correction. Adding one
 * without a specific, citable reason would be inventing precision this method
 * can't support — the automated refresh already gives every state a real,
 * dated, reproducible figure; this file exists only for the two places that
 * figure is measuring the wrong person.
 *
 * If a state's assessment-cap law changes, or research turns up another state
 * where it matters, this is the one place that has to know about it —
 * proptax.generated.js and the fetch script that builds it never do, and
 * never should: mixing a policy judgement into a data pull is how a refresh
 * silently reintroduces stale advocacy instead of a stale number.
 */

export const PROPTAX_BUYER_ADJUSTMENT = {
  CA: {
    multiplier: 1.62,
    reason: "Proposition 13 resets the assessment to the purchase price; a buyer's "
      + 'effective rate runs 1.10%-1.35% against an owner-average of roughly 0.7%.'
  },
  TX: {
    multiplier: 1.13,
    reason: "A homestead's assessed value is capped at 10% growth a year once "
      + "homesteaded, which pulls the owner-average below a new buyer's first-year bill."
  }
};

/**
 * The rate a buyer actually pays, given the owner-average the ACS measures.
 * A state with no listed adjustment is returned unchanged — most of them.
 */
export function buyerRate(code, ownerRate) {
  const adjustment = PROPTAX_BUYER_ADJUSTMENT[code];
  if (!adjustment || !(ownerRate > 0)) return ownerRate;
  return Math.round(ownerRate * adjustment.multiplier * 100) / 100;
}
