import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';

// Two additions to the Scheduler, both exercised here against the REAL served
// script (extracted from SCHEDULER_HTML, not the source file) rather than a
// re-implementation:
//
//   1. A Week / Month toggle on the Schedule card, so every Sunday of the month
//      can be seen and edited at once instead of one at a time via the rail.
//   2. An "also send the printable schedule to the office" checkbox on the
//      Email Assignments panel, so the office assistant gets the same sheet the
//      Print button produces whenever volunteer assignment emails go out.
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

/** Three Sundays with a couple of slots filled, shaped like currentSchedule rows. */
function makeSchedule(ctx) {
  const per = ctx.PER_ROLES;
  const shared = ctx.SHARED_ROLES;
  return ['2026-08-02', '2026-08-09', '2026-08-16'].map((iso, i) => {
    const assignments = {};
    per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
    shared.forEach((r) => { assignments[r] = { shared: null }; });
    assignments[per[0]]['8am'] = 'p1';
    assignments[shared[0]].shared = 'p2';
    return {
      type: 'sunday',
      date: new Date(iso + 'T12:00:00Z'),
      ordinal: i + 1,
      assignments,
    };
  });
}

function seedPeople(ctx) {
  const people = [
    { id: 'p1', name: 'Larry Hawkins', email: 'larry@example.org', roles: ctx.PER_ROLES.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
    { id: 'p2', name: 'Holly Feldman', email: 'holly@example.org', roles: ctx.SHARED_ROLES.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] },
  ];
  ctx.getPeople = () => people;
  return people;
}

// ── 1. The served script still parses ────────────────────────────────────────

describe('served scheduler script', () => {
  it('parses and evaluates as shipped (standalone)', () => {
    expect(SERVED_JS.length).toBeGreaterThan(1000);
    expect(() => runScheduler()).not.toThrow();
  });

  it('parses and evaluates after the ChMS embed transform', () => {
    const embedded = getSchedulerInlineParts().js;
    expect(embedded).toContain('schedInitScheduler');
    expect(() => new vm.Script(embedded)).not.toThrow();
  });

  it('routes the office-copy send through workerUrl so the embed transform rewrites it', () => {
    // scheduler-inline.js strips "s.workerUrl +" from fetch calls so the embedded
    // tab stays same-origin (CSP connect-src 'self'). A hand-built URL that does
    // not match that exact shape is left pointing at the old host and is blocked.
    // Slice to the function's own body first — a lazy match across the whole
    // script would happily find the per-volunteer send further down instead.
    const bodyOf = (src, name) => {
      const start = src.indexOf('function ' + name);
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf('\nfunction ', start + 1);
      return src.slice(start, end > -1 ? end : src.length);
    };
    expect(bodyOf(SERVED_JS, 'sendOfficeScheduleCopy'))
      .toContain("fetch(s.workerUrl + '/email/send'");
    expect(bodyOf(getSchedulerInlineParts().js, 'sendOfficeScheduleCopy'))
      .toContain("fetch('/email/send'");
  });
});

// ── 2. Week / Month toggle ───────────────────────────────────────────────────

