/**
 * Openbook — the interface.
 *
 * Reads and writes the DOM; all arithmetic lives in calc.js and all persistence
 * in state.js. The pattern throughout: structural changes re-render a list,
 * value changes only recompute — so typing never steals your own focus.
 */

import {
  STATE_DATA, CREDIT_BANDS, INS_TIER_TEXT, FILING_LABELS,
  DTI_APPROVAL, DTI_DU_CEILING, DTI_FRONT_END, DTI_BACK_END
} from './data.js';
import { compute, parseNum, itemAmount } from './calc.js';
import { evaluateBenchmarks, scoreBenchmarks, readiness } from './guidance.js';
import {
  createDefaultState, createEmptyState, newItem, hydrate,
  save, load, clear, saveDraft, loadDraft, clearDraft,
  encodeShareCode, decodeShareCode
} from './state.js';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------------
 * Affiliate slots
 *
 * Put your affiliate URL against a key to turn that slot on. A slot with no URL
 * stays hidden: each one carries a "Paid link" label and a line saying Openbook
 * earns a commission, and neither should appear on a link that earns nothing.
 *
 * Both links render with rel="sponsored noopener noreferrer", and the
 * disclosure sits with the link rather than only in the footer — the FTC's
 * guidance is that a disclosure tucked into a footer or behind a "more" link is
 * likely to be missed.
 * ------------------------------------------------------------------------- */

const PARTNER_LINKS = {
  rates: '',      // mortgage-rate comparison
  insurance: ''   // homeowners insurance
};

