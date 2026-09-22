/**
 * Refresh the per-state property tax rates from the U.S. Census Bureau.
 *
 * WHY THIS EXISTS AS A SCRIPT
 *
 * Property tax rates drift every year, and a stale figure in an affordability
 * calculator is not a rounding error: at 2% of a $600,000 home it is $1,000 a
 * month. Hand-maintaining fifty-one numbers from secondary sources that
 * disagree with each other is how the table got out of date in the first
 * place. This pulls them from the primary source instead, and
 * .github/workflows/proptax.yml runs it quarterly and opens a pull request when
 * anything moves.
 *
 * THE METHOD
 *
 * Two American Community Survey tables, both published for every state:
 *
 *   B25103_001E  median real estate taxes paid, owner-occupied housing units
 *   B25077_001E  median value, owner-occupied housing units
 *
 * The effective rate is the first divided by the second. That is the same
 * median-over-median method the widely quoted rankings use, and unlike them it
 * is reproducible: same query, same answer, and the query is right here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide what a *buyer* pays. The ACS measures people who already
 * own, and in states that cap assessment growth those are different numbers —
 * see assets/js/proptax-adjust.js, which is small, hand-maintained and
 * deliberately separate from anything automated.
 *
 * Run locally with: node scripts/fetch-proptax.mjs
 * (needs outbound access to api.census.gov, which most sandboxes block)
 */

import { writeFile } from 'node:fs/promises';

const OUT = 'assets/js/proptax.generated.js';

/** FIPS state codes to the postal codes the app uses. DC included; PR is not. */
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN',
  19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI',
  27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ',
  35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA',
  44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA',
  53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY'
};

const TAXES = 'B25103_001E';
const VALUE = 'B25077_001E';

/**
 * The newest release wins. ACS 1-year is the most current; the 5-year release
 * covers the same states with a longer window and lands earlier, so it is the
 * fallback rather than a second opinion.
 */
function candidateDatasets() {
  const year = new Date().getUTCFullYear();
  const list = [];
  for (let y = year; y >= year - 3; y--) {
    list.push({ year: y, survey: 'acs1', label: `ACS 1-year ${y}` });
    list.push({ year: y, survey: 'acs5', label: `ACS 5-year ${y}` });
  }
  return list;
}

async function fetchDataset({ year, survey, label }) {
  const url = `https://api.census.gov/data/${year}/acs/${survey}`
    + `?get=NAME,${TAXES},${VALUE}&for=state:*`;

  const response = await fetch(url, { headers: { 'User-Agent': 'openbook-proptax-refresh' } });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error(`${label}: unexpected shape`);

  const header = rows[0];
  const iTax = header.indexOf(TAXES);
  const iValue = header.indexOf(VALUE);
  const iState = header.indexOf('state');
  if (iTax < 0 || iValue < 0 || iState < 0) throw new Error(`${label}: columns missing`);

  const rates = {};
  for (const row of rows.slice(1)) {
    const code = FIPS[String(row[iState]).padStart(2, '0')] || FIPS[Number(row[iState])];
    if (!code) continue; // Puerto Rico and anything else outside the fifty states plus DC

    const taxes = Number(row[iTax]);
    const value = Number(row[iValue]);
    // The ACS uses large negative sentinels for suppressed or unavailable cells.
    if (!(taxes > 0) || !(value > 0)) continue;

    rates[code] = Math.round((taxes / value) * 10000) / 100; // percent, two decimals
  }

  const missing = Object.values(FIPS).filter((code) => !(code in rates));
  if (missing.length) throw new Error(`${label}: no usable figure for ${missing.join(', ')}`);

  return { label, rates };
}

async function main() {
  const failures = [];
  let dataset = null;

  for (const candidate of candidateDatasets()) {
    try {
      dataset = await fetchDataset(candidate);
      break;
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (!dataset) {
    console.error('Could not read any ACS release:\n  ' + failures.join('\n  '));
    process.exit(1);
  }

  const { label, rates } = dataset;
  const entries = Object.values(FIPS).sort().map((code) => `  ${code}: ${rates[code].toFixed(2)}`);

  const file = `/**
 * Per-state property tax rates, as a percent of home value a year.
 *
 * GENERATED — do not edit. Run scripts/fetch-proptax.mjs, or let the quarterly
 * workflow do it. What a *buyer* pays is a different question in states that
 * cap assessment growth; assets/js/proptax-adjust.js handles those by hand.
 *
 * Source:  U.S. Census Bureau, ${label}
 *          median real estate taxes paid (${TAXES})
 *          ÷ median home value (${VALUE}), owner-occupied units
 * Fetched: ${new Date().toISOString().slice(0, 10)}
 */

export const PROPTAX_SOURCE = {
  dataset: ${JSON.stringify(label)},
  method: 'median real estate taxes paid ÷ median home value, owner-occupied units',
  fetched: ${JSON.stringify(new Date().toISOString().slice(0, 10))}
};

/** Postal code to the owner-occupied effective rate, in percent. */
export const PROPTAX_OWNER_RATE = {
${entries.join(',\n')}
};
`;

  await writeFile(OUT, file);

  const sorted = Object.entries(rates).sort((a, b) => b[1] - a[1]);
  console.log(`${label}: ${sorted.length} states written to ${OUT}`);
  console.log(`highest: ${sorted.slice(0, 5).map(([c, r]) => `${c} ${r}%`).join(', ')}`);
  console.log(`lowest:  ${sorted.slice(-5).map(([c, r]) => `${c} ${r}%`).join(', ')}`);

  // A job summary, when there is one to write to.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    const table = ['| State | Rate |', '|---|---|', ...sorted.map(([c, r]) => `| ${c} | ${r}% |`)];
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Property tax refresh\n\n**${label}**, fetched ${new Date().toISOString().slice(0, 10)}\n\n${table.join('\n')}\n`);
  }
}

// Guarded so importing this module — from a test, or from a REPL exploring
// the parsing logic against a mocked fetch — never triggers a real network
// call or overwrites the generated file as a side effect of the import
// itself. Only running the file directly does that.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
