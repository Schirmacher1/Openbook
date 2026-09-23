/**
 * Openbook — the interface.
 *
 * Reads and writes the DOM; all arithmetic lives in calc.js and all persistence
 * in state.js. The pattern throughout: structural changes re-render a list,
 * value changes only recompute — so typing never steals your own focus.
 */

import {
  STATE_DATA, CREDIT_BANDS, INS_TIER_TEXT, FILING_LABELS, DTI_FRONT_END, RATES_AS_OF,
  CLOSING_FEE_RANGE, ESCROW_MONTHS_TAX, ESCROW_MONTHS_INSURANCE
} from './data.js';
import { compute, parseNum, itemAmount, cashToClose } from './calc.js';
import { evaluateBenchmarks, scoreBenchmarks, readiness } from './guidance.js';
import { compareLedgers, COMPARE_LIMIT } from './compare.js';
import { levers, debtRateNote } from './levers.js';
import {
  createDefaultState, createEmptyState, newItem, hydrate,
  save, load, clear, saveDraft, loadDraft, clearDraft,
  listViews, saveView, renameView, deleteView, clearViews, VIEW_LIMITS, syncItemToViews,
  encodeShareCode, encodeShareBundle, decodeShareCode, extractShareCode
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
let saveTimer = null;
let lastResult = null;

/**
 * The saved view currently on screen, or null when the numbers are just the
 * numbers — typed in, restored from a device save, or pasted from a code.
 * Set only where the numbers on screen are known to exactly match a saved
 * view (loading one, or saving the current numbers under a name), and
 * cleared the instant an edit could make that untrue.
 */
let activeView = null;

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

/**
 * Like banner(), but asking a question with a choice of saved views instead
 * of just stating something — the one place outside the views panel this
 * page asks anything: which of your saved views (all of them, some of them,
 * or none) an item just added or removed here should change the same way.
 * Every checkbox starts checked — the common case is "all of them" — and
 * "All views" both drives and reflects the individual rows, indeterminate
 * when they disagree.
 */
function bannerSyncPicker(message, confirmLabel, views, onConfirm) {
  const slot = $('bannerSlot');
  slot.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'banner banner-sync';

  const heading = document.createElement('p');
  heading.className = 'banner-sync-heading';
  heading.textContent = message;
  wrap.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'banner-sync-list';

  let allBox = null;
  const viewBoxes = views.map((view) => {
    const row = document.createElement('label');
    row.className = 'banner-sync-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    const text = document.createElement('span');
    text.textContent = view.name;
    row.append(box, text);
    list.appendChild(row);
    box.addEventListener('change', () => {
      if (!allBox) return;
      allBox.checked = viewBoxes.every((b) => b.box.checked);
      allBox.indeterminate = !allBox.checked && viewBoxes.some((b) => b.box.checked);
    });
    return { id: view.id, box };
  });

  if (views.length > 1) {
    const allRow = document.createElement('label');
    allRow.className = 'banner-sync-row banner-sync-all';
    allBox = document.createElement('input');
    allBox.type = 'checkbox';
    allBox.checked = true;
    const allText = document.createElement('span');
    allText.textContent = `All views (${views.length})`;
    allRow.append(allBox, allText);
    list.insertBefore(allRow, list.firstChild);
    allBox.addEventListener('change', () => {
      for (const { box } of viewBoxes) box.checked = allBox.checked;
    });
  }

  wrap.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'banner-actions';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = confirmLabel;
  confirm.addEventListener('click', () => {
    const chosen = viewBoxes.filter(({ box }) => box.checked).map(({ id }) => id);
    slot.textContent = '';
    if (chosen.length) onConfirm(chosen);
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Not now';
  dismiss.addEventListener('click', () => { slot.textContent = ''; });

  actions.append(confirm, dismiss);
  wrap.appendChild(actions);
  slot.appendChild(wrap);
}

/* ---------------------------------------------------------------------------
 * Tabs
 * ------------------------------------------------------------------------- */

const tabs = Array.from(document.querySelectorAll('.tab'));

/* ---------------------------------------------------------------------------
 * The step gate
 *
 * The figures stay hidden until all three steps have been opened. Landing on a
 * finished-looking total makes the remaining steps read as decoration, and
 * anchors you on an answer computed from numbers you haven't entered. Once
 * revealed it stays revealed — going back to step 1 shouldn't hide your own
 * results again.
 * ------------------------------------------------------------------------- */

const STEP_LABELS = {
  'tab-income': 'What you earn',
  'tab-outgoings': 'What goes out',
  'tab-home': 'The home and loan'
};

const visitedSteps = new Set();
let revealed = false;

/** Restored or pasted numbers are already somebody's finished input. */
function revealResults() {
  for (const tab of tabs) visitedSteps.add(tab.id);
  renderGate();
}

function renderGate() {
  if (!revealed) revealed = tabs.every((tab) => visitedSteps.has(tab.id));
  document.body.dataset.steps = revealed ? 'complete' : 'incomplete';
  if (revealed) return;

  const remaining = tabs.filter((tab) => !visitedSteps.has(tab.id));
  $('gateHeading').textContent = remaining.length === tabs.length
    ? 'Three quick steps'
    : `${remaining.length} step${remaining.length === 1 ? '' : 's'} to go`;

  const list = $('gateSteps');
  list.textContent = '';
  for (const tab of tabs) {
    const done = visitedSteps.has(tab.id);
    const item = document.createElement('li');
    item.className = done ? 'is-done' : '';
    const mark = document.createElement('span');
    mark.className = 'gate-mark';
    mark.textContent = done ? '\u2713' : '';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = STEP_LABELS[tab.id] || tab.textContent.trim();
    item.append(mark, label);
    list.appendChild(item);
  }

  const next = remaining[0];
  const button = $('gateNext');
  button.textContent = next === tabs[0] ? 'Start with your income' : `Next: ${STEP_LABELS[next.id].toLowerCase()}`;
  button.dataset.gotoTab = next.id;
}

/** Below 1000px the CSS stops honouring `hidden` on `.panel` (see
 *  openbook.css) so all three render at once as a continuous scroll instead
 *  of a one-at-a-time wizard — but the HTML `hidden` attribute itself still
 *  reaches assistive tech regardless of what the CSS does with it, so it has
 *  to actually come off in that layout, not just be visually overridden. */
const isFlowLayout = () => window.matchMedia('(max-width: 999px)').matches;

/** The one place that decides which panel(s) carry `hidden`: none of them,
 *  flowing; only the inactive ones, tabbed. Called after anything that could
 *  change either the active tab or the layout itself. */
function syncPanelVisibility() {
  const flow = isFlowLayout();
  tabs.forEach((tab) => {
    $(tab.getAttribute('aria-controls')).hidden = !flow && !tab.classList.contains('is-active');
  });
}

/** Switches tabs and returns the panel that just became visible, so a caller
 *  that wants to scroll to it has the right element without repeating the
 *  aria-controls lookup — and a fresh one every time, unlike `#calculator`
 *  (the section wrapper above the tabs), whose position never changes when
 *  the panel inside it does. Anchoring "Next" there worked once, then
 *  computed a zero-distance scroll on every click after: same target,
 *  already in view, nothing to do — which is what "the button takes me to
 *  the wrong place" turned out to be.
 */
function selectTab(id, { focus = false } = {}) {
  const panel = $(tabs.find((tab) => tab.id === id).getAttribute('aria-controls'));

  // The click that led here is very often a "Next"/"Back" button living
  // inside the panel that's about to be hidden. Hiding a focused element
  // makes the browser rescue focus onto whatever's next in DOM or tab order
  // IMMEDIATELY and SYNCHRONOUSLY, as part of setting `hidden` itself — not
  // deferred to some later point where redirecting focus afterwards could
  // still catch it. The moment the step gate reveals a huge amount of
  // previously display:none content, "whatever's next" can be something
  // arbitrary deep in the results column ("Against the published rules"),
  // and focusing an off-screen element auto-scrolls to it, natively, before
  // any of our own code gets a turn — including a focus redirect placed
  // after the hide/show loop, which was the first, insufficient version of
  // this fix: it moved focus to the right place, but only after the
  // browser's own rescue had already dragged the viewport away. Moving
  // focus ourselves FIRST, before anything is hidden, leaves the browser
  // nothing to rescue.
  const activeElsewhere = tabs.some((tab) =>
    tab.id !== id && $(tab.getAttribute('aria-controls')).contains(document.activeElement));
  if (!focus && activeElsewhere) panel.focus({ preventScroll: true });

  tabs.forEach((tab) => {
    const isActive = tab.id === id;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
  syncPanelVisibility();

  if (focus) $(id).focus();

  visitedSteps.add(id);
  renderGate();
  return panel;
}

/**
 * Scroll a newly revealed panel to the top of the viewport, under the sticky
 * header.
 *
 * Completing the third step flips a huge amount of previously display:none
 * content to visible in the very same tick — the ledger, the rules section,
 * the levers, every reveal-on-complete card in the results column — and some
 * *native* browser scroll (not this call: instrumented and confirmed innocent,
 * see below) detours through several screens of that newly-shown content
 * before settling on the right spot, over about a second, if smooth scrolling
 * is left switched on anywhere in the page for that moment. Someone glancing
 * at their phone straight after tapping "Next" sees the wrong, mid-detour
 * screen and reasonably assumes that's where the button took them — it was
 * reported twice, with screenshots, before this was tracked down.
 *
 * What it isn't: not scroll anchoring (overflow-anchor: none is set on html
 * and changed nothing); not this function's own window.scrollTo call (logged
 * every call to it and to .focus() — this call always already carries the
 * right target the instant it fires, and nothing else in that log touches
 * scroll position afterwards); not fixed by passing behavior: 'auto' to that
 * call either (the detour still played out identically). What does fix it:
 * setting document.documentElement.style.scrollBehavior — the CSS property
 * itself, not a per-call option — to 'auto' before touching anything, which
 * is the one lever that actually reaches whatever native scroll this is.
 * That single controlled experiment (everything else held constant) is what
 * pins the cause here rather than somewhere still unexplained.
 */
function scrollToPanel(panel) {
  if (!panel) return;

  const html = document.documentElement;
  const restoreBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';

  const headerGap = 16;
  const target = Math.max(0,
    panel.getBoundingClientRect().top + window.scrollY - header.offsetHeight - headerGap);
  window.scrollTo({ top: target, behavior: 'auto' });

  // Restored once the jump has had a couple of frames to fully settle, so
  // every other in-page scroll on the site — clicking a nav link, "See the
  // full ledger" — keeps the smooth default this one moment can't tolerate.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    html.style.scrollBehavior = restoreBehavior;
  }));
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const panel = selectTab(tab.id);
    if (isFlowLayout()) scrollToPanel(panel);
  });
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const panel = selectTab(tabs[(index + step + tabs.length) % tabs.length].id, { focus: true });
    if (isFlowLayout()) scrollToPanel(panel);
  });
});