function mountPartnerSlots() {
  let anyLive = false;
  for (const slot of document.querySelectorAll('[data-partner]')) {
    const url = PARTNER_LINKS[slot.dataset.partner];
    if (!url) continue;
    slot.querySelector('.partner-link').href = url;
    slot.hidden = false;
    anyLive = true;
  }
  // The footer's paid-link sentence appears with the first live slot and stays
  // hidden until then — so turning a slot on can't leave the disclosure behind,
  // and turning them all off can't leave a claim about links that aren't there.
  $('affiliateDisclosure').hidden = !anyLive;
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

const money = (n) => `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;
const moneyNeg = (n) => `−${money(Math.abs(n))}`;
const pct = (n, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const commas = (n) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US');

/* ---------------------------------------------------------------------------
 * App state
 * ------------------------------------------------------------------------- */

let state = createDefaultState();
let isExampleData = true;
let saveTimer = null;
let lastResult = null;

/* ---------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------- */

function currentTheme() {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped) return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

$('themeToggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('openbook.theme', next); } catch (e) { /* private mode */ }
  paint();
});

/* ---------------------------------------------------------------------------
 * Toast & banner
 * ------------------------------------------------------------------------- */

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

function banner(message) {
  const slot = $('bannerSlot');
  slot.textContent = '';
  if (!message) return;
  const wrap = document.createElement('div');
  wrap.className = 'banner';
  const text = document.createElement('span');
  text.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => { slot.textContent = ''; });
  wrap.append(text, dismiss);
  slot.appendChild(wrap);
}

/* ---------------------------------------------------------------------------
 * Tabs
 * ------------------------------------------------------------------------- */

const tabs = Array.from(document.querySelectorAll('.tab'));

function selectTab(id, { focus = false } = {}) {
  tabs.forEach((tab) => {
    const isActive = tab.id === id;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !isActive;
  });
  if (focus) $(id).focus();
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.id));
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    selectTab(tabs[(index + step + tabs.length) % tabs.length].id, { focus: true });
  });
});

document.querySelectorAll('[data-goto-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    selectTab(button.dataset.gotoTab);
    $('calculator').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ---------------------------------------------------------------------------
 * Controls
 * ------------------------------------------------------------------------- */

/** A segmented control: one pressed button at a time. */
function segmented(container, options, value, onSelect) {
  container.textContent = '';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.setAttribute('aria-pressed', String(option.value === value));
    button.addEventListener('click', () => onSelect(option.value));
    container.appendChild(button);
  }
}

function iconButton(className, label, pathHtml) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `line-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${pathHtml}</svg>`;
  return button;
}

const ICONS = {
  check: '<path d="M4.5 12.5l5 5 10-11" />',
  circle: '<circle cx="12" cy="12" r="8" />',
  up: '<path d="M6 14l6-6 6 6" />',
  down: '<path d="M6 10l6 6 6-6" />',
  remove: '<line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />'
};

/** A money or percentage input, adorned with $ / % / per-month. */
function valueField(item, { allowPct }) {
  const wrap = document.createElement('div');
  wrap.className = 'line-value';
  const field = document.createElement('div');
  const isPct = allowPct && item.mode === 'pct';
  field.className = 'adorned has-suffix';

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.setAttribute('aria-label', `${item.label || 'Item'} amount`);

  if (isPct) {
    input.value = item.value;
    const suffix = document.createElement('span');
    suffix.className = 'suffix';
    suffix.textContent = '%';
    field.append(input, suffix);
  } else {
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = '$';
    input.value = commas(item.value);
    const suffix = document.createElement('span');
    suffix.className = 'suffix';
    suffix.textContent = '/mo';
    field.append(prefix, input, suffix);
  }

  input.addEventListener('input', () => { item.value = parseNum(input.value); touched(); });
  input.addEventListener('blur', () => { if (!isPct) input.value = commas(item.value); });
  wrap.appendChild(field);
  return wrap;
}

/**
 * Render one editable list of line items. Called on structural change only
 * (add, remove, reorder, mode switch) — never on every keystroke.
 */
function renderLineList(containerId, items, options) {
  const container = $(containerId);
  container.textContent = '';

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'line-empty';
    empty.textContent = options.emptyText;
    container.appendChild(empty);
    return;
  }

  const rerender = () => { renderLineList(containerId, items, options); touched(); };

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'line-row';
    row.classList.toggle('is-excluded', Boolean(item.excluded));

    const top = document.createElement('div');
    top.className = 'line-top';

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'line-label';
    label.value = item.label;
    label.setAttribute('aria-label', 'Item name');
    label.addEventListener('input', () => { item.label = label.value; scheduleSave(); });
    top.appendChild(label);

    const include = iconButton(
      item.excluded ? '' : 'is-on',
      item.excluded ? `Include ${item.label} in totals` : `Exclude ${item.label} from totals`,
      item.excluded ? ICONS.circle : ICONS.check
    );
    include.setAttribute('aria-pressed', String(!item.excluded));
    include.addEventListener('click', () => { item.excluded = !item.excluded; rerender(); });
    top.appendChild(include);

    const moves = document.createElement('div');
    moves.className = 'line-moves';
    const up = iconButton('', `Move ${item.label} up`, ICONS.up);
    up.disabled = index === 0;
    up.addEventListener('click', () => { items.splice(index - 1, 0, items.splice(index, 1)[0]); rerender(); });
    const down = iconButton('', `Move ${item.label} down`, ICONS.down);
    down.disabled = index === items.length - 1;
    down.addEventListener('click', () => { items.splice(index + 1, 0, items.splice(index, 1)[0]); rerender(); });
    moves.append(up, down);
    top.appendChild(moves);

    const remove = iconButton('is-remove', `Remove ${item.label}`, ICONS.remove);
    remove.addEventListener('click', () => { items.splice(index, 1); rerender(); });
    top.appendChild(remove);

    row.appendChild(top);

    const controls = document.createElement('div');
    controls.className = 'line-controls';

    if (options.allowPct) {
      const unit = document.createElement('div');
      unit.className = 'segmented';
      unit.setAttribute('role', 'group');
      unit.setAttribute('aria-label', `${item.label} unit`);
      segmented(unit, [{ label: '$', value: 'dollar' }, { label: '%', value: 'pct' }], item.mode, (mode) => {
        item.mode = mode;
        if (mode === 'pct') item.pretax = false; // a % of take-home isn't defined pre-tax
        rerender();
      });
      controls.appendChild(unit);
    }

    controls.appendChild(valueField(item, options));

    if (options.allowPretax && item.mode !== 'pct') {
      const pretax = document.createElement('button');
      pretax.type = 'button';
      pretax.className = 'pretax-toggle';
      pretax.textContent = 'Pre-tax';
      pretax.setAttribute('aria-pressed', String(Boolean(item.pretax)));
      pretax.title = 'Deducted from your paycheck before tax, like an HSA or health premium';
      pretax.addEventListener('click', () => { item.pretax = !item.pretax; rerender(); });
      controls.appendChild(pretax);
    }

    row.appendChild(controls);
    container.appendChild(row);
  });
}

function renderLists() {
  renderLineList('savingsList', state.savingsItems, {
    allowPct: true, allowPretax: true, emptyText: 'No savings items yet — add one below.'
  });
  renderLineList('debtsList', state.debtItems, {
    allowPct: false, allowPretax: false, emptyText: 'No debts. Enviable.'
  });
  renderLineList('expensesList', state.expenseItems, {
    allowPct: false, allowPretax: true, emptyText: 'No recurring expenses yet — add one below.'
  });
}

/** The 401(k) amount field, whose adornment depends on % vs $ mode. */
function render401kValue() {
  const wrap = $('k401Value');
  wrap.textContent = '';
  const field = document.createElement('div');
  field.className = 'adorned has-suffix';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.id = 'k401Input';
  input.setAttribute('aria-label', '401(k) contribution amount');

  if (state.k401.mode === 'dollar') {
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = '$';
    input.value = commas(state.k401.pct);
    const suffix = document.createElement('span');
    suffix.className = 'suffix';
    suffix.textContent = '/mo';
    field.append(prefix, input, suffix);
  } else {
    input.value = state.k401.pct;
    const suffix = document.createElement('span');
    suffix.className = 'suffix';
    suffix.textContent = '%';
    field.append(input, suffix);
  }

  input.addEventListener('input', () => { state.k401.pct = parseNum(input.value); touched(); });
  input.addEventListener('blur', () => { if (state.k401.mode === 'dollar') input.value = commas(state.k401.pct); });
  wrap.appendChild(field);
}

function renderSegments() {
  segmented($('seg401kMode'), [{ label: '%', value: 'pct' }, { label: '$', value: 'dollar' }], state.k401.mode, (mode) => {
    state.k401.mode = mode;
    render401kValue();
    renderSegments();
    touched();
  });
  segmented($('seg401kType'), [{ label: 'Traditional', value: 'traditional' }, { label: 'Roth', value: 'roth' }], state.k401.type, (type) => {
    state.k401.type = type;
    renderSegments();
    touched();
  });
  segmented($('segTerm'), [{ label: '30-year fixed', value: 30 }, { label: '15-year fixed', value: 15 }], state.term, (term) => {
    state.term = term;
    renderSegments();
    touched();
  });
  segmented($('segInsMode'), [{ label: 'Estimate for me', value: 'estimate' }, { label: 'I know my premium', value: 'manual' }], state.insMode, (mode) => {
    state.insMode = mode;
    $('insManualWrap').hidden = mode !== 'manual';
    renderSegments();
    touched();
  });
  segmented($('segFirstHome'), [{ label: 'Yes, my first', value: true }, { label: 'No, I\'ve owned before', value: false }], state.firstHome !== false, (value) => {
    state.firstHome = value;
    renderSegments();
    touched();
  });
  segmented($('segPriceMode'), [{ label: 'The estimate above', value: 'auto' }, { label: 'A price I enter', value: 'manual' }], state.priceTestMode, (mode) => {
    state.priceTestMode = mode;
    if (mode === 'manual' && !state.testPrice) state.testPrice = Math.round(lastResult?.price || 400000);
    $('testPriceWrap').hidden = mode !== 'manual';
    if (state.testPrice != null) $('testPrice').value = commas(state.testPrice);
    renderSegments();
    touched();
  });
}

/* ---------------------------------------------------------------------------
 * Charts
 * ------------------------------------------------------------------------- */

const tip = document.createElement('div');
tip.className = 'viz-tip';
document.body.appendChild(tip);

function attachTip(element, text) {
  element.addEventListener('pointerenter', (event) => {
    tip.textContent = text;
    tip.classList.add('is-visible');
    moveTip(event);
  });
  element.addEventListener('pointermove', moveTip);
  element.addEventListener('pointerleave', () => tip.classList.remove('is-visible'));
}

function moveTip(event) {
  const pad = 14;
  const x = Math.min(event.clientX + pad, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, event.clientY - tip.offsetHeight - pad)}px`;
}

