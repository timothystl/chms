import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';

// People & Availability: the loaded month brought onto the People tab — chips,
// a per-person "this month" load, a Needs-a-look / Depth-by-role rail, and an
// availability board where a click marks somebody away.
//
// Two things here are worth pinning harder than the layout:
//
//   1. "Away" is a blackout date, the store Auto-Fill and the role picker have
//      always honored — so marking someone away really does keep them out. And
//      a relational volunteer's record lives in D1, not the localStorage blob,
//      so the toggle must write through the volunteers endpoint or the next
//      pull silently restores the old value.
//   2. Every month figure is derived from ONE walk of currentSchedule
//      (peopleMonthStats), so the chips, the roster column, the rail and the
//      board cannot disagree about who served when.
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

/** Three Sundays; the first role at 8:00 and the first shared role are filled every week. */
function makeSchedule(ctx) {
  const per = ctx.PER_ROLES, shared = ctx.SHARED_ROLES;
  return ['2026-08-02', '2026-08-09', '2026-08-16'].map((iso, i) => {
    const assignments = {};
    per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
    shared.forEach((r) => { assignments[r] = { shared: null }; });
    assignments[per[0]]['8am'] = 'p1';
    assignments[shared[0]].shared = 'p2';
    return { type: 'sunday', date: new Date(iso + 'T12:00:00Z'), ordinal: i + 1, assignments };
  });
}

/**
 * p1 — relational (has personId), serves every Sunday, blacked out on one of them (a conflict)
 * p2 — legacy (no personId), serves every Sunday, never away
 * p3 — never scheduled, away on Aug 16 via an absence WINDOW rather than a blackout
 */
function seedPeople(ctx) {
  const per = ctx.PER_ROLES, shared = ctx.SHARED_ROLES;
  const people = [
    { id: 'p1', personId: 11, name: 'Larry Hawkins', email: 'l@example.org', roles: per.slice(),
      primaryFor: [per[0]], preferredSundays: [], servicePreference: 'both', roleSundayOverrides: {},
      blackoutDates: ['2026-08-09'], absenceStart: '', absenceUntil: '' },
    { id: 'p2', name: 'Holly Feldman', email: 'h@example.org', roles: shared.slice(),
      primaryFor: [], preferredSundays: [], servicePreference: 'both', roleSundayOverrides: {},
      blackoutDates: [], absenceStart: '', absenceUntil: '' },
    { id: 'p3', name: 'Gwen Roth', email: '', roles: [per[per.length - 1]],
      primaryFor: [], preferredSundays: [], servicePreference: '8am', roleSundayOverrides: {},
      blackoutDates: [], absenceStart: '2026-08-14', absenceUntil: '2026-08-20' },
  ];
  ctx.localStorage.setItem('ws_people', JSON.stringify(people));
  return people;
}

function renderPeople(view = 'list', opts = {}) {
  const h = runScheduler();
  h.ctx.currentMonthKey = '2026-08';
  h.ctx.currentSchedule = opts.noSchedule ? [] : makeSchedule(h.ctx);
  seedPeople(h.ctx);
  h.ctx.peopleView = view;
  h.ctx.renderPeopleList();
  return Object.assign(h, {
    list: h.el('people-list').innerHTML,
    chips: h.el('people-stats').innerHTML,
    rail: h.el('people-rail').innerHTML,
  });
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
    expect(embedded).toContain('peopleMonthStats');
    expect(() => new vm.Script(embedded)).not.toThrow();
  });
});

// ── 2. One walk of the month feeds everything ────────────────────────────────

