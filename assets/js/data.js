/**
 * Openbook — reference data.
 *
 * Everything here is a published figure or a broad national estimate. Nothing in
 * this file is user data: the app never sends anything anywhere, so these tables
 * ship with the page and the whole calculation runs in the browser.
 */

/* ---------------------------------------------------------------------------
 * Federal income tax
 * ------------------------------------------------------------------------- */

/** Marginal brackets as [lowerBound, rate] pairs, applied by calc.bracketTax(). */
export const BRACKETS = {
  single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
  mfj:    [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
  hoh:    [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]]
};

export const STD_DED = { single: 16100, mfj: 32200, hoh: 24150 };
export const ADDL_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000, hoh: 200000 };
export const SS_WAGE_BASE = 184500;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDL_MEDICARE_RATE = 0.009;

/**
 * The most an employee can put into a 401(k) themselves in a year — the IRC
 * §402(g) elective-deferral limit, $24,500 for 2026 (IRS Notice 2025-67).
 *
 * It matters to the readiness checks: above roughly $163,000 of salary, 15% of
 * gross is more than a 401(k) can legally hold, so measuring someone against a
 * rate they cannot reach in the account would be a warning about the law rather
 * than about their saving. Catch-up contributions ($8,000 at 50+, $11,250 at
 * 60-63) are deliberately not modelled: Openbook never asks your age.
 */
export const K401_ELECTIVE_LIMIT = 24500;

export const FILING_LABELS = {
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household'
};

export const PAY_FREQ = {
  weekly:      { divisor: 52, label: 'Weekly take-home',      short: 'per week' },
  biweekly:    { divisor: 26, label: 'Biweekly take-home',    short: 'every 2 weeks' },
  semimonthly: { divisor: 24, label: 'Semi-monthly take-home', short: 'twice a month' },
  monthly:     { divisor: 12, label: 'Monthly take-home',     short: 'per month' }
};

/* ---------------------------------------------------------------------------
 * Mortgage pricing
 * ------------------------------------------------------------------------- */

/** Broad national rate/PMI estimates by credit tier. `pmiMult` scales the LTV-based PMI base rate. */
export const CREDIT_BANDS = {
  '800': { rate30: 6.60, pmiMult: 0.90, label: '800+ (Excellent)' },
  '740': { rate30: 6.75, pmiMult: 1.15, label: '740–799 (Very good)' },
  '670': { rate30: 7.05, pmiMult: 1.90, label: '670–739 (Good)' },
  '580': { rate30: 7.85, pmiMult: 4.50, label: '580–669 (Fair)' },
  '300': { rate30: 9.20, pmiMult: 8.80, label: 'Below 580 (Poor)' }
};

/** A 15-year fixed typically prices below a 30-year by roughly this much. */
export const TERM_15_DISCOUNT = 0.69;

/**
 * Per-state figures.
 *   proptax — effective annual property tax as a % of home value
 *   ins     — homeowners-insurance cost tier, keyed into INS_TIER_RATE
 *   tax     — a flat rate (decimal) or a [lowerBound, rate] bracket table
 *
 * The state `tax` is applied to the SAME taxable-income base as the federal
 * calculation (gross minus the federal standard deduction, minus traditional
 * 401(k), minus pre-tax payroll items) rather than each state's own deductions,
 * exemptions and credits — so it is a solid estimate, not an exact figure. A few
 * smaller states without full published tables use a simplified two-bracket
 * approximation anchored to their real top rate and threshold. Local/city income
 * tax (NYC, for instance) is not modeled.
 */
