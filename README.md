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
assets/js/theme.js      Pre-paint theme stamp (kept external so CSP can ban inline script)
tests/calc.test.js      Engine tests
tests/guidance.test.js  Rule and readiness tests
tests/security.test.js  Untrusted-input tests for the share code
_headers                Response headers for hosts that read them (not GitHub Pages)
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
4. **The lender comparison.** The same solver run against what underwriting actually
   approves — see below.
5. **The rules of thumb.** The same solver again, once per published benchmark.

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
| [The Money Guy — 3/5/25](https://moneyguy.com/guide/home-buying/) | 3% down **on a first home** (20% after that), 5 years in the home, 25% of gross | monthly gross |
| The 28/36 rule | 28% of gross for housing, 36% including all debt — advice, not a limit | monthly gross |
| [What a lender will approve](https://selling-guide.fanniemae.com/sel/b3-6-02/debt-income-ratios) | 45% of gross counting all debt, **no front-end cap** | monthly gross |
| [HUD cost-burden line](https://www.huduser.gov/portal/pdredge/pdr_edge_featd_article_092214.html) | 30% of gross (50% is "severely cost burdened") | monthly gross |

### Approved is not the same as affordable

The hero comparison is against **what a lender will approve**, which is a much larger
number than the 28/36 rule most calculators quote:

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
percentage gets measured against whichever rule the reader has in mind. The hero prints
all three on both lines so the rule can be checked rather than taken on trust — on the
example household: 36% of take-home, 24% front-end, 33% back-end, so it clears 28/36 on
both counts.

Printing only the front end was actively misleading on the approval line, whose housing
share happens to be 36% of gross. Next to a rule whose second number is also 36, that
reads as "the lender is at the 28/36 limit" when its real back-end is 45%.

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
merely worth noting.

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

There are two tiers, on purpose.

**The in-tab draft** is written automatically to `sessionStorage` as you type. It
survives a refresh, the back button and a restored tab, and the browser destroys it when
the tab closes. It exists so a stray reload doesn't cost you twenty minutes of typing.

**"Save to this device"** writes to `localStorage` and outlives the tab. It is deliberately
something you ask for rather than the default: the page knows your salary, your debts and
what you have put by, and leaving that on a library or office machine for whoever sits
down next would undo the promise the rest of the site makes. Once you've saved once,
changes autosave.

On load an explicit save wins over a draft — it outlived a tab, so it's the newer intent —
and is announced with a banner. A draft is restored quietly, since it's the same tab you
typed it into. "Clear saved" clears both.

Drafts go through `hydrate()` like anything else, so a tampered one is sanitised rather
than trusted, and every draft call swallows its own failure — a blocked `sessionStorage`
must never be the reason something breaks.

**"Copy share code"** packs the state into a base64 string you can send by text or email;
the recipient pastes it into "Paste a code". A link can't carry the data reliably — the
page is often opened inside another app's viewer, which doesn't hand the script the URL —
so the code is the transport.

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
