import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// Reported live: confirming or declining a role, then reassigning the slot to
// a different volunteer, kept showing the OLD confirmation/decline status —
// now attached to whoever is newly assigned, who never answered anything.
//
// Root cause: the confirmation key (dateISO|role|svc, see roleSlotView) is
// keyed per SLOT, not per PERSON. assignRoleSlot() overwrote who occupies a
// slot without ever touching ws_confirmations, so a stale status just sat
// there under the same key waiting to be misread as the new person's answer.
//
// The script is one giant template literal (SC3-BUG1/SC3-BUG2 class of risk),
// so this executes the real served string rather than reading source.

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
    fetch() {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('{}') });
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

describe('reassigning a role slot clears its stale confirmation status', () => {
  it('assignRoleSlot() clears a confirmed/declined status when the person changes', () => {
    const { ctx } = runScheduler();
    const role = ctx.PER_ROLES[0];
    const row = makeRow(ctx, '2026-08-02');
    ctx.currentSchedule = [row];

    // p1 is assigned and confirms.
    ctx.assignRoleSlot(0, role, '8am', null, 'p1');
    const confKey = '2026-08-02|' + role + '|8am';
    let confs = ctx.getConfirmations();
    confs[confKey] = 'confirmed';
    ctx.saveConfirmations(confs);
    expect(ctx.getConfirmations()[confKey]).toBe('confirmed');

    // Reassign the same slot to p2 — the new person never answered anything.
    ctx.assignRoleSlot(0, role, '8am', null, 'p2');

    confs = ctx.getConfirmations();
    expect(confs.hasOwnProperty(confKey)).toBe(false);

    // roleSlotView must read this as pending for the new person, not confirmed.
    const view = ctx.roleSlotView(0, role, '8am', null, 'p2', {}, '2026-08-02');
    expect(view.confStatus).toBe('pending');
  });

  it('also clears a declined status when the slot is reassigned', () => {
    const { ctx } = runScheduler();
    const role = ctx.SHARED_ROLES[0];
    const row = makeRow(ctx, '2026-08-09');
    ctx.currentSchedule = [row];

    ctx.assignRoleSlot(0, role, 'shared', null, 'p1');
    const confKey = '2026-08-09|' + role + '|shared';
    let confs = ctx.getConfirmations();
    confs[confKey] = 'declined';
    ctx.saveConfirmations(confs);

    ctx.assignRoleSlot(0, role, 'shared', null, 'p3');
    expect(ctx.getConfirmations().hasOwnProperty(confKey)).toBe(false);
  });

  it('leaves the confirmation untouched when the assignment does not actually change', () => {
    const { ctx } = runScheduler();
    const role = ctx.PER_ROLES[0];
    const row = makeRow(ctx, '2026-08-16');
    ctx.currentSchedule = [row];

    ctx.assignRoleSlot(0, role, '10:45am', null, 'p1');
    const confKey = '2026-08-16|' + role + '|10:45am';
    let confs = ctx.getConfirmations();
    confs[confKey] = 'confirmed';
    ctx.saveConfirmations(confs);

    // Re-"assigning" the same person (e.g. re-render, no real change).
    ctx.assignRoleSlot(0, role, '10:45am', null, 'p1');
    expect(ctx.getConfirmations()[confKey]).toBe('confirmed');
  });

  it('clears the confirmation when a slot is cleared back to empty', () => {
    const { ctx } = runScheduler();
    const role = ctx.PER_ROLES[1] || ctx.PER_ROLES[0];
    const row = makeRow(ctx, '2026-08-23');
    ctx.currentSchedule = [row];

    ctx.assignRoleSlot(0, role, '8am', null, 'p1');
    const confKey = '2026-08-23|' + role + '|8am';
    let confs = ctx.getConfirmations();
    confs[confKey] = 'confirmed';
    ctx.saveConfirmations(confs);

    ctx.assignRoleSlot(0, role, '8am', null, null);
    expect(ctx.getConfirmations().hasOwnProperty(confKey)).toBe(false);
  });

  it('deletePerson() also clears the confirmation on the slot it vacates', () => {
    const { ctx } = runScheduler();
    const role = ctx.PER_ROLES[0];
    const row = makeRow(ctx, '2026-08-30');
    ctx.currentSchedule = [row];
    ctx.getPeople = () => [{ id: 'p1', name: 'Larry Hawkins', roles: [role], primaryFor: [], preferredSundays: [], blackoutDates: [] }];
    ctx.savePeople = () => {};

    ctx.assignRoleSlot(0, role, '8am', null, 'p1');
    const confKey = '2026-08-30|' + role + '|8am';
    let confs = ctx.getConfirmations();
    confs[confKey] = 'confirmed';
    ctx.saveConfirmations(confs);

    ctx.deletePerson('p1');
    expect(ctx.getConfirmations().hasOwnProperty(confKey)).toBe(false);
    expect(row.assignments[role]['8am']).toBeNull();
  });
});