export const STATE_DATA = {
  AL: { name: 'Alabama', proptax: 0.37, ins: 'high', tax: [[0, 0.02], [500, 0.04], [3000, 0.05]] },
  AK: { name: 'Alaska', proptax: 1.04, ins: 'low', tax: 0 },
  AZ: { name: 'Arizona', proptax: 0.48, ins: 'medium', tax: 0.025 },
  AR: { name: 'Arkansas', proptax: 0.52, ins: 'high', tax: [[0, 0.02], [4500, 0.039]] },
  CA: { name: 'California', proptax: 0.71, ins: 'low', tax: [[0, 0.01], [11079, 0.02], [26264, 0.04], [41452, 0.06], [57542, 0.08], [72724, 0.093]] },
  CO: { name: 'Colorado', proptax: 0.55, ins: 'co', tax: 0.044 },
  CT: { name: 'Connecticut', proptax: 1.54, ins: 'medium', tax: [[0, 0.02], [10000, 0.045], [50000, 0.055], [100000, 0.06], [200000, 0.065], [250000, 0.069], [500000, 0.0699]] },
  DE: { name: 'Delaware', proptax: 0.53, ins: 'low', tax: [[0, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]] },
  FL: { name: 'Florida', proptax: 0.71, ins: 'high', tax: 0 },
  GA: { name: 'Georgia', proptax: 0.72, ins: 'high', tax: 0.0539 },
  HI: { name: 'Hawaii', proptax: 0.29, ins: 'low', tax: [[0, 0.014], [9600, 0.032], [14400, 0.055], [19200, 0.064], [24000, 0.068], [36000, 0.072], [48000, 0.076], [125000, 0.079], [175000, 0.0825], [225000, 0.09], [275000, 0.10], [325000, 0.11]] },
  ID: { name: 'Idaho', proptax: 0.49, ins: 'low', tax: 0.05695 },
  IL: { name: 'Illinois', proptax: 1.88, ins: 'medium', tax: 0.0495 },
  IN: { name: 'Indiana', proptax: 0.71, ins: 'medium', tax: 0.03 },
  IA: { name: 'Iowa', proptax: 1.29, ins: 'medium', tax: 0.038 },
  KS: { name: 'Kansas', proptax: 1.19, ins: 'high', tax: [[0, 0.052], [23000, 0.0558]] },
  KY: { name: 'Kentucky', proptax: 0.72, ins: 'medium', tax: 0.04 },
  LA: { name: 'Louisiana', proptax: 0.42, ins: 'high', tax: 0.03 },
  ME: { name: 'Maine', proptax: 1.02, ins: 'low', tax: [[0, 0.058], [26050, 0.0675], [61600, 0.0715]] },
  MD: { name: 'Maryland', proptax: 0.98, ins: 'medium', tax: [[0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [100000, 0.05], [125000, 0.0525], [150000, 0.055], [250000, 0.0575], [500000, 0.0625], [1000000, 0.065]] },
  MA: { name: 'Massachusetts', proptax: 1.02, ins: 'medium', tax: 0.05 },
  MI: { name: 'Michigan', proptax: 1.24, ins: 'medium', tax: 0.0425 },
  MN: { name: 'Minnesota', proptax: 0.93, ins: 'medium', tax: [[0, 0.0535], [32570, 0.068], [106990, 0.078], [198630, 0.098]] },
  MS: { name: 'Mississippi', proptax: 0.52, ins: 'high', tax: 0.044 },
  MO: { name: 'Missouri', proptax: 0.81, ins: 'high', tax: [[0, 0.02], [9191, 0.047]] },
  MT: { name: 'Montana', proptax: 0.62, ins: 'medium', tax: [[0, 0.047], [21100, 0.059]] },
  NE: { name: 'Nebraska', proptax: 1.35, ins: 'high', tax: [[0, 0.0351], [38870, 0.052]] },
  NV: { name: 'Nevada', proptax: 0.44, ins: 'low', tax: 0 },
  NH: { name: 'New Hampshire', proptax: 1.50, ins: 'low', tax: 0 },
  NJ: { name: 'New Jersey', proptax: 1.88, ins: 'low', tax: [[0, 0.014], [20000, 0.0175], [35000, 0.035], [40000, 0.055], [75000, 0.0637], [500000, 0.0897], [1000000, 0.1075]] },
  NM: { name: 'New Mexico', proptax: 0.61, ins: 'medium', tax: [[0, 0.015], [5500, 0.032], [16500, 0.043], [33500, 0.047], [66500, 0.049], [210000, 0.059]] },
  NY: { name: 'New York', proptax: 1.30, ins: 'low', tax: [[0, 0.04], [8500, 0.045], [11700, 0.053], [13900, 0.055], [80650, 0.06], [215400, 0.069], [1077550, 0.097], [5000000, 0.103], [25000000, 0.109]] },
  NC: { name: 'North Carolina', proptax: 0.63, ins: 'medium', tax: 0.0425 },
  ND: { name: 'North Dakota', proptax: 0.90, ins: 'medium', tax: [[0, 0], [48475, 0.019], [244825, 0.025]] },
  OH: { name: 'Ohio', proptax: 1.36, ins: 'medium', tax: [[0, 0], [26050, 0.0275], [100000, 0.031]] },
  OK: { name: 'Oklahoma', proptax: 0.75, ins: 'high', tax: [[0, 0.02], [7200, 0.0475]] },
  OR: { name: 'Oregon', proptax: 0.76, ins: 'low', tax: [[0, 0.0475], [4400, 0.0675], [11100, 0.0875], [125000, 0.099]] },
  PA: { name: 'Pennsylvania', proptax: 1.29, ins: 'medium', tax: 0.0307 },
  RI: { name: 'Rhode Island', proptax: 1.17, ins: 'medium', tax: [[0, 0.0375], [79900, 0.0475], [181650, 0.0599]] },
  SC: { name: 'South Carolina', proptax: 0.49, ins: 'high', tax: [[0, 0.0199], [30000, 0.0521]] },
  SD: { name: 'South Dakota', proptax: 1.02, ins: 'medium', tax: 0 },
  TN: { name: 'Tennessee', proptax: 0.51, ins: 'medium', tax: 0 },
  TX: { name: 'Texas', proptax: 1.40, ins: 'high', tax: 0 },
  UT: { name: 'Utah', proptax: 0.48, ins: 'low', tax: 0.0455 },
  VT: { name: 'Vermont', proptax: 1.51, ins: 'low', tax: [[0, 0.0335], [49400, 0.066], [119700, 0.076], [249700, 0.0875]] },
  VA: { name: 'Virginia', proptax: 0.75, ins: 'medium', tax: [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]] },
  WA: { name: 'Washington', proptax: 0.76, ins: 'low', tax: 0 },
  WV: { name: 'West Virginia', proptax: 0.51, ins: 'medium', tax: [[0, 0.036], [60000, 0.0482]] },
  WI: { name: 'Wisconsin', proptax: 1.38, ins: 'medium', tax: [[0, 0.035], [14680, 0.044], [50480, 0.053], [323290, 0.0765]] },
  WY: { name: 'Wyoming', proptax: 0.51, ins: 'low', tax: 0 },
  DC: { name: 'District of Columbia', proptax: 0.46, ins: 'medium', tax: [[0, 0.04], [10000, 0.06], [40000, 0.065], [60000, 0.085], [250000, 0.0925], [500000, 0.0975], [1000000, 0.1075]] }
};

