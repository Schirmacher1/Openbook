# Openbook

A home affordability calculator built on your **take-home pay**, not the biggest loan a
lender would approve.

Most calculators answer a lender's question — what's the largest mortgage you'd qualify
for, measured against your gross salary and the debts on your credit report. Openbook
answers yours: after real tax, retirement contributions, savings, debts and the bills you
already have, what's actually left for a house?

It's a static site. There is no back end, no account and no analytics — the whole
calculation runs in the browser, and your numbers never leave the device.

## Running it locally

The site is plain HTML, CSS and ES modules, with no build step. Module imports need a
real HTTP origin, so serve the folder rather than opening `index.html` from disk:

```sh
npm start          # python3 -m http.server 8080
# then open http://localhost:8080
```

## Tests

The calculation engine is pure and covered by `node:test`:

```sh
npm test
```

The suite pins down the tax brackets, the FICA wage base and surtax, amortization, PMI
tiers, the price solver, the 28/36 lender comparison and the pre-tax vs post-tax
handling — the arithmetic the interface is only allowed to display.

## Layout

```
index.html              The page: landing, calculator, ledger, FAQ
assets/css/openbook.css Design tokens and every component
assets/js/data.js       Tax brackets, per-state data, credit tiers, insurance tiers
assets/js/calc.js       The whole calculation, as pure functions (no DOM, no storage)
assets/js/state.js      Defaults, persistence and share codes
assets/js/guidance.js   Published rules of thumb and the readiness checks
assets/js/app.js        The interface: rendering, wiring, charts
tests/calc.test.js      Engine tests
tests/guidance.test.js  Rule and readiness tests
```

The split matters: `calc.js` never touches the DOM, so the same code runs in the browser
and under `npm test`.

## How the calculation works

1. **Take-home pay.** Federal tax from the published marginal brackets and standard
   deduction for the filing status; state tax from each state's own published rate or
   brackets; Social Security to the wage base; Medicare including the additional
   surtax. Traditional 401(k) and pre-tax payroll items reduce taxable income —
   pre-tax items reduce FICA wages too, a 401(k) doesn't.
2. **Housing budget.** Post-tax savings, debt payments and recurring expenses come off
   take-home pay. What survives is the budget.
3. **Home price.** A bisection solve for the largest price whose full monthly payment —
   principal and interest, property tax, homeowners insurance, PMI and HOA — fits that
   budget. Bisection (rather than an algebraic inverse) because PMI steps at
   loan-to-value cutoffs, so the payment isn't smooth in price.
4. **The lender comparison.** The same solver run against conventional underwriting:
   28% of gross monthly income for housing, 36% including all other debt, whichever
   binds first.
5. **The rules of thumb.** The same solver again, once per published benchmark — see
   below.

### What it doesn't model

State-specific deductions, exemptions and credits; local or city income tax; a few
smaller states use a simplified approximation of their real brackets. Mortgage rate, PMI,
property tax and insurance are broad national estimates by credit tier and state, not
quotes. Openbook sizes a price around your own budget, not a lender's maximum.

## Rules of thumb

`assets/js/guidance.js` runs the best-known published guidance against the same numbers
and shows where each lands. Every benchmark is a summary of what its source states
publicly, with a link to their own words:

| Benchmark | Rule | Measured on |
|-----------|------|-------------|
| Openbook | whatever your paycheck actually leaves | take-home, after everything you listed |
| [Ramsey](https://www.ramseysolutions.com/real-estate/how-much-house-can-i-afford) | 25% of take-home pay, **on a 15-year fixed** | monthly take-home |
| [The Money Guy — 3/5/25](https://moneyguy.com/guide/home-buying/) | 3% down minimum, 5 years in the home, 25% of gross | monthly gross |
| Conventional underwriting | 28% of gross for housing, 36% including all debt | monthly gross |
| [HUD cost-burden line](https://www.huduser.gov/portal/pdredge/pdr_edge_featd_article_092214.html) | 30% of gross (50% is "severely cost burdened") | monthly gross |

Two implementation details that matter:

- **Ramsey's line is solved on a 15-year loan** regardless of the term selected in the
  form, because the rule specifies one. A 15-year payment is far higher, which is why
  that line usually comes out lowest. Quoting the 25% without the term attached would
  misstate the rule.
- **The verdict compares the payment you're actually contemplating** — the affordability
  estimate normally, or the what-if price if you've typed one into the ledger.

`readiness()` covers what the sources spend most of their time on: consumer debt, the
emergency fund, the down payment, the retirement contribution rate (Ramsey's 15% of
gross, The Money Guy's 25%) and housing as a share of income. The retirement check
deliberately counts the 401(k) only and says so — Openbook can't see an IRA, a brokerage
account or an employer match, so anything else would be a guess. The emergency-fund check
reports `unknown` rather than a failure when the optional balance is blank.

**Attribution.** Openbook is not affiliated with, endorsed by or connected to Ramsey
Solutions, The Money Guy Show or HUD. Their names appear because their guidance is worth
measuring against; the page links to each source, and the disclaimer says summaries lose
nuance. If you restate any of these rules, re-check them against the source first —
`tests/guidance.test.js` pins each figure so a refactor can't quietly reword someone
else's advice.

## Saving and sharing

"Save to this device" writes to `localStorage` and never leaves the browser. "Copy share
code" packs the state into a base64 string you can send by text or email; the recipient
pastes it into "Paste a code". A link can't carry the data reliably — the page is often
opened inside another app's viewer, which doesn't hand the script the URL — so the code
is the transport.

## Deploying

Any static host works. For GitHub Pages, serve the repository root from the branch you
publish (`.nojekyll` is present so the `assets/` paths are served as-is).

## Chart colours

The payment-composition palette is validated for lightness band, chroma floor,
colour-vision-deficiency separation and contrast against both the light and dark
surfaces, and every segment is direct-labelled in the legend so identity never rests on
colour alone.

| Slot | Light | Dark | Used for |
|------|-------|------|----------|
| 1 | `#0B7F5E` | `#2FA57E` | Principal & interest |
| 2 | `#C2751B` | `#BE8329` | Property tax |
| 3 | `#2F6FB0` | `#4E8ECF` | Homeowners insurance |
| 4 | `#A8477E` | `#C06894` | PMI |
| 5 | `#6FA33B` | `#739C3D` | HOA |

## Affiliate slots

Two placeholder partner links are marked in `index.html` with `href="#"` — one for
mortgage-rate comparison, one for homeowners insurance. They carry
`rel="sponsored noopener noreferrer"`, and the footer discloses them. They never affect
the numbers the page shows.

## Licence

Not yet chosen. Openbook is an independent tool, isn't affiliated with any lender, bank
or insurer, and is not financial, legal or tax advice.
