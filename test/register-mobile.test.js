import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_CSS, CHMS_HTML } from '../src/html-chms.js';

// The Church Register was effectively read-only on a phone, and searching it led nowhere: you
// could find an entry and tap Edit, and nothing happened. Two independent defects, both about
// display state rather than about the search filter itself (the filter is fine — it was driven
// through the real bundle against null names, missing dates and numeric pdf_page values and
// never threw):
//
//   1. The phone stylesheet revealed the "+ Add" button with `.reg-add-toggle`, a CLASS. The
//      button carries id="reg-add-toggle" and no class of that name, so the rule matched
//      nothing. With the form panel display:none on phones and the button hidden by its own
//      inline style, the add/edit form was unreachable.
//   2. toggleRegForm and openRegisterEdit revealed the panel with `style.display = ''`. Clearing
//      an inline style does not override a stylesheet rule — it hands the decision back to it —
//      so the panel stayed display:none. openRegisterEdit even carried the comment "Ensure form
//      is visible (mobile)" while doing the one thing that cannot make it visible on mobile.
//
// These tests assert the mechanism (an ID selector, a class-driven toggle) rather than the
// literal text, and each one pins the premise that made the old code wrong.

const PHONE = '@media(max-width:767px){';

/** The phone block that styles the register form panel, by brace counting. */
function regPhoneBlock() {
  let i = CHMS_APP_CSS.indexOf(PHONE);
  while (i !== -1) {
    let depth = 0, j = i + PHONE.length - 1;
    for (; j < CHMS_APP_CSS.length; j++) {
      if (CHMS_APP_CSS[j] === '{') depth++;
      else if (CHMS_APP_CSS[j] === '}' && --depth === 0) break;
    }
    const text = CHMS_APP_CSS.slice(i, j + 1);
    if (/\.reg-form-panel/.test(text)) return text;
    i = CHMS_APP_CSS.indexOf(PHONE, j + 1);
  }
  return null;
}

describe('register on a phone — the "+ Add" button is actually reachable', () => {
  const block = regPhoneBlock();

  it('has a phone block that collapses the register form', () => {
    expect(block, 'no 767px block styles .reg-form-panel').toBeTruthy();
    expect(block).toMatch(/\.reg-form-panel\{[^}]*display:none/);
  });

  it('reveals the toggle by ID, because that is what the element carries', () => {
    expect(block).toMatch(/#reg-add-toggle\{[^}]*display:inline-flex/);
    // The premise. If the button ever gains a real class, this test should be revisited —
    // but until then a class selector silently reaches nothing.
    const btn = CHMS_HTML.match(/<button[^>]*id="reg-add-toggle"[^>]*>/);
    expect(btn, 'the add toggle is no longer an id').toBeTruthy();
    expect(btn[0]).not.toMatch(/class="[^"]*reg-add-toggle/);
  });

  it('no longer ships the class selector that matched nothing', () => {
    expect(CHMS_APP_CSS).not.toMatch(/\.reg-add-toggle/);
  });

  it('uses !important, which is what beats the button’s inline display:none', () => {
    // An important author declaration outranks a normal inline one. Drop the !important and the
    // button stays hidden however correct the selector is.
    expect(block).toMatch(/#reg-add-toggle\{[^}]*!important/);
    const btn = CHMS_HTML.match(/<button[^>]*id="reg-add-toggle"[^>]*>/)[0];
    expect(btn, 'premise: the button is hidden by an inline style').toMatch(/style="[^"]*display:none/);
  });

  it('reveals the panel through a class, not by clearing an inline style', () => {
    expect(block).toMatch(/\.reg-form-panel\.reg-form-open\{[^}]*display:block/);
  });

  it('leaves desktop alone — the panel is only ever hidden inside a phone block', () => {
    const withoutPhoneBlocks = CHMS_APP_CSS.split(PHONE).map((s, n) => (n === 0 ? s : '')).join('');
    expect(withoutPhoneBlocks).not.toMatch(/\.reg-form-panel\{[^}]*display:none/);
  });
});

// ── Behaviour, run out of the real built bundle ──────────────────────────────────────────────

function fakeEl(id) {
  const e = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, files: [],
    _classes: new Set(), _focused: false, _scrolled: false,
    appendChild() {}, addEventListener() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() { e._focused = true; }, scrollIntoView() { e._scrolled = true; },
  };
  e.classList = {
    add: (c) => e._classes.add(c),
    remove: (c) => e._classes.delete(c),
    contains: (c) => e._classes.has(c),
    toggle: (c, on) => (on === undefined
      ? (e._classes.has(c) ? e._classes.delete(c) : e._classes.add(c))
      : (on ? e._classes.add(c) : e._classes.delete(c))),
  };
  return e;
}