document.querySelectorAll('[data-goto-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    scrollToPanel(selectTab(button.dataset.gotoTab));
  });
});

$('gateNext').addEventListener('click', () => {
  scrollToPanel(selectTab($('gateNext').dataset.gotoTab));
});

// A resize (or a foldable/tablet rotating) can cross the 1000px line without
// a reload — re-decide which panels carry `hidden` right when that happens,
// not just on the next tab click.
window.matchMedia('(max-width: 999px)').addEventListener('change', syncPanelVisibility);
syncPanelVisibility();

/**
 * Below 1000px all three panels render at once and the page is one
 * continuous scroll, with the "Next" / "Back" pills hidden (see
 * syncPanelVisibility and the CSS) since there's nowhere left for them to
 * take you. The tab bar keeps working, but its job changes from switching
 * which panel is visible to scrolling to one and, as you pass each panel's
 * top going down the page, saying so: it both highlights the tab and — same
 * as a step used to only count as "done" once you clicked to it — marks
 * that step visited, which is what lets the results reveal once you've
 * scrolled past all three rather than only once you've tapped through them.
 */
let flowScrollQueued = false;
function onFlowScroll() {
  if (flowScrollQueued) return;
  flowScrollQueued = true;
  requestAnimationFrame(() => {
    flowScrollQueued = false;
    if (!isFlowLayout()) return;

    const passLine = header.offsetHeight + 24;
    let current = null;
    for (const tab of tabs) {
      const panel = $(tab.getAttribute('aria-controls'));
      if (panel.getBoundingClientRect().top - passLine > 0) break;
      current = tab;
      visitedSteps.add(tab.id);
    }
    renderGate();
    if (current && !current.classList.contains('is-active')) selectTab(current.id);
  });
}
window.addEventListener('scroll', onFlowScroll, { passive: true });

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
 * Items just pushed by "Add a …" below, whose label is still the generic
 * placeholder ("New savings item" and so on). Tracked by object identity so
 * the label field's blur handler can ask about syncing the item to every
 * saved view once — and only once — there's an actual name to ask about.
 */
const pendingAddSync = new Set();
const ITEM_DEFAULT_LABEL = { savingsItems: 'New savings item', debtItems: 'New debt', expenseItems: 'New expense' };

/**
 * Offers to make the same add or remove — already applied on screen — in
 * whichever saved views get picked, so a debt paid off or a new subscription
 * doesn't mean opening each view by hand to match it. Silent when there's
 * nothing to ask: no name to match on, or no saved views to touch.
 */
