/**
 * Openbook — app state, defaults and persistence.
 *
 * Saving means localStorage on this device. Sharing means a plain-text code the
 * person copies and sends: the numbers never touch a server, because there isn't
 * one.
 */

import { STATE_DATA, CREDIT_BANDS, FILING_LABELS, PAY_FREQ } from './data.js';

const uid = (() => {
  let n = 0;
  return (prefix) => `${prefix}${++n}_${Date.now().toString(36)}`;
})();

export const STORAGE_KEY = 'openbook.v1';

/**
 * Example numbers, so the page is alive on arrival and every control has
 * something to demonstrate. The interface labels these as an example and offers
 * a one-click reset to empty.
 */
export function createDefaultState() {
  return {
    salary: 95000,
    filing: 'single',
    payfreq: 'biweekly',
    k401: { pct: 8, mode: 'pct', type: 'traditional' },
    savingsItems: [
      { id: uid('sav'), label: 'HSA', value: 150, mode: 'dollar', pretax: true },
      { id: uid('sav'), label: 'Emergency fund', value: 250, mode: 'dollar' },
      { id: uid('sav'), label: 'Investments', value: 300, mode: 'dollar' },
      { id: uid('sav'), label: 'Everyday spending money', value: 12, mode: 'pct' }
    ],
    debtItems: [
      { id: uid('debt'), label: 'Car loan', value: 450 },
      { id: uid('debt'), label: 'Student loans', value: 280 },
      { id: uid('debt'), label: 'Credit cards (minimum)', value: 0 }
    ],
    expenseItems: [
      { id: uid('exp'), label: 'Utilities', value: 280 },
      { id: uid('exp'), label: 'Groceries', value: 600 },
      { id: uid('exp'), label: 'Transport & fuel', value: 220 },
      { id: uid('exp'), label: 'Phone & internet', value: 130 },
      { id: uid('exp'), label: 'Insurance (auto, life)', value: 200 },
      { id: uid('exp'), label: 'Health, dental & vision premiums', value: 300, pretax: true }
    ],
    credit: '740',
    term: 30,
    city: '',
    stateCode: 'CO',
    downpayment: 40000,
    hoa: 0,
    insMode: 'estimate',
    insManual: 120,
    priceTestMode: 'auto',
    testPrice: null,
    // Optional: only the readiness checks use it, and they say so when it's blank.
    emergencyFund: 0,
    // Changes which branch of The Money Guy's 3/5/25 applies: a first home can go
    // down to 3%, anything after it is 20%.
    firstHome: true
  };
}

/** A blank slate for someone who'd rather start from nothing. */
export function createEmptyState() {
  return {
    ...createDefaultState(),
    salary: 0,
    k401: { pct: 0, mode: 'pct', type: 'traditional' },
    savingsItems: [],
    debtItems: [],
    expenseItems: [],
    downpayment: 0,
    hoa: 0
  };
}

export function newItem(kind, overrides = {}) {
  const labels = { sav: 'New savings item', debt: 'New debt', exp: 'New expense' };
  return { id: uid(kind), label: labels[kind] || 'New item', value: 0, mode: 'dollar', ...overrides };
}

const PERSISTED_KEYS = [
  'salary', 'filing', 'payfreq', 'k401', 'savingsItems', 'debtItems', 'expenseItems',
  'credit', 'term', 'city', 'stateCode', 'downpayment', 'hoa', 'insMode', 'insManual',
  'priceTestMode', 'testPrice', 'emergencyFund', 'firstHome'
];

export function serialize(state) {
  const out = { savedAt: Date.now() };
  for (const key of PERSISTED_KEYS) out[key] = state[key];
  return out;
}

/* ---------------------------------------------------------------------------
 * Hydration
 *
 * Everything that reaches hydrate() is untrusted: a share code is typed in by
 * hand from whoever sent it, and localStorage is only as trustworthy as the
 * browser it sits in. So state is rebuilt field by field from an allowlist
 * rather than merged — an unknown key never survives, every number is finite
 * and clamped, every enum is checked against its own options, and the lists
 * have a length limit. A hostile code should be able to make the page show
 * silly figures at worst, never hang it or print NaN.
 * ------------------------------------------------------------------------- */