function makeCtx() {
  const store = {};
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = fakeEl(id)); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement: () => fakeEl('x'), addEventListener() {}, body: fakeEl('body'),
      activeElement: null,
    },
    console, setTimeout, clearTimeout, Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt,
    isFinite, Number, String, Object, Array, Promise, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    alert() {}, confirm() { return false; },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.__store = store;
  return ctx;
}

const panelOf = (ctx) => ctx.document.getElementById('reg-form-panel');

describe('register form toggle — class-driven, so the phone rule can be overridden', () => {
  it('opens and closes on repeated taps of "+ Add"', () => {
    const ctx = makeCtx();
    ctx.toggleRegForm();
    expect(panelOf(ctx).classList.contains('reg-form-open')).toBe(true);
    ctx.toggleRegForm();
    expect(panelOf(ctx).classList.contains('reg-form-open')).toBe(false);
  });

  it('never writes an inline display, which is what could not win', () => {
    const ctx = makeCtx();
    ctx.toggleRegForm();
    expect(panelOf(ctx).style.display).toBeFalsy();
  });

  it('scrolls the form into view when opening, not when closing', () => {
    const ctx = makeCtx();
    ctx.toggleRegForm();
    expect(panelOf(ctx)._scrolled).toBe(true);
    const ctx2 = makeCtx();
    panelOf(ctx2).classList.add('reg-form-open');
    ctx2.toggleRegForm();
    expect(panelOf(ctx2)._scrolled).toBe(false);
  });
});

describe('tapping Edit on a search result', () => {
  const entry = { id: 7, event_date: '1962-04-01', name: 'Ada Meyer', pdf_page: 14 };

  function withEntry() {
    const ctx = makeCtx();
    ctx._regEntries = [entry];
    ctx._regType = 'baptism';
    return ctx;
  }

  it('reveals the form on a phone instead of silently doing nothing', () => {
    const ctx = withEntry();
    ctx.openRegisterEdit(7);
    expect(panelOf(ctx).classList.contains('reg-form-open')).toBe(true);
  });

  it('scrolls to the form, which stacks above a long list on a phone', () => {
    const ctx = withEntry();
    ctx.openRegisterEdit(7);
    expect(panelOf(ctx)._scrolled).toBe(true);
  });

  it('still loads the entry and focuses the name field', () => {
    const ctx = withEntry();
    ctx.openRegisterEdit(7);
    expect(ctx.document.getElementById('reg-name').value).toBe('Ada Meyer');
    expect(ctx.document.getElementById('reg-name')._focused).toBe(true);
  });

  it('collapses the form again on Cancel', () => {
    const ctx = withEntry();
    ctx.openRegisterEdit(7);
    ctx.cancelRegisterEdit();
    expect(panelOf(ctx).classList.contains('reg-form-open')).toBe(false);
  });
});

describe('register search filter', () => {
  function search(ctx, q) {
    ctx.document.getElementById('reg-search').value = q;
    ctx.filterRegister();
    return ctx.document.getElementById('reg-stat-txt').textContent;
  }

  const ENTRIES = [
    { id: 1, event_date: '2024-03-10', name: 'Mary Schmidt', name2: 'John Schmidt', officiant: 'Rev. Dinger' },
    { id: 2, event_date: '2023-11-05', name: 'Peter O’Brien', name2: null, officiant: null, father: 'Sean' },
    { id: 3, event_date: '1962-04-01', name: null, name2: null, officiant: null, pdf_page: 14 },
    { id: 4, event_date: null, name: 'Anna Weiss', officiant: 'Rev. Klein' },
  ];

  function loaded() {
    const ctx = makeCtx();
    ctx._regEntries = ENTRIES;
    ctx._regType = 'baptism';
    return ctx;
  }

  it('matches on name, and on a multi-word query across fields', () => {
    expect(search(loaded(), 'mary')).toBe('1 of 4 shown');
    expect(search(loaded(), 'rev dinger')).toBe('1 of 4 shown');
  });

  it('does not match the literal text "null" on a record with no name', () => {
    // Old records imported from the scanned register can have no name. Concatenating a null
    // name into the haystack made every one of them findable by searching "null" — and made
    // any query containing that substring return them.
    expect(search(loaded(), 'null')).toBe('0 of 4 shown');
  });

  it('survives records with null/undefined fields, missing dates and numeric pdf_page', () => {
    const ctx = loaded();
    expect(() => search(ctx, 'a')).not.toThrow();
    // The unfiltered batch is the one that includes the nameless, numeric-pdf_page record, and
    // it also carries a father, which is what puts the renderer on its extended-fields path.
    expect(() => search(ctx, '')).not.toThrow();
    expect(ctx.document.getElementById('reg-list').innerHTML).toContain('p.14');
  });
});