function maybeAskSync(action, kind, item) {
  const label = (item.label || '').trim();
  if (!label) return;

  let views;
  try { views = listViews(); } catch (e) { return; }
  if (!views.length) return;

  const verb = action === 'remove' ? 'Remove' : 'Add';
  const prep = action === 'remove' ? 'from' : 'to';
  bannerSyncPicker(
    `${verb} "${label}" ${prep}:`,
    verb,
    views,
    (chosenIds) => {
      const changed = syncItemToViews(kind, action, item, chosenIds);
      toast(changed
        ? `${verb === 'Add' ? 'Added' : 'Removed'} "${label}" in ${changed} view${changed === 1 ? '' : 's'}`
        : 'Already matched in every view you picked');
      if (changed) renderViews();
    }
  );
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
    label.addEventListener('blur', () => {
      if (!pendingAddSync.has(item)) return;
      pendingAddSync.delete(item);
      if (item.label.trim() !== ITEM_DEFAULT_LABEL[options.kind]) maybeAskSync('add', options.kind, item);
    });
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
    remove.addEventListener('click', () => {
      pendingAddSync.delete(item);
      items.splice(index, 1);
      rerender();
      maybeAskSync('remove', options.kind, item);
    });
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

    // Optional, debts only. The payment is what a lender counts; the balance is
    // what clearing it costs. Without the second, the page can say what a lever
    // is worth but not what pulling it takes.
    if (options.allowBalance) {
      const wrap = document.createElement('label');
      wrap.className = 'line-balance';
      const text = document.createElement('span');
      text.textContent = 'Balance';
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = 'optional';
      input.value = item.balance ? commas(item.balance) : '';
      input.setAttribute('aria-label', `Balance left on ${item.label || 'this debt'}`);
      input.addEventListener('input', () => {
        item.balance = parseNum(input.value);
        touched();
      });
      input.addEventListener('blur', () => {
        input.value = item.balance ? commas(item.balance) : '';
      });
      wrap.append(text, input);
      controls.appendChild(wrap);
    }

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
    kind: 'savingsItems', allowPct: true, allowPretax: true, emptyText: 'No savings items yet — add one below.'
  });
  renderLineList('debtsList', state.debtItems, {
    kind: 'debtItems', allowPct: false, allowPretax: false, allowBalance: true, emptyText: 'No debts. Enviable.'
  });
  renderLineList('expensesList', state.expenseItems, {
    kind: 'expenseItems', allowPct: false, allowPretax: true, emptyText: 'No recurring expenses yet — add one below.'
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

/* ---------------------------------------------------------------------------
 * Ledger
 * ------------------------------------------------------------------------- */

// What leaves before the money is ever yours to allocate, in the order it
// leaves: tax first, then whatever your employer holds back.
const LEDGER_PRE_ROWS = [
  { key: 'tax', label: 'Tax' },
  { key: 'payroll', label: '401(k) & pre-tax deductions' }
];

const LEDGER_ROWS = [
  { key: 'savings', label: 'Savings (post-tax)' },
  { key: 'debts', label: 'Debts' },
  { key: 'expenses', label: 'Other recurring expenses' },
  { key: 'housing', label: 'Estimated housing payment' }
];

/** Built once; only the figures inside change, so an open row stays open. */
function buildLedgerRows(containerId = 'ledgerRows', rows = LEDGER_ROWS) {
  const container = $(containerId);
  container.textContent = '';
  for (const row of rows) {
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

function detailRows(container, rows, emptyText, { negative = false } = {}) {
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
    stat.classList.toggle('is-negative', negative);
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    if (row.excluded) {
      const tag = document.createElement('span');
      tag.className = 'excl-tag';
      tag.textContent = 'excluded';
      dt.appendChild(tag);
    }
    const dd = document.createElement('dd');
    dd.textContent = negative ? moneyNeg(row.amount) : money(row.amount);
    stat.append(dt, dd);
    list.appendChild(stat);
  }
  container.appendChild(list);
}

/** A line of plain context under a detail table. */
function detailNote(container, text) {
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = text;
  container.appendChild(note);
}

function renderLedger(result) {
  const { ledger, paycheck } = result;

  // --- gross, then the two deductions, then take-home ---
  $('ledgerGross').textContent = money(ledger.grossMonthly);

  for (const row of LEDGER_PRE_ROWS) {
    $(`ledgerValue-${row.key}`).textContent = moneyNeg(ledger.deductions[row.key]);
  }

  detailRows(
    $('ledgerDetail-tax'),
    [
      { label: 'Federal income tax', amount: paycheck.federalTax / 12 },
      { label: 'State income tax', amount: paycheck.stateTax / 12 },
      { label: 'Social Security & Medicare', amount: paycheck.ficaTax / 12 }
    ],
    '',
    { negative: true }
  );
  detailNote(
    $('ledgerDetail-tax'),
    `${pct(paycheck.effectiveRate, 1)} of gross pay, or ${money(paycheck.federalTax + paycheck.stateTax + paycheck.ficaTax)} a year.`
      + (result.isTraditional && result.k401Monthly > 0
        ? ' Your traditional 401(k) has already been taken off the income this is charged on.'
        : '')
  );

  // The whole 401(k) belongs on this line whichever type it is, because all of
  // it left the paycheck — otherwise the cascade doesn't reach take-home pay.
  const payrollItems = [];
  if (result.k401Monthly > 0) {
    payrollItems.push({
      label: `401(k) — ${result.isTraditional ? 'traditional' : 'Roth'}`,
      amount: result.k401Monthly
    });
  }
  for (const item of state.savingsItems) {
    if (item.pretax && item.mode !== 'pct' && !item.excluded) {
      payrollItems.push({ label: `${item.label || 'Untitled'} (pre-tax)`, amount: parseNum(item.value) });
    }
  }
  for (const item of state.expenseItems) {
    if (item.pretax && !item.excluded) {
      payrollItems.push({ label: `${item.label || 'Untitled'} (pre-tax)`, amount: parseNum(item.value) });
    }
  }
  detailRows($('ledgerDetail-payroll'), payrollItems, 'Nothing leaves your pay before you see it.', { negative: true });
  if (payrollItems.length) {
    detailNote(
      $('ledgerDetail-payroll'),
      `${money(ledger.deductions.payroll * 12)} a year. `
        + (result.isTraditional
          ? 'A traditional 401(k) and the pre-tax rows lower the tax above as well as your take-home pay.'
          : "A Roth 401(k) is taken after tax, so it lowers your take-home pay without lowering the tax above.")
    );
  }

  $('ledgerIncome').textContent = money(paycheck.netMonthly);
  $('ledgerIncomeHint').textContent =
    `${money(paycheck.netAnnual)} a year — ${money(result.takeHomePerPeriod)} ${result.freq.short}. `
    + 'Everything below comes out of this figure.';

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
    : result.cappedByRule
      ? `This is money your paycheck could have put toward a house, held back because the payment is capped at ${
        pct(DTI_FRONT_END)} of gross — the 28/36 rule's limit. Spending it on housing would take you past the rule.`
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

  // "2 of 3" next to a list of four names reads as an arithmetic error. The
  // score counts the rules that are advice; the two ceilings are shown on the
  // chart but not scored, so the caption is built from the same split.
  const scoreEl = $('rulesScore');
  scoreEl.textContent = `${score.passed} of ${score.total}`;
  const unit = document.createElement('span');
  unit.className = 'rules-score-unit';
  unit.textContent = score.total === 1 ? ' rule met' : ' rules met';
  scoreEl.appendChild(unit);

  const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const nameList = (items) => {
    const names = items.map((b) => b.short || b.name);
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };
  $('rulesSummarySub').textContent =
    `${nameList(evaluated.filter((b) => !b.isYou && !b.isCeiling))}, run against your numbers. `
    + `${sentenceCase(nameList(evaluated.filter((b) => b.isCeiling)))} are shown too, but they're limits rather than targets, so they aren't scored \u2192`;

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

/* ---------------------------------------------------------------------------
 * Cash at closing, and the levers
 * ------------------------------------------------------------------------- */

function renderCash(result) {
  const cash = result.cash;
  setMoney($('cashTotal'), cash.total);
  $('cashDown').textContent = money(cash.down);
  $('cashFees').textContent = money(cash.fees);
  $('cashEscrow').textContent = money(cash.escrowTax + cash.escrowInsurance + cash.prepaidInterest);
  $('cashFeesLabel').textContent = `Fees (${CLOSING_FEE_RANGE[0]}%–${CLOSING_FEE_RANGE[1]}% of the price)`;

  // This follows whatever price is on the table in the ledger below — the
  // estimate normally, or a what-if price once one is entered — which can
  // genuinely differ from the "Cash to close" stat on the price card above,
  // which is always for the estimate. Silent about it, the two numbers would
  // just look like they disagreed.
  $('cashNote').textContent =
    (result.ledger.usingTestPrice
      ? `For the ${money(result.ledger.payment.price)} price you entered below, not the estimate above. `
      : '')
    + `${money(cash.costs)} of that is on top of the down payment: lender and title fees, `
    + `${ESCROW_MONTHS_TAX} months of property tax and ${ESCROW_MONTHS_INSURANCE} of insurance into escrow, `
    + 'and interest from closing to month end. Transfer taxes vary enormously by state, so treat the fee line as a '
    + 'national middle rather than a quote — and remember none of this changes the monthly payment, only whether you '
    + 'can get to the table.';
}

/**
 * One line per change worth considering, each priced in house and in money a
 * month. A gain and a trade look different because they are different.
 */
function renderLevers(result) {
  const list = $('leverList');
  list.textContent = '';

  const all = levers(result, state, CREDIT_BANDS);
  if (!all.length) {
    const none = document.createElement('li');
    none.className = 'lever lever-none';
    none.textContent = 'Nothing obvious left to pull: no debts, 20% down, the best credit tier. That is the good ending.';
    list.appendChild(none);
    $('leverNote').textContent = '';
    return;
  }

  for (const lever of all) {
    const item = document.createElement('li');
    item.className = `lever is-${lever.kind}`;

    const head = document.createElement('div');
    head.className = 'lever-head';
    const title = document.createElement('h3');
    title.className = 'lever-title';
    title.textContent = lever.title;

    const figure = document.createElement('p');
    figure.className = 'lever-figure';
    const sign = lever.gainPrice >= 0 ? '+' : '\u2212';
    figure.textContent = `${sign}${money(Math.abs(lever.gainPrice))}`;
    const unit = document.createElement('span');
    unit.className = 'lever-unit';
    unit.textContent = lever.gainPrice >= 0 ? 'of house' : 'of house';
    figure.appendChild(unit);
    head.append(title, figure);

    const detail = document.createElement('p');
    detail.className = 'lever-detail';
    detail.textContent = lever.detail;

    const meta = document.createElement('p');
    meta.className = 'lever-meta';
    const bits = [];
    if (lever.cost) bits.push(`${money(lever.cost)} ${lever.costLabel}`);
    if (lever.gainMonthly) {
      bits.push(lever.gainMonthly > 0
        ? `${money(lever.gainMonthly)}/mo freed`
        : `${money(Math.abs(lever.gainMonthly))}/mo more`);
    }
    meta.textContent = bits.join('  ·  ');

    item.append(head, detail);
    if (bits.length) item.appendChild(meta);
    if (lever.note) {
      const note = document.createElement('p');
      note.className = 'lever-note';
      note.textContent = lever.note;
      item.appendChild(note);
    }
    list.appendChild(item);
  }

  // The rate comparison people actually want, without pretending to know a
  // rate nobody entered.
  $('leverNote').textContent = all.some((l) => l.kind === 'debt')
    ? `${debtRateNote()} Each figure above assumes everything else stays as it is, so they don't add up — pulling two levers is not the sum of pulling each.`
    : 'Each figure above assumes everything else stays as it is, so they don\'t add up — pulling two levers is not the sum of pulling each.';
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

// One in-flight animation per element, not one for the whole page. When there
// was only ever a single animated figure (homePrice) a single shared variable
// was enough; adding cashTotal turned it into a bug — a plain, non-animated
// setMoney() call for cashTotal still unconditionally cancelled whatever frame
// id the variable held, which was homePrice's still-pending first frame. That
// left homePrice showing the static "$0" from the markup forever, because with
// animate:true its text is only ever written inside the rAF callback, and the
// callback that would have written it was the one just cancelled.
const countFrames = new WeakMap();

/**
 * Write a money figure, optionally counting up to it.
 *
 * Cancels any animation already in flight for THIS element — otherwise a
 * count-up still running would keep writing over a newer figure and leave a
 * stale number on screen. It must not touch another element's animation.
 */
function setMoney(element, value, animate = false) {
  const running = countFrames.get(element);
  if (running) cancelAnimationFrame(running);
  countFrames.delete(element);

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
    if (t < 1) countFrames.set(element, requestAnimationFrame(step));
    else countFrames.delete(element);
  };
  countFrames.set(element, requestAnimationFrame(step));
}

function paint({ animate = false } = {}) {
  const result = compute(state);
  lastResult = result;

  const stateInfo = STATE_DATA[state.stateCode] || STATE_DATA.CO;

  // --- headline ---
  setMoney($('homePrice'), result.price, animate);

  const where = state.city.trim() ? `${state.city.trim()}, ${stateInfo.name}` : stateInfo.name;
  // The dollars actually going down at this price, not the figure typed in —
  // the two only differ when a tight cash figure has capped the price below
  // the stated down payment (see paymentAt() in calc.js), and showing the
  // bigger, unused number there reads as a contradiction: "$0 house, $200,000
  // down."
  $('homePriceSub').textContent = `Buying in ${where} with ${money(result.payment.down)} down, on a ${state.term}-year fixed.`;

  // When cash is what's holding the price back, the down payment above is
  // almost always what gave way first (see solvePriceForCash() in calc.js)
  // — this is the case that used to read as a contradiction: the stat
  // showing a different, smaller down payment than the one just typed in,
  // with nothing here explaining why.
  const downGaveWay = result.usingCashLimit && result.payment.down < result.model.downpayment - 0.5;

  // Unmissable, not just a footnote: what the down payment as typed would
  // allow on its own, next to what the cash on hand actually allows, the
  // moment the two genuinely differ — rather than only a small note further
  // down the page a viewer could easily scroll past.
  const cashNotice = $('cashCapNotice');
  cashNotice.hidden = !result.cappedByCash;
  if (result.cappedByCash) {
    $('cashNoticeBudgetPrice').textContent = money(result.budgetPrice);
    $('cashNoticeCashPrice').textContent = money(result.price);
    $('cashNoticeDetail').textContent = downGaveWay
      ? `Your ${money(state.totalCash)} cash doesn't stretch to the full ${money(state.downpayment)} down payment you set plus closing costs on the bigger home, so the down payment above is ${money(result.payment.down)} instead — keeping the price as close as possible to what your down payment alone would have allowed.`
      : `Even with the down payment reduced, your ${money(state.totalCash)} cash isn't enough to close on ${money(result.budgetPrice)} — so the price itself is held to ${money(result.price)} instead.`;
  }

  $('paymentTotal').textContent = `${money(result.payment.total)}/mo`;
  renderPaymentViz(result.payment);

  $('outLoan').textContent = money(result.payment.loan);
  $('outRate').textContent = `${result.model.rate.toFixed(2)}%`;
  $('outDown').textContent = `${money(result.payment.down)} · ${result.payment.downPct.toFixed(0)}%`;

  // For THIS price specifically — result.cash (below, in the fuller
  // breakdown) follows the ledger's what-if price instead when one is
  // entered, so the two can differ on purpose; this one never does.
  const estimateCash = cashToClose(result.payment, result.model);
  $('outCash').textContent = money(estimateCash.total);
  $('outCashNote').textContent = result.cappedByCash
    ? downGaveWay
      ? `${money(estimateCash.costs)} of that is fees and escrow on top of the down payment above. Your cash didn't stretch to the full ${money(result.model.downpayment)} you set plus those costs, so the down payment above is ${money(result.payment.down)} instead — enough to keep the price close to the ${money(result.budgetPrice)} your monthly budget alone would allow, rather than letting the price itself drop instead. Full breakdown below.`
      : `${money(estimateCash.costs)} of that is fees and escrow on top of the down payment above — a one-time cost to get to the closing table. `
        + `It's why the price above is held to ${money(result.price)} rather than the ${money(result.budgetPrice)} your monthly budget alone would allow: that much house would need more cash to close than you said you have. Full breakdown below.`
    : `${money(estimateCash.costs)} of that is fees and escrow on top of the down payment above — `
      + 'a one-time cost to get to the closing table, not a monthly one, so by default it never changes the price shown here — enter how much cash you have above to change that. Full breakdown below.';

  // --- take-home & budget ---
  $('takeHomeLabel').textContent = result.freq.label;
  $('takeHomeNumber').textContent = money(result.takeHomePerPeriod);
  $('housingBudget').textContent = `${money(result.housingBudget)}/mo`;
  $('housingBudgetNote').textContent = result.cappedByRule
    ? `Your paycheck would leave ${money(result.leftover)}, but this is held to ${
      pct(DTI_FRONT_END)} of gross — the most the 28/36 rule allows on housing. The rule is the tighter of the two here.`
    : "What's left each month after savings, debts and living costs — before any mortgage, tax, insurance or HOA. It's the tighter of the two tests here; the rule would allow "
      + `${money(result.ruleCap)}.`;

  // --- totals on the input side ---
  $('savingsTotal').textContent = money(result.savingsTotalMonthly);
  $('debtsTotal').textContent = money(result.debtsMonthly);
  $('expensesTotal').textContent = money(result.expensesTotalMonthly);

  // --- home & loan hints ---
  $('downPctHint').textContent = result.price > 0
    ? `${result.payment.downPct.toFixed(1)}% of the estimated price.${result.payment.downPct < 20 ? ' Under 20% means PMI.' : ' No PMI at 20% or more.'}`
    : '';

  $('totalCashHint').textContent = !result.usingCashLimit
    ? "Unlike the emergency fund below, this one does feed the estimate: leave it blank and only the monthly payment limits the price. Set it and, if cash is tight, the down payment above gives way first — down to $0 if it has to — to keep the price as high as it can before the price itself would need to drop too."
    : result.cappedByCash
      ? downGaveWay
        ? `This is why the down payment above is ${money(result.payment.down)} rather than the ${money(state.downpayment)} you set: your cash didn't stretch to both, so the down payment gave way to keep the price close to the ${money(result.budgetPrice)} your monthly budget alone would allow.`
        : `This is what's holding the price back: your monthly budget alone would allow ${money(result.budgetPrice)}, but that takes more cash to close than you have. Held to ${money(result.price)} instead.`
      : `Enough — closing at the estimate above takes about ${money(estimateCash.total)}, within the ${money(state.totalCash)} you said you have. The monthly budget is what's limiting the price here.`;
  $('firstHomeHint').textContent = state.firstHome !== false
    ? "The Money Guy's 3/5/25 lets a first home go as low as 3% down, provided you plan to stay five years. Under 20% still means PMI."
    : "After your first home, The Money Guy's figure is 20% down, not 3% — and the stay is five to seven years.";

  // Below roughly 620 the estimate is modelling a loan that mostly isn't
  // written, so it says so rather than quoting a confident figure.
  $('creditHint').textContent = state.credit === '300'
    ? "Conventional lenders and mortgage insurers generally won't write a loan below about 620 at all. An FHA loan is the usual route, and it prices differently from the estimate here — treat this line as a rough upper bound on cost."
    : '';

  $('insHint').textContent = state.insMode === 'estimate'
    ? `${INS_TIER_TEXT[result.model.insTier]} Estimated at ${money(result.payment.insurance)}/mo for this price.`
    : 'Used as a flat monthly premium at any price.';

  renderLedger(result);
  renderCash(result);
  renderBenchmarks(result);
  renderReadiness(result);
  renderLevers(result);

  $('mobilePrice').textContent = money(result.price);
}

/** Something changed: recompute, autosave if we're already saving. */
function touched() {
  if (activeView) {
    activeView = null;
    renderViewingStatus();
    if (!$('viewsPanel').hidden) renderViews();
  }
  paint();
  scheduleSave();
}

/* ---------------------------------------------------------------------------
 * Persistence
 * ------------------------------------------------------------------------- */

let autosaveEnabled = false;

function setSaveStatus(savedAt, { draft = false } = {}) {
  const el = $('saveStatus');
  const end = $('saveStatusEnd');
  if (!savedAt) {
    el.textContent = draft
      ? "Not saved to this device. Your numbers survive a refresh of this tab — close it and they're gone."
      : 'Not saved yet — this page forgets everything when you close it.';
    end.textContent = draft
      ? 'Not saved to this device yet. They survive a refresh of this tab, and go when you close it.'
      : 'Not saved yet.';
    return;
  }
  const date = new Date(savedAt);
  const when = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  el.innerHTML = `Saved on this device · <strong>${when}</strong>`;
  end.textContent = `Saved on this device at ${when}. Changes from here are kept automatically.`;
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

function applyState(next, { message, animate = true, view = null } = {}) {
  state = next;
  activeView = view;
  renderViewingStatus();
  syncInputs();
  renderSegments();
  render401kValue();
  renderLists();
  paint({ animate });
  if (message) banner(message);
}

/**
 * "Viewing …" wherever the save status already sits — the toolbar and the
 * result card's own save prompt — so it's visible whether you're at the top
 * of the page or scrolled down to the numbers it produced.
 */
function renderViewingStatus() {
  const text = activeView ? `Viewing the saved view "${activeView.name}" — editing anything here won't change what's saved.` : '';
  for (const id of ['viewingStatus', 'viewingStatusEnd']) {
    const el = $(id);
    el.textContent = text;
    el.hidden = !text;
  }
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
  $('totalCash').value = state.totalCash == null ? '' : commas(state.totalCash);
  $('insManualWrap').hidden = state.insMode !== 'manual';
  $('testPriceWrap').hidden = state.priceTestMode !== 'manual';
  if (state.testPrice != null) $('testPrice').value = commas(state.testPrice);
}

function wireMoneyInput(id, key, { blankWhenZero = false, nullable = false } = {}) {
  const el = $(id);
  el.addEventListener('input', () => {
    // Blank means "not entered" here, not zero — the two mean very different
    // things for a field that can cap the estimate (see totalCash).
    state[key] = nullable && el.value.trim() === '' ? null : parseNum(el.value);
    touched();
  });
  el.addEventListener('blur', () => {
    // An optional field stays empty rather than tidying itself to "0".
    el.value = nullable
      ? (state[key] == null ? '' : commas(state[key]))
      : (blankWhenZero && !state[key] ? '' : commas(state[key]));
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
wireMoneyInput('totalCash', 'totalCash', { nullable: true });
wireSelect('filing', 'filing');
wireSelect('payfreq', 'payfreq');
wireSelect('credit', 'credit');
wireSelect('state', 'stateCode');
$('city').addEventListener('input', (event) => { state.city = event.target.value; touched(); });

$('addSavings').addEventListener('click', () => {
  const item = newItem('sav');
  state.savingsItems.push(item);
  pendingAddSync.add(item);
  renderLists();
  touched();
});
$('addDebt').addEventListener('click', () => {
  const item = newItem('debt');
  state.debtItems.push(item);
  pendingAddSync.add(item);
  renderLists();
  touched();
});
$('addExpense').addEventListener('click', () => {
  const item = newItem('exp');
  state.expenseItems.push(item);
  pendingAddSync.add(item);
  renderLists();
  touched();
});

/* ---------------------------------------------------------------------------
 * Saved views
 * ------------------------------------------------------------------------- */

const dayMonth = (ts) => ts
  ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  : 'unknown date';

/* ---------------------------------------------------------------------------
 * Comparing views
 *
 * A saved view already shows the price it produces. What it can't show is why
 * one view buys less house than another — the same price can come from a raise
 * and a bigger mortgage, or from clearing a car loan, and those are not the
 * same plan. So the comparison is the ledger itself, row for row.
 * ------------------------------------------------------------------------- */

/** View ids to compare, in the order they were ticked. CURRENT_ID is live input. */
const CURRENT_ID = '\u0000current';
const compareSelection = new Set();

/** The live numbers are only offered once the three steps have been opened. */
const currentIsOfferable = () => document.body.dataset.steps === 'complete';

function toggleCompare(id, on) {
  if (on) {
    if (compareSelection.size >= COMPARE_LIMIT) return false;
    compareSelection.add(id);
  } else {
    compareSelection.delete(id);
  }
  return true;
}

function compareEntries(views) {
  const entries = [];
  for (const id of compareSelection) {
    if (id === CURRENT_ID) {
      entries.push({ id, name: 'On screen now', state, isCurrent: true });
      continue;
    }
    const view = views.find((v) => v.id === id);
    if (view) entries.push({ id: view.id, name: view.name, state: view.state });
  }
  return entries;
}

/** Which openable rows are showing their parts. Outlives a redraw. */
const compareOpen = new Set();

/** Keep the expand-all control saying what it would actually do. */
function syncExpandAll(openable) {
  const button = $('btnCompareExpand');
  const keys = openable || compareRowKeys;
  if (!keys.length) return;
  const allOpen = keys.every((key) => compareOpen.has(key));
  button.textContent = allOpen ? 'Collapse all' : 'Expand all';
  button.setAttribute('aria-expanded', String(allOpen));
}

let compareRowKeys = [];

function renderComparison(views) {
  const panel = $('comparePanel');
  const offerCurrent = currentIsOfferable();
  const available = views.length + (offerCurrent ? 1 : 0);

  // Nothing to compare against — don't offer a comparison of one thing.
  panel.hidden = available < 2;
  if (panel.hidden) return;

  const currentWrap = $('cmpCurrentWrap');
  currentWrap.hidden = !offerCurrent;
  $('cmpCurrent').checked = compareSelection.has(CURRENT_ID);

  const entries = compareEntries(views);
  const hint = $('compareHint');
  const host = $('compareTable');
  host.textContent = '';

  if (entries.length < 2) {
    hint.textContent = `Tick two or more of the views above — up to ${COMPARE_LIMIT} — and their ledgers appear here side by side.`;
    $('btnCompareExpand').hidden = true;
    return;
  }

  const table = compareLedgers(entries);
  hint.textContent = compareSelection.size >= COMPARE_LIMIT
    ? `Comparing ${entries.length}. That's the limit — untick one to swap it for another.`
    : `Comparing ${entries.length}. Every row is monthly except the home price.`;

  const el = document.createElement('table');
  el.className = 'cmp-table';

  const caption = document.createElement('caption');
  caption.className = 'cmp-caption';
  caption.textContent = table.diffable
    ? `Each view's ledger, in ledger order. The last column is "${table.columns[1].name}" minus "${
      table.columns[0].name}" on each figure, so a positive difference on a tax or debt row means more of it.`
    : "Each view's ledger, in ledger order. A difference column needs exactly two views — with more than two there is no baseline the reader can see.";
  el.appendChild(caption);

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.scope = 'col';
  corner.textContent = 'Per month';
  headRow.appendChild(corner);

  for (const column of table.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    const name = document.createElement('span');
    name.className = 'cmp-name';
    name.textContent = column.name;
    th.appendChild(name);

    // Two things change what a column means, so neither is left implicit.
    const flags = [];
    if (column.usingTestPrice) flags.push('a price you entered');
    if (column.cappedByRule) flags.push('held to 28% of gross');
    if (column.cappedByCash) flags.push('held to cash on hand');
    if (flags.length) {
      const flag = document.createElement('span');
      flag.className = 'cmp-flag';
      flag.textContent = flags.join(' · ');
      th.appendChild(flag);
    }
    headRow.appendChild(th);
  }

  if (table.diffable) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = 'cmp-diff-head';
    th.textContent = 'Difference';
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  el.appendChild(head);

  const body = document.createElement('tbody');

  /** A difference cell, blank-looking when there isn't one worth printing. */
  const diffCell = (diff) => {
    const td = document.createElement('td');
    td.className = 'cmp-diff';
    td.textContent = Math.abs(diff) < 1
      ? '\u2014'
      : `${diff > 0 ? '+' : '\u2212'}${money(Math.abs(diff))}`;
    return td;
  };

  for (const row of table.rows) {
    const tr = document.createElement('tr');
    tr.className = `cmp-row is-${row.group}`;

    const label = document.createElement('th');
    label.scope = 'row';

    // A row with parts is a disclosure: the label becomes the control, the
    // same way a ledger row does.
    const childRows = [];
    if (row.opens) {
      const open = compareOpen.has(row.key);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'cmp-toggle';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.innerHTML = '<span class="chev" aria-hidden="true">\u25BE</span>';
      toggle.append(row.label);
      toggle.addEventListener('click', () => {
        const nowOpen = !compareOpen.has(row.key);
        if (nowOpen) compareOpen.add(row.key); else compareOpen.delete(row.key);
        toggle.setAttribute('aria-expanded', String(nowOpen));
        for (const child of childRows) child.hidden = !nowOpen;
        syncExpandAll();
      });
      label.appendChild(toggle);
    } else {
      label.textContent = row.label;
    }
    tr.appendChild(label);

    row.values.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = row.sign < 0 ? moneyNeg(value) : money(value);
      td.classList.toggle('is-negative', row.key === 'unallocated' && value < -1);
      // The figure a column is really about, for anyone scanning across.
      if (row.group === 'outcome' || row.group === 'subtotal') td.classList.add('is-key');
      if (table.columns[i].isCurrent) td.classList.add('is-current');
      tr.appendChild(td);
    });

    if (table.diffable) tr.appendChild(diffCell(row.diff));
    body.appendChild(tr);

    for (const part of row.children) {
      const childTr = document.createElement('tr');
      childTr.className = `cmp-row cmp-child is-${row.group}`;
      childTr.hidden = !compareOpen.has(row.key);

      const childLabel = document.createElement('th');
      childLabel.scope = 'row';
      childLabel.className = 'cmp-child-label';
      childLabel.textContent = part.label;
      childTr.appendChild(childLabel);

      // A note repeated in every column is just the row's description; one that
      // differs — "excluded" against nothing, Roth against traditional — is the
      // difference itself, so only those are printed.
      const varies = part.notes.some((note) => note !== part.notes[0]);

      part.values.forEach((value, i) => {
        const td = document.createElement('td');
        if (value === null) {
          // Not in this scenario at all, which is not the same as zero.
          td.textContent = '\u2014';
          td.classList.add('is-absent');
        } else {
          td.textContent = row.sign < 0 ? moneyNeg(value) : money(value);
        }
        if (table.columns[i].isCurrent) td.classList.add('is-current');
        if (part.notes[i] && varies) {
          const note = document.createElement('span');
          note.className = 'cmp-note';
          note.textContent = part.notes[i];
          td.appendChild(note);
        }
        childTr.appendChild(td);
      });

      if (table.diffable) childTr.appendChild(diffCell(part.diff));
      body.appendChild(childTr);
      childRows.push(childTr);
    }
  }
  el.appendChild(body);
  host.appendChild(el);

  // One control for the lot, because opening six rows one at a time to read
  // the whole ledger is six clicks of ceremony.
  const openable = table.rows.filter((r) => r.opens).map((r) => r.key);
  const expandAll = $('btnCompareExpand');
  expandAll.hidden = openable.length === 0;
  expandAll.onclick = () => {
    const allOpen = openable.every((key) => compareOpen.has(key));
    for (const key of openable) {
      if (allOpen) compareOpen.delete(key); else compareOpen.add(key);
    }
    renderComparison(views);
  };
  compareRowKeys = openable;
  syncExpandAll(openable);
}

/** Swap a view's name for an input, in place. Enter keeps it, Escape doesn't. */
function startRename(view, button) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'view-name-input';
  input.value = view.name;
  input.maxLength = VIEW_LIMITS.name;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `New name for the view ${view.name}`);

  // Enter, Escape and clicking away all land here, and removing the focused
  // input fires one more blur on the way out, so the first one wins.
  let settled = false;
  const finish = (keep) => {
    if (settled) return;
    settled = true;

    const next = input.value.trim();
    if (!keep || !next || next === view.name) { renderViews(); return; }

    // Two views with one name is a trap: saving under that name would then
    // replace whichever came first.
    const taken = listViews().some((other) => other.id !== view.id
      && other.name.toLowerCase() === next.toLowerCase());
    if (taken) {
      toast(`There's already a view called "${next}"`, true);
      renderViews();
      return;
    }

    try {
      renameView(view.id, next);
      if (activeView?.id === view.id) { activeView = { ...activeView, name: next }; renderViewingStatus(); }
      toast(`Renamed to "${next}"`);
    } catch (e) {
      toast('A view needs a name', true);
    }
    renderViews();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));

  button.replaceWith(input);
  input.focus();
  input.select();
}

/**
 * Deleting is irreversible, so it asks first — in the row rather than in a
 * window.confirm(), which a sandboxed frame refuses to show. A refused confirm
 * reads as false, which is how Delete came to do nothing at all.
 */
function askToDelete(view, actions) {
  const restore = Array.from(actions.children);

  const putBack = () => {
    actions.textContent = '';
    for (const child of restore) actions.appendChild(child);
    restore[restore.length - 1]?.focus();
  };

  actions.textContent = '';

  const ask = document.createElement('span');
  ask.className = 'view-confirm';
  ask.textContent = 'Delete for good?';

  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn btn-sm btn-danger-solid';
  yes.textContent = 'Delete';
  yes.setAttribute('aria-label', `Yes, delete the view ${view.name}`);
  yes.addEventListener('click', () => {
    deleteView(view.id);
    compareSelection.delete(view.id);
    if (activeView?.id === view.id) { activeView = null; renderViewingStatus(); }
    renderViews();
    toast(`Deleted "${view.name}"`);
  });

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn-ghost btn-sm';
  no.textContent = 'Keep it';
  no.addEventListener('click', putBack);

  actions.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); putBack(); }
  });

  actions.append(ask, yes, no);
  yes.focus();
}