describe('peopleMonthStats', () => {
  it('counts a Sunday served once even when someone fills two roles on it', () => {
    const { ctx } = renderPeople();
    const people = ctx.getPeople();
    // Give p1 a second role on the first Sunday; they still served three Sundays.
    ctx.currentSchedule[0].assignments[ctx.PER_ROLES[1]]['10:45am'] = 'p1';
    const st = ctx.peopleMonthStats(people);
    expect(st.byId.p1.count).toBe(3);
    expect(st.byId.p1.jobs['2026-08-02'].length).toBe(2);
  });

  it('treats an absence window as away, not just an explicit blackout', () => {
    const { ctx } = renderPeople();
    const st = ctx.peopleMonthStats(ctx.getPeople());
    expect(st.byId.p3.awayISOs).toEqual(['2026-08-16']);   // inside 08-14..08-20
    expect(st.byId.p1.awayISOs).toEqual(['2026-08-09']);   // an explicit blackout
  });

  it('reports away-and-assigned as a conflict', () => {
    const { ctx } = renderPeople();
    const st = ctx.peopleMonthStats(ctx.getPeople());
    expect(st.byId.p1.conflicts).toEqual(['2026-08-09']);
    expect(st.conflicts.map((r) => r.p.id)).toEqual(['p1']);
    expect(st.byId.p2.conflicts).toEqual([]);
  });

  it('leaves a special service out of the month, as the Schedule grid does', () => {
    const { ctx } = renderPeople();
    ctx.currentSchedule.push({
      type: 'special', date: new Date('2026-08-26T12:00:00Z'), name: 'Midweek',
      ordinal: 0, services: [{ time: '7:00 PM', roles: [ctx.PER_ROLES[0]], assignments: { [ctx.PER_ROLES[0]]: 'p3' } }],
    });
    const st = ctx.peopleMonthStats(ctx.getPeople());
    expect(st.sundays.length).toBe(3);
    expect(st.byId.p3.count).toBe(0);
  });
});

// ── 3. The chips, and what they say when there is no month ───────────────────

describe('month chips', () => {
  it('report the roster and the month together', () => {
    const { chips } = renderPeople();
    const stat = (label) => parseInt(chips.match(new RegExp(label + ' <strong>(\\d+)<'))[1], 10);
    expect(stat('Volunteers')).toBe(3);
    expect(chips).toMatch(/Serving in August 2026 <strong>2</);
    expect(chips).toMatch(/Not yet scheduled <strong>1</);
    expect(chips).toMatch(/Away some Sundays <strong>2</);
    expect(chips).toMatch(/Carrying 3\+ Sundays <strong>2</);
  });

  it('refuses to print month figures with no schedule loaded', () => {
    // Zeros here would read as "nobody is serving" rather than "no month yet".
    const { chips, list, rail } = renderPeople('list', { noSchedule: true });
    expect(chips).toContain('Volunteers');
    expect(chips).toContain('No schedule generated for August 2026 yet');
    expect(chips).not.toContain('Not yet scheduled');
    expect(list).not.toContain('pt-load');       // and no month column on the roster
    expect(rail).toContain('Nothing to check yet');
  });
});

// ── 4. Roster rows ───────────────────────────────────────────────────────────

describe('roster', () => {
  it('adds a this-month column headed by the loaded month', () => {
    const { list } = renderPeople();
    expect(list).toContain('>August 2026<');
    expect(count(list, /class="pt-load"/g)).toBe(3);
    expect(list).toContain('0 of 3');
    expect(list).toContain('3 of 3');
  });

  it('flags each person by what actually needs attention', () => {
    const { list } = renderPeople();
    expect(list).toContain('>Conflict<');        // p1: away on a Sunday they serve
    expect(list).toContain('>Heavy<');           // p2: three of three
    expect(list).toContain('>Not scheduled<');   // p3
  });

  it('keeps the header and the body the same width', () => {
    // A column added to one and not the other silently shifts every cell.
    const { list } = renderPeople();
    const head = list.slice(list.indexOf('<thead'), list.indexOf('</thead>'));
    const firstRow = list.slice(list.indexOf('<tbody'), list.indexOf('</tr>', list.indexOf('<tbody')));
    // /<th/ would also match the <thead> that opens the slice.
    expect(count(head, /<th[ >]/g)).toBe(count(firstRow, /<td[ >]/g));
  });
});

// ── 5. The rail ──────────────────────────────────────────────────────────────