const PAYMENT_PARTS = [
  { key: 'pi', label: 'Principal & interest', series: 'var(--series-1)' },
  { key: 'tax', label: 'Property tax', series: 'var(--series-2)' },
  { key: 'insurance', label: 'Insurance', series: 'var(--series-3)' },
  { key: 'pmi', label: 'PMI', series: 'var(--series-4)' },
  { key: 'hoa', label: 'HOA', series: 'var(--series-5)' }
];

/**
 * Composition of the monthly payment: a thin stacked bar with a 2px surface gap
 * between segments, plus a legend that direct-labels every segment with its
 * value — so identity never rests on colour alone.
 */
function renderPaymentViz(payment) {
  const bar = $('paymentBar');
  const legend = $('paymentLegend');
  bar.textContent = '';
  legend.textContent = '';

  const total = payment.total || 0;
  bar.setAttribute('aria-label', `Monthly payment of ${money(total)}, made up of ${
    PAYMENT_PARTS.filter((p) => payment[p.key] > 0).map((p) => `${p.label} ${money(payment[p.key])}`).join(', ')
  }`);

  for (const part of PAYMENT_PARTS) {
    const value = payment[part.key] || 0;
    const share = total > 0 ? value / total : 0;

    const segment = document.createElement('div');
    segment.className = 'stack-seg';
    segment.classList.toggle('is-empty', value <= 0);
    segment.style.flex = `${share} 1 0`;
    segment.style.background = part.series;
    if (value > 0) attachTip(segment, `${part.label} · ${money(value)}/mo · ${pct(share)}`);
    bar.appendChild(segment);

    if (value <= 0) continue;
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = part.series;
    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = part.label;
    const amount = document.createElement('span');
    amount.className = 'legend-value';
    amount.textContent = money(value);
    item.append(swatch, label, amount);
    legend.appendChild(item);
  }
}

/**
 * Each ratio set against the limit the 28/36 rule actually states, so the
 * comparison is made on screen rather than left to the reader. A bare "24%"
 * means nothing without the 28% it is being measured against.
 */
function renderDtiCheck(container, frontEnd, backEnd, caption) {
  container.textContent = '';

  if (caption) {
    const note = document.createElement('p');
    note.className = 'dti-caption';
    note.textContent = caption;
    container.appendChild(note);
  }

  const rows = [
    { label: 'Housing', value: frontEnd, limit: DTI_FRONT_END },
    { label: 'With your debts', value: backEnd, limit: DTI_BACK_END }
  ];

  for (const row of rows) {
    const within = row.value <= row.limit + 0.0005;

    const line = document.createElement('div');
    line.className = 'dti-row';

    const label = document.createElement('span');
    label.className = 'dti-label';
    label.textContent = row.label;

    const figures = document.createElement('span');
    figures.className = 'dti-figures';
    const actual = document.createElement('strong');
    actual.textContent = pct(row.value);
    figures.append(actual, ` of gross · rule allows ${pct(row.limit)}`);

    const mark = document.createElement('span');
    mark.className = `dti-mark ${within ? 'is-ok' : 'is-over'}`;
    mark.textContent = within ? '\u2713' : '\u2715';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', within ? 'within the rule' : 'over the rule');

    line.append(label, figures, mark);
    container.appendChild(line);
  }
}