/**
 * The library, rebuilt from storage each time. Each row carries the price that
 * view produces, so the list doubles as a comparison of the scenarios rather
 * than just a list of names.
 */
function renderViews() {
  const list = $('viewsList');
  const hint = $('viewsHint');
  list.textContent = '';

  let views = [];
  try {
    views = listViews();
  } catch (e) {
    hint.textContent = "Views can't be read in this browser (private window, or storage is blocked).";
    $('comparePanel').hidden = true;
    return;
  }

  hint.textContent = views.length
    ? `${views.length} of ${VIEW_LIMITS.count} saved on this device. Saving under a name you've used before replaces it.`
    : 'Nothing saved yet. Views live on this device only, like everything else here.';

  // A deleted view can't stay in the comparison, and neither can the live
  // numbers once the gate has hidden them again.
  const ids = new Set(views.map((view) => view.id));
  for (const id of compareSelection) {
    if (id === CURRENT_ID ? !currentIsOfferable() : !ids.has(id)) compareSelection.delete(id);
  }

  for (const view of views) {
    const result = compute(view.state);
    const isActive = activeView?.id === view.id;

    const row = document.createElement('div');
    row.className = 'view-row';
    row.classList.toggle('view-row-active', isActive);

    const main = document.createElement('div');
    main.className = 'view-main';

    // The name is the rename control. A separate Rename button used to open a
    // window.prompt(), which a sandboxed frame — the preview, an embed, some
    // in-app browsers — simply refuses to show, so the button did nothing at
    // all. Editing in place needs no dialog and is one click shorter.
    const nameRow = document.createElement('div');
    nameRow.className = 'view-name-row';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'view-name';
    name.textContent = view.name;
    name.title = 'Click to rename';
    name.setAttribute('aria-label', `Rename the view ${view.name}`);
    name.addEventListener('click', () => startRename(view, name));
    nameRow.appendChild(name);
    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Viewing';
      nameRow.appendChild(badge);
    }
    const meta = document.createElement('p');
    meta.className = 'view-meta';
    meta.textContent = `${money(result.price)} · ${money(result.payment.total)}/mo · saved ${dayMonth(view.savedAt)}`;
    main.append(nameRow, meta);

    const actions = document.createElement('div');
    actions.className = 'view-actions';

    const compareWrap = document.createElement('label');
    compareWrap.className = 'view-compare';
    const compareBox = document.createElement('input');
    compareBox.type = 'checkbox';
    compareBox.checked = compareSelection.has(view.id);
    compareBox.setAttribute('aria-label', `Compare the view ${view.name}`);
    compareBox.addEventListener('change', () => {
      if (!toggleCompare(view.id, compareBox.checked)) {
        compareBox.checked = false;
        toast(`Up to ${COMPARE_LIMIT} at a time`, true);
        return;
      }
      renderViews();
    });
    const compareText = document.createElement('span');
    compareText.textContent = 'Compare';
    compareWrap.append(compareBox, compareText);
    actions.appendChild(compareWrap);

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn btn-primary btn-sm';
    loadBtn.textContent = 'Load';
    loadBtn.setAttribute('aria-label', `Load the view ${view.name}`);
    loadBtn.addEventListener('click', () => {
      applyState(view.state, {
        message: `Loaded the view "${view.name}". Saving over it won't change anything else you've stored.`,
        view: { id: view.id, name: view.name }
      });
      persist();
      $('viewName').value = view.name;
      toast(`Loaded "${view.name}"`);
      renderViews();
    });

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn btn-ghost btn-sm';
    shareBtn.textContent = 'Share';
    shareBtn.setAttribute('aria-label', `Share the view ${view.name}`);
    shareBtn.addEventListener('click', () => shareOneView(view));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-ghost btn-sm btn-danger';
    removeBtn.textContent = 'Delete';
    removeBtn.setAttribute('aria-label', `Delete the view ${view.name}`);
    removeBtn.addEventListener('click', () => askToDelete(view, actions));

    actions.append(loadBtn, shareBtn, removeBtn);
    row.append(main, actions);
    list.appendChild(row);
  }

  const shareAll = $('btnShareAllViews');
  shareAll.hidden = views.length === 0;
  shareAll.onclick = () => shareAllViews(views);

  renderComparison(views);
}

