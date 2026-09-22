/**
 * Security tests for the one untrusted input this site has: the share code.
 *
 * A share code is typed in by hand from whoever sent it, and saved state is only
 * as trustworthy as the browser holding it. Both go through hydrate(), so these
 * tests pin the guarantees it has to keep — no unknown keys, no non-finite
 * numbers, no unbounded lists or strings, no prototype pollution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hydrate, createDefaultState, encodeShareCode, decodeShareCode, LIMITS } from '../assets/js/state.js';
import { compute } from '../assets/js/calc.js';
import { evaluateBenchmarks, readiness } from '../assets/js/guidance.js';

/** Every headline figure the interface prints must be a real number. */
function assertNoBadNumbers(state, label) {
  const result = compute(state);
  const figures = [
    result.price, result.payment.total, result.paycheck.netMonthly, result.housingBudget,
    result.takeHomePerPeriod, result.ledger.debitsTotal, result.ledger.unallocated,
    result.approval.price, result.ruleOfThumb.price, ...evaluateBenchmarks(result, state).map((b) => b.price)
  ];
  for (const figure of figures) {
    assert.ok(Number.isFinite(figure), `${label} produced a non-finite figure: ${figure}`);
  }
  // The readiness copy is built from those same numbers.
  for (const check of readiness(result, state)) {
    assert.doesNotMatch(check.detail, /NaN|Infinity|undefined/, `${label} leaked into readiness copy`);
  }
}

/* -------------------------------------------------------------------------- */

test('hydrate only ever emits the known keys', () => {
  const expected = Object.keys(createDefaultState()).sort();
  assert.deepEqual(Object.keys(hydrate({})).sort(), expected);
  assert.deepEqual(Object.keys(hydrate({ evil: 1, onclick: 'x', __proto__: {} })).sort(), expected);
});

test('an unknown key from a share code is dropped, not carried', () => {
  const state = hydrate({ salary: 50000, evilKey: 'payload', render: () => {} });
  assert.equal(state.evilKey, undefined);
  assert.equal(state.render, undefined);
  assert.equal(state.salary, 50000);
});

test('__proto__ and constructor payloads do not pollute Object.prototype', () => {
  hydrate(JSON.parse('{"__proto__":{"polluted":true}}'));
  hydrate(JSON.parse('{"constructor":{"prototype":{"pwned":true}}}'));
  hydrate(JSON.parse('{"savingsItems":[{"__proto__":{"polluted2":true}}]}'));
  assert.equal({}.polluted, undefined);
  assert.equal({}.pwned, undefined);
  assert.equal({}.polluted2, undefined);
});

test('non-finite and absurd numbers never reach the output', () => {
  const cases = {
    'salary Infinity': { salary: Infinity },
    'salary -Infinity': { salary: -Infinity },
    'salary NaN': { salary: NaN },
    'salary huge string': { salary: '9'.repeat(40) },
    'negative salary': { salary: -500000 },
    'downpayment huge': { downpayment: 1e18 },
    'hoa Infinity': { hoa: Infinity },
    'testPrice NaN': { priceTestMode: 'manual', testPrice: NaN },
    'k401 Infinity': { k401: { pct: Infinity, mode: 'pct' } },
    'item value NaN': { debtItems: [{ label: 'x', value: NaN }] },
    'item value object': { debtItems: [{ label: 'x', value: { a: 1 } }] },
    'pct absurd': { savingsItems: [{ label: 'x', value: 1e9, mode: 'pct' }] }
  };
  for (const [label, payload] of Object.entries(cases)) {
    assertNoBadNumbers(hydrate(payload), label);
  }
});

test('numbers are clamped into their documented range', () => {
  assert.equal(hydrate({ salary: 1e18 }).salary, LIMITS.salary);
  assert.equal(hydrate({ salary: -5 }).salary, 0);
  assert.equal(hydrate({ downpayment: 1e18 }).downpayment, LIMITS.price);
  assert.equal(hydrate({ savingsItems: [{ value: 1e9, mode: 'pct' }] }).savingsItems[0].value, LIMITS.pct);
});

