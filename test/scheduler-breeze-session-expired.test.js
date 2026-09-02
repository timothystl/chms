import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// Reported live: the Scheduler's Settings → Integrations "Test Connection" button showed
// "Connection failed: HTTP 401 (https://connect.timothystl.org/api/people?limit=1&details=0)".
//
// That 401 is the CORRECT, by-design response from the SEC11/SEC12 gate on /api/* (see
// scheduler-route-authz.test.js) — it means the request carried no valid ChMS session cookie,
// most plausibly because the scheduler tab had simply sat open past the 8-hour idle window
// (src/auth.js IDLE_TIMEOUT_MS). Every other authenticated call in this app already redirects
// to the login page on a 401 (api() in js-core.js); breezeGet()/breezePost() predated that
// convention and instead threw a bare "HTTP 401 (...)" that reads like a Breeze outage rather
// than an expired session. Fixed by redirecting the same way api() does.
//
// The script is one large template literal, so the class of bug that has bitten this file
// repeatedly (SC3-BUG1/SC3-BUG2/FIN15) is a stray backslash or backtick that silently breaks
// the WHOLE <script> at parse time. Executing the served string (not reading the source) is
// what catches that.

const scriptMatch = SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/);
const SERVED_JS = scriptMatch ? scriptMatch[1] : '';

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

/** Runs the real served scheduler script against a stubbed fetch, returning its globals. */
function runScheduler({ fetchImpl, localStorage: seedStore } = {}) {
  const els = {};
  const store = Object.assign({}, seedStore || {});
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
    fetch: fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })),
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
  return ctx;
}

describe('the scheduler still parses (SC3-BUG1-class regression guard)', () => {
  it('a fresh vm context can run the served script with no syntax error', () => {
    expect(() => runScheduler()).not.toThrow();
  });
});

describe('breezeGet()/breezePost() on a 401', () => {
  it('breezeGet redirects to the login page instead of just throwing', async () => {
    const ctx = runScheduler({
      fetchImpl: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }),
      localStorage: { ws_breeze_settings: JSON.stringify({ subdomain: 'timothystl' }) },
    });
    await expect(ctx.breezeGet('/api/people', { limit: 1, details: 0 })).rejects.toBeTruthy();
    expect(ctx.window.location.href).toBe('/');
  });

  it('breezePost redirects to the login page instead of just throwing', async () => {
    const ctx = runScheduler({
      fetchImpl: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }),
      localStorage: { ws_breeze_settings: JSON.stringify({ subdomain: 'timothystl' }) },
    });
    await expect(ctx.breezePost('/ajax/whatever', { a: '1' })).rejects.toBeTruthy();
    expect(ctx.window.location.href).toBe('/');
  });

  it('uses frontendAppRootPath() when the app shell has already defined it, not a bare "/"', async () => {
    const ctx = runScheduler({
      fetchImpl: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }),
      localStorage: { ws_breeze_settings: JSON.stringify({ subdomain: 'timothystl' }) },
    });
    // js-core.js (loaded before the scheduler embed, in production) defines this globally.
    ctx.frontendAppRootPath = () => '/some-root';
    await expect(ctx.breezeGet('/api/people', {})).rejects.toBeTruthy();
    expect(ctx.window.location.href).toBe('/some-root');
  });

  it('a real Breeze error (non-401) still reports the HTTP status, unchanged', async () => {
    const ctx = runScheduler({
      fetchImpl: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
      localStorage: { ws_breeze_settings: JSON.stringify({ subdomain: 'timothystl' }) },
    });
    await expect(ctx.breezeGet('/api/people', {})).rejects.toMatch(/HTTP 500/);
    // Only a 401 means "no session" — a real upstream error must not bounce the user to login.
    expect(ctx.window.location.href).toBe('');
  });

  it('a genuinely successful call is unaffected', async () => {
    const ctx = runScheduler({
      fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ people: [] }) }),
      localStorage: { ws_breeze_settings: JSON.stringify({ subdomain: 'timothystl' }) },
    });
    await expect(ctx.breezeGet('/api/people', {})).resolves.toEqual({ people: [] });
    expect(ctx.window.location.href).toBe('');
  });
});