/* ---------------------------------------------------------------------------
 * The actions menu
 *
 * One trigger, one list. Items whose label ends in an ellipsis open a panel
 * below; the rest act immediately and close the menu.
 * ------------------------------------------------------------------------- */

const PANELS = ['viewsPanel', 'pastePanel', 'confirmPanel', 'sharePanel', 'invitePanel'];

/** Show one panel and hide the other, or hide both with no argument. */
function showPanel(id) {
  for (const panel of PANELS) $(panel).hidden = panel !== id;
}

const menu = $('actionMenu');
const menuTrigger = $('btnMenu');
const menuItems = () => Array.from(menu.querySelectorAll('[role="menuitem"]'));

function openMenu() {
  menu.hidden = false;
  menuTrigger.setAttribute('aria-expanded', 'true');
  menuItems()[0]?.focus();
}

function closeMenu({ returnFocus = false } = {}) {
  if (menu.hidden) return;
  menu.hidden = true;
  menuTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) menuTrigger.focus();
}

menuTrigger.addEventListener('click', () => {
  if (menu.hidden) openMenu();
  else closeMenu({ returnFocus: true });
});

// Roving focus, so the menu is usable without a pointer.
menu.addEventListener('keydown', (event) => {
  const items = menuItems();
  const index = items.indexOf(document.activeElement);
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];

  if (step !== undefined) {
    event.preventDefault();
    items[(index + step + items.length) % items.length].focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    items[0].focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    items[items.length - 1].focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu({ returnFocus: true });
  } else if (event.key === 'Tab') {
    closeMenu();
  }
});

menuTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'Escape') {
    event.preventDefault();
    if (event.key === 'ArrowDown') openMenu();
    else closeMenu({ returnFocus: true });
  }
});

// A click anywhere else dismisses it, the way a menu should.
document.addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu();
});

/** Wire a menu item: run the action, then close the menu. */
function menuAction(id, run) {
  $(id).addEventListener('click', () => {
    closeMenu();
    run();
  });
}

function doSaveView() {
  const input = $('viewName');
  const name = input.value.trim();
  if (!name) {
    toast('Give the view a name first', true);
    input.focus();
    return;
  }
  try {
    const { view, replaced } = saveView(name, state);
    // The numbers on screen now exactly match this view, whether it was
    // freshly created or an existing one just updated to the current state.
    activeView = { id: view.id, name: view.name };
    renderViewingStatus();
    renderViews();
    toast(replaced ? `Updated "${name}"` : `Saved "${name}"`);
  } catch (e) {
    toast("Couldn't save in this browser (private window, or storage is blocked)", true);
  }
}

$('cmpCurrent').addEventListener('change', (event) => {
  if (!toggleCompare(CURRENT_ID, event.target.checked)) {
    event.target.checked = false;
    toast(`Up to ${COMPARE_LIMIT} at a time`, true);
    return;
  }
  renderViews();
});