test('lists and labels are bounded, so a hostile code cannot hang the page', () => {
  const many = Array.from({ length: 200_000 }, (_, i) => ({ label: `row ${i}`, value: 1 }));
  const state = hydrate({ debtItems: many, savingsItems: many, expenseItems: many });
  assert.equal(state.debtItems.length, LIMITS.items);
  assert.equal(state.savingsItems.length, LIMITS.items);
  assert.equal(state.expenseItems.length, LIMITS.items);

  const long = hydrate({ debtItems: [{ label: 'A'.repeat(5_000_000), value: 1 }] });
  assert.equal(long.debtItems[0].label.length, LIMITS.label);
  assert.equal(hydrate({ city: 'B'.repeat(10_000) }).city.length, LIMITS.city);
});

test('a label is never coerced, so it cannot run code of its own', () => {
  let called = false;
  const hostile = { toString() { called = true; throw new Error('boom'); } };
  const state = hydrate({ debtItems: [{ label: hostile, value: 1 }] });
  assert.equal(called, false, 'hydrate must not call toString on untrusted input');
  assert.equal(typeof state.debtItems[0].label, 'string');
  assert.equal(state.debtItems[0].label, 'Untitled');
});

test('enums fall back rather than reaching the reference tables as-is', () => {
  const state = hydrate({
    filing: 'nope', payfreq: 'nope', stateCode: 'ZZ', credit: '999',
    insMode: 'nope', priceTestMode: 'nope', term: 0,
    k401: { mode: 'nope', type: 'nope' }
  });
  const base = createDefaultState();
  assert.equal(state.filing, base.filing);
  assert.equal(state.payfreq, base.payfreq);
  assert.equal(state.stateCode, base.stateCode);
  assert.equal(state.credit, base.credit);
  assert.equal(state.insMode, base.insMode);
  assert.equal(state.priceTestMode, base.priceTestMode);
  assert.equal(state.term, 30);
  assert.equal(state.k401.mode, base.k401.mode);
  assert.equal(state.k401.type, base.k401.type);
  assertNoBadNumbers(state, 'bogus enums');
});

test('a list given as the wrong type becomes an empty list', () => {
  for (const wrong of ['evil', 42, null, {}, true]) {
    const state = hydrate({ savingsItems: wrong, debtItems: wrong, expenseItems: wrong });
    assert.ok(Array.isArray(state.savingsItems));
    assert.equal(state.debtItems.length, 0);
    assertNoBadNumbers(state, `list as ${typeof wrong}`);
  }
});

test('a percentage row can never be marked pre-tax', () => {
  const state = hydrate({ savingsItems: [{ label: 'x', value: 10, mode: 'pct', pretax: true }] });
  assert.equal(state.savingsItems[0].pretax, false);
});

test('decodeShareCode refuses an oversized code instead of parsing it', () => {
  assert.throws(() => decodeShareCode('A'.repeat(LIMITS.shareCode + 1)), /too long/i);
});

test('decodeShareCode rejects malformed input rather than half-loading it', () => {
  for (const bad of ['not base64!!', '', '{}', 'eyJhIjox']) {
    assert.throws(() => decodeShareCode(bad));
  }
});

test('a legitimate share code still round-trips exactly', () => {
  const original = createDefaultState();
  const restored = decodeShareCode(encodeShareCode(original));
  assert.equal(restored.salary, original.salary);
  assert.equal(restored.debtItems.length, original.debtItems.length);
  assert.equal(restored.debtItems[0].label, original.debtItems[0].label);
  assert.equal(Math.round(compute(restored).price), Math.round(compute(original).price));
});

