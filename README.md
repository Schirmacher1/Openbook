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
assets/js/proptax.generated.js  Per-state property tax, owner rate (generated — see below)
assets/js/proptax-adjust.js     The buyer-vs-owner correction, hand-maintained
assets/js/calc.js       The whole calculation, as pure functions (no DOM, no storage)
assets/js/state.js      Defaults, persistence and share codes
assets/js/guidance.js   Published rules of thumb and the readiness checks
assets/js/compare.js    Saved views, side by side, as pure functions
assets/js/levers.js     What each change would be worth, as pure functions
assets/js/app.js        The interface: rendering, wiring, charts
assets/js/theme.js      Pre-paint theme stamp (kept external so CSP can ban inline script)
assets/css/fonts.css    @font-face rules for the self-hosted typefaces (generated)
assets/fonts/           The woff2 files themselves, plus their licence
scripts/fetch-fonts.mjs Regenerates both from Google Fonts
tests/calc.test.js      Engine tests
tests/guidance.test.js  Rule and readiness tests
tests/security.test.js  Untrusted-input tests for the share code
_headers                Response headers for hosts that read them (not GitHub Pages)
```

The split matters: `calc.js` never touches the DOM, so the same code runs in the browser
and under `npm test`.

## How the calculation works

The **ledger** ("Where every dollar goes") runs the whole cascade: monthly gross pay, then
tax, then the payroll deductions that never reach your account, then take-home pay, then
what you spend it on. `grossMonthly - tax - payroll === netMonthly` by construction, and
`tests/calc.test.js` pins that identity for both 401(k) types. It used to start at
take-home, with tax in a separate card below — a card called "where every dollar goes"
that began three thousand dollars in, and whose neighbour was called "Tax breakdown" while
listing the 401(k) too. Both problems went away when the cascade became one card.

1. **Take-home pay.** Federal tax from the published marginal brackets and standard
   deduction for the filing status; state tax from each state's own published rate or
   brackets; Social Security to the wage base; Medicare including the additional surtax.

   The 401(k) types are passed to `computePaycheck` separately, because they do two
   different things and conflating them is a real hazard:

   | | lowers taxable income | leaves the paycheck | lowers FICA wages |
   |---|---|---|---|
   | Traditional 401(k) | yes | yes | no |
   | Roth 401(k) | **no** | **yes** | no |
   | Pre-tax payroll items | yes | yes | yes |

   Reading "Roth doesn't lower your tax" as "Roth doesn't leave your paycheck" hands a
   Roth contributor a housing budget as though they'd saved nothing. That bug shipped
   once; `tests/calc.test.js` now pins each cell of that table, and pins that the tax
   breakdown's rows still sum to take-home pay for both types.

   The 401(k) control sits in step 2, "Money out", with the rest of the savings — a
   contribution is money leaving, not money arriving, and the Savings card's monthly
   total has always counted it.
2. **Housing budget.** Post-tax savings, debt payments and recurring expenses come off
   take-home pay. What survives is the budget — **capped at 28% of gross**, the most the
   28/36 rule allows on housing, so the recommendation is the stricter of the two tests.
   Without that cap the budget is simply "every spare dollar", which for anyone with
   light expenses recommends a payment no adviser would stand behind. When the cap binds,
   the held-back money shows in the ledger as unallocated income with an explanation,
   rather than vanishing.
3. **Home price.** A bisection solve for the largest price whose full monthly payment —
   principal and interest, property tax, homeowners insurance, PMI and HOA — fits that
   budget. Bisection (rather than an algebraic inverse) because PMI steps at
   loan-to-value cutoffs, so the payment isn't smooth in price.
4. **The lender comparison.** The same solver run against what underwriting actually
   approves — see below.
5. **The rules of thumb.** The same solver again, once per published benchmark.

### What it doesn't model

State-specific deductions, exemptions and credits; local or city income tax; a few
smaller states use a simplified approximation of their real brackets. Mortgage rate, PMI,
property tax and insurance are broad national estimates by credit tier and state, not
quotes. Openbook sizes a price around your own budget, not a lender's maximum.

## The step gate

The figures stay hidden until all three calculator steps have been opened. Until then the
results slot holds a checklist with a "next step" button, the ledger is hidden, the rules section shows a short notice instead of its chart, and the phone summary
bar stays down.

The reason is not ceremony. With the figures visible from the start, the answer becomes the
thing you look at, the remaining steps read as decoration, and the number you're anchored
on was computed from numbers you haven't entered — the example household's, not yours.

Details that matter:

- **It only ever reveals.** Going back to step 1 doesn't re-hide your own results.
- **Restored input skips it.** A saved state, a loaded view or a pasted share code is
  already somebody's finished input, so those call `revealResults()` and the gate never
  shows.
- **Nothing leaks.** It's a `data-steps` attribute on `<body>` plus two classes —
  `.reveal-on-complete` and `.show-until-complete` — so every figure on the page is
  covered by the same switch rather than each being hidden by hand. Verified by asserting
  no `$NNN,NNN` string appears anywhere in `document.body.innerText` on arrival.

Each panel footer also carries a "Step N of 3" label, so the sequence is legible without
having to infer it from the tab badges.

## Rules of thumb

`assets/js/guidance.js` runs the best-known published guidance against the same numbers
and shows where each lands. Every benchmark is a summary of what its source states
publicly, with a link to their own words:

| Benchmark | Rule | Measured on |
|-----------|------|-------------|
| Openbook | whatever your paycheck actually leaves | take-home, after everything you listed |
| [Ramsey](https://www.ramseysolutions.com/real-estate/how-much-house-can-i-afford) | 25% of take-home pay, **on a 15-year fixed** | monthly take-home |
| [The Money Guy — 3/5/25](https://moneyguy.com/guide/home-buying/) | 3% down **on a first home** (20% after that), 5 years in the home, 25% of gross | monthly gross |
| 28% of gross on housing | the front-end half on its own — the figure people quote | monthly gross |
| The 28/36 rule | both halves; the tighter one sets the figure, usually the 36% | monthly gross |
| [What a lender will approve](https://selling-guide.fanniemae.com/sel/b3-6-02/debt-income-ratios) | 45% of gross counting all debt, **no front-end cap** | monthly gross |
| [HUD cost-burden line](https://www.huduser.gov/portal/pdredge/pdr_edge_featd_article_092214.html) | 30% of gross (50% is "severely cost burdened") | monthly gross |

### The 28% half, kept separate

"Don't spend more than 28% of gross on housing" is the sentence everybody knows, but a
combined 28/36 figure almost never reports it — as soon as there is any other debt the
36% half is tighter and sets the number. On the example household the combined rule gives
$2,120/mo while 28% of gross is $2,217/mo.

`rule28` holds the front-end half on its own, and `ruleOfThumb.boundBy` records which half
produced the combined figure, so the rules section can say which one it is quoting. The
hero used to display `rule28` as a price of its own; with that section removed it now
appears only inside the 28/36 row's explanation, as a monthly figure.

### Approved is not the same as affordable

The approval line is **what a lender will approve**, which is a much larger number than
the 28/36 rule most calculators quote:

- a conventional loan applies **no front-end housing cap** — 28% is a guideline, not a
  requirement, and total debt-to-income is the only ratio underwriting enforces;
- Fannie Mae's automated underwriter (Desktop Underwriter) allows total DTI up to **50%**;
  manual underwriting starts at 36% and stretches to 45% on credit score and reserves;
  FHA runs to **57%** with an automated approval and strong compensating factors.

`DTI_APPROVAL` is set to **45%** — past what manual underwriting allows unaided, short of
the DU ceiling — as where a typical conventional approval lands. Erring low is deliberate:
the real gap is more often wider than this than narrower. On the example household it
still produces a **$116k** gap, with the approved payment taking 54% of take-home pay
against Openbook's 36%.

The 28/36 rule stays in the rules section as what it is: guidance, sitting alongside
Ramsey and The Money Guy rather than standing in for a lender.

**Always name the denominator, and print both halves of the ratio.** Three numbers are in
play and only two of them are the 28/36 rule:

| | What it is | 28/36 |
|---|---|---|
| `housingShareOfTakeHome` | housing ÷ take-home | not in the rule |
| `frontEnd` | housing ÷ gross | the **28** |
| `backEnd` | (housing + all other debt) ÷ gross | the **36** |

Openbook leads with the take-home share because that's the argument, but a bare
percentage means nothing without the limit it's being measured against, so the readiness
check prints the ratio and names the limit together.

Note that none of these percentages is set anywhere — they all fall out. The approval
line's housing share is whatever 45% of gross minus the debt load leaves (36% on the
example household); the paycheck line's is whatever that household's budget produces
(24%). Change the debts and the first moves on its own: no debts gives 45%, $1,500 of
debts gives 26%. Anything that displays one of them should say which test set it.

There are two sets of these ratios, because two payments are in play. `estimate*`
describes the affordability estimate and drives the hero. The unprefixed `frontEnd` /
`backEnd` describe the payment actually on the table — the estimate normally, the what-if
price once one is entered — and drive the readiness checks and the rules verdict. Pairing
a payment with the other one's ratios is how the hero briefly showed a $1,913/mo payment
at 58% of gross; `tests/calc.test.js` now guards against it.

Printing only the front end was actively misleading on the approval line, whose housing
share happens to be 36% of gross. Next to a rule whose second number is also 36, that
reads as "the lender is at the 28/36 limit" when its real back-end is 45%. Showing the
stated limit on every row removes the ambiguity entirely.

Two implementation details that matter:

- **Ramsey's line is solved on a 15-year loan** regardless of the term selected in the
  form, because the rule specifies one. A 15-year payment is far higher, which is why
  that line usually comes out lowest. Quoting the 25% without the term attached would
  misstate the rule.
- **The verdict compares the payment you're actually contemplating** — the affordability
  estimate normally, or the what-if price if you've typed one into the ledger.
- **The 3% in 3/5/25 is a first-home allowance, not a general floor.** On any home after
  the first, The Money Guy's figure is 20% down and the stay is five to seven years, so
  `state.firstHome` decides which branch the down-payment check and the rule's own note
  apply. The control sits directly above the down-payment field and the check names the
  branch it used, so the assumption is never silent.

Scoring counts the guidance rules only. Openbook's own line isn't a rule, and neither are
the two ceilings — coming in under a limit you'd have to be reckless to breach isn't an
achievement. A breached ceiling is reported separately, because it's alarming rather than
merely worth noting. The score reads "2 of 3 rules met" and its caption is generated from
the same split, naming the three it scored and the two it didn't: "2 of 3" beside a list of
four sources reads as an arithmetic mistake.

`readiness()` covers what the sources spend most of their time on: consumer debt, the
emergency fund, the down payment, the retirement contribution rate (Ramsey's 15% of
gross, The Money Guy's 25%) and housing as a share of income. The retirement check
deliberately counts the 401(k) only and says so — Openbook can't see an IRA, a brokerage
account or an employer match, so anything else would be a guess. The emergency-fund check
reports `unknown` rather than a failure when the optional balance is blank.

Two of those checks need more than a threshold:

- **Retirement is measured against the account, not just the rate.** The §402(g) elective
  deferral limit is $24,500 for 2026, so above roughly $163,000 of salary, 15% of gross is
  more than a 401(k) can legally hold. The target is `min(15% of gross, the limit)`, and
  when the limit is what binds the check says so and points at an IRA or a taxable account
  rather than reporting a shortfall nobody can close. The comparison runs on the whole
  percentage the label prints, so "401(k) at 12% of gross" is never shown failing a 12%
  target by a quarter of a point.
- **Housing share follows the gross measure.** Three of the four lines here — The Money
  Guy's 25%, the 28/36 rule's 28% and HUD's 30% — measure gross pay. Ramsey's 25% measures
  take-home, which makes it far the strictest; failing the whole check on his line alone
  marked plans that clear every other published figure. Clearing 25% of gross passes, and
  the detail names Ramsey as the one still outstanding instead of burying it.

**Attribution.** Openbook is not affiliated with, endorsed by or connected to Ramsey
Solutions, The Money Guy Show or HUD. Their names appear because their guidance is worth
measuring against; the page links to each source, and the disclaimer says summaries lose
nuance. If you restate any of these rules, re-check them against the source first —
`tests/guidance.test.js` pins each figure so a refactor can't quietly reword someone
else's advice.

## Cash at closing

The down payment used to be the only cash the page modelled, which quietly implied that
someone with $40,000 saved can put $40,000 down. They can't. `cashToClose()` adds:

- **Fees** at 2% of the price (lender, title, appraisal, attorney, recording). The page
  quotes the 1.5%–3% band around it, because the spread between states is enormous —
  transfer taxes and title practice are local, and New York averages near $16,800 against
  Missouri's $2,100 on the same transaction.
- **Escrow**, computed from *this buyer's* own property tax and insurance rather than an
  average, because the calculator already knows both: three months of tax and a year of
  insurance is what a lender typically collects up front.
- **Prepaid interest** from the closing date to month end, charged on the loan — so an
  all-cash purchase owes none of it, which `tests/levers.test.js` pins.

On the example household that is $8,778 on top of the deposit: 22% more cash than the
page used to imply. None of it changes the monthly payment, so none of it changes what you
can afford month to month — it changes whether you can get to the table at all, which is a
different question the page had not been asking.

## The levers

`assets/js/levers.js` answers "what should I do about it" by running the same calculation
again with one thing changed, and pricing the difference in dollars of house and dollars a
month. It is not an advice engine and it holds to one rule: **it never asserts anything it
cannot compute from what the person entered.**

The levers are: clearing each debt, reaching the next mortgage-insurance tier, reaching
20%, moving up a credit tier, and the 15-year trade.

Three things it gets right that a naive version would not:

- **A debt's payment is the lever; its balance is the price.** A lender counts the
  payment, so a small balance on a large payment is the most leverage in the model —
  clearing a $450/mo car loan with $3,100 left buys about $38,000 more house. The balance
  is an optional field on each debt row: without it the page says what the lever is worth
  but not what pulling it costs, and says so rather than guessing.
- **A bigger deposit is mostly a transfer, not leverage.** Putting 20% down might show
  "+$24,297 of house", but $19,193 of that is your own cash becoming equity. Only the
  remainder — what the freed mortgage insurance lets you borrow — is what the lever is
  worth, and that is what it's ranked on. Ranking on the headline would put moving your
  own money above clearing a debt.
- **When the 28% cap binds, clearing a debt buys no more house at all,** and the line says
  so instead of showing a triumphant zero.

**On car loans specifically**, the honest framing is the payment, not the rate. Openbook
never asks what rate you're paying, so it doesn't tell you what clearing the loan saves in
interest; it notes the published averages (around 11.4% used, 6.4% new, September 2026),
points out that anything above your mortgage rate costs more than the house would, and
leaves you to check your own paperwork.

The figures don't add up, and the page says so: each one assumes everything else stays as
it is, so pulling two levers is not the sum of pulling each.

## Where the figures come from, and when

Every market assumption carries a date, because a mortgage rate without one is
worth very little. The page prints the date in its disclaimer; `RATES_AS_OF` in
`assets/js/data.js` is the single place it lives.

| Figure | Source | Checked |
|---|---|---|
| Federal brackets, standard deduction | IRS 2026 inflation adjustments | Sept 2026 |
| Social Security wage base, Medicare surtax thresholds | SSA / statute | Sept 2026 |
| 401(k) elective deferral limit | IRS Notice 2025-67 ($24,500) | Sept 2026 |
| 30-year and 15-year mortgage rates | Freddie Mac PMMS, 17 Sept 2026 (6.95% / 6.26%) | Sept 2026 |
| PMI by tier | Published MI rate cards, capped at `PMI_RATE_CAP` | Sept 2026 |
| Property tax by state | U.S. Census ACS, automated + quarterly, adjusted for buyers | see below |

Two of those need explaining.

**Mortgage rates are anchored, not invented.** The 740-799 tier sits exactly at the
PMMS 30-year figure, since the survey reflects what a well-qualified borrower is quoted;
the other tiers are spread around it by roughly the loan-level price adjustments a
conventional lender applies. The 15-year discount is the gap in the same survey week
(6.95% − 6.26% = 0.69), which `tests/calc.test.js` pins.

**Property tax refreshes itself.** The other rows in the table above are numbers
someone checked by hand and will need to check again someday. Property tax doesn't wait
for that — it's on a quarterly, automated pipeline, described in full below.

Where sources disagreed before the pipeline existed, the more conservative (higher)
figure was taken: understating a monthly cost in an affordability calculator fails in the
direction that hurts. That principle now lives in the pipeline's own review step, not in
a one-time judgement call.

### The property tax pipeline

Three files, each with one job, none of them hand-editing another:

| File | Job | Touched by |
|---|---|---|
| `assets/js/proptax.generated.js` | The raw figure per state — what an existing **owner** pays | `scripts/fetch-proptax.mjs` only |
| `assets/js/proptax-adjust.js` | The correction for the handful of states where a **buyer** pays something else | A human, on purpose, with a citation |
| `assets/js/data.js` | Applies the second to the first, once, in a loop right after `STATE_DATA` | Nothing — it's the consumer |

**Where the number comes from.** `scripts/fetch-proptax.mjs` pulls two American
Community Survey tables for every state — median real estate tax paid
(`B25103_001E`) and median home value (`B25077_001E`) — and divides one by the
other. That's the same method the widely-quoted rankings use, and unlike them
it's reproducible: same query, same answer, and the query is sitting right
there in the script rather than behind whatever a ranking site did last year.

**Why it's a government API and not a citation.** A number that drifts and is
checked by hand on whatever schedule someone remembers to do it is exactly how
this table got stale in the first place. Pulling from the primary source on a
schedule is the fix — this is public, free, government-published data with no
API key required, not something that needed a subscription or a workaround.

**Why it runs in CI and not here.** The environment this was built in has no
route to `api.census.gov`, or to any other government data host — only
`github.com` is reachable from it. That's a property of *that specific
environment's* network policy, not of the data. `.github/workflows/proptax.yml`
runs the same script on a GitHub Actions runner, which has ordinary outbound
internet, on the 2nd of January, April, July and October — a few days after
each quarter turns over, so a freshly published release has time to actually
be live.

**What happens when it runs.** If the fetched figures differ from what's
committed, the workflow runs the test suite against them and opens a pull
request with the diff; nothing merges automatically. If a state's rate moved,
a reviewer sees it move, the same way any other change to this page gets
reviewed. Run it on demand rather than waiting for the schedule with
`gh workflow run proptax.yml`.

**Why owner and buyer are different files.** The ACS measures people who
already own a home. Every user of this calculator is a *buyer*, and in a state
that caps how fast an assessment can rise, a buyer is reassessed at the price
they pay — a different number, sometimes by a wide margin. California is the
clearest case: Proposition 13 resets the assessment to the purchase price, so a
buyer pays the 1% constitutional base plus voter-approved bonds — typically
1.10%-1.35% — while decades of capped growth pull the owner-average down to
roughly 0.7%. Using the owner figure understates a California buyer by about
40%, or roughly $200 a month on a $600,000 home. Texas caps homestead growth
the same way.

That correction is `assets/js/proptax-adjust.js`, and it's deliberately not
part of the automated fetch: it's a policy judgement — *which* states need a
correction, and by how much — not a data pull, and mixing the two is how a
refresh would silently reintroduce stale advocacy dressed up as a stale
number. It's short on purpose. Most states reassess close to market value on a
sale, so the owner-average and the buyer figure are close enough that adding a
correction would be false precision. Only California and Texas are listed, each
with the reasoning inline; `tests/proptax.test.js` pins that nothing else in
the fifty-one is adjusted, and that the two which are move by more than a
rounding error.

**The bootstrap.** `proptax.generated.js` as committed right now is seeded from
the same figures that were already shipping in `data.js` before this pipeline
existed — not a real ACS fetch, because the environment that built this
couldn't reach the Census API to run one. Merging it changes nothing about
what the page shows today (`tests/proptax.test.js` includes a byte-for-byte
check of that), and the file says so at its own top. The first real run —
scheduled, or triggered by hand — replaces it with an actual dated fetch and
opens the first real PR.

## Performance

The whole calculation is pure arithmetic and there is no framework, so the budget is
spent on the page rather than on the maths.

| | |
|---|---|
| `compute(state)` | 0.04 ms |
| A full recalculation (compute + rules + readiness) | 0.07 ms |
| Keystroke to fully repainted page | 1.7 ms median, 3 ms worst |
| Keystroke with a four-way comparison open | 0.7 ms median |
| First contentful paint | 180 ms |
| Everything, gzipped | 66 KB |

A keystroke runs about ten bisections of ~64 payment evaluations each — the price solver
runs once for the estimate and again for every benchmark line — and still lands inside a
tenth of a millisecond, so nothing is debounced and nothing needs to be.

**The fonts were the whole load cost.** Three families from Google Fonts meant a
render-blocking third-party stylesheet, then a second origin for the files: 444 ms to
first contentful paint, against 128 ms with the request blocked. Self-hosting took FCP to
180 ms, removed the last third-party request on the page, and let the
Content-Security-Policy drop to `style-src 'self'; font-src 'self'`. That second part
matters more than the milliseconds: every visitor's IP address used to reach Google
before a single number appeared, on a page whose whole promise is that nothing leaves the
device. `scripts/fetch-fonts.mjs` regenerates `assets/css/fonts.css` and the woff2 files;
the `latin-ext` subsets are kept but never downloaded unless a page actually uses those
characters, which is what `unicode-range` is for.

## Saving and sharing

The calculator toolbar is one **Manage** button opening a menu of six actions, each with a
line saying what it does. Items ending in an ellipsis (`Saved views…`, `Paste a code…`)
open a panel below; the rest act immediately and close the menu.

It replaced a row of buttons for a specific reason worth remembering: a row of toggles
needs a visible active state, and the one it had was a pale hover tint that read as
nothing happening at all. A menu has no such state to get wrong — it is open or it isn't,
and the chevron says which.

The menu is anchored to the **toolbar card**, not to the trigger. The trigger moves: it
shares a row with the status text on a wide screen and wraps below it on a narrow one.
Anchoring to it and chasing that with a breakpoint clipped the menu off the viewport at
the widths in between — verified clipping at 480px and 559px before the fix, and fitting
at 320/360/390/480/559/560/700/1024/1440 after. The card is always inside the viewport,
so anchoring there cannot clip.

Keyboard: `ArrowDown` from the trigger opens it and focuses the first item, arrows and
`Home`/`End` move between items, `Escape` closes and returns focus to the trigger, `Tab`
closes it, and a pointer press anywhere outside dismisses it.

Persistence itself has three tiers, on purpose.

**The in-tab draft** is written automatically to `sessionStorage` as you type. It
survives a refresh, the back button and a restored tab, and the browser destroys it when
the tab closes. It exists so a stray reload doesn't cost you twenty minutes of typing.

**"Remember these numbers"** (in the Manage menu) writes to `localStorage` and outlives the tab. It is deliberately
something you ask for rather than the default: the page knows your salary, your debts and
what you have put by, and leaving that on a library or office machine for whoever sits
down next would undo the promise the rest of the site makes. Once you've saved once,
changes autosave.

On load an explicit save wins over a draft — it outlived a tab, so it's the newer intent —
and is announced with a banner. A draft is restored quietly, since it's the same tab you
typed it into. "Delete saved data" clears both, plus the view library.

Drafts go through `hydrate()` like anything else, so a tampered one is sanitised rather
than trusted, and every draft call swallows its own failure — a blocked `sessionStorage`
must never be the reason something breaks.

**Named views** are a library of scenarios — "as things are", "if we clear the car loan",
"the Denver version" — each a complete set of numbers, saved under a name and reloadable
in one click. Each row in the list shows the price and payment that view produces, so the
library doubles as a comparison of the scenarios rather than just a list of names.

Saving under a name already in use replaces that view (case-insensitively), so saving
"Plan A" twice updates Plan A instead of leaving two of them. The library caps at 24 and
drops the oldest to make room rather than refusing a save. Views read back through
`hydrate()` like anything else, so a corrupt store reads as empty and a tampered entry is
sanitised. "Delete saved data" removes them too, but never silently: it names the views it
is about to delete and asks first.

**Share codes carry three different scopes,** because "share your numbers" turned out to
mean three different things depending on where you click:

| Where | What it carries | What happens on paste |
|---|---|---|
| Manage menu → "Copy share code" | The numbers on screen right now | Replaces the recipient's on-screen numbers |
| A view's own "Share" button | That one view | Replaces their on-screen numbers **and** is filed into their library under its name |
| "Share all views…" | The whole library | Nothing on their screen changes — every view is added to their library |

A link can't carry the data reliably — the page is often opened inside another app's
viewer, which doesn't hand the script the URL — so the code is the transport in every
case; only what goes into it differs.

The wire format (`assets/js/state.js`) is a small versioned envelope:
```
{ openbookShare: 2, current: <state or null>, views: [{ name, state }, ...] }
```
`encodeShareCode()` — the original, single-state function — is untouched: it still emits
a bare serialized state with no envelope at all, exactly as it always has, so every code
already sent before this existed keeps decoding exactly as it always has. `decodeShareCode()`
tells the two apart by one key, `openbookShare`, that a bare state can never have — every
key a bare state does have comes from `PERSISTED_KEYS`, and that isn't one of them. A bare
code decodes straight to a hydrated state, as before; a bundle decodes to
`{ bundle: true, current, views }`, with `current` hydrated (or `null`, for a views-only
code) and every view's state hydrated the same allowlisted way `listViews()` sanitises its
own — a share code is the one truly untrusted input this page has, and nothing about
wrapping several states in an envelope is exempt from that.

Two things the paste handler gets right that a naive merge wouldn't:

- **A name collision never clobbers.** Two people's "Plan A" are not the same plan, so an
  incoming view whose name the recipient already has becomes "Plan A (received)", then
  "Plan A (received 2)", checked against both their existing library and names already
  claimed earlier in the same import — pasting the same code twice does not overwrite the
  first import with the second.
- **A views-only code touches nothing on screen.** "Share all views" deliberately leaves
  `current` out, and the recipient's own in-progress numbers are never at risk from
  pasting one — the views land in the library and nothing else moves.

A full 24-view library, the cap the views feature already enforces, comes to about 44,000
characters — comfortably inside `LIMITS.shareCode`'s 64,000-character guard, which
`tests/security.test.js` exercises the same way it does for a single state: refused before
`atob` or `JSON.parse` ever see it.

### No browser dialogs, anywhere

Nothing on the page depends on `window.confirm()`, `window.prompt()` or `alert()`. A
sandboxed frame — the artifact preview, an embed, some in-app browsers — refuses to show
them, and a refused `confirm()` reads as `false`, so Delete silently did nothing and
Rename silently kept the old name. Both now happen in the page:

- **Renaming is the name.** Clicking it swaps in an input; Enter keeps the change, Escape
  drops it, clicking away keeps it. A name another view already uses is refused with a
  message rather than quietly creating two views that "Save view" would then confuse. The
  separate Rename button is gone.
- **Deleting asks in the row** — "Delete for good?" with Delete and Keep it — and Escape
  backs out. Clearing all saved data asks in a panel that names the views it will remove.
- **The share code falls back to a panel,** not a prompt, when the clipboard is refused
  (an iframe, an insecure origin, a browser wanting a gesture it didn't see).

`tests/` can't cover this — it's DOM behaviour — so the browser check asserts it instead:
the Playwright run fails if a dialog is opened at all.

### Comparing views

Ticking two or more saved views (up to four) puts their ledgers side by side in the same
order the ledger card uses. `assets/js/compare.js` is pure — it takes `{ id, name, state }`
entries and returns columns and rows — so `tests/compare.test.js` can pin the arithmetic
without a browser.

Why the whole ledger rather than the price each view produces, which the list already
shows: the price can't tell you *which* line moved. A view that buys less house because the
401(k) went up and one that buys less because a car loan came back look identical at the
top and nothing alike underneath. The tests pin one case where two views produce the *same*
price for a reason invisible in the price — both held to 28% of gross — and the difference
shows up in unallocated income instead.

**Every row with parts inside it opens.** A differing total is the start of the question,
not the answer: "Debts: $730 against $280" invites "which debt?". Opening the row answers
it, one line per line item, and `Expand all` opens the lot. Which rows open, and what is
inside them:

| Row | Inside |
|---|---|
| Tax | federal, state, Social Security & Medicare |
| 401(k) & pre-tax deductions | the 401(k), then each pre-tax row |
| Savings, Debts, Other recurring expenses | each line you entered |
| Housing payment | principal & interest, property tax, insurance, PMI, HOA |

Lining those up across views takes three decisions:

- **Typed lines match on their label, not their stored id.** Two views can hold the same
  "Car loan" under different ids — one typed, one pasted from a share code — and to a
  reader they are plainly the same debt. A label used twice inside one view stays two
  rows. Derived parts (tax, the payment) match on a fixed key instead.
- **Missing and zero are different answers.** A view with no such line reads `—`; a line
  that is there but ticked off reads `$0` with an `excluded` note. That note is the
  comparison people come for: "the car loan, ticked off".
- **A derived part that is zero in every column is dropped** — no HOA anywhere is not a
  difference — but a line *someone typed* stays even at zero, because they put it there.

A per-column note (`excluded`, `Roth`, `12% of take-home`) prints only when the columns
disagree about it; repeated in every column it is just the row's description.

`tests/compare.test.js` pins that every openable row equals the sum of its own parts, in
every column.

Details:

- **A difference column appears only with exactly two views.** With three or more it would
  have to choose a baseline the reader can't see. The caption names the subtraction.
- **The live numbers are an optional column,** offered only once the step gate has opened —
  before that the page has no figures to show, and this is not the back way in.
- **A view running a what-if price is compared on that price,** and the column says so.
  Showing its estimate above a housing row computed from a different price would be two
  answers to one question.
- **Four columns, then stop.** A fifth doesn't fit a laptop, and on a phone the table
  scrolls sideways with the row labels pinned.

## Deploying

`.github/workflows/deploy.yml` runs the tests on every push and pull request, and
publishes to GitHub Pages from `main` once they pass. It stages only what the site serves,
so tests, `package.json` and this README stay off the public site.

One manual step, which can only be done in the web UI:

> **Settings → Pages → Build and deployment → Source: "GitHub Actions"**

Until that is set the deploy job fails with "Pages site not found". After that, every push
to `main` publishes to `https://<user>.github.io/openbook/`.

