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

// ── Behavior, run out of the real built bundle ──────────────────────────────────────────────

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

// ── The crash itself ─────────────────────────────────────────────────────────────────────────
//
// The reported symptom was iOS's "A problem repeatedly occurred on .../#register" — the web
// content process being killed, not a JS exception, which is why nothing ever reached the error
// banner. Cause: GET /admin/api/register has no LIMIT, and renderRegisterList drew every row it
// got. Measured against a realistic scanned historical register, at ~1.5KB of markup and ~25
// elements per row: 2,500 entries was 3.7MB of HTML and 61,620 DOM nodes, 5,000 was 7.4MB and
// 121,620 — and the search box rebuilt all of it on EVERY KEYSTROKE, undebounced. That is what
// exhausted the renderer's memory budget.

/** A realistic historical register row: every extended field populated, as the PDF import leaves them. */
function histEntry(i) {
  const y = 1890 + (i % 135);
  return {
    id: i + 1, type: 'baptism', event_date: y + '-0' + (1 + (i % 9)) + '-1' + (i % 9),
    name: 'Johann Friedrich Schmidt ' + i, name2: '', officiant: 'Rev. C. F. W. Walther',
    dob: (y - 1) + '-05-1' + (i % 9), place_of_birth: 'St. Louis, Missouri',
    baptism_place: 'Timothy Lutheran Church, St. Louis', father: 'Heinrich Schmidt ' + i,
    mother: 'Maria Katharina Schmidt (nee Bauer) ' + i,
    sponsors: 'Johann Bauer, Anna Bauer, Wilhelm Schmidt, Elisabeth Schmidt',
    record_type: 'Infant', notes: 'Recorded in the German-language register, vol. II',
    pdf_page: 1 + Math.floor(i / 4),
  };
}

function withRegister(n) {
  const ctx = makeCtx();
  ctx._regEntries = Array.from({ length: n }, (_, i) => histEntry(i));
  ctx._regType = 'baptism';
  ctx.regFilterChanged();
  return ctx;
}

const listHtml = (ctx) => ctx.document.getElementById('reg-list').innerHTML;
const rowCount = (ctx) => (listHtml(ctx).match(/<tr><td class="reg-c-date"/g) || []).length;

describe('register render is bounded, so a large register cannot kill the renderer', () => {
  it('renders a page, not the whole register', () => {
    const ctx = withRegister(2500);
    expect(rowCount(ctx)).toBe(ctx.REG_PAGE_SIZE);
  });

  it('holds peak DOM flat as the register grows — the property that fixes the crash', () => {
    // Both sides of this comparison sit above the "Show all" ceiling, so they render the same
    // footer and the only difference is the match count printed in it. Comparing across the
    // ceiling would compare two different footers, not two register sizes.
    const small = listHtml(withRegister(1200)).length;
    const huge = listHtml(withRegister(5000)).length;
    // Not byte-identical: "5000" is one char longer than "1200". What matters is that it does not
    // GROW with the register — a 4x bigger register must not produce meaningfully more markup.
    expect(Math.abs(huge - small)).toBeLessThan(64);
    // And an order of magnitude below where it was. 5,000 entries used to be ~7.4MB.
    expect(huge).toBeLessThan(600_000);
  });

  it('says how many matches are off screen rather than truncating silently', () => {
    const html = listHtml(withRegister(2500));
    expect(html).toContain('Showing the first 250 of 2500 matching entries');
    expect(html).toMatch(/onclick="regShowMore\(\)"/);
  });

  it('does not offer "Show all" above the ceiling — that button would hand the crash back', () => {
    // Rendering thousands of rows at once is the exact thing that killed the renderer. Show more
    // still reaches every entry, a page at a time.
    expect(listHtml(withRegister(2500))).not.toMatch(/regShowAll/);
    expect(listHtml(withRegister(400))).toMatch(/onclick="regShowAll\(\)"/);
  });

  it('shows no footer when everything matched fits', () => {
    expect(listHtml(withRegister(40))).not.toContain('Showing the first');
  });

  it('extends the window on "Show more", and drops the footer once caught up', () => {
    const ctx = withRegister(300);
    expect(rowCount(ctx)).toBe(250);
    ctx.regShowMore();
    expect(rowCount(ctx)).toBe(300);
    expect(listHtml(ctx)).not.toContain('Showing the first');
  });

  it('renders everything on an explicit "Show all"', () => {
    const ctx = withRegister(1200);
    ctx.regShowAll();
    expect(rowCount(ctx)).toBe(1200);
  });

  it('restarts the window when the filter changes, so a new search starts at page one', () => {
    const ctx = withRegister(2500);
    ctx.regShowAll();
    expect(rowCount(ctx)).toBe(2500);
    ctx.regFilterChanged();
    expect(rowCount(ctx)).toBe(250);
  });

  it('keeps the count in the toolbar honest about the full match set', () => {
    const ctx = withRegister(2500);
    // 2500 of 2500 match, so it reads as a plain total rather than "n of m".
    expect(ctx.document.getElementById('reg-stat-txt').textContent).toBe('2500 baptisms');
    ctx.document.getElementById('reg-search').value = 'Schmidt 7';
    ctx.regFilterChanged();
    expect(ctx.document.getElementById('reg-stat-txt').textContent).toMatch(/^\d+ of 2500 shown$/);
  });
});

