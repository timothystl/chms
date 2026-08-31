import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// Two asks from the same report: (1) opening a new month should not force an
// immediate auto-fill — a blank set of Sundays should be available to fill in
// by hand first, with Auto-Fill left for whatever's still open afterward; and
// (2) rotation fairness — pickBest()'s tie-break used to be Array.sort's
// stable order over the untouched people-array, so whoever appears earliest
// in the roster always won every tie, and kept winning every tie every month
// since counts reset per generation. Both are exercised against the real
// served script, not a re-implementation, per this file's own established
// SC3-BUG1-class verification convention (a stray backslash/backtick breaks
// the whole <script> silently, so executing the served string is what catches
// it — reading the source cannot).

const SERVED_JS = SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function fakeEl(id) {
  const e = {
    id, tagName: 'DIV', style: {}, dataset: {}, children: [], _attrs: {}, _classes: new Set(),
    innerHTML: '', textContent: '', value: '', checked: false, disabled: false, className: '',
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
  e.parentNode = { setAttribute() {}, removeAttribute() {}, appendChild() {}, parentNode: { appendChild() {} } };
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

function runScheduler() {
  const els = {};
  const store = {};
  const ctx = {
    document: {
      getElementById(id) { return els[id] || (els[id] = fakeEl(id)); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
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
    fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('{}') }); },
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
  const el = (id) => ctx.document.getElementById(id);
  return { ctx, els, el };
}

describe('served scheduler script still parses (new-month + rotation changes)', () => {
  it('evaluates without throwing', () => {
    expect(() => runScheduler()).not.toThrow();
  });
});

describe('New Month (Blank) — btn-new-month', () => {
  it('exists and creates every Sunday for the month with no assignments picked', () => {
    const { ctx } = runScheduler();
    ctx.getPeople = () => ([
      { id: 'p1', name: 'Ann', roles: ctx.PER_ROLES.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
    ]);
    ctx.currentMonthKey = '2026-09';
    ctx.currentSchedule = [];
    ctx.newBlankMonth();

    const sundayRows = ctx.currentSchedule.filter((r) => r.type === 'sunday');
    expect(sundayRows.length).toBeGreaterThan(0);
    sundayRows.forEach((row) => {
      ctx.PER_ROLES.forEach((role) => {
        expect(row.assignments[role]['8am']).toBeNull();
        expect(row.assignments[role]['10:45am']).toBeNull();
      });
      ctx.SHARED_ROLES.forEach((role) => {
        expect(row.assignments[role].shared).toBeNull();
      });
    });
  });

  it('never calls pickBest — it is a structural build, not a fill', () => {
    const { ctx } = runScheduler();
    let called = false;
    const realPickBest = ctx.pickBest;
    ctx.pickBest = (...args) => { called = true; return realPickBest(...args); };
    ctx.getPeople = () => ([{ id: 'p1', name: 'Ann', roles: ctx.PER_ROLES.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] }]);
    ctx.currentMonthKey = '2026-09';
    ctx.currentSchedule = [];
    ctx.newBlankMonth();
    expect(called).toBe(false);
  });

  it('keeps existing special services for the month untouched', () => {
    const { ctx } = runScheduler();
    ctx.getPeople = () => ([]);
    ctx.currentMonthKey = '2026-09';
    const special = { type: 'special', date: new Date('2026-09-16T12:00:00Z'), name: 'Midweek', ordinal: 0, services: [] };
    ctx.currentSchedule = [special];
    ctx.newBlankMonth();
    const specials = ctx.currentSchedule.filter((r) => r.type === 'special');
    expect(specials).toEqual([special]);
  });

  it('marks the schedule dirty so it can be reviewed before Save Changes', () => {
    const { ctx, el } = runScheduler();
    ctx.getPeople = () => ([]);
    ctx.currentMonthKey = '2026-09';
    ctx.currentSchedule = [];
    ctx.newBlankMonth();
    expect(ctx.isDirty).toBe(true);
    expect(el('btn-save-schedule').innerHTML).toContain('Save Changes');
  });
});

describe('pickBest rotation fairness — tie-breaks are shuffled, not roster order', () => {
  function makePool(ctx, n) {
    return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Person ' + i }));
  }

  it('does not always pick the first pool entry when every count is tied', () => {
    const { ctx } = runScheduler();
    const counts = {};
    const winners = new Set();
    // With 8 tied people and enough trials, a fair tie-break should surface
    // more than one winner. Before the fix, pool.sort's stable order meant
    // pool[0] (the same person, roster order) won literally every time.
    for (let trial = 0; trial < 200; trial++) {
      const pool = makePool(ctx, 8);
      const picked = ctx.pickBest(pool, counts);
      winners.add(picked.id);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('still always picks the lowest count when counts are NOT tied', () => {
    const { ctx } = runScheduler();
    const pool = makePool(ctx, 5);
    const counts = { p0: 3, p1: 1, p2: 5, p3: 0, p4: 2 };
    const picked = ctx.pickBest(pool, counts);
    expect(picked.id).toBe('p3');
  });

  it('returns null for an empty pool', () => {
    const { ctx } = runScheduler();
    expect(ctx.pickBest([], {})).toBeNull();
  });
});