describe('needs a look', () => {
  it('names the conflict, the unused and the overloaded, with who', () => {
    const { rail } = renderPeople();
    expect(rail).toContain('Scheduled on a Sunday they are away');
    expect(rail).toContain('Larry Hawkins (08/09)');
    expect(rail).toContain('1 on the roster served no Sundays');
    expect(rail).toContain('Gwen Roth');
    expect(rail).toContain('2 carrying 3+ Sundays');
  });

  it('says so plainly when there is nothing wrong', () => {
    const h = runScheduler();
    h.ctx.currentMonthKey = '2026-08';
    h.ctx.currentSchedule = makeSchedule(h.ctx);
    const people = seedPeople(h.ctx);
    // Everyone serves exactly one Sunday, nobody away.
    people.forEach((p) => { p.blackoutDates = []; p.absenceStart = ''; p.absenceUntil = ''; });
    h.ctx.localStorage.setItem('ws_people', JSON.stringify(people));
    const per = h.ctx.PER_ROLES;
    h.ctx.currentSchedule.forEach((r, i) => {
      per.forEach((role) => { r.assignments[role]['8am'] = null; });
      h.ctx.SHARED_ROLES.forEach((role) => { r.assignments[role].shared = null; });
      r.assignments[per[0]]['8am'] = ['p1', 'p2', 'p3'][i];
    });
    h.ctx.renderPeopleList();
    expect(h.el('people-rail').innerHTML).toContain('All clear');
  });

  it('counts role depth, and separately who is clear this month', () => {
    const { ctx, rail } = renderPeople();
    // p3 is the only person with the last per-service role, and is away a Sunday.
    expect(rail).toContain('(0 clear)');
    const clearAll = runScheduler();
    clearAll.ctx.currentMonthKey = '2026-08';
    clearAll.ctx.currentSchedule = makeSchedule(clearAll.ctx);
    const people = seedPeople(clearAll.ctx);
    people.forEach((p) => { p.blackoutDates = []; p.absenceStart = ''; p.absenceUntil = ''; });
    clearAll.ctx.localStorage.setItem('ws_people', JSON.stringify(people));
    clearAll.ctx.renderPeopleList();
    expect(clearAll.el('people-rail').innerHTML).not.toContain('clear)');
    expect(ctx.ALL_ROLES_IN_ORDER.length).toBeGreaterThan(0);
  });
});

// ── 6. The availability board ────────────────────────────────────────────────