menuAction('btnViewsOpen', () => {
  showPanel('viewsPanel');
  renderViews();
  $('viewName').focus();
});

menuAction('btnPasteOpen', () => {
  showPanel('pastePanel');
  $('loadCodeInput').focus();
});

/* ---------------------------------------------------------------------------
 * Invite by text
 *
 * A link, opened in the visitor's own Messages app, to the empty page — never
 * this device's numbers. The only thing that makes it different from typing a
 * text by hand is that it fills in the compose box for you; nothing here
 * touches state, storage, or the network — an sms: link is a navigation, the
 * same as clicking any other link, and the CSP has nothing to say about it.
 */

/** The page's own canonical URL, dropping any query or hash so a stray share
 *  code or view id in the address bar is never forwarded to someone else. */
function siteUrl() {
  return `${location.origin}${location.pathname}`;
}

/**
 * A share code carried in a link instead of a blob of text to copy exactly.
 * The code lives after `#s=` in the fragment, which browsers never send to
 * any server — GitHub Pages' own access log never sees it, same privacy
 * property as a bare code, just tap-to-load instead of copy-then-paste.
 * That distinction is the point: a pasted code depends on the clipboard
 * round-tripping a long case-sensitive string exactly (a mobile keyboard's
 * autocapitalize, an "Allow Paste" prompt someone misses, a copy that
 * silently grabbed the wrong thing) — a tapped link just navigates, the way
 * every other link on the page already does, so none of that is in play.
 */
function shareLink(code) {
  return `${siteUrl()}#s=${encodeURIComponent(code)}`;
}

function defaultInviteBody() {
  return `I've been using Openbook to figure out what home I can actually afford, `
    + `not just what a lender would approve. Free, no sign-up: ${siteUrl()}`;
}

/** Rebuilds the "Open in Messages" link from the current phone number and
 *  message. Digits, +, spaces, hyphens and parens survive into the sms: URI;
 *  anything else in a pasted number is dropped rather than mis-encoded. */
function updateInviteLink() {
  const phone = $('invitePhone').value.replace(/[^\d+()\-\s]/g, '').trim();
  const body = $('inviteBody').value;
  const target = phone ? `sms:${encodeURIComponent(phone)}` : 'sms:';
  $('btnInviteSend').href = `${target}?body=${encodeURIComponent(body)}`;
}

menuAction('btnInviteOpen', () => {
  showPanel('invitePanel');
  if (!$('inviteBody').value) $('inviteBody').value = defaultInviteBody();
  updateInviteLink();
  $('invitePhone').focus();
});

$('invitePhone').addEventListener('input', updateInviteLink);
$('inviteBody').addEventListener('input', updateInviteLink);
$('btnInviteSend').addEventListener('click', () => {
  // The link itself does the work; this only confirms it fired, since
  // navigating to an sms: URI gives no other feedback that anything happened.
  toast('Opening Messages…');
});

$('btnSaveView').addEventListener('click', doSaveView);
$('viewName').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    doSaveView();
  }
});

/* ---------------------------------------------------------------------------
 * Toolbar
 * ------------------------------------------------------------------------- */

menuAction('btnSave', () => doSave(true));

/**
 * Numbers that arrived in someone else's code deserve a different offer: a
 * share code carries one scenario, not a library, so the way to compare theirs
 * with yours is to save theirs as a view.
 */
let cameFromCode = false;

function renderSaveCardSub() {
  $('saveCardSub').textContent = cameFromCode
    ? "These arrived in someone else's code. A code carries one set of numbers, not their saved views — save these as a named view and you can put them beside your own."
    : 'This page forgets everything when you close it. Saving keeps them on this device — nothing is uploaded.';
}

/** Copy the share code, or show it when the clipboard is refused. */
/**
 * Copy a share code to the clipboard, or fall back to a panel with the code
 * selected when the clipboard is refused — an iframe, an insecure origin, a
 * browser wanting a gesture it didn't see. Every share action funnels through
 * here, so there is one place that handles the fallback.
 */
async function offerShareCode(code, { copiedMessage, panelHint }) {
  try {
    await navigator.clipboard.writeText(code);
    toast(copiedMessage);
  } catch (e) {
    $('shareHint').textContent = panelHint;
    const out = $('shareCodeOut');
    out.value = code;
    showPanel('sharePanel');
    out.focus();
    out.select();
  }
}

/** The current on-screen numbers only — the plain, single-scenario share. */
async function doShare() {
  await offerShareCode(shareLink(await encodeShareBundle({ current: state, views: [] })), {
    copiedMessage: 'Link copied — send it, and they just tap it',
    panelHint: "Copying it automatically didn't work in this browser. Select the link and copy it by hand — it's the whole of your numbers, so send it however you'd send anything else private."
  });
}

/**
 * One saved view. Carries the view's own name and state twice over, in both
 * halves of the bundle: as `current`, so the recipient sees it immediately on
 * opening the link rather than only filed away, and as the one entry in
 * `views`, so it also lands in their library under its name rather than
 * replacing whatever they already had on screen without a record of it.
 */
async function shareOneView(view) {
  await offerShareCode(shareLink(await encodeShareBundle({ current: view.state, views: [view] })), {
    copiedMessage: `"${view.name}" link copied — send it, and they just tap it`,
    panelHint: `Copying it automatically didn't work in this browser. Select the link and copy it by hand — it's "${view.name}", so send it however you'd send anything else private.`
  });
}

/**
 * The whole library, current on-screen numbers left out deliberately: "all
 * views" means exactly that, not views-plus-whatever-you-happen-to-be-typing.
 * Share the current numbers too by saving them as a view first.
 */
async function shareAllViews(views) {
  const n = views.length;
  await offerShareCode(shareLink(await encodeShareBundle({ current: null, views })), {
    copiedMessage: `Link to ${n} view${n === 1 ? '' : 's'} copied — send it, and they just tap it`,
    panelHint: `Copying it automatically didn't work in this browser. Select the link and copy it by hand — it's all ${n} of your saved views, so send it however you'd send anything else private.`
  });
}

menuAction('btnShare', doShare);

/* The same three offers, at the end of the form: the menu is at the top of the
   page and you have to know it's there. */
