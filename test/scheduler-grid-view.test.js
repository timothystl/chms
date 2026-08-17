import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';

// Grid view: the whole month as one table, Sundays across and roles down,
// alongside the existing Week and Month views.
//
// The thing worth pinning is not the arrangement but the SHARING. A grid cell
// and a role row are two layouts over one slot, and they both resolve it
// through roleSlotView() — so the picker a cell opens, the confirmation key a
// pill cycles, and the star/other-svc marks are decided in one place. A second
// hand-inlined copy is exactly how the grid would come to disagree with the
// week view about who is assigned where (SW17). Several tests below compare the
// two views' output for the SAME slot for that reason.
//
// The script is one ~260KB template literal, so the class of bug that has bitten
// this file repeatedly (SC3-BUG1 / SC3-BUG2 / FIN15) is a stray backslash or
// backtick that breaks the WHOLE <script> at parse time and silently disables
// every feature in it. Executing the served string is what catches that; reading
// the source cannot.

const scriptMatch = SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/);
const SERVED_JS = scriptMatch ? scriptMatch[1] : '';

/** Minimal DOM: enough for the script's top-level wiring to evaluate. */
function fakeEl(id) {
  const e = {
    id, tagName: 'DIV', style: {}, dataset: {}, children: [], _attrs: {}, _classes: new Set(),
    innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    parentNode: null,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild() {}, remove() {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {}, scrollIntoView() {}, click() {},
    closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 100 }; },
  };
  e.parentNode = {
    setAttribute() {}, removeAttribute() {}, appendChild() {},
    parentNode: { appendChild() {} },
  };
  e.classList = {
    add: (...c) => c.forEach((x) => e._classes.add(x)),
    remove: (...c) => c.forEach((x) => e._classes.delete(x)),
    contains: (c) => e._classes.has(c),
    toggle: (c, on) => (on === undefined
      ? (e._classes.has(c) ? e._classes.delete(c) : e._classes.add(c))
      : (on ? e._classes.add(c) : e._classes.delete(c))),
  };
  return e;
}