test('unicode survives the round trip', () => {
  const state = { ...createDefaultState(), city: 'Zürich · 日本 · café' };
  assert.equal(decodeShareCode(encodeShareCode(state)).city, 'Zürich · 日本 · café');
});

/* ---------------------------------------------------------------------------
 * The in-tab draft
 * ------------------------------------------------------------------------- */

/** Minimal Storage stand-in; `failing` models a browser that blocks storage. */
function fakeStorage({ failing = false } = {}) {
  const map = new Map();
  const boom = () => { throw new Error('storage blocked'); };
  return {
    getItem: (k) => (failing ? boom() : (map.has(k) ? map.get(k) : null)),
    setItem: (k, v) => (failing ? boom() : map.set(k, String(v))),
    removeItem: (k) => (failing ? boom() : map.delete(k)),
    _map: map
  };
}

async function withSessionStorage(storage, fn) {
  const original = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });
  try { return await fn(); }
  finally {
    if (original === undefined) delete globalThis.sessionStorage;
    else Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true, writable: true });
  }
}

test('a draft round-trips through the same sanitiser as a share code', async () => {
  const { saveDraft, loadDraft, clearDraft, DRAFT_KEY } = await import('../assets/js/state.js');
  const storage = fakeStorage();

  await withSessionStorage(storage, () => {
    assert.equal(loadDraft(), null, 'no draft to begin with');

    const state = { ...createDefaultState(), salary: 123456 };
    assert.equal(saveDraft(state), true);

    const restored = loadDraft();
    assert.equal(restored.salary, 123456);
    assert.equal(restored.debtItems.length, state.debtItems.length);

    clearDraft();
    assert.equal(loadDraft(), null, 'cleared');
  });
});

test('a tampered draft is sanitised, not trusted', async () => {
  const { loadDraft, DRAFT_KEY } = await import('../assets/js/state.js');
  const storage = fakeStorage();
  storage.setItem(DRAFT_KEY, JSON.stringify({
    salary: Infinity,
    evilKey: 'payload',
    debtItems: Array.from({ length: 5000 }, () => ({ label: 'x'.repeat(500), value: 1 }))
  }));

  await withSessionStorage(storage, () => {
    const draft = loadDraft();
    assert.equal(Object.keys(draft).sort().join(), Object.keys(createDefaultState()).sort().join());
    assert.equal(draft.evilKey, undefined);
    assert.equal(draft.debtItems.length, LIMITS.items);
    assert.equal(draft.debtItems[0].label.length, LIMITS.label);
    assertNoBadNumbers(draft, 'tampered draft');
  });
});

test('a draft never throws, whatever the browser does', async () => {
  const { saveDraft, loadDraft, clearDraft, DRAFT_KEY } = await import('../assets/js/state.js');

  // Storage blocked outright, as in some private-browsing modes.
  await withSessionStorage(fakeStorage({ failing: true }), () => {
    assert.equal(saveDraft(createDefaultState()), false, 'reports failure rather than throwing');
    assert.equal(loadDraft(), null);
    assert.doesNotThrow(() => clearDraft());
  });

  // Storage present but holding junk.
  const junk = fakeStorage();
  junk.setItem(DRAFT_KEY, 'not json at all');
  await withSessionStorage(junk, () => {
    assert.equal(loadDraft(), null, 'unparseable draft is ignored, not fatal');
  });
});

/* ---------------------------------------------------------------------------
 * Named views
 * ------------------------------------------------------------------------- */

async function withLocalStorage(storage, fn) {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try { return await fn(); }
  finally {
    if (original === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true, writable: true });
  }
}