$('btnSaveEnd').addEventListener('click', () => doSave(true));
$('btnShareEnd').addEventListener('click', doShare);
$('btnSaveViewEnd').addEventListener('click', () => {
  showPanel('viewsPanel');
  renderViews();
  $('viewsPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('viewName').focus();
});

/**
 * File incoming views into the recipient's own library without clobbering
 * anything already there under the same name — two people's "Plan A" are not
 * the same plan. A collision gets " (received)", then " (received 2)" and so
 * on, checked against both the existing library and names already claimed
 * earlier in this same import.
 */
function importSharedViews(views) {
  if (!views || !views.length) return [];

  let existing;
  try {
    existing = new Set(listViews().map((v) => v.name.toLowerCase()));
  } catch (e) {
    return []; // storage is blocked; nothing can be filed
  }

  const imported = [];
  for (const view of views) {
    let name = view.name;
    if (existing.has(name.toLowerCase())) {
      let n = 2;
      let candidate = `${name} (received)`;
      while (existing.has(candidate.toLowerCase())) {
        candidate = `${name} (received ${n})`;
        n += 1;
      }
      name = candidate;
    }
    try {
      saveView(name, view.state);
      existing.add(name.toLowerCase());
      imported.push(name);
    } catch (e) { /* an unnamed or otherwise unsaveable entry — skip it, keep going */ }
  }
  return imported;
}

function describeImport(names) {
  if (!names.length) return '';
  return names.length === 1
    ? ` Also added to your saved views: "${names[0]}".`
    : ` Also added ${names.length} saved views: ${names.map((n) => `"${n}"`).join(', ')}.`;
}

/**
 * The one place that decodes an incoming code and applies whatever it
 * carries — shared by the manual "Paste a code" button and a tapped share
 * link opening cold, so the two ways of arriving at the same numbers can't
 * drift into different behaviour. `raw` is passed through extractShareCode()
 * first, so either a bare code or a whole link (someone pasted the link
 * text itself, rather than tapping it) works the same way here.
 *
 * Returns `{ ok: false }` on anything that didn't decode, or
 * `{ ok: true, kind: 'current' | 'views', importedCount }` — `kind` says
 * whether the on-screen numbers changed (and the caller should treat this
 * like a fresh page of someone else's figures) or only the views library
 * grew (the caller's own numbers are untouched).
 */
async function applyIncomingCode(raw) {
  let decoded;
  try {
    decoded = await decodeShareCode(raw);
  } catch (e) {
    return { ok: false };
  }

  const isBundle = decoded && decoded.bundle === true;
  const current = isBundle ? decoded.current : decoded;
  const imported = importSharedViews(isBundle ? decoded.views : []);

  if (current) {
    applyState(current, {
      message: "Loaded those numbers. They've replaced what was on this page in your browser — not what's saved on their device."
        + describeImport(imported)
    });
    cameFromCode = true;
    renderSaveCardSub();
    revealResults();
    mobileSummaryUpdate();
    persist();
    return { ok: true, kind: 'current', importedCount: imported.length };
  }

  // Views only — a "share all views" or "share this view" code arrived where
  // the sender chose not to carry their on-screen numbers too. Nothing on
  // this screen changes; the library gains what arrived.
  if (imported.length) {
    renderViews();
    return { ok: true, kind: 'views', importedCount: imported.length };
  }

  return { ok: false };
}

$('btnLoadCode').addEventListener('click', async () => {
  const input = $('loadCodeInput');
  if (!input.value.trim()) { toast('Paste a code first', true); return; }

  const result = await applyIncomingCode(input.value);
  input.value = '';

  if (!result.ok) {
    toast("That code doesn't look right — check it copied in full", true);
    return;
  }
  showPanel(result.kind === 'views' ? 'viewsPanel' : null);
  if (result.kind === 'views') {
    renderViews();
    toast(`Added ${result.importedCount} saved view${result.importedCount === 1 ? '' : 's'}`);
  } else {
    toast(result.importedCount ? `Loaded, plus ${result.importedCount} saved view${result.importedCount === 1 ? '' : 's'}` : 'Loaded');
  }
});

/**
 * A tapped share link carries its code after `#s=` in the hash — never the
 * query string or the path, so the browser never puts it in a request to
 * any server in the first place. Checked once, right after boot() has
 * already settled on whatever it would have shown anyway (a device save, a
 * draft, or the example numbers), since a link's whole point is to override
 * that with what it's carrying — same as pasting a code by hand after the
 * page has already loaded. The hash is cleared from the address bar either
 * way, so refreshing doesn't reapply it and the numbers don't linger in
 * browser history as a URL.
 */
async function applyHashCode() {
  if (!location.hash.startsWith('#s=')) return;

  const raw = location.hash;
  history.replaceState(null, '', location.pathname + location.search);

  const result = await applyIncomingCode(raw);
  if (!result.ok) {
    toast("That link's code doesn't look right — ask them to send it again", true);
    return;
  }
  if (result.kind === 'views') {
    toast(`Added ${result.importedCount} saved view${result.importedCount === 1 ? '' : 's'}`);
  } else {
    toast(result.importedCount ? `Loaded, plus ${result.importedCount} saved view${result.importedCount === 1 ? '' : 's'}` : 'Loaded from the link');
  }
}

menuAction('btnReset', () => {
  applyState(createEmptyState(), { message: 'Cleared the example numbers. Everything is yours to fill in.' });
  cameFromCode = false;
  renderSaveCardSub();
  showPanel(null);
  selectTab('tab-income');
});

/**
 * Ask before something irreversible, in the page rather than in a dialog the
 * browser may refuse to show. `onYes` runs only on a real click.
 */
function askToConfirm({ title, text, confirmLabel, onYes }) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  const yes = $('btnConfirmYes');
  yes.textContent = confirmLabel;

  // One listener per asking, so an old question can't answer a new one.
  const cleanup = () => {
    yes.removeEventListener('click', accept);
    $('btnConfirmNo').removeEventListener('click', decline);
  };
  const accept = () => { cleanup(); showPanel(null); onYes(); };
  const decline = () => { cleanup(); showPanel(null); };

  yes.addEventListener('click', accept);
  $('btnConfirmNo').addEventListener('click', decline);

  showPanel('confirmPanel');
  yes.focus();
}

function doClear() {
  try { clear(); } catch (e) { /* nothing saved */ }
  clearDraft();
  autosaveEnabled = false;
  setSaveStatus(null);
  banner('');
  compareSelection.clear();
  renderViews();
}

menuAction('btnClear', () => {
  // Named views are deliberate work, so clearing them is never a side effect of
  // a single click — it is named and confirmed.
  let views = [];
  try { views = listViews(); } catch (e) { views = []; }

  if (!views.length) {
    doClear();
    toast('Saved data cleared from this device');
    return;
  }

  askToConfirm({
    title: 'Delete everything saved on this device?',
    text: `This also deletes ${views.length} saved view${views.length === 1 ? '' : 's'} `
      + `(${views.map((v) => v.name).join(', ')}). The numbers on the page stay as they are.`,
    confirmLabel: 'Delete it all',
    onYes: () => {
      clearViews();
      doClear();
      toast('Saved data and views cleared from this device');
    }
  });
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
let mobileSummaryUpdate = () => {};
const summary = $('mobileSummary');
const resultsPanel = $('results');
const calculator = $('calculator');

if ('IntersectionObserver' in window) {
  let inCalculator = false;
  let resultsVisible = false;
  const update = () => { summary.hidden = !(revealed && inCalculator && !resultsVisible); };

  new IntersectionObserver(([entry]) => { inCalculator = entry.isIntersecting; update(); }, { threshold: 0 })
    .observe(calculator);
  new IntersectionObserver(([entry]) => { resultsVisible = entry.isIntersecting; update(); }, { threshold: 0.25 })
    .observe(resultsPanel);

  // Revealing the results is what makes the bar eligible in the first place.
  mobileSummaryUpdate = update;
}

$('year').textContent = String(new Date().getFullYear());

/* ---------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

function boot() {
  mountPartnerSlots();
  visitedSteps.add(tabs[0].id);
  renderGate();
  $('ratesAsOf').textContent = RATES_AS_OF;
  renderSaveCardSub();
  buildLedgerRows('ledgerPreRows', LEDGER_PRE_ROWS);
  buildLedgerRows();

  let restored = null;
  try { restored = load(); } catch (e) { restored = null; }

  if (restored) {
    // An explicit save wins: it outlives the tab, so it is the newer intent.
    state = restored.state;
    autosaveEnabled = true;
    applyState(state, { message: 'Restored the numbers you saved here earlier.' });
    setSaveStatus(restored.savedAt);
    revealResults();
    applyHashCode();
    return;
  }

  const draft = loadDraft();
  if (draft) {
    // Restored quietly — this is the same tab the numbers were typed into, so a
    // banner announcing it would be telling someone what they already know.
    state = draft;
    applyState(state);
    setSaveStatus(null, { draft: true });
    revealResults();
    applyHashCode();
    return;
  }

  applyState(hydrate(createDefaultState()));
  setSaveStatus(null);
  applyHashCode();
}

boot();