/** The hero comparison: approved vs. affordable, both direct-labelled. */
function renderCompare(result) {
  const lender = result.approval.price;
  const openbook = result.price;
  const max = Math.max(lender, openbook, 1);

  $('lenderBar').style.width = `${(lender / max) * 100}%`;
  $('openbookBar').style.width = `${(openbook / max) * 100}%`;
  $('lenderPrice').textContent = money(lender);
  $('openbookPrice').textContent = money(openbook);

  $('lenderNote').textContent = `A ${money(result.approval.payment.total)}/mo payment — ${
    pct(result.approvalShareOfTakeHome)} of take-home pay.`;
  $('openbookNote').textContent = `A ${money(result.payment.total)}/mo payment — ${
    pct(result.estimateShareOfTakeHome)} of take-home pay.`;

  // The lender's rows are the rule being broken, not applied — said out loud,
  // because two crosses under a heading that names a rule read like a failure
  // on our part rather than the lender's.
  renderDtiCheck(
    $('lenderDti'), result.approvalFrontEnd, result.approvalBackEnd,
    "A lender doesn't apply the 28/36 rule. Here's how far past it this goes:"
  );
  renderDtiCheck($('openbookDti'), result.estimateFrontEnd, result.estimateBackEnd);

  const gap = lender - openbook;
  const chip = $('deltaChip');
  if (gap > 1000) {
    chip.textContent = `${money(gap)} of "approved" you probably shouldn't spend`;
    chip.hidden = false;
  } else if (gap < -1000) {
    chip.textContent = `${money(-gap)} more than a lender would approve`;
    chip.hidden = false;
  } else {
    chip.textContent = 'Both answers land in the same place';
    chip.hidden = false;
  }

  const stateName = (STATE_DATA[state.stateCode] || {}).name || '';
  $('compareContext').textContent = `${money(state.salary)} salary, ${
    FILING_LABELS[state.filing].toLowerCase()}, in ${stateName}.`;
  $('compareSource').textContent = isExampleData
    ? 'Example numbers — change them below.'
    : 'Your numbers, live.';
}

/* ---------------------------------------------------------------------------
 * Ledger
 * ------------------------------------------------------------------------- */

const LEDGER_ROWS = [
  { key: 'savings', label: 'Savings (post-tax)' },
  { key: 'debts', label: 'Debts' },
  { key: 'expenses', label: 'Other recurring expenses' },
  { key: 'housing', label: 'Estimated housing payment' }
];

/** Built once; only the figures inside change, so an open row stays open. */
function buildLedgerRows() {
  const container = $('ledgerRows');
  container.textContent = '';
  for (const row of LEDGER_ROWS) {
    const details = document.createElement('details');
    details.className = 'ledger-row';
    details.id = `ledgerRow-${row.key}`;

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'row-label';
    label.innerHTML = '<span class="chev" aria-hidden="true">▾</span>';
    label.append(row.label);
    const value = document.createElement('span');
    value.className = 'row-value';
    value.id = `ledgerValue-${row.key}`;
    value.textContent = '$0';
    summary.append(label, value);

    const body = document.createElement('div');
    body.className = 'ledger-detail';
    body.id = `ledgerDetail-${row.key}`;

    details.append(summary, body);
    container.appendChild(details);
  }
}

function detailRows(container, rows, emptyText) {
  container.textContent = '';
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('dl');
  list.className = 'stat-list';
  list.style.marginTop = '0';
  for (const row of rows) {
    const stat = document.createElement('div');
    stat.className = 'stat';
    stat.classList.toggle('is-excluded', Boolean(row.excluded));
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    if (row.excluded) {
      const tag = document.createElement('span');
      tag.className = 'excl-tag';
      tag.textContent = 'excluded';
      dt.appendChild(tag);
    }
    const dd = document.createElement('dd');
    dd.textContent = money(row.amount);
    stat.append(dt, dd);
    list.appendChild(stat);
  }
  container.appendChild(list);
}