test('views round-trip, keeping each scenario independent', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage(), () => {
    assert.deepEqual(mod.listViews(), []);

    const a = { ...createDefaultState(), salary: 95000 };
    const b = { ...createDefaultState(), salary: 145000, debtItems: [] };
    mod.saveView('As things are', a);
    mod.saveView('After the raise', b);

    const views = mod.listViews();
    assert.equal(views.length, 2);

    const byName = Object.fromEntries(views.map((v) => [v.name, v.state]));
    assert.equal(byName['As things are'].salary, 95000);
    assert.equal(byName['After the raise'].salary, 145000);
    assert.equal(byName['As things are'].debtItems.length, a.debtItems.length);
    assert.equal(byName['After the raise'].debtItems.length, 0);
  });
});

test('saving under an existing name replaces rather than duplicates', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage(), () => {
    mod.saveView('Plan A', { ...createDefaultState(), salary: 90000 });
    const again = mod.saveView('plan a', { ...createDefaultState(), salary: 120000 });

    assert.equal(again.replaced, true, 'matching is case-insensitive');
    const views = mod.listViews();
    assert.equal(views.length, 1);
    assert.equal(views[0].salary, undefined);
    assert.equal(views[0].state.salary, 120000);
  });
});

test('a view needs a name', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage(), () => {
    assert.throws(() => mod.saveView('   ', createDefaultState()), /needs a name/i);
    assert.throws(() => mod.saveView(null, createDefaultState()), /needs a name/i);
    assert.equal(mod.listViews().length, 0);
  });
});

test('rename and delete act on the right view', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage(), () => {
    mod.saveView('One', createDefaultState());
    mod.saveView('Two', createDefaultState());

    const two = mod.listViews().find((v) => v.name === 'Two');
    assert.equal(mod.renameView(two.id, 'Two renamed'), true);
    assert.ok(mod.listViews().some((v) => v.name === 'Two renamed'));
    assert.ok(mod.listViews().some((v) => v.name === 'One'));

    mod.deleteView(two.id);
    assert.deepEqual(mod.listViews().map((v) => v.name), ['One']);

    assert.equal(mod.renameView('no-such-id', 'X'), false);
  });
});

test('the library is capped, dropping the oldest to make room', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage(), () => {
    for (let i = 0; i < mod.VIEW_LIMITS.count + 6; i++) {
      mod.saveView(`View ${i}`, { ...createDefaultState(), salary: 50000 + i });
    }
    const views = mod.listViews();
    assert.equal(views.length, mod.VIEW_LIMITS.count);
    // The most recent save must have survived.
    assert.ok(views.some((v) => v.name === `View ${mod.VIEW_LIMITS.count + 5}`));
  });
});

test('a tampered or corrupt view store is sanitised, never trusted', async () => {
  const mod = await import('../assets/js/state.js');

  const corrupt = fakeStorage();
  corrupt.setItem(mod.VIEWS_KEY, 'not json at all');
  await withLocalStorage(corrupt, () => {
    assert.deepEqual(mod.listViews(), [], 'unparseable store reads as empty');
  });

  const tampered = fakeStorage();
  tampered.setItem(mod.VIEWS_KEY, JSON.stringify({
    views: [
      { name: 'X'.repeat(500), data: { salary: Infinity, evilKey: 'payload' } },
      { name: '', data: null },
      'not an object'
    ]
  }));
  await withLocalStorage(tampered, () => {
    const views = mod.listViews();
    assert.equal(views.length, 2, 'the non-object entry is dropped');
    assert.equal(views[0].name.length, mod.VIEW_LIMITS.name);
    assert.equal(views[0].state.evilKey, undefined);
    assert.ok(Number.isFinite(views[0].state.salary));
    assert.equal(views[1].name, 'Untitled view');
    for (const view of views) assertNoBadNumbers(view.state, 'tampered view');
  });
});

test('views never throw when storage is blocked', async () => {
  const mod = await import('../assets/js/state.js');
  await withLocalStorage(fakeStorage({ failing: true }), () => {
    assert.deepEqual(mod.listViews(), []);
    assert.doesNotThrow(() => mod.clearViews());
    assert.throws(() => mod.saveView('X', createDefaultState()), /storage blocked/);
  });
});