Pages serves a project site from a subpath. Every path in the page is relative, so this
works with no base-href — verified by staging the site under `/openbook/` and loading it.

Pages cannot set response headers, so `_headers` is ignored there; it is staged anyway so
moving to Cloudflare Pages or Netlify later needs no change. See **Security** for which
headers that costs you.

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

## Security

The site has no back end, no forms, no cookies and makes no network requests of its own,
which removes most of the usual categories outright. What is left is one genuinely
untrusted input and the page's own hardening.

### The share code is the attack surface

A share code is typed in by hand from whoever sent it, and `localStorage` is only as
trustworthy as the browser holding it. Both go through `hydrate()` in
`assets/js/state.js`, which rebuilds state **field by field from an allowlist** rather
than merging:

- an unknown key never survives — output is always exactly the known fields;
- every number is finite and clamped into `LIMITS`, so `Infinity`, `NaN`, a numeric
  string and a negative can't reach the interface;
- every enum is checked against its own options, so a bogus `stateCode` or `filing`
  can't index a reference table;
- lists cap at 100 rows and labels at 120 characters, so a code can't hang the page by
  asking it to render 200,000 rows;
- a label is only accepted if it is already a string, so a hostile object can't get its
  `toString` called;
- `decodeShareCode` refuses anything over 64 KB before handing it to `atob`/`JSON.parse`.