/** Generous enough that nobody real hits one; tight enough to keep the page up. */
export const LIMITS = {
  salary: 100_000_000,
  amount: 10_000_000,   // any monthly figure or dollar field
  price: 1_000_000_000,
  pct: 100,
  items: 100,           // rows in any one list
  label: 120,           // characters
  city: 80,
  id: 64,
  shareCode: 64_000     // characters of base64
};

/** A finite number clamped to [0, max]; anything else falls back. */
function num(value, max, fallback = 0) {
  const n = typeof value === 'number'
    ? value
    : parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), max);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** Strings only — never coerces, so a hostile object can't run its own toString. */
function text(value, max, fallback = '') {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function sanitizeItems(raw, { allowPct }) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, LIMITS.items).map((entry, i) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const mode = allowPct ? oneOf(item.mode, ['dollar', 'pct'], 'dollar') : 'dollar';
    return {
      id: text(item.id, LIMITS.id) || uid(`r${i}`),
      label: text(item.label, LIMITS.label) || 'Untitled',
      mode,
      value: num(item.value, mode === 'pct' ? LIMITS.pct : LIMITS.amount),
      // A percentage of take-home isn't defined before tax, so it can't be pre-tax.
      pretax: mode === 'dollar' && item.pretax === true,
      excluded: item.excluded === true
    };
  });
}

/** Rebuild a valid state from whatever turned up. */
export function hydrate(data) {
  const base = createDefaultState();
  const raw = data && typeof data === 'object' ? data : {};
  const k401 = raw.k401 && typeof raw.k401 === 'object' ? raw.k401 : {};
  const k401Mode = oneOf(k401.mode, ['pct', 'dollar'], base.k401.mode);

  return {
    salary: num(raw.salary, LIMITS.salary, base.salary),
    filing: oneOf(raw.filing, Object.keys(FILING_LABELS), base.filing),
    payfreq: oneOf(raw.payfreq, Object.keys(PAY_FREQ), base.payfreq),
    k401: {
      mode: k401Mode,
      type: oneOf(k401.type, ['traditional', 'roth'], base.k401.type),
      pct: num(k401.pct, k401Mode === 'pct' ? LIMITS.pct : LIMITS.amount, 0)
    },
    savingsItems: sanitizeItems(raw.savingsItems, { allowPct: true }),
    debtItems: sanitizeItems(raw.debtItems, { allowPct: false }),
    expenseItems: sanitizeItems(raw.expenseItems, { allowPct: false }),
    credit: oneOf(raw.credit, Object.keys(CREDIT_BANDS), base.credit),
    term: Number(raw.term) === 15 ? 15 : 30,
    city: text(raw.city, LIMITS.city),
    stateCode: oneOf(raw.stateCode, Object.keys(STATE_DATA), base.stateCode),
    downpayment: num(raw.downpayment, LIMITS.price, base.downpayment),
    hoa: num(raw.hoa, LIMITS.amount, 0),
    insMode: oneOf(raw.insMode, ['estimate', 'manual'], base.insMode),
    insManual: num(raw.insManual, LIMITS.amount, base.insManual),
    priceTestMode: oneOf(raw.priceTestMode, ['auto', 'manual'], base.priceTestMode),
    testPrice: raw.testPrice == null ? null : num(raw.testPrice, LIMITS.price),
    emergencyFund: num(raw.emergencyFund, LIMITS.salary, 0),
    firstHome: raw.firstHome !== false
  };
}

export function save(state) {
  const payload = serialize(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload.savedAt;
}

export function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return { state: hydrate(data), savedAt: data.savedAt };
}

export function clear() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ---------------------------------------------------------------------------
 * The in-tab draft
 *
 * Saving to the device is deliberately something you ask for — this tool knows
 * your salary, your debts and what you have put by, and silently leaving that on
 * a library or office machine for whoever sits down next would undo the promise
 * the rest of the page makes.
 *
 * Losing twenty minutes of typing to a stray refresh is a different problem, and
 * it has a different answer: sessionStorage. A draft written here survives a
 * reload, the back button and a restored tab, and is destroyed by the browser
 * when the tab closes. Nothing to clean up, nothing left behind.
 *
 * Every call swallows its own failure. A draft is a convenience; it must never
 * be the reason something breaks.
 * ------------------------------------------------------------------------- */