/** Runs the real served scheduler script and hands back its globals. */
function runScheduler(opts = {}) {
  const els = {};
  const store = Object.assign({}, opts.localStorage || {});
  const sent = [];
  const selectors = {};   // selector string -> elements, so a test can stage a real query
  const ctx = {
    document: {
      getElementById(id) { return els[id] || (els[id] = fakeEl(id)); },
      querySelector() { return null; },
      querySelectorAll(sel) { return selectors[sel] || []; },
      createElement(tag) { const el = fakeEl('created-' + tag); el.tagName = String(tag).toUpperCase(); return el; },
      addEventListener() {},
      body: fakeEl('body'),
      documentElement: fakeEl('html'),
      activeElement: null,
      hidden: false,
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt, isFinite, isNaN,
    Number, String, Object, Array, Promise, Error, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, URLSearchParams,
    alert() {}, confirm() { return true; }, prompt() { return null; },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    unescape: globalThis.unescape,
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; } },
    navigator: { userAgent: 'test', clipboard: null },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    fetch(url, init) {
      sent.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve('{}'),
      });
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class { constructor() {} },
    Element: class {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window.location = { origin: 'https://connect.timothystl.org', href: '', search: '' };
  ctx.window.addEventListener = () => {};
  ctx.window.removeEventListener = () => {};
  ctx.window.open = () => null;
  ctx.window.innerWidth = 1200;
  ctx.window.innerHeight = 900;
  ctx.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

  vm.createContext(ctx);
  vm.runInContext(SERVED_JS, ctx, { filename: 'scheduler-served.js' });
  // `els` is populated lazily by getElementById, so read through el() rather
  // than indexing it before the script has asked for that element.
  const el = (id) => ctx.document.getElementById(id);
  return { ctx, els, el, store, sent, selectors };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Three regular Sundays plus one special service, shaped like currentSchedule. */
function makeSchedule(ctx, opts = {}) {
  const per = ctx.PER_ROLES;
  const shared = ctx.SHARED_ROLES;
  const rows = ['2026-08-02', '2026-08-09', '2026-08-16'].map((iso, i) => {
    const assignments = {};
    per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
    shared.forEach((r) => { assignments[r] = { shared: null }; });
    assignments[per[0]]['8am'] = 'p1';        // primary + cross-service filler
    assignments[shared[0]].shared = 'p2';
    return { type: 'sunday', date: new Date(iso + 'T12:00:00Z'), ordinal: i + 1, assignments };
  });
  if (opts.special !== false) {
    rows.push({
      type: 'special', date: new Date('2026-08-26T12:00:00Z'), name: 'Midweek Advent',
      ordinal: 0, services: [{ time: '7:00 PM', roles: [per[0]], assignments: {} }],
    });
  }
  return rows;
}

function seedPeople(ctx) {
  const people = [
    { id: 'p1', name: 'Larry Hawkins', email: 'larry@example.org', roles: ctx.PER_ROLES.slice(),
      primaryFor: [ctx.PER_ROLES[0]], preferredSundays: [], servicePreference: '10:45am', blackoutDates: [] },
    { id: 'p2', name: 'Holly Feldman', email: 'holly@example.org', roles: ctx.SHARED_ROLES.slice(),
      primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
  ];
  ctx.getPeople = () => people;
  return people;
}

/** Renders the grid and hands back its HTML. */
function renderGrid(opts = {}) {
  const h = runScheduler(opts.harness);
  h.ctx.currentSchedule = makeSchedule(h.ctx, opts);
  seedPeople(h.ctx);
  h.ctx.focusWeekViewMode = 'grid';
  h.ctx.renderFocusWeekDetail();
  return Object.assign(h, { html: h.el('fw-detail').innerHTML });
}

const count = (s, re) => (s.match(re) || []).length;

// ── 1. The served script still parses ────────────────────────────────────────

describe('served scheduler script', () => {
  it('parses and evaluates as shipped (standalone)', () => {
    expect(SERVED_JS.length).toBeGreaterThan(1000);
    expect(() => runScheduler()).not.toThrow();
  });

  it('parses and evaluates after the ChMS embed transform', () => {
    const embedded = getSchedulerInlineParts().js;
    expect(embedded).toContain('focusWeekGridHtml');
    expect(() => new vm.Script(embedded)).not.toThrow();
  });
});

// ── 2. The toggle itself ─────────────────────────────────────────────────────

describe('Grid is a third view mode, not a replacement', () => {
  it('offers Week, Month and Grid on the switch', () => {
    const modes = [...SCHEDULER_HTML.matchAll(/data-fw-view="([a-z]+)"/g)].map((m) => m[1]);
    expect(modes).toEqual(['week', 'month', 'grid']);
  });

  it('remembers the chosen mode and restores it', () => {
    const { ctx, store } = runScheduler();
    ctx.currentSchedule = [];
    ctx.setFocusWeekViewMode('grid');
    expect(store.ws_fw_view).toBe('grid');
    expect(ctx.getFocusWeekViewMode()).toBe('grid');
  });

  it('falls back to week for a stored value it does not recognize', () => {
    // A mode that no longer exists must not leave the pane blank.
    const { ctx } = runScheduler({ localStorage: { ws_fw_view: 'kanban' } });
    expect(ctx.getFocusWeekViewMode()).toBe('week');
    const legacy = runScheduler({ localStorage: { ws_fw_view: 'month' } });
    expect(legacy.ctx.getFocusWeekViewMode()).toBe('month');
  });

  it('marks the layout so the rail (a week picker) can be hidden', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = [];
    ctx.setFocusWeekViewMode('grid');
    expect(el('fw-layout').classList.contains('fw-grid')).toBe(true);
    expect(el('fw-layout').classList.contains('fw-month')).toBe(false);
    ctx.setFocusWeekViewMode('week');
    expect(el('fw-layout').classList.contains('fw-grid')).toBe(false);
  });

  it('leaves the Week and Month views rendering exactly what they did', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);

    ctx.focusWeekViewMode = 'week';
    ctx.focusWeekSelectedIdx = 1;
    ctx.renderFocusWeekDetail();
    const week = el('fw-detail').innerHTML;
    expect(week).toContain('Aug 9, 2026');
    expect(week).not.toContain('Aug 2, 2026');
    expect(week).not.toContain('fw-grid-pane');

    ctx.focusWeekViewMode = 'month';
    ctx.renderFocusWeekDetail();
    const month = el('fw-detail').innerHTML;
    expect(count(month, /fw-month-sec/g)).toBe(4);
    expect(month).not.toContain('fw-grid-pane');
  });
});