Object spread (not `Object.assign`) is used throughout, so `__proto__` in a payload
defines an own property rather than polluting `Object.prototype`. `tests/security.test.js`
pins all of this, including the pollution case.

### Content Security Policy

`index.html` carries a `default-src 'none'` policy. Script is `'self'` only — there are
no inline `<script>` blocks and no inline `style` attributes, which is why the theme
bootstrap lives in `assets/js/theme.js`. `connect-src 'none'` is the important one: even
if markup injection were ever found, there is nowhere to send anything.

Verified in Chromium rather than assumed — under this policy a `fetch()` to an external
host is blocked and an injected inline `<script>` does not execute.

`frame-ancestors`, `X-Content-Type-Options` and `Permissions-Policy` cannot be delivered
by a `<meta>` tag. They live in `_headers`, which Netlify and Cloudflare Pages read.
**GitHub Pages cannot set custom headers at all** — if you stay on Pages, the meta CSP
still applies but those three don't, which is the main argument for putting a CDN in
front.

### Known trade-off

Fonts come from Google Fonts, so loading the page tells Google an IP address requested
it. The numbers never leave the device, and the CSP pins font traffic to
`fonts.gstatic.com`, but self-hosting the three families would make the privacy claim
airtight and let `style-src`/`font-src` drop to `'self'`.