function renderLedger(result) {
  const { ledger, paycheck } = result;

  $('ledgerIncome').textContent = money(paycheck.netMonthly);
  const payrollDeducted = result.k401Monthly + result.pretaxMonthly;
  $('ledgerIncomeHint').textContent = payrollDeducted > 0
    ? `${money(payrollDeducted)}/mo of 401(k) and pre-tax deductions already left your paycheck before this figure, so they aren't listed again below.`
    : '';

  for (const row of LEDGER_ROWS) {
    $(`ledgerValue-${row.key}`).textContent = money(ledger.debits[row.key]);
  }

  detailRows(
    $('ledgerDetail-savings'),
    state.savingsItems
      .filter((item) => !(item.pretax && item.mode !== 'pct'))
      .map((item) => ({
        label: item.mode === 'pct'
          ? `${item.label || 'Untitled'} (${parseNum(item.value)}% of take-home)`
          : (item.label || 'Untitled'),
        amount: itemAmount(item, paycheck.netMonthly),
        excluded: Boolean(item.excluded)
      })),
    'No post-tax savings items.'
  );

  detailRows(
    $('ledgerDetail-debts'),
    state.debtItems.map((item) => ({
      label: item.label || 'Untitled', amount: parseNum(item.value), excluded: Boolean(item.excluded)
    })),
    'No debts entered.'
  );

  detailRows(
    $('ledgerDetail-expenses'),
    state.expenseItems.filter((item) => !item.pretax).map((item) => ({
      label: item.label || 'Untitled', amount: parseNum(item.value), excluded: Boolean(item.excluded)
    })),
    'No other recurring expenses.'
  );

  const housing = ledger.payment;
  const housingBody = $('ledgerDetail-housing');
  housingBody.textContent = '';
  const context = document.createElement('p');
  context.className = 'hint';
  context.style.margin = '0 0 4px';
  context.textContent = ledger.usingTestPrice
    ? `Based on the ${money(housing.price)} home price you entered.`
    : `Based on the ${money(result.price)} affordability estimate above.`;
  housingBody.appendChild(context);
  const parts = document.createElement('div');
  housingBody.appendChild(parts);
  detailRows(parts, PAYMENT_PARTS.map((part) => ({ label: part.label, amount: housing[part.key] })), '');

  $('ledgerDebits').textContent = money(ledger.debitsTotal);

  const net = ledger.unallocated;
  $('ledgerNet').textContent = net < 0 ? moneyNeg(net) : money(net);
  $('ledgerNetRow').classList.toggle('is-negative', net < -1);

  $('ledgerNetHint').textContent = ledger.usingTestPrice
    ? `What's left over — or short — each month if you buy at that price instead of the ${money(result.price)} estimate.`
    : result.pmiTierLimited
      ? `This sits a little above $0 because your estimated price lands right on a mortgage-insurance pricing tier. One dollar more of house would push PMI into a costlier tier and overshoot your budget by more than the extra house is worth, leaving ${money(net)}/mo unused. That's how tiered PMI works, not an error.`
      : net < -1
        ? "This is negative because savings, debts and expenses already use up your whole take-home pay — even a house bought outright at your down payment still costs more each month in insurance and HOA than you have left."
        : "This should land at — or very near — $0, because the estimated home price is sized to use up exactly what's left after savings, debts and expenses.";
}

/* ---------------------------------------------------------------------------
 * Rules of thumb
 * ------------------------------------------------------------------------- */

const CHECK_GLYPH = { pass: '\u2713', caution: '!', fail: '\u2715', unknown: '?' };

/**
 * One row per benchmark: the price it allows, as a bar, direct-labelled with
 * both the figure and a verdict — so nothing here is carried by colour alone.
 * The ceiling rule also gets a hatched fill, because it's a limit, not a target.
 */
function renderBenchmarks(result) {
  const evaluated = evaluateBenchmarks(result, state);
  const max = Math.max(...evaluated.map((b) => b.price), 1);
  const sorted = [...evaluated].sort((a, b) => b.price - a.price);

  const list = $('ruleRows');
  list.textContent = '';

  for (const benchmark of sorted) {
    const row = document.createElement('li');
    row.className = 'rule-row';
    row.classList.toggle('is-you', Boolean(benchmark.isYou));
    row.classList.toggle('is-ceiling', Boolean(benchmark.isCeiling));

    const head = document.createElement('div');
    head.className = 'rule-head';
    const name = document.createElement('span');
    name.className = 'rule-name';
    name.textContent = benchmark.name;
    const basis = document.createElement('span');
    basis.className = 'rule-basis';
    basis.textContent = benchmark.rule;
    head.append(name, basis);

    const track = document.createElement('div');
    track.className = 'rule-track';
    const fill = document.createElement('div');
    fill.className = 'rule-fill';
    fill.style.width = `${(benchmark.price / max) * 100}%`;
    track.appendChild(fill);
    attachTip(track, `${benchmark.name} · up to ${money(benchmark.price)} · ${money(benchmark.budget)}/mo`);

    const figures = document.createElement('div');
    figures.className = 'rule-figures';
    const price = document.createElement('span');
    price.className = 'rule-price';
    price.textContent = money(benchmark.price);

    const chip = document.createElement('span');
    chip.className = 'verdict-chip';
    if (benchmark.isYou) {
      chip.classList.add('is-you');
      chip.innerHTML = '<span class="chip-icon" aria-hidden="true">\u25CF</span>';
      chip.append('Your plan');
    } else if (benchmark.fits) {
      // "Fits" suits a rule you're meeting; a ceiling you're merely under is
      // not the same claim.
      chip.classList.add('is-pass');
      chip.innerHTML = '<span class="chip-icon" aria-hidden="true">\u2713</span>';
      chip.append(benchmark.isCeiling ? 'Under' : 'Fits');
    } else {
      chip.classList.add('is-over');
      chip.innerHTML = '<span class="chip-icon" aria-hidden="true">\u25B2</span>';
      chip.append(`${money(benchmark.over)}/mo over`);
    }
    figures.append(price, chip);

    const note = document.createElement('details');
    note.className = 'rule-note';
    const summary = document.createElement('summary');
    summary.textContent = benchmark.isYou ? 'What this line is' : 'Where this number comes from';
    const body = document.createElement('p');
    body.textContent = `${benchmark.note} It allows ${money(benchmark.budget)} a month — ${
      pct(benchmark.shareOfTakeHome)} of your take-home pay, ${pct(benchmark.shareOfGross)} of gross.`;
    note.append(summary, body);
    if (benchmark.url) {
      const link = document.createElement('a');
      link.href = benchmark.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `Read ${benchmark.source} on this \u2192`;
      const wrap = document.createElement('p');
      wrap.appendChild(link);
      note.appendChild(wrap);
    }

    row.append(head, track, figures, note);
    list.appendChild(row);
  }

  // --- headline verdict ---
  // Measured against the payment actually on the table: the affordability
  // estimate normally, or the price typed into the ledger's what-if.
  const score = scoreBenchmarks(evaluated);
  const missed = score.missed;
  const planned = result.ledger.payment;
  const opening = result.ledger.usingTestPrice
    ? `A ${money(planned.price)} house — ${money(planned.total)} a month —`
    : `At ${money(planned.total)} a month, your plan`;

  $('rulesScore').textContent = `${score.passed} of ${score.total}`;

  const verdict = $('rulesVerdict');
  verdict.textContent = '';
  if (score.passed === score.total) {
    verdict.innerHTML = `${opening} clears <strong>all ${score.total}</strong> of them.`;
  } else if (score.passed === 0) {
    verdict.innerHTML = `${opening} is above <strong>every one</strong> of them. That is the clearest signal there is to look at a cheaper house, or a bigger down payment.`;
  } else {
    const names = missed.map((b) => b.name).join(' and ');
    verdict.innerHTML = `${opening} clears <strong>${score.passed} of ${score.total}</strong> — it comes in over ${names}.`;
  }

  // A breached ceiling is a different order of problem from a missed rule.
  for (const ceiling of score.ceilingsBreached) {
    const extra = document.createElement('span');
    extra.className = 'verdict-alarm';
    extra.textContent = ceiling.id === 'approval'
      ? ' A lender would not approve it either.'
      : ` It is also past ${ceiling.name.toLowerCase()}.`;
    verdict.appendChild(extra);
  }

  return evaluated;
}

