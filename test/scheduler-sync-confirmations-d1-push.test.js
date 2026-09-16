import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// Reported live: a volunteer confirms via the RSVP email link (written
// straight to KV RSVP_STORE by the Worker), an admin clicks "Sync
// Confirmations" on the desktop Scheduler and sees the pill update -- but
// Mobile Admin, and any other admin's browser, never sees it. syncConfirmations()
// pulled the fresh KV data into this browser's own localStorage cache but
// never called queueD1Push(), so the update never reached the D1
// scheduler_data blob that Mobile Admin (and d1Pull() on other browsers)
// actually reads. This test pins that a sync that changes any confirmation
// now schedules a D1 push, and that a no-op sync does not.

const scriptMatch = SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/);
const SERVED_JS = scriptMatch ? scriptMatch[1] : '';

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

function runScheduler(opts = {}) {
  const els = {};
  const store = Object.assign({}, opts.localStorage || {});
  const fetchImpl = opts.fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('{}') }));
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
    fetch: fetchImpl,
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
  return { ctx, els, el, store };
}

function makeRow(ctx, iso) {
  const per = ctx.PER_ROLES;
  const shared = ctx.SHARED_ROLES;
  const assignments = {};
  per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
  shared.forEach((r) => { assignments[r] = { shared: null }; });
  return { type: 'sunday', date: new Date(iso + 'T12:00:00Z'), ordinal: 1, assignments };
}

describe('syncConfirmations() pushes newly-synced statuses to D1', () => {
  it('schedules a D1 push when the Worker returns a fresh confirmed assignment', async () => {
    const results = {
      'tok-p1': {
        assignments: [{ dateISO: '2026-08-02', role: null, svc: '8am', status: 'confirmed' }],
      },
    };
    const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(results), text: () => Promise.resolve(JSON.stringify(results)) });
    const { ctx } = runScheduler({ fetchImpl });

    const role = ctx.PER_ROLES[0];
    results['tok-p1'].assignments[0].role = role;
    const row = makeRow(ctx, '2026-08-02');
    ctx.currentSchedule = [row];
    ctx.getPeople = () => [{ id: 'p1', name: 'Larry Hawkins', roles: [role], primaryFor: [], preferredSundays: [], blackoutDates: [] }];

    ctx.saveConfirmations({});
    const tokens = {};
    tokens.p1 = 'tok-p1';
    ctx.localStorage.setItem('ws_rsvp_tokens', JSON.stringify(tokens));

    let pushCalls = 0;
    ctx.queueD1Push = () => { pushCalls++; };

    await ctx.syncConfirmations(true);

    const confKey = '2026-08-02|' + role + '|8am';
    expect(ctx.getConfirmations()[confKey]).toBe('confirmed');
    expect(pushCalls).toBe(1);
  });

  it('does not schedule a D1 push when the sync changes nothing', async () => {
    const results = { 'tok-p1': { assignments: [] } };
    const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(results), text: () => Promise.resolve(JSON.stringify(results)) });
    const { ctx } = runScheduler({ fetchImpl });

    const row = makeRow(ctx, '2026-08-02');
    ctx.currentSchedule = [row];
    ctx.getPeople = () => [];

    ctx.saveConfirmations({});
    const tokens = {};
    tokens.p1 = 'tok-p1';
    ctx.localStorage.setItem('ws_rsvp_tokens', JSON.stringify(tokens));

    let pushCalls = 0;
    ctx.queueD1Push = () => { pushCalls++; };

    await ctx.syncConfirmations(true);

    expect(pushCalls).toBe(0);
  });
});