describe('Week / Month view toggle', () => {
  it('week mode renders only the selected Sunday', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'week';
    ctx.focusWeekSelectedIdx = 1;
    ctx.renderFocusWeekDetail();

    const html = el('fw-detail').innerHTML;
    expect(html).toContain('Aug 9, 2026');
    expect(html).not.toContain('Aug 2, 2026');
    expect(html).not.toContain('Aug 16, 2026');
    expect(html).not.toContain('fw-month-sec');
  });

  it('month mode renders every Sunday of the month in one pane', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'month';
    ctx.renderFocusWeekDetail();

    const html = el('fw-detail').innerHTML;
    expect(html).toContain('Aug 2, 2026');
    expect(html).toContain('Aug 9, 2026');
    expect(html).toContain('Aug 16, 2026');
    expect(html.match(/fw-month-sec/g)).toHaveLength(3);
  });

  it('month mode keeps every row independently editable (rowIdx travels with each role row)', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'month';
    ctx.renderFocusWeekDetail();

    const html = el('fw-detail').innerHTML;
    // Every Sunday's role rows must carry their OWN index — a shared or zero
    // index would make edits on the 2nd and 3rd Sundays silently write to the 1st.
    const perSundayRows = ctx.PER_ROLES.length * 2 + ctx.SHARED_ROLES.length;
    [0, 1, 2].forEach((i) => {
      expect(html.match(new RegExp('data-row="' + i + '"', 'g'))).toHaveLength(perSundayRows);
    });
    expect(html.match(/class="role-row[ "]/g)).toHaveLength(perSundayRows * 3);
  });

  it('renders a Sunday from one shared builder, so the views cannot drift (SW17)', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    const pMap = { p1: ctx.getPeople()[0], p2: ctx.getPeople()[1] };
    const oneSunday = ctx.focusWeekRowHtml(2, pMap);

    ctx.focusWeekViewMode = 'week';
    ctx.focusWeekSelectedIdx = 2;
    ctx.renderFocusWeekDetail();
    expect(el('fw-detail').innerHTML).toBe(oneSunday);

    ctx.focusWeekViewMode = 'month';
    ctx.renderFocusWeekDetail();
    // Month mode is the same markup, only wrapped — the heading shrinks via CSS
    // on the wrapper, not via a second code path.
    expect(el('fw-detail').innerHTML).toContain('<div class="fw-month-sec">' + oneSunday + '</div>');
  });

  it('persists the choice and restores it on the next load', () => {
    const first = runScheduler();
    first.ctx.currentSchedule = makeSchedule(first.ctx);
    seedPeople(first.ctx);
    first.ctx.setFocusWeekViewMode('month');
    expect(first.store['ws_fw_view']).toBe('month');

    const second = runScheduler({ localStorage: first.store });
    expect(second.ctx.getFocusWeekViewMode()).toBe('month');
  });

  it('defaults to week view when nothing is stored, and ignores a junk value', () => {
    expect(runScheduler().ctx.getFocusWeekViewMode()).toBe('week');
    expect(runScheduler({ localStorage: { ws_fw_view: 'banana' } }).ctx.getFocusWeekViewMode()).toBe('week');
  });

  it('hides the week rail in month mode and restores it in week mode', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = makeSchedule(ctx);
    seedPeople(ctx);
    ctx.setFocusWeekViewMode('month');
    expect(el('fw-layout').classList.contains('fw-month')).toBe(true);
    ctx.setFocusWeekViewMode('week');
    expect(el('fw-layout').classList.contains('fw-month')).toBe(false);
  });

  it('ships the CSS rule that actually hides the rail', () => {
    expect(SCHEDULER_HTML).toContain('.fw-layout.fw-month .wr-rail { display:none; }');
    // and it survives the embed transform, scoped under .sched-root
    expect(getSchedulerInlineParts().markup).toContain('.sched-root .fw-layout.fw-month .wr-rail');
  });

  it('month mode survives an empty schedule without throwing', () => {
    const { ctx, el } = runScheduler();
    ctx.currentSchedule = [];
    seedPeople(ctx);
    ctx.focusWeekViewMode = 'month';
    expect(() => ctx.renderFocusWeekDetail()).not.toThrow();
    expect(el('fw-detail').innerHTML).toContain('No schedule generated yet');
  });
});

// ── 3. Printable schedule emailed to the office ──────────────────────────────

