import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';

// A Scheduler volunteer can now carry a second notification address — a parent's
// email for a child who serves, or a second address of their own. Every place the
// Scheduler emails a volunteer (assignment emails, weekly reminders, open-slot
// requests) should reach both addresses when a second one is set, and nothing
// should change for the ordinary one-address case.
//
// The script is one ~320KB template literal, so the class of bug that has bitten
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
  const selectors = {};
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
  const el = (id) => ctx.document.getElementById(id);
  return { ctx, els, el, store, sent, selectors };
}

/** One Sunday, one filled Elder slot, shaped like currentSchedule rows. */
function makeSchedule(ctx) {
  const per = ctx.PER_ROLES;
  const shared = ctx.SHARED_ROLES;
  const assignments = {};
  per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
  shared.forEach((r) => { assignments[r] = { shared: null }; });
  assignments[per[0]]['8am'] = 'p1';
  return [{ type: 'sunday', date: new Date('2026-08-09T12:00:00Z'), ordinal: 2, assignments }];
}

function seedTwoEmailPerson(ctx) {
  const people = [
    { id: 'p1', name: 'Timmy Hawkins', email: 'timmy@example.org', secondEmail: 'parent@example.org',
      roles: ctx.PER_ROLES.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
  ];
  ctx.getPeople = () => people;
  return people;
}

function stageSettings(overrides = {}) {
  return {
    localStorage: {
      ws_breeze_settings: JSON.stringify(Object.assign({
        subdomain: 'tlc', workerUrl: 'https://connect.timothystl.org', replyTo: 'dinger@timothystl.org',
      }, overrides)),
    },
  };
}

describe('served scheduler script', () => {
  it('parses and evaluates as shipped (standalone)', () => {
    expect(SERVED_JS.length).toBeGreaterThan(1000);
    expect(() => runScheduler()).not.toThrow();
  });

  it('parses and evaluates after the ChMS embed transform', () => {
    const embedded = getSchedulerInlineParts().js;
    expect(embedded).toContain('personEmailRecipients');
    expect(() => new vm.Script(embedded)).not.toThrow();
  });
});

describe('personEmailRecipients / personHasEmail / personEmailTo', () => {
  it('returns just the primary email when no second one is set', () => {
    const { ctx } = runScheduler();
    const p = { email: 'a@example.org', secondEmail: '' };
    expect(ctx.personEmailRecipients(p)).toEqual(['a@example.org']);
    expect(ctx.personHasEmail(p)).toBe(true);
    // Single address stays a plain string, matching every send before this existed.
    expect(ctx.personEmailTo(p)).toBe('a@example.org');
  });

  it('returns both, deduplicated and trimmed, when a second address is set', () => {
    const { ctx } = runScheduler();
    const p = { email: ' a@example.org ', secondEmail: 'b@example.org' };
    expect(ctx.personEmailRecipients(p)).toEqual(['a@example.org', 'b@example.org']);
    expect(ctx.personEmailTo(p)).toEqual(['a@example.org', 'b@example.org']);
  });

  it('does not duplicate when the two addresses are identical', () => {
    const { ctx } = runScheduler();
    const p = { email: 'a@example.org', secondEmail: 'a@example.org' };
    expect(ctx.personEmailRecipients(p)).toEqual(['a@example.org']);
    expect(ctx.personEmailTo(p)).toBe('a@example.org');
  });

  it('is not fooled by a second address with no primary — hasEmail is still true', () => {
    const { ctx } = runScheduler();
    const p = { email: '', secondEmail: 'parent@example.org' };
    expect(ctx.personHasEmail(p)).toBe(true);
    expect(ctx.personEmailTo(p)).toBe('parent@example.org');
  });

  it('reports no email and an empty "to" for a person with neither', () => {
    const { ctx } = runScheduler();
    const p = { email: '', secondEmail: '' };
    expect(ctx.personHasEmail(p)).toBe(false);
    expect(ctx.personEmailTo(p)).toBe('');
  });
});

describe('sendReminderEmails — the "email all upcoming assignments" send', () => {
  it('sends to both addresses when the volunteer has a second email', async () => {
    const { ctx, sent } = runScheduler(stageSettings());
    ctx.currentSchedule = makeSchedule(ctx);
    seedTwoEmailPerson(ctx);
    ctx.sendReminderEmails();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toEqual(['timmy@example.org', 'parent@example.org']);
  });

  it('still sends a plain string when there is only one address', async () => {
    const { ctx, sent } = runScheduler(stageSettings());
    ctx.currentSchedule = makeSchedule(ctx);
    ctx.getPeople = () => [
      { id: 'p1', name: 'Larry Hawkins', email: 'larry@example.org', roles: ctx.PER_ROLES.slice(),
        primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
    ];
    ctx.sendReminderEmails();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toBe('larry@example.org');
  });
});

describe('_sendWeekReminders — the per-week reminder send', () => {
  it('sends to both addresses when the volunteer has a second email', async () => {
    const { ctx, el, selectors, sent } = runScheduler(stageSettings());
    ctx.currentSchedule = makeSchedule(ctx);
    ctx.currentMonthKey = '2026-08';
    seedTwoEmailPerson(ctx);
    ctx._reminderAssignmentsCache = {
      p1: [{ dateISO: '2026-08-09', date: 'Aug 9, 2026', svc: '8am', role: ctx.PER_ROLES[0] }],
    };
    el('reminder-week-filter').value = '2026-08-09';
    el('reminder-office-cb').checked = false;
    el('reminder-office-cb').disabled = true;
    const personCb = fakeEl('cb-p1');
    personCb.checked = true;
    personCb.setAttribute('data-pid', 'p1');
    personCb.setAttribute('data-week', '2026-08-09');
    selectors['.reminder-person-cb:checked'] = [personCb];

    ctx._sendWeekReminders();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toEqual(['timmy@example.org', 'parent@example.org']);
  });
});

describe('sendVolunteerNotifications — the open-slot request send', () => {
  it('sends to both addresses for an eligible volunteer with a second email', async () => {
    const { ctx, el, sent } = runScheduler(stageSettings());
    const people = seedTwoEmailPerson(ctx);
    ctx._notifySlotsCache = [
      { date: 'Aug 9, 2026', dateISO: '2026-08-09', svc: '8am', role: ctx.PER_ROLES[0], pool: people },
    ];
    el('notify-week-filter').value = 'all';
    const slotCb = fakeEl('cb-slot-0');
    slotCb.checked = true;
    slotCb.setAttribute('data-slot-idx', '0');
    ctx.document.querySelectorAll = (sel) => (sel === '.notify-slot-cb:checked' ? [slotCb] : []);

    ctx.sendVolunteerNotifications();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toEqual(['timmy@example.org', 'parent@example.org']);
  });

  it('leaves out a pool member with no email at all, second address included', async () => {
    const { ctx, el, sent } = runScheduler(stageSettings());
    const withEmail = seedTwoEmailPerson(ctx)[0];
    const withoutEmail = { id: 'p2', name: 'No Email Nolan', email: '', secondEmail: '' };
    ctx._notifySlotsCache = [
      { date: 'Aug 9, 2026', dateISO: '2026-08-09', svc: '8am', role: ctx.PER_ROLES[0], pool: [withEmail, withoutEmail] },
    ];
    el('notify-week-filter').value = 'all';
    const slotCb = fakeEl('cb-slot-0');
    slotCb.checked = true;
    slotCb.setAttribute('data-slot-idx', '0');
    ctx.document.querySelectorAll = (sel) => (sel === '.notify-slot-cb:checked' ? [slotCb] : []);

    ctx.sendVolunteerNotifications();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toEqual(['timmy@example.org', 'parent@example.org']);
  });
});

describe('renderNotifySlots — the "Eligible" column reflects personHasEmail', () => {
  it('counts a volunteer with only a second (no primary) email as eligible', () => {
    const { ctx } = runScheduler();
    ctx._notifySlotsCache = [
      { date: 'Aug 9, 2026', dateISO: '2026-08-09', svc: '8am', role: ctx.PER_ROLES[0],
        pool: [{ id: 'p1', name: 'Second-Only Sue', email: '', secondEmail: 'parent@example.org' }] },
    ];
    const html = ctx.renderNotifySlots('all');
    // renderNotifySlots writes into notify-slots-list rather than returning HTML —
    // read it back the same way the app does.
    const listHtml = ctx.document.getElementById('notify-slots-list').innerHTML;
    expect(listHtml).toContain('Second-Only Sue');
    expect(listHtml).not.toContain('no email');
  });
});

describe('savePerson — a relational volunteer\'s second email is written through', () => {
  it('POSTs second_email alongside reminder_email when linked to a real person', async () => {
    const { ctx, el, sent } = runScheduler();
    el('linked-person-id').value = '7';
    el('person-name').value = 'Timmy Hawkins';
    el('person-email').value = 'timmy@example.org';
    el('person-second-email').value = 'parent@example.org';
    const roleCb = fakeEl('role-cb');
    roleCb.checked = true;
    roleCb.value = ctx.PER_ROLES[0];
    const roleQuerySpy = (sel) => (sel === 'input:checked' ? [roleCb] : []);
    ctx.document.getElementById('pref-roles').querySelectorAll = roleQuerySpy;
    ctx.document.getElementById('pref-sundays').querySelectorAll = () => [];
    ctx.document.getElementById('primary-roles').querySelectorAll = () => [];
    ctx.document.getElementById('role-override-body').querySelectorAll = () => [];
    ctx.currentBlackouts = [];

    ctx.savePerson();
    await new Promise((r) => setTimeout(r, 30));

    const volunteerPost = sent.find((r) => String(r.url).includes('/admin/api/scheduler/volunteers'));
    expect(volunteerPost).toBeTruthy();
    expect(volunteerPost.body.reminder_email).toBe('timmy@example.org');
    expect(volunteerPost.body.second_email).toBe('parent@example.org');
  });
});