describe('availability board', () => {
  it('draws one cell per person per Sunday of the loaded month', () => {
    const { list } = renderPeople('availability');
    expect(count(list, /class="pt-bname"/g)).toBe(3);
    expect(count(list, /class="pt-bcell /g)).toBe(9);
    expect(count(list, /<div/g)).toBe(count(list, /<\/div>/g));
    expect(count(list, /<button/g)).toBe(count(list, /<\/button>/g));
    expect(count(list, /<span/g)).toBe(count(list, /<\/span>/g));
  });

  it('separates serving, free, away and conflict', () => {
    const { list } = renderPeople('availability');
    expect(count(list, /pt-b-serving/g)).toBe(5);   // p1 x2 clear Sundays + p2 x3
    expect(count(list, /pt-b-conflict/g)).toBe(1);  // p1 away on a Sunday they serve
    expect(count(list, /pt-b-away/g)).toBe(1);      // p3 inside their absence window
    expect(count(list, /pt-b-free/g)).toBe(2);      // p3's other two Sundays
  });

  it('names the job in a serving cell, so the board is readable on its own', () => {
    const { ctx, list } = renderPeople('availability');
    expect(list).toContain(ctx.roleLabel(ctx.PER_ROLES[0]) + ' 8:00');
  });

  it('says nothing rather than showing everyone free with no schedule', () => {
    const { list } = renderPeople('availability', { noSchedule: true });
    expect(list).toContain('No schedule generated for August 2026');
    expect(list).not.toContain('pt-bcell');
  });

  it('opens the existing person panel rather than a second editor', () => {
    // The design draws its own edit drawer; #person-panel already has every
    // field it shows, and a second one that looks real but is not wired up is
    // the defect this avoids.
    const { list } = renderPeople('availability');
    expect(list).toContain('data-action="edit"');
    expect(SCHEDULER_HTML).toContain('id="person-panel"');
    expect(count(SCHEDULER_HTML, /id="person-panel"/g)).toBe(1);
  });
});

// ── 7. Marking someone away actually sticks ──────────────────────────────────

describe('toggling availability', () => {
  function toggled(id, iso) {
    const h = renderPeople('availability');
    h.sent.length = 0;
    h.ctx.togglePersonAway(id, iso);
    return Object.assign(h, {
      people: JSON.parse(h.store.ws_people),
      posts: h.sent.filter((s) => s.url && String(s.url).indexOf('/scheduler/volunteers') > -1),
    });
  }

  it('writes a blackout date — the store Auto-Fill and the picker already honor', () => {
    const { people, ctx } = toggled('p1', '2026-08-02');
    const p1 = people.find((p) => p.id === 'p1');
    expect(p1.blackoutDates).toEqual(['2026-08-02', '2026-08-09']);
    // The point of using blackoutDates rather than a new store:
    expect(ctx.personAwayOn(p1, '2026-08-02')).toBe(true);
  });

  it('clears it again on a second click', () => {
    const { people } = toggled('p1', '2026-08-09');
    expect(people.find((p) => p.id === 'p1').blackoutDates).toEqual([]);
  });

  it('writes through to D1 for a relational volunteer', () => {
    // savePeople() is localStorage only; without the POST the next d1Pull()
    // silently restores the old value and the change appears to vanish.
    const { posts } = toggled('p1', '2026-08-02');
    expect(posts.length).toBe(1);
    expect(posts[0].body.person_id).toBe(11);
    expect(posts[0].body.blackout_dates).toEqual(['2026-08-02', '2026-08-09']);
  });

  it('sends exactly the fields the person panel sends, so the two cannot drift', () => {
    const { posts } = toggled('p1', '2026-08-02');
    // Slice from the panel's own object literal to its own fetch — the plain
    // indexOf finds an earlier, unrelated call to the same endpoint and yields
    // an empty slice, which would assert nothing at all.
    const at = SERVED_JS.indexOf('var fields = {');
    const fromPanel = SERVED_JS.slice(at, SERVED_JS.indexOf('};', at));
    const panelKeys = [...fromPanel.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
    expect(panelKeys.length).toBeGreaterThan(5);
    expect(Object.keys(posts[0].body).sort()).toEqual(panelKeys);
  });

  it('does not POST for a legacy volunteer with no linked person', () => {
    const { posts, people } = toggled('p2', '2026-08-02');
    expect(posts.length).toBe(0);
    expect(people.find((p) => p.id === 'p2').blackoutDates).toEqual(['2026-08-02']);
  });

  it('refuses a cell held by an absence window, and says why', () => {
    // A date range is set on the person; one cell cannot clear it, so offering
    // a click that silently does nothing would be worse than refusing.
    const { people, sent } = toggled('p3', '2026-08-16');
    expect(people.find((p) => p.id === 'p3').blackoutDates).toEqual([]);
    expect(sent.length).toBe(0);
  });

  it('marks that cell as locked in the board itself', () => {
    const { list } = renderPeople('availability');
    expect(count(list, /data-away-locked="1"/g)).toBe(1);
    expect(list).toContain('pt-b-locked');
    expect(list).toContain('on an absence');
  });
});

// ── 8. The retired three-column view is gone, not orphaned ───────────────────

describe('the old availability view', () => {
  it('is deleted rather than left behind as a second renderer', () => {
    // A renderer nobody calls is the trap that bit the person profile (SAC2):
    // it looks like the live one and is the obvious thing to change.
    ['renderPeopleAvailabilityHtml', 'personIsAnySunday', 'personIsLimitedSunday', 'av-cols', 'av-card-any']
      .forEach((dead) => expect(SCHEDULER_HTML).not.toContain(dead));
  });
});