export const DRAFT_KEY = 'openbook.draft.v1';

export function saveDraft(state) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? hydrate(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    /* nothing to clear */
  }
}

/* ---------------------------------------------------------------------------
 * Named views
 *
 * A library of saved scenarios — "current plan", "if we clear the car loan",
 * "the Denver version" — each a complete set of numbers you can come back to.
 *
 * Same posture as the single save: localStorage, this device only, never sent
 * anywhere, and only ever written when you ask. Read back through hydrate() like
 * any other stored input, so a corrupted or tampered entry is sanitised rather
 * than trusted.
 * ------------------------------------------------------------------------- */

export const VIEWS_KEY = 'openbook.views.v1';
export const VIEW_LIMITS = { name: 60, count: 24 };

let viewSeq = 0;
const viewId = () => `v${++viewSeq}_${Date.now().toString(36)}`;

/** Newest first. Never throws: a broken store reads as an empty library. */
export function listViews() {
  let raw;
  try {
    raw = localStorage.getItem(VIEWS_KEY);
  } catch (e) {
    return [];
  }
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return [];
  }

  const entries = Array.isArray(parsed?.views) ? parsed.views : [];
  return entries
    .slice(0, VIEW_LIMITS.count)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, i) => ({
      id: typeof entry.id === 'string' ? entry.id.slice(0, 64) : `stored${i}`,
      name: (typeof entry.name === 'string' ? entry.name : '').slice(0, VIEW_LIMITS.name) || 'Untitled view',
      savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : 0,
      state: hydrate(entry.data)
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

function writeViews(views) {
  const payload = {
    views: views.slice(0, VIEW_LIMITS.count).map((view) => ({
      id: view.id,
      name: view.name,
      savedAt: view.savedAt,
      data: serialize(view.state)
    }))
  };
  localStorage.setItem(VIEWS_KEY, JSON.stringify(payload));
}

/**
 * Save under a name, replacing any view already using it — saving "Plan A"
 * twice should update Plan A, not leave two of them.
 */
export function saveView(name, state) {
  const clean = String(name ?? '').trim().slice(0, VIEW_LIMITS.name);
  if (!clean) throw new Error('A view needs a name');

  const views = listViews();
  const existing = views.find((view) => view.name.toLowerCase() === clean.toLowerCase());
  const entry = {
    id: existing ? existing.id : viewId(),
    name: clean,
    savedAt: Date.now(),
    state: hydrate(serialize(state))
  };

  const rest = views.filter((view) => view.id !== entry.id);
  if (rest.length + 1 > VIEW_LIMITS.count) {
    // Drop the oldest to make room rather than refusing the save.
    rest.length = VIEW_LIMITS.count - 1;
  }
  writeViews([entry, ...rest]);
  return { view: entry, replaced: Boolean(existing) };
}

export function renameView(id, name) {
  const clean = String(name ?? '').trim().slice(0, VIEW_LIMITS.name);
  if (!clean) throw new Error('A view needs a name');
  const views = listViews();
  const target = views.find((view) => view.id === id);
  if (!target) return false;
  target.name = clean;
  writeViews(views);
  return true;
}

export function deleteView(id) {
  writeViews(listViews().filter((view) => view.id !== id));
}

export function clearViews() {
  try {
    localStorage.removeItem(VIEWS_KEY);
  } catch (e) {
    /* nothing stored */
  }
}

/* ---------------------------------------------------------------------------
 * Share codes
 *
 * A link can't carry the numbers reliably — this page is often opened inside
 * another app's viewer, which doesn't hand the script the URL it was given. So
 * sharing packs the state into a short base64 code that travels over text,
 * email or chat, and the other person pastes it back in.
 * ------------------------------------------------------------------------- */

export function encodeShareCode(state) {
  const json = JSON.stringify(serialize(state));
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export function decodeShareCode(code) {
  const raw = String(code).trim();
  // Refuse to decode something far larger than any real state, rather than
  // handing a multi-megabyte string to atob and JSON.parse.
  if (raw.length > LIMITS.shareCode) throw new Error('Share code is too long to be real');
  const binary = atob(raw);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return hydrate(JSON.parse(new TextDecoder().decode(bytes)));
}
