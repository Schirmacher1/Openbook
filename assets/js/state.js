/**
 * Openbook — app state, defaults and persistence.
 *
 * Saving means localStorage on this device. Sharing means a plain-text code the
 * person copies and sends: the numbers never touch a server, because there isn't
 * one.
 */

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
    emergencyFund: 0
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
  'priceTestMode', 'testPrice', 'emergencyFund'
];

export function serialize(state) {
  const out = { savedAt: Date.now() };
  for (const key of PERSISTED_KEYS) out[key] = state[key];
  return out;
}

/** Merge saved data over the defaults, so an older save missing a field still loads. */
export function hydrate(data) {
  const base = createDefaultState();
  const merged = { ...base, ...(data || {}) };
  merged.k401 = { ...base.k401, ...(data?.k401 || {}) };
  for (const key of ['savingsItems', 'debtItems', 'expenseItems']) {
    merged[key] = Array.isArray(merged[key]) ? merged[key] : [];
    merged[key] = merged[key].map((it, i) => ({ id: it.id || uid(`r${i}`), mode: 'dollar', ...it }));
  }
  return merged;
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
  const binary = atob(String(code).trim());
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return hydrate(JSON.parse(new TextDecoder().decode(bytes)));
}