describe('office copy of the printable schedule', () => {
  const OFFICE = { ws_breeze_settings: JSON.stringify({ subdomain: 'tlc', workerUrl: 'https://connect.timothystl.org', officeEmail: 'assistant@timothystl.org', replyTo: 'dinger@timothystl.org' }) };

  function ready(store) {
    const h = runScheduler({ localStorage: store || OFFICE });
    h.ctx.currentSchedule = makeSchedule(h.ctx);
    seedPeople(h.ctx);
    h.ctx.currentMonthKey = '2026-08';
    return h;
  }

  // The title repeats the date, so a date alone does not prove the table has
  // any rows in it — assert on the ordinal label, which only the body prints.
  it('single scope carries only the Sunday the assignment emails covered', () => {
    const { ctx } = ready();
    const html = ctx.buildOfficeScheduleHtml('single', '2026-08-09');
    expect(html).toContain('August 9');
    expect(html).toContain('2nd Sunday');
    expect(html).toContain('Larry Hawkins');
    expect(html).not.toContain('1st Sunday');
    expect(html).not.toContain('3rd Sunday');
  });

  it('month scope carries every Sunday, titled by month', () => {
    const { ctx } = ready();
    const html = ctx.buildOfficeScheduleHtml('month', '2026-08-09');
    expect(html).toContain('1st Sunday');
    expect(html).toContain('2nd Sunday');
    expect(html).toContain('3rd Sunday');
    expect(html).toContain('August 2');
    expect(html).toContain('August 16');
    expect(html).toContain('Serving Schedule');
    expect(html).toContain('August 2026');
  });

  it('is table markup with real rows, not the flex Single Sunday print layout', () => {
    // Outlook does not lay out flexbox; a flex sheet arrives as unaligned lines.
    const { ctx } = ready();
    const html = ctx.buildOfficeScheduleHtml('single', '2026-08-09');
    expect(html).toContain('<table');
    expect(html).not.toContain('display:flex');
    // One <tr> per service time, plus the header row.
    expect(html.match(/<tr>/g).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('8:00 AM');
    expect(html).toContain('10:45 AM');
  });

  it('reuses the print renderer, so the emailed sheet matches the printed one', () => {
    const { ctx } = ready();
    const rows = ctx.officeScheduleRows('month', '');
    const emailed = ctx.buildOfficeScheduleHtml('month', '');
    const printed = ctx.ppBuildMonthHtml(rows, 'Serving Schedule — August 2026');
    expect(emailed).toContain(printed);
  });

  it('names the assigned volunteers in both the HTML and the plain-text part', () => {
    const { ctx } = ready();
    const html = ctx.buildOfficeScheduleHtml('single', '2026-08-09');
    const text = ctx.buildOfficeScheduleText('single', '2026-08-09');
    expect(html).toContain('Larry Hawkins');
    expect(html).toContain('Holly Feldman');
    expect(text).toContain('Larry Hawkins');
    expect(text).toContain('Holly Feldman');
    expect(text).toContain('\n');           // real newlines, not a literal backslash-n
    expect(text).not.toContain('\\n');
  });

  it('marks unfilled slots as open in the plain-text part rather than leaving a blank', () => {
    const { ctx } = ready();
    const text = ctx.buildOfficeScheduleText('single', '2026-08-09');
    expect(text).toContain('(open)');
  });

  it('returns null (and sends nothing) when the chosen Sunday is not in the schedule', async () => {
    const { ctx, sent } = ready();
    expect(ctx.buildOfficeScheduleHtml('single', '2026-12-25')).toBeNull();
    const res = await ctx.sendOfficeScheduleCopy('single', '2026-12-25');
    expect(res.status).toBe('skipped');
    expect(sent.filter((r) => String(r.url).includes('/email/send'))).toHaveLength(0);
  });

  it('sends to the configured office address with a reply-to and both body parts', async () => {
    const { ctx, sent } = ready();
    const res = await ctx.sendOfficeScheduleCopy('month', '2026-08-09');
    expect(res.status).toBe('sent');
    const req = sent.find((r) => String(r.url).includes('/email/send'));
    expect(req).toBeTruthy();
    expect(req.body.to).toBe('assistant@timothystl.org');
    expect(req.body.reply_to).toBe('dinger@timothystl.org');
    expect(req.body.subject).toContain('August 2026');
    expect(req.body.html).toContain('<table');
    expect(req.body.text).toContain('Larry Hawkins');
  });

  it('skips the send, rather than erroring, when no office address is configured', async () => {
    const { ctx, sent } = ready({ ws_breeze_settings: JSON.stringify({ subdomain: 'tlc', workerUrl: 'https://x' }) });
    const res = await ctx.sendOfficeScheduleCopy('month', '2026-08-09');
    expect(res.status).toBe('skipped');
    expect(sent.filter((r) => String(r.url).includes('/email/send'))).toHaveLength(0);
  });

  it('reports a server-side failure instead of claiming it was sent', async () => {
    const { ctx } = ready();
    ctx.fetch = () => Promise.resolve({
      ok: false, status: 500,
      json: () => Promise.resolve({ error: 'RESEND_API_KEY missing' }),
    });
    const res = await ctx.sendOfficeScheduleCopy('month', '2026-08-09');
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('RESEND_API_KEY');
  });

  it('reports a network failure instead of hanging the panel', async () => {
    const { ctx } = ready();
    ctx.fetch = () => Promise.reject(new Error('offline'));
    const res = await ctx.sendOfficeScheduleCopy('month', '2026-08-09');
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('offline');
  });
});

// ── 4. The panel control and its wiring ──────────────────────────────────────

describe('Email Assignments panel — office copy control', () => {
  it('offers the checkbox, defaulted on, once an address is configured', () => {
    const { ctx, el } = runScheduler({ localStorage: { ws_breeze_settings: JSON.stringify({ officeEmail: 'assistant@timothystl.org' }) } });
    ctx.renderReminderOfficeBlock();
    expect(el('reminder-office-cb').disabled).toBe(false);
    expect(el('reminder-office-cb').checked).toBe(true);
    expect(el('reminder-office-to').innerHTML).toContain('assistant@timothystl.org');
  });

  it('disables the checkbox and says where to set an address when none is configured', () => {
    const { ctx, el } = runScheduler({ localStorage: { ws_breeze_settings: '{}' } });
    ctx.renderReminderOfficeBlock();
    expect(el('reminder-office-cb').disabled).toBe(true);
    expect(el('reminder-office-cb').checked).toBe(false);
    expect(el('reminder-office-hint').style.display).not.toBe('none');
    expect(SCHEDULER_HTML).toContain('Add an Office Copy Address under Settings');
  });

  it('hides that hint again once an address is configured', () => {
    const { ctx, el } = runScheduler({ localStorage: { ws_breeze_settings: JSON.stringify({ officeEmail: 'assistant@timothystl.org' }) } });
    ctx.renderReminderOfficeBlock();
    expect(el('reminder-office-hint').style.display).toBe('none');
  });

  it('remembers a previously turned-off checkbox and the chosen scope', () => {
    const { ctx, el } = runScheduler({
      localStorage: {
        ws_breeze_settings: JSON.stringify({ officeEmail: 'assistant@timothystl.org' }),
        ws_office_copy_pref: JSON.stringify({ enabled: false, scope: 'month' }),
      },
    });
    ctx.renderReminderOfficeBlock();
    expect(el('reminder-office-cb').checked).toBe(false);
    expect(el('reminder-office-scope').value).toBe('month');
  });

  it('escapes the address rather than injecting it into the panel markup', () => {
    const { ctx, el } = runScheduler({ localStorage: { ws_breeze_settings: JSON.stringify({ officeEmail: '<img src=x onerror=alert(1)>' }) } });
    ctx.renderReminderOfficeBlock();
    expect(el('reminder-office-to').innerHTML).not.toContain('<img');
    expect(el('reminder-office-to').innerHTML).toContain('&lt;img');
  });

  // ── The real send, driven end to end through _sendWeekReminders ──────────
  function stageSend(officeChecked, scope) {
    const h = runScheduler({
      localStorage: {
        ws_breeze_settings: JSON.stringify({
          subdomain: 'tlc', workerUrl: 'https://connect.timothystl.org',
          officeEmail: 'assistant@timothystl.org', replyTo: 'dinger@timothystl.org',
        }),
      },
    });
    const { ctx, el, selectors } = h;
    ctx.currentSchedule = makeSchedule(ctx);
    ctx.currentMonthKey = '2026-08';
    seedPeople(ctx);
    ctx._reminderAssignmentsCache = {
      p1: [{ dateISO: '2026-08-09', date: 'Aug 9, 2026', svc: '8am', role: 'Elder' }],
    };
    el('reminder-week-filter').value = '2026-08-09';
    el('reminder-office-cb').checked = officeChecked;
    el('reminder-office-cb').disabled = false;
    el('reminder-office-scope').value = scope || 'single';

    const personCb = fakeEl('cb-p1');
    personCb.checked = true;
    personCb.setAttribute('data-pid', 'p1');
    personCb.setAttribute('data-week', '2026-08-09');
    selectors['.reminder-person-cb:checked'] = [personCb];
    return h;
  }

  it('sends the office copy as part of an ordinary assignment send', async () => {
    const { ctx, sent } = stageSend(true, 'single');
    ctx._sendWeekReminders();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(2);
    expect(emails[0].body.to).toBe('larry@example.org');
    // The office copy goes LAST — after every volunteer email — so the sheet it
    // carries is never contradicted by a send still in flight behind it.
    expect(emails[1].body.to).toBe('assistant@timothystl.org');
    expect(emails[1].body.html).toContain('Larry Hawkins');
  });

  it('sends nothing extra when the office checkbox is off', async () => {
    const { ctx, sent } = stageSend(false, 'single');
    ctx._sendWeekReminders();
    await new Promise((r) => setTimeout(r, 30));

    const emails = sent.filter((r) => String(r.url).includes('/email/send'));
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toBe('larry@example.org');
  });

  it('honors the whole-month scope chosen in the panel', async () => {
    const { ctx, sent } = stageSend(true, 'month');
    ctx._sendWeekReminders();
    await new Promise((r) => setTimeout(r, 30));

    const office = sent.filter((r) => String(r.url).includes('/email/send')).pop();
    expect(office.body.to).toBe('assistant@timothystl.org');
    expect(office.body.html).toContain('1st Sunday');
    expect(office.body.html).toContain('3rd Sunday');
  });

  it('reports the office copy in the panel status line rather than silently', async () => {
    const { ctx, el, sent } = stageSend(true, 'single');
    ctx._sendWeekReminders();
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.length).toBeGreaterThan(0);
    expect(el('reminder-send-status').textContent).toContain('assistant@timothystl.org');
  });

  it('carries a settings field for the address', () => {
    expect(SCHEDULER_HTML).toContain('id="email-office-to"');
    expect(SERVED_JS).toContain("document.getElementById('email-office-to').value");
    expect(SERVED_JS).toContain('officeEmail:officeEmail');
  });

  it('keeps the office address in the settings blob that syncs to D1', () => {
    // ws_breeze_settings is in the D1 sync key list, so the address follows the
    // user to another browser rather than living only on one machine.
    expect(SERVED_JS).toContain('ws_breeze_settings');
    const { ctx, store, el } = runScheduler({ localStorage: { ws_breeze_settings: JSON.stringify({ officeEmail: 'assistant@timothystl.org' }) } });
    // Round-trips back into the settings form, so a saved address is visible
    // and editable rather than a value only the send path can see.
    ctx.loadSettingsForm();
    expect(el('email-office-to').value).toBe('assistant@timothystl.org');
    expect(JSON.parse(store['ws_breeze_settings']).officeEmail).toBe('assistant@timothystl.org');
  });
});
