import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// Reported live: a volunteer confirms via the RSVP email link, an admin clicks
// "Sync Confirmations" on the desktop Scheduler -- but nothing shows up,
// on any device. Root cause (found in two layers): (1) syncConfirmations()
// used to only ask the server about tokens already in THIS browser's own
// local ws_rsvp_tokens cache, and that cache had silently lost the
// volunteer's token; (2) even a successful sync never called queueD1Push(),
// so a change that DID sync stayed stuck in this one browser's localStorage
// instead of reaching the shared D1 record Mobile Admin and other browsers
// read.
//
// Fixed by GET /rsvp/status (see src/api-scheduler.js's handleSchedRsvpStatus),
// which returns the server's full, authoritative person->token and
// slot->status maps -- not filtered by any local cache. This test pins that
// syncConfirmations() (a) self-heals the local token cache from that
// response, (b) applies every confirmation status the server reports even
// when the local cache started out empty, and (c) schedules a D1 push only
// when something actually changed.

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

describe('syncConfirmations() pulls the server\'s full authoritative status, not just what the local cache already knew about', () => {
  it('applies a confirmation for a person this browser had NO local token for, and schedules a D1 push', async () => {
    const status = {
      tokens: { p1: 'tok-p1' }, // server knows about p1 even though this browser never did
      confirmations: { '2026-08-02|Elder|8am': 'confirmed' },
    };
    const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status), text: () => Promise.resolve(JSON.stringify(status)) });
    const { ctx } = runScheduler({ fetchImpl });

    ctx.saveConfirmations({});
    ctx.localStorage.setItem('ws_rsvp_tokens', JSON.stringify({})); // empty -- this browser never sent p1 a reminder

    let pushCalls = 0;
    ctx.queueD1Push = () => { pushCalls++; };

    await ctx.syncConfirmations(true);

    expect(ctx.getConfirmations()['2026-08-02|Elder|8am']).toBe('confirmed');
    expect(pushCalls).toBe(1);

    // Self-healed: the local token cache now knows about p1 too, so a future
    // "send reminders" run won't hand them a second, disconnected token.
    expect(ctx.getRsvpTokens()).toEqual({ p1: 'tok-p1' });
  });

  it('merges the server token map into the local cache without dropping tokens the server does not know about', async () => {
    const status = { tokens: { p2: 'tok-p2' }, confirmations: {} };
    const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status), text: () => Promise.resolve(JSON.stringify(status)) });
    const { ctx } = runScheduler({ fetchImpl });

    ctx.saveConfirmations({});
    ctx.localStorage.setItem('ws_rsvp_tokens', JSON.stringify({ p1: 'tok-p1-local' }));

    await ctx.syncConfirmations(true);

    expect(ctx.getRsvpTokens()).toEqual({ p1: 'tok-p1-local', p2: 'tok-p2' });
  });

  it('does not schedule a D1 push when the sync changes nothing', async () => {
    const status = { tokens: {}, confirmations: {} };
    const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status), text: () => Promise.resolve(JSON.stringify(status)) });
    const { ctx } = runScheduler({ fetchImpl });

    ctx.saveConfirmations({});

    let pushCalls = 0;
    ctx.queueD1Push = () => { pushCalls++; };

    await ctx.syncConfirmations(true);

    expect(pushCalls).toBe(0);
  });
});