function renderReadiness(result) {
  const list = $('readinessList');
  list.textContent = '';

  for (const check of readiness(result, state)) {
    const item = document.createElement('li');

    const mark = document.createElement('span');
    mark.className = `check-mark is-${check.status}`;
    mark.textContent = CHECK_GLYPH[check.status] || '?';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', `${check.status}:`);

    const body = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'check-label';
    label.textContent = check.label;
    const detail = document.createElement('p');
    detail.className = 'check-detail';
    detail.textContent = check.detail;
    const source = document.createElement('span');
    source.className = 'check-source';
    source.textContent = check.source;
    body.append(label, detail, source);

    item.append(mark, body);
    list.appendChild(item);
  }
}

/* ---------------------------------------------------------------------------
 * Paint
 * ------------------------------------------------------------------------- */

let countFrame = null;

/**
 * Write a money figure, optionally counting up to it.
 *
 * Every call cancels any animation already in flight — otherwise a count-up
 * still running would keep writing over a newer figure and leave a stale number
 * on screen.
 */
function setMoney(element, value, animate = false) {
  cancelAnimationFrame(countFrame);
  countFrame = null;

  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = money(value);
    return;
  }

  const start = performance.now();
  const duration = 620;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    element.textContent = money(value * eased);
    countFrame = t < 1 ? requestAnimationFrame(step) : null;
  };
  countFrame = requestAnimationFrame(step);
}