### Bots

There is nothing to spam: no form submits, no endpoint, no database, no email. A bot can
only fill in a calculator in its own browser. This changes the moment you add anything
that accepts input — a contact form, an email capture, a saved-scenario back end — at
which point the answer is a hosted form service with spam filtering, or a privacy-respecting
challenge, not a CAPTCHA on the calculator itself.

## Affiliate slots

Two slots ship switched off: mortgage-rate comparison and homeowners insurance. Set a URL
against its key in `PARTNER_LINKS` at the top of `assets/js/app.js` to turn one on:

```js
const PARTNER_LINKS = {
  rates: '',      // mortgage-rate comparison
  insurance: ''   // homeowners insurance
};
```

A slot with no URL stays hidden, so the page never ships a dead `href="#"` — and, more to
the point, never shows a "Paid link" label or a commission disclosure on a link that
earns nothing. The footer's paid-link sentence is gated on the same check, so turning a
slot on can't leave the disclosure behind and turning them all off can't leave a claim
about links that aren't there. With both keys empty, as they ship, the page says nothing
about affiliate links anywhere.

When a slot is on, the disclosure sits **with** the link: a `Paid link` label beside the
text and a full sentence directly beneath it, at 12.5px, visible without scrolling,
hovering or expanding anything. Both links carry `rel="sponsored noopener noreferrer"`.

The wording is deliberate. The FTC's
[Endorsement Guides](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
treat "Paid link" next to an affiliate link as adequate, and note that consumers often
don't understand what "affiliate link" means — "Partner" or "Sponsored" leaves more to
the reader. The same guidance is that a disclosure is likely to be missed if it appears
only in a footer, at the end of a page, or behind a "more" link, which is why the footer
line is a backstop rather than the disclosure itself. If you reword any of this, keep the
label unambiguous and keep it adjacent to the link.

**Before adding an affiliate relationship with anyone named in the rules-of-thumb
section**, note that the page currently states Openbook is "not affiliated with, endorsed
by or connected to" them. That sentence has to change if it stops being true, and the
independence it claims is doing real work for the rest of the page.

## Licence

Not yet chosen. Openbook is an independent tool, isn't affiliated with any lender, bank
or insurer, and is not financial, legal or tax advice.