describe('search is debounced, so typing does not re-render per character', () => {
  it('coalesces a burst of keystrokes into one render', async () => {
    const ctx = withRegister(600);
    let renders = 0;
    const real = ctx.filterRegister;
    ctx.filterRegister = function () { renders++; return real.apply(this, arguments); };
    for (const q of ['s', 'sc', 'sch', 'schm', 'schmi']) {
      ctx.document.getElementById('reg-search').value = q;
      ctx.debounceRegister();
    }
    expect(renders, 'rendered while still typing').toBe(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(renders).toBe(1);
  });

  it('is wired to the search box in the markup', () => {
    const input = CHMS_HTML.match(/<input[^>]*id="reg-search"[^>]*>/)[0];
    expect(input).toContain('oninput="debounceRegister()"');
  });
});

describe('printing is not capped by the on-screen window', () => {
  it('prints every match, not just the rendered page', () => {
    const ctx = withRegister(900);
    let written = '';
    ctx.window.open = () => ({ document: { write(h) { written += h; }, close() {} } });
    ctx.printRegister();
    expect(written).toContain('900 entries');
    // One numbered row per entry, plus the year header rows.
    expect((written.match(/<tr>/g) || []).length).toBeGreaterThan(900);
  });

  it('shares one filter with the screen, so the two cannot disagree', () => {
    // regFilteredEntries is the single source; a second hand-rolled copy is how they drift.
    expect(typeof makeCtx().regFilteredEntries).toBe('function');
  });
});

describe('row markup moved from inline styles to classes, carrying the same declarations', () => {
  // The weight of the repeated inline styles was itself part of the memory problem. These pin the
  // values so the extraction cannot silently change how a row looks.
  const EXPECTED = {
    'reg-c-date': ['white-space:nowrap', 'color:var(--warm-gray)', 'width:96px'],
    'reg-c-sm': ['font-size:.85rem'],
    'reg-c-act': ['white-space:nowrap', 'text-align:right'],
    'reg-sub': ['font-size:.75rem', 'color:var(--warm-gray)'],
    'reg-sub-note': ['font-style:italic'],
    'reg-flabel': ['font-size:.72rem', 'color:var(--warm-gray)', 'text-transform:uppercase', 'letter-spacing:.03em'],
    'reg-dash': ['color:var(--faint)'],
    'reg-page': ['font-size:.72rem', 'color:var(--faint)'],
    'reg-yr-count': ['font-weight:400', 'color:var(--faint)'],
    'reg-rt-badge': ['display:inline-block', 'font-size:.68rem', 'padding:1px 6px', 'border-radius:4px', 'background:var(--linen)', 'color:var(--warm-gray)', 'margin-bottom:3px'],
    'reg-scroll': ['overflow-x:auto', '-webkit-overflow-scrolling:touch', 'margin-top:8px'],
  };

  for (const [cls, decls] of Object.entries(EXPECTED)) {
    it('.' + cls + ' keeps its declarations', () => {
      // Plain string slicing rather than a built regex — no escaping to get wrong.
      const at = CHMS_APP_CSS.indexOf('\n.' + cls + '{');
      expect(at, '.' + cls + ' is not defined').toBeGreaterThan(-1);
      const body = CHMS_APP_CSS.slice(at + cls.length + 3, CHMS_APP_CSS.indexOf('}', at));
      for (const d of decls) expect(body, '.' + cls + ' lost ' + d).toContain(d);
    });
  }

  it('leaves no inline style attributes on a rendered register row', () => {
    const rows = listHtml(withRegister(3));
    const trs = rows.match(/<tr><td[\s\S]*?<\/tr>/g) || [];
    expect(trs.length).toBe(3);
    for (const tr of trs) expect(tr).not.toMatch(/style="/);
  });
});