function paint({ animate = false } = {}) {
  const result = compute(state);
  lastResult = result;

  const stateInfo = STATE_DATA[state.stateCode] || STATE_DATA.CO;

  // --- headline ---
  setMoney($('homePrice'), result.price, animate);

  const where = state.city.trim() ? `${state.city.trim()}, ${stateInfo.name}` : stateInfo.name;
  $('homePriceSub').textContent = `Buying in ${where} with ${money(result.model.downpayment)} down, on a ${state.term}-year fixed.`;

  $('paymentTotal').textContent = `${money(result.payment.total)}/mo`;
  renderPaymentViz(result.payment);

  $('outLoan').textContent = money(result.payment.loan);
  $('outRate').textContent = `${result.model.rate.toFixed(2)}%`;
  $('outDown').textContent = `${money(result.model.downpayment)} · ${result.payment.downPct.toFixed(0)}%`;

  // --- take-home & budget ---
  $('takeHomeLabel').textContent = result.freq.label;
  $('takeHomeNumber').textContent = money(result.takeHomePerPeriod);
  $('housingBudget').textContent = `${money(result.housingBudget)}/mo`;

  // --- lender flag ---
  const gap = result.approval.price - result.price;
  const flag = $('lenderFlag');
  if (gap > 1000) {
    flag.hidden = false;
    $('lenderFlagText').textContent = `Conventional underwriting stops at ${pct(DTI_APPROVAL)} of gross income including all your debts — and applies no cap on the housing share at all — so a lender would go to ${
      money(result.approval.price)}, ${money(gap)} more than this. That payment would take ${
      pct(result.approvalShareOfTakeHome)} of your take-home pay instead of ${pct(result.estimateShareOfTakeHome)}. Fannie Mae's automated underwriter allows up to ${pct(DTI_DU_CEILING)}.`;
  } else {
    flag.hidden = true;
  }

  renderCompare(result);

  // --- totals on the input side ---
  $('savingsTotal').textContent = money(result.savingsTotalMonthly);
  $('debtsTotal').textContent = money(result.debtsMonthly);
  $('expensesTotal').textContent = money(result.expensesTotalMonthly);

  // --- home & loan hints ---
  $('downPctHint').textContent = result.price > 0
    ? `${result.payment.downPct.toFixed(1)}% of the estimated price.${result.payment.downPct < 20 ? ' Under 20% means PMI.' : ' No PMI at 20% or more.'}`
    : '';
  $('firstHomeHint').textContent = state.firstHome !== false
    ? "The Money Guy's 3/5/25 lets a first home go as low as 3% down, provided you plan to stay five years. Under 20% still means PMI."
    : "After your first home, The Money Guy's figure is 20% down, not 3% — and the stay is five to seven years.";

  $('insHint').textContent = state.insMode === 'estimate'
    ? `${INS_TIER_TEXT[result.model.insTier]} Estimated at ${money(result.payment.insurance)}/mo for this price.`
    : 'Used as a flat monthly premium at any price.';

  // --- tax ---
  $('taxGross').textContent = money(result.paycheck.gross);
  $('taxFed').textContent = moneyNeg(result.paycheck.federalTax);
  $('taxState').textContent = moneyNeg(result.paycheck.stateTax);
  $('taxFica').textContent = moneyNeg(result.paycheck.ficaTax);
  $('taxPretax').textContent = moneyNeg((result.isTraditional ? result.k401Annual : 0) + result.pretaxMonthly * 12);
  $('taxNet').textContent = money(result.paycheck.netAnnual);
  $('taxSummaryMeta').textContent = `${pct(result.paycheck.effectiveRate, 1)} effective rate`;

  renderLedger(result);
  renderBenchmarks(result);
  renderReadiness(result);

  $('mobilePrice').textContent = money(result.price);
}

/** Something changed: recompute, autosave if we're already saving. */
function touched() {
  isExampleData = false;
  paint();
  scheduleSave();
}

/* ---------------------------------------------------------------------------
 * Persistence
 * ------------------------------------------------------------------------- */

let autosaveEnabled = false;

function setSaveStatus(savedAt, { draft = false } = {}) {
  const el = $('saveStatus');
  if (!savedAt) {
    el.textContent = draft
      ? "Not saved to this device. Your numbers survive a refresh of this tab — close it and they're gone."
      : 'Not saved yet — this page forgets everything when you close it.';
    return;
  }
  const date = new Date(savedAt);
  el.innerHTML = `Saved on this device · <strong>${date.toLocaleDateString()} ${
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>`;
}

function doSave(manual) {
  try {
    setSaveStatus(save(state));
    autosaveEnabled = true;
    if (manual) toast('Saved — your numbers will be here when you come back');
  } catch (e) {
    $('saveStatus').textContent = "Couldn't save in this browser (private window, or storage is blocked).";
    if (manual) toast('Could not save in this browser', true);
  }
}

/**
 * The draft is always written; the device save only once it has been asked for.
 * Returns whether a draft is now standing, so the status line can say so.
 */
function persist() {
  const drafted = saveDraft(state);
  if (autosaveEnabled) doSave(false);
  else if (drafted) setSaveStatus(null, { draft: true });
  return drafted;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 900);
}

function applyState(next, { message, animate = true } = {}) {
  state = next;
  syncInputs();
  renderSegments();
  render401kValue();
  renderLists();
  paint({ animate });
  if (message) banner(message);
}

/* ---------------------------------------------------------------------------
 * Input wiring
 * ------------------------------------------------------------------------- */

function syncInputs() {
  $('salary').value = commas(state.salary);
  $('filing').value = state.filing;
  $('payfreq').value = state.payfreq;
  $('credit').value = state.credit;
  $('state').value = state.stateCode;
  $('city').value = state.city || '';
  $('downpayment').value = commas(state.downpayment);
  $('hoa').value = commas(state.hoa);
  $('insManual').value = commas(state.insManual);
  $('emergencyFund').value = state.emergencyFund ? commas(state.emergencyFund) : '';
  $('insManualWrap').hidden = state.insMode !== 'manual';
  $('testPriceWrap').hidden = state.priceTestMode !== 'manual';
  if (state.testPrice != null) $('testPrice').value = commas(state.testPrice);
}

function wireMoneyInput(id, key, { blankWhenZero = false } = {}) {
  const el = $(id);
  el.addEventListener('input', () => { state[key] = parseNum(el.value); touched(); });
  el.addEventListener('blur', () => {
    // An optional field stays empty rather than tidying itself to "0".
    el.value = blankWhenZero && !state[key] ? '' : commas(state[key]);
  });
}