// ── 3. Shape of the grid ─────────────────────────────────────────────────────

describe('grid layout', () => {
  it('gives every regular Sunday one column, in schedule order', () => {
    const { html } = renderGrid();
    expect(count(html, /class="gr-colhd"/g)).toBe(3);
    const dates = [...html.matchAll(/class="gr-coldate">([^<]+)</g)].map((m) => m[1]);
    expect(dates).toEqual(['Aug 2, 2026', 'Aug 9, 2026', 'Aug 16, 2026']);
  });

  it('gives every role one row, in three bands, shared roles last', () => {
    const { ctx, html } = renderGrid();
    const bands = [...html.matchAll(/class="gr-band">([^<]+)</g)].map((m) => m[1]);
    expect(bands).toEqual(['8:00 AM', '10:45 AM', 'Both Services']);
    const labels = [...html.matchAll(/class="gr-rowlbl-name">([^<]+)</g)].map((m) => m[1]);
    const per = ctx.PER_ROLES.map(ctx.roleLabel);
    const shared = ctx.SHARED_ROLES.map(ctx.roleLabel);
    expect(labels).toEqual(per.concat(per, shared));
  });

  it('draws one cell per role per Sunday and nothing else', () => {
    const { ctx, html } = renderGrid();
    const slots = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    expect(count(html, /class="role-row gr-cell/g)).toBe(slots * 3);
  });

  it('every column shares one grid-template, so the cells line up', () => {
    const { html } = renderGrid();
    const tmpls = new Set([...html.matchAll(/style="(grid-template-columns:[^"]+)"/g)].map((m) => m[1]));
    expect(tmpls.size).toBe(1);
    expect([...tmpls][0]).toContain('repeat(3,');
  });

  it('emits balanced markup', () => {
    const { html } = renderGrid();
    expect(count(html, /<div/g)).toBe(count(html, /<\/div>/g));
    expect(count(html, /<button/g)).toBe(count(html, /<\/button>/g));
    expect(count(html, /<span/g)).toBe(count(html, /<\/span>/g));
  });
});

// ── 4. Cells are role rows, so nothing about assigning is reimplemented ──────

describe('a grid cell is the same slot a role row is', () => {
  it('carries the attributes the click delegation reads', () => {
    const { ctx, html } = renderGrid();
    const cell = html.match(/<button type="button" class="role-row gr-cell"[^>]*>/)[0];
    expect(cell).toContain('data-row="0"');
    expect(cell).toContain('data-role="' + ctx.PER_ROLES[0] + '"');
    expect(cell).toContain('data-svc="8am"');
  });

  it('keeps the .role-row class, which is what opens the picker at all', () => {
    // The #fw-detail handler matches .role-row; a bespoke class here would make
    // every cell in the grid inert while still looking correct.
    const { html } = renderGrid();
    expect(html).not.toMatch(/class="gr-cell[" ]/);
    expect(count(html, /class="role-row gr-cell/g)).toBeGreaterThan(0);
  });

  it('cycles the SAME confirmation key the week view cycles for that slot', () => {
    const { ctx, el, html } = renderGrid();
    const gridKeys = [...html.matchAll(/data-conf-key="([^"]+)"/g)].map((m) => m[1]);

    ctx.focusWeekViewMode = 'week';
    ctx.focusWeekSelectedIdx = 0;
    ctx.renderFocusWeekDetail();
    const weekKeys = [...el('fw-detail').innerHTML.matchAll(/data-conf-key="([^"]+)"/g)].map((m) => m[1]);

    expect(weekKeys.length).toBeGreaterThan(0);
    weekKeys.forEach((k) => expect(gridKeys).toContain(k));
  });

  it('marks the primary and the cross-service filler the same way a row does', () => {
    const { ctx, el, html } = renderGrid();
    // p1 is primaryFor the first role and prefers 10:45, so their 8am slot is both.
    expect(html).toContain('class="rr-star"');
    expect(html).toContain('class="rr-otherSvc"');

    ctx.focusWeekViewMode = 'week';
    ctx.focusWeekSelectedIdx = 0;
    ctx.renderFocusWeekDetail();
    const week = el('fw-detail').innerHTML;
    expect(week).toContain('class="rr-star"');
    expect(week).toContain('class="rr-otherSvc"');
  });

  it('says Open on an unfilled cell rather than leaving it blank', () => {
    const { ctx, html } = renderGrid();
    const slots = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    expect(count(html, /class="gr-open">Open</g)).toBe((slots - 2) * 3);
    expect(count(html, /class="role-row gr-cell empty"/g)).toBe((slots - 2) * 3);
  });
});

// ── 5. The figures add up to the columns beneath them ────────────────────────

describe('grid totals', () => {
  it('reconciles: filled + open equals slots, and slots equals columns x roles', () => {
    const { ctx, html } = renderGrid();
    const stat = (label) => {
      const m = html.match(new RegExp(label + ' <strong[^>]*>(\\d+)<'));
      return parseInt(m[1], 10);
    };
    const slots = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    expect(stat('Slots this month')).toBe(slots * 3);
    expect(stat('Filled') + stat('Open')).toBe(stat('Slots this month'));
    expect(stat('Filled')).toBe(6);
    expect(stat('Volunteers serving')).toBe(2);
  });

  it('counts confirmations, not just assignments', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx, { special: false });
    seedPeople(ctx);
    const iso = '2026-08-02';
    ctx.saveConfirmations({ [iso + '|' + ctx.PER_ROLES[0] + '|8am']: 'confirmed' });
    ctx.focusWeekViewMode = 'grid';
    ctx.renderFocusWeekDetail();
    expect(el('fw-detail').innerHTML).toMatch(/Confirmed <strong class="fw-gstat-ok">1</);
  });

  it('gives each column a coverage bar matching its own filled count', () => {
    const { ctx, html } = renderGrid();
    const slots = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    const nums = [...html.matchAll(/class="gr-cov-num">([^<]+)</g)].map((m) => m[1]);
    expect(nums).toEqual([`2/${slots}`, `2/${slots}`, `2/${slots}`]);
    const widths = [...html.matchAll(/class="gr-bar-fill" style="width:(\d+)%/g)].map((m) => m[1]);
    expect(widths).toEqual(Array(3).fill(String(Math.round((2 / slots) * 100))));
  });

  it('shows each role how many Sundays it is covered on', () => {
    const { ctx, html } = renderGrid();
    const covs = [...html.matchAll(/class="gr-rowlbl-cov">([^<]+)</g)].map((m) => m[1]);
    expect(covs[0]).toBe('3 of 3 Sundays');                       // first role, 8am, filled every week
    expect(covs[ctx.PER_ROLES.length]).toBe('0 of 3 Sundays');    // same role at 10:45, never filled
  });
});

// ── 6. Special services ──────────────────────────────────────────────────────

describe('special services', () => {
  it('are not columns — their times and roles do not fit a fixed role grid', () => {
    const { html } = renderGrid();
    expect(count(html, /class="gr-colhd"/g)).toBe(3);
    expect(html).not.toContain('Aug 26, 2026</span><span class="gr-colsub"');
  });

  it('are named below the grid rather than silently dropped', () => {
    const { html } = renderGrid();
    expect(html).toContain('Not in the grid');
    expect(html).toContain('Midweek Advent');
    expect(html).toContain('not counted in the figures above');
    expect(html).toContain('data-fw-goto="3"');
  });

  it('add no strip at all when the month has none', () => {
    const { html } = renderGrid({ special: false });
    expect(html).not.toContain('gr-specials');
  });

  it('are excluded from the totals, matching what the strip says', () => {
    const withSpecial = renderGrid().html;
    const without = renderGrid({ special: false }).html;
    const slots = (h) => parseInt(h.match(/Slots this month <strong>(\d+)</)[1], 10);
    expect(slots(withSpecial)).toBe(slots(without));
  });

  it('still show the grid when a month has ONLY special services', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx).filter((r) => r.type === 'special');
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'grid';
    expect(() => ctx.renderFocusWeekDetail()).not.toThrow();
    const html = el('fw-detail').innerHTML;
    expect(html).toContain('Midweek Advent');
    expect(html).toContain('the grid lays Sundays out as columns');
  });
});

// ── 7. Printing ──────────────────────────────────────────────────────────────

describe('Month Grid print sheet', () => {
  function buildPrintGrid() {
    const { ctx } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.ppSundayRows = ctx.currentSchedule.filter((r) => r.type === 'sunday');
    ctx.currentMonthKey = '2026-08';
    return { ctx, html: ctx.ppBuildGridHtml() };
  }

  it('is offered as a fourth print mode', () => {
    const modes = [...SCHEDULER_HTML.matchAll(/data-pp-mode="([a-z]+)"/g)].map((m) => m[1]);
    expect(modes).toEqual(['single', 'month', 'grid', 'bulletin']);
  });

  it('prints landscape, like the other whole-month sheet', () => {
    const { ctx } = buildPrintGrid();
    let rule = '';
    ctx.ppWin = { closed: false, document: { getElementById: () => ({ set textContent(v) { rule = v; } }) } };
    ctx.ppMode = 'grid';
    ctx.ppUpdatePageSize();
    expect(rule).toContain('landscape');
  });

  it('opens on the grid when the grid is what is on screen', () => {
    const { ctx } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'grid';
    ctx.openPrintPreview();          // window.open returns null in this harness
    expect(ctx.ppMode).toBe('grid');

    ctx.ppWin = null;
    ctx.focusWeekViewMode = 'week';
    ctx.openPrintPreview();
    expect(ctx.ppMode).toBe('single');
  });

  it('has a row per role and a column per Sunday', () => {
    const { ctx, html } = buildPrintGrid();
    const roleRows = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    expect(count(html, /<tr>/g)).toBe(1 + 3 + roleRows);   // header + 3 band labels + roles
    expect(count(html, /<col /g)).toBe(1 + 3);             // role column + one per Sunday
    expect(html).toContain('August 2026');
  });

  it('prints OPEN, not a dash, for a slot still needing somebody', () => {
    // On a wall an empty box reads as finished rather than as still open.
    const { ctx, html } = buildPrintGrid();
    const roleRows = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    expect(count(html, />OPEN</g)).toBe((roleRows - 2) * 3);
    expect(html).toContain('Larry Hawkins');
    expect(html).toContain('OPEN = still needs a volunteer');
  });

  it('stays well-formed XML, which the Copy/Download Image path needs', () => {
    // Void tags self-closed, no HTML named entities — an SVG foreignObject is
    // parsed as XML, so either one silently breaks image export (SC7-FIX2).
    const { html } = buildPrintGrid();
    expect(html.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)[a-z]+;/gi)).toBeNull();
    expect(count(html, /<col style/g)).toBe(count(html, /\/>/g));
    expect(html).toContain('—');   // a real em dash, not &mdash;
  });
});
