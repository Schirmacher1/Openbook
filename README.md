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
assets/js/app.js        The interface: rendering, wiring, charts
tests/calc.test.js      Engine tests
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

### What it doesn't model

State-specific deductions, exemptions and credits; local or city income tax; a few
smaller states use a simplified approximation of their real brackets. Mortgage rate, PMI,
property tax and insurance are broad national estimates by credit tier and state, not
quotes. Openbook sizes a price around your own budget, not a lender's maximum.

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