function wireSelect(id, key) {
  $(id).addEventListener('change', (event) => { state[key] = event.target.value; touched(); });
}

// Populate the dropdowns that come from reference data.
const stateSelect = $('state');
Object.keys(STATE_DATA)
  .sort((a, b) => STATE_DATA[a].name.localeCompare(STATE_DATA[b].name))
  .forEach((code) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = STATE_DATA[code].name;
    stateSelect.appendChild(option);
  });

const creditSelect = $('credit');
Object.entries(CREDIT_BANDS).forEach(([score, band]) => {
  const option = document.createElement('option');
  option.value = score;
  option.textContent = band.label;
  creditSelect.appendChild(option);
});

wireMoneyInput('salary', 'salary');
wireMoneyInput('downpayment', 'downpayment');
wireMoneyInput('hoa', 'hoa');
wireMoneyInput('insManual', 'insManual');
wireMoneyInput('testPrice', 'testPrice');
wireMoneyInput('emergencyFund', 'emergencyFund', { blankWhenZero: true });
wireSelect('filing', 'filing');
wireSelect('payfreq', 'payfreq');
wireSelect('credit', 'credit');
wireSelect('state', 'stateCode');
$('city').addEventListener('input', (event) => { state.city = event.target.value; touched(); });

$('addSavings').addEventListener('click', () => {
  state.savingsItems.push(newItem('sav'));
  renderLists();
  touched();
});
$('addDebt').addEventListener('click', () => {
  state.debtItems.push(newItem('debt'));
  renderLists();
  touched();
});
$('addExpense').addEventListener('click', () => {
  state.expenseItems.push(newItem('exp'));
  renderLists();
  touched();
});

/* ---------------------------------------------------------------------------
 * Toolbar
 * ------------------------------------------------------------------------- */

$('btnSave').addEventListener('click', () => doSave(true));

$('btnShare').addEventListener('click', async () => {
  const code = encodeShareCode(state);
  try {
    await navigator.clipboard.writeText(code);
    toast('Code copied — send it, and they paste it into "Paste a code"');
  } catch (e) {
    window.prompt('Copy this code and send it to whoever you are sharing with:', code);
  }
});

$('btnLoadToggle').addEventListener('click', () => {
  const panel = $('loadPanel');
  panel.hidden = !panel.hidden;
  $('btnLoadToggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('loadCodeInput').focus();
});

$('btnLoadCode').addEventListener('click', () => {
  const input = $('loadCodeInput');
  if (!input.value.trim()) { toast('Paste a code first', true); return; }
  try {
    const next = decodeShareCode(input.value);
    applyState(next, { message: "Loaded those numbers. They've replaced what was on this page in your browser — not what's saved on their device." });
    input.value = '';
    $('loadPanel').hidden = true;
    $('btnLoadToggle').setAttribute('aria-expanded', 'false');
    isExampleData = false;
    persist();
    toast('Loaded');
  } catch (e) {
    toast("That code doesn't look right — check it copied in full", true);
  }
});

$('btnReset').addEventListener('click', () => {
  applyState(createEmptyState(), { message: 'Cleared the example numbers. Everything is yours to fill in.' });
  isExampleData = false;
  selectTab('tab-income');
});

$('btnClear').addEventListener('click', () => {
  try { clear(); } catch (e) { /* nothing saved */ }
  clearDraft();
  autosaveEnabled = false;
  setSaveStatus(null);
  banner('');
  toast('Saved data cleared from this device');
});

/* ---------------------------------------------------------------------------
 * Chrome: sticky header, mobile summary
 * ------------------------------------------------------------------------- */

const header = document.querySelector('.site-header');
const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// The compact bottom bar shows up once the calculator is on screen but the
// results panel has scrolled past — never while you can already see the figures.
const summary = $('mobileSummary');
const resultsPanel = $('results');
const calculator = $('calculator');

if ('IntersectionObserver' in window) {
  let inCalculator = false;
  let resultsVisible = false;
  const update = () => { summary.hidden = !(inCalculator && !resultsVisible); };

  new IntersectionObserver(([entry]) => { inCalculator = entry.isIntersecting; update(); }, { threshold: 0 })
    .observe(calculator);
  new IntersectionObserver(([entry]) => { resultsVisible = entry.isIntersecting; update(); }, { threshold: 0.25 })
    .observe(resultsPanel);
}

$('year').textContent = String(new Date().getFullYear());

/* ---------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

function boot() {
  mountPartnerSlots();
  buildLedgerRows();

  let restored = null;
  try { restored = load(); } catch (e) { restored = null; }

  if (restored) {
    // An explicit save wins: it outlives the tab, so it is the newer intent.
    state = restored.state;
    isExampleData = false;
    autosaveEnabled = true;
    applyState(state, { message: 'Restored the numbers you saved here earlier.' });
    setSaveStatus(restored.savedAt);
    return;
  }

  const draft = loadDraft();
  if (draft) {
    // Restored quietly — this is the same tab the numbers were typed into, so a
    // banner announcing it would be telling someone what they already know.
    state = draft;
    isExampleData = false;
    applyState(state);
    setSaveStatus(null, { draft: true });
    return;
  }

  applyState(hydrate(createDefaultState()));
  setSaveStatus(null);
}

boot();