/** Annual homeowners premium as a % of home value, by tier. */
export const INS_TIER_RATE = { high: 1.05, medium: 0.65, low: 0.40, co: 0.85 };

export const INS_TIER_TEXT = {
  high: 'Insurance here tends to run above the national average — roughly 0.8%–1.3% of home value a year, given weather and catastrophe risk.',
  medium: 'Insurance here tends to run close to the national average — roughly 0.5%–0.8% of home value a year.',
  low: 'Insurance here tends to run below the national average — roughly 0.25%–0.5% of home value a year.',
  co: 'Insurance here runs well above the national average because of hail and wildfire risk — roughly 0.7%–1.2% of home value a year.'
};

/**
 * The classic 28/36 rule of thumb: housing ≤ 28% of gross monthly income, and
 * housing plus all other debt ≤ 36%. This is *advice* — the figure textbooks and
 * advisers quote. It is not what a lender enforces, and conflating the two is
 * the most common way an affordability calculator flatters itself.
 */
export const DTI_FRONT_END = 0.28;
export const DTI_BACK_END = 0.36;

/**
 * What a lender will actually approve, which is a different and much larger
 * number.
 *
 * A conventional loan has no hard front-end housing cap — 28% is a guideline,
 * not a requirement, and total debt-to-income is what underwriting enforces.
 * Fannie Mae's automated underwriter (Desktop Underwriter) allows total DTI up
 * to 50%; manual underwriting starts at 36% and stretches to 45% on credit
 * score and reserves. FHA runs to 57% with an automated approval and strong
 * compensating factors.
 *
 * 45% is modelled here as where a typical conventional approval lands: past what
 * manual underwriting allows without compensating factors, short of the DU
 * ceiling. Erring low is deliberate — the real gap is more often wider than this
 * than narrower.
 */
export const DTI_APPROVAL = 0.45;
export const DTI_DU_CEILING = 0.50;
export const DTI_FHA_CEILING = 0.57;
