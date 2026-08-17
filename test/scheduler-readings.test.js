import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';
import { getSchedulerInlineParts } from '../src/scheduler-inline.js';

// Readings are what the Lector and Liturgist are sent with their assignment.
// They auto-fill from the LCMS lectionary shipped in scheduler/lcms_calendar.json,
// and can be overridden per date.
//
// The bug this file exists around: the ONLY way into the readings editor used to
// be a button rendered into the legacy #schedule-table, and that table has been
// display:none since the Focus Week redesign — so readings could not be set from
// the UI at all. Same class as SAC2 and FIN57, where a redesign left a control in
// a renderer that is no longer on screen. The entry point now lives in the pane
// that actually renders, and a test pins it there.

const SERVED_JS = (SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

/** A top-level handler/function body, sliced to its own closing brace rather
 *  than a guessed character count — a short slice silently asserts nothing. */
function bodyFrom(marker) {
  const start = SERVED_JS.indexOf(marker);
  expect(start, 'marker not found: ' + marker).toBeGreaterThan(-1);
  const end = SERVED_JS.indexOf('\n});', start);
  expect(end, 'no close found after: ' + marker).toBeGreaterThan(start);
  return SERVED_JS.slice(start, end);
}

function fakeEl(id) {
  const e = {
    id, tagName: 'DIV', style: {}, dataset: {}, children: [], _attrs: {}, _classes: new Set(),
    innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    appendChild(c) { this.children.push(c); return c; },
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
      addEventListener() {}, body: fakeEl('body'), documentElement: fakeEl('html'),
      activeElement: null, hidden: false,
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
    navigator: { userAgent: 'test' },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    fetch(url, init) {
      sent.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.window.location = { origin: 'https://connect.timothystl.org', href: '', search: '' };
  ctx.window.addEventListener = () => {}; ctx.window.removeEventListener = () => {};
  ctx.window.open = () => null;
  ctx.window.innerWidth = 1200; ctx.window.innerHeight = 900;
  ctx.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  vm.createContext(ctx);
  vm.runInContext(SERVED_JS, ctx, { filename: 'scheduler-served.js' });
  return { ctx, el: (id) => ctx.document.getElementById(id), store, sent, selectors };
}

// One Sunday, with a lectionary entry shaped exactly like the shipped JSON —
// including the scraped "( 8-10 )" spacing that file really contains.
const LECT = {
  '2026-08-16': {
    sundayName: '12th Sunday after Pentecost (prop15)',
    season: 'Pentecost', churchYear: 'CY2026', series: 'A',
    psalm: 'Psalm 122 ( 6 )',
    ot: 'Isaiah 2:1-5',
    epistle: 'Romans 13:( 8-10 ) 11-14',
    gospel: 'Matthew 21:1-11',
  },
};

function ready(opts = {}) {
  const h = runScheduler(opts);
  h.ctx.lectCalendar = JSON.parse(JSON.stringify(LECT));
  const per = h.ctx.PER_ROLES, shared = h.ctx.SHARED_ROLES;
  const assignments = {};
  per.forEach((r) => { assignments[r] = { '8am': null, '10:45am': null }; });
  shared.forEach((r) => { assignments[r] = { shared: null }; });
  assignments['Lector']['8am'] = 'p1';
  h.ctx.currentSchedule = [{
    type: 'sunday', date: new Date('2026-08-16T12:00:00Z'), ordinal: 3, assignments,
  }];
  h.ctx.currentMonthKey = '2026-08';
  const people = [{ id: 'p1', name: 'Larry Hawkins', email: 'larry@example.org', roles: per.slice(), primaryFor: [], preferredSundays: [], servicePreference: 'both', blackoutDates: [] }];
  h.ctx.getPeople = () => people;
  return h;
}

// ── Reaching the editor at all ───────────────────────────────────────────────

describe('the readings editor is reachable', () => {
  it('renders a readings strip, with an edit control, in the pane that is on screen', () => {
    const { ctx, el } = ready();
    ctx.renderFocusWeekDetail();
    const html = el('fw-detail').innerHTML;
    expect(html).toContain('fw-readings');
    expect(html).toContain('class="fw-readings-edit" data-date="2026-08-16"');
  });

  it('is in the month view too, one per Sunday', () => {
    const { ctx, el } = ready();
    ctx.currentSchedule.push(Object.assign({}, ctx.currentSchedule[0], {
      date: new Date('2026-08-23T12:00:00Z'), ordinal: 4,
    }));
    ctx.focusWeekViewMode = 'month';
    ctx.renderFocusWeekDetail();
    const html = el('fw-detail').innerHTML;
    expect(html.match(/class="fw-readings-edit"/g)).toHaveLength(2);
    expect(html).toContain('data-date="2026-08-16"');
    expect(html).toContain('data-date="2026-08-23"');
  });

  it('does not depend on the legacy table, which is display:none', () => {
    // The old entry point lived in #schedule-tbody, inside a hidden wrapper.
    // If the new one ever moves back there it becomes unreachable again.
    expect(SCHEDULER_HTML).toMatch(/<div class="table-wrapper" style="display:none;">/);
    const detailPaneBuilder = SERVED_JS.slice(
      SERVED_JS.indexOf('function focusWeekReadingsHtml'),
      SERVED_JS.indexOf('function focusWeekRowHtml'),
    );
    expect(detailPaneBuilder).toContain('fw-readings-edit');
    // and the click handler is bound to the visible pane
    expect(SERVED_JS).toMatch(/getElementById\('fw-detail'\)\.addEventListener\('click'[\s\S]{0,300}fw-readings-edit/);
  });

  it('survives the ChMS embed transform', () => {
    const embedded = getSchedulerInlineParts().js;
    expect(embedded).toContain('focusWeekReadingsHtml');
    expect(() => new vm.Script(embedded)).not.toThrow();
    expect(getSchedulerInlineParts().markup).toContain('.sched-root .fw-readings');
  });

  it('is not hidden on a phone, unlike the legacy button it replaces', () => {
    // .btn-edit-readings is display:none under the mobile query on purpose;
    // the new control must not be swept up by that rule.
    expect(SCHEDULER_HTML).toContain('.btn-edit-readings, .btn-bulletin-slide { display: none !important; }');
    expect(SCHEDULER_HTML).not.toMatch(/\.fw-readings-edit[^{]*\{[^}]*display:\s*none/);
  });
});

// ── What the strip says ──────────────────────────────────────────────────────

describe('the readings strip', () => {
  it('fills from the lectionary with nothing set, and says so', () => {
    const { ctx } = ready();
    const html = ctx.focusWeekReadingsHtml('2026-08-16');
    expect(html).toContain('from the LCMS lectionary');
    expect(html).toContain('Isaiah 2:1-5');
    expect(html).toContain('Matthew 21:1-11');
  });

  it('splits the readings by who is emailed them', () => {
    // The Lector reads the two lessons; the Liturgist leads the service around
    // all of them, so they get everything.
    const { ctx } = ready();
    const html = ctx.focusWeekReadingsHtml('2026-08-16');
    const lector = html.slice(html.indexOf('Lector'), html.indexOf('Liturgist'));
    const liturgist = html.slice(html.indexOf('Liturgist'));
    expect(lector).toContain('Isaiah 2:1-5');        // OT
    expect(lector).toContain('Romans 13');           // Epistle
    expect(lector).not.toContain('Matthew 21:1-11'); // not the Gospel
    expect(lector).not.toContain('Psalm 122');       // nor the Psalm
    expect(liturgist).toContain('Isaiah 2:1-5');
    expect(liturgist).toContain('Romans 13');
    expect(liturgist).toContain('Matthew 21:1-11');
    expect(liturgist).toContain('Psalm 122');
  });

  it('reports a hand-set date as set by hand, not as the lectionary', () => {
    const { ctx } = ready({
      localStorage: { ws_readings: JSON.stringify({ '2026-08-16': { ot: 'Jonah 3:1-5', epistle: '', gospel: 'Mark 1:14-20', psalm: '' } }) },
    });
    const html = ctx.focusWeekReadingsHtml('2026-08-16');
    expect(html).toContain('set by hand');
    expect(html).toContain('Jonah 3:1-5');
    expect(html).not.toContain('Isaiah 2:1-5');
  });

  it('offers Add, and says what to do, for a date the lectionary does not cover', () => {
    const { ctx } = ready();
    const html = ctx.focusWeekReadingsHtml('2026-12-24');
    expect(html).toContain('>Add<');
    expect(html).toContain('Not in the lectionary');
  });

  it('names the translation on screen', () => {
    const { ctx } = ready();
    expect(ctx.focusWeekReadingsHtml('2026-08-16')).toContain('ESV');
  });
});

// ── References, links and the ESV ────────────────────────────────────────────

describe('reference handling', () => {
  it('tidies the scraped spacing but keeps the optional verses', () => {
    const { ctx } = ready();
    // The lectionary marks optional verses in parentheses; dropping them would
    // quietly change what is read aloud.
    expect(ctx.tidyReadingRef('Romans 13:( 8-10 ) 11-14')).toBe('Romans 13:(8-10) 11-14');
    expect(ctx.tidyReadingRef('Psalm 122 ( 6 )')).toBe('Psalm 122 (6)');
    expect(ctx.tidyReadingRef('Isaiah 2:1-5')).toBe('Isaiah 2:1-5');
    expect(ctx.tidyReadingRef('')).toBe('');
  });

  it('drops the parentheses only in the link, which cannot parse them', () => {
    const { ctx } = ready();
    const href = ctx.bibleLink('Romans 13:( 8-10 ) 11-14');
    expect(href).toBe('https://www.esv.org/Romans+13:11-14/');
    expect(href).not.toContain('(');
  });

  it('links to esv.org itself, in the form that site publishes', () => {
    const { ctx } = ready();
    // Verified shape: https://www.esv.org/Romans+8/ — spaces as "+", colon left
    // literal. Crossway also REQUIRES a link to www.esv.org wherever their text
    // is quoted, so this is what makes the embedded-text path compliant.
    expect(ctx.bibleLink('Romans 8')).toBe('https://www.esv.org/Romans+8/');
    expect(ctx.bibleLink('Isaiah 2:1-5')).toBe('https://www.esv.org/Isaiah+2:1-5/');
    expect(ctx.bibleLink('1 Corinthians 13:1-13')).toBe('https://www.esv.org/1+Corinthians+13:1-13/');
    expect(ctx.bibleLink('Isaiah 2:1-5')).not.toContain('%3A');
    expect(ctx.BIBLE_VERSION).toBe('ESV');
  });

  it('returns no link for an empty reference rather than a search for nothing', () => {
    const { ctx } = ready();
    expect(ctx.bibleLink('')).toBe('');
    expect(ctx.bibleLink('   ')).toBe('');
  });
});

// ── What actually reaches the volunteer ──────────────────────────────────────

describe('the assignment email', () => {
  const assignmentsFor = (role) => ([{
    date: 'Aug 16, 2026', dateISO: '2026-08-16', svc: '8am', role,
  }]);

  it('sends the Lector the OT and Epistle, and not the Gospel', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'Larry Hawkins' }, assignmentsFor('Lector'), '', '', '');
    expect(html).toContain('Your Readings');
    expect(html).toContain('Isaiah 2:1-5');
    expect(html).toContain('Romans 13:(8-10) 11-14');
    expect(html).not.toContain('Matthew 21:1-11');
  });

  it('sends the Liturgist all four — the three readings and the Psalm', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'Larry Hawkins' }, assignmentsFor('Liturgist'), '', '', '');
    expect(html).toContain('Isaiah 2:1-5');            // OT
    expect(html).toContain('Romans 13:(8-10) 11-14');  // Epistle
    expect(html).toContain('Matthew 21:1-11');         // Gospel
    expect(html).toContain('Psalm 122 (6)');
  });

  it('gives the Liturgist a superset of the Lector, in reading order', () => {
    // The rule, stated once: Lector = the two lessons; Liturgist = everything.
    // Anything the Lector is sent must also reach the Liturgist.
    const { ctx } = ready();
    const rd = ctx.getReadingsForDate('2026-08-16');
    const lector = ctx.readingsForRole('Lector', rd).map((i) => i.label);
    const liturgist = ctx.readingsForRole('Liturgist', rd).map((i) => i.label);
    expect(lector).toEqual(['OT', 'Epistle']);
    expect(liturgist).toEqual(['OT', 'Epistle', 'Gospel', 'Psalm']);
    lector.forEach((l) => expect(liturgist).toContain(l));
    expect(liturgist.length).toBeGreaterThan(lector.length);
  });

  it('omits a reading the lectionary does not carry, for either role', () => {
    const { ctx } = ready();
    ctx.lectCalendar['2026-08-16'].psalm = '';
    ctx.lectCalendar['2026-08-16'].ot = '';
    const rd = ctx.getReadingsForDate('2026-08-16');
    expect(ctx.readingsForRole('Liturgist', rd).map((i) => i.label)).toEqual(['Epistle', 'Gospel']);
    expect(ctx.readingsForRole('Lector', rd).map((i) => i.label)).toEqual(['Epistle']);
  });

  it('sends no readings section to a role that does not read', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'Larry Hawkins' }, assignmentsFor('Acolyte'), '', '', '');
    expect(html).not.toContain('Your Readings');
  });

  it('names the ESV in the email, so the reader knows which Bible to use', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '');
    expect(html).toContain('ESV');
    expect(html).toMatch(/href="https:\/\/www\.esv\.org\//);
  });

  it('carries a hand-set reading, not the lectionary it replaced', () => {
    const { ctx } = ready({
      localStorage: { ws_readings: JSON.stringify({ '2026-08-16': { ot: 'Jonah 3:1-5', epistle: '', gospel: '', psalm: '' } }) },
    });
    const html = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '');
    expect(html).toContain('Jonah 3:1-5');
    expect(html).not.toContain('Isaiah 2:1-5');
  });

  it('puts the same readings in the plain-text part, with links', () => {
    const { ctx } = ready();
    const lines = ctx.readingsTextLines(assignmentsFor('Lector'));
    const text = lines.join('\n');
    expect(text).toContain('Your Readings (ESV)');
    expect(text).toContain('OT: Isaiah 2:1-5');
    expect(text).toContain('Epistle: Romans 13:(8-10) 11-14');
    expect(text).toContain('https://www.esv.org/');
    expect(text).not.toContain('Matthew 21:1-11');
  });

  it('emits nothing at all in plain text for a non-reading role', () => {
    const { ctx } = ready();
    expect(ctx.readingsTextLines(assignmentsFor('Acolyte'))).toEqual([]);
  });

  it('drives the HTML and plain-text halves from one role split (no third copy)', () => {
    const { ctx } = ready();
    const items = ctx.readingsForRole('Lector', ctx.getReadingsForDate('2026-08-16'));
    expect(items.map((i) => i.label)).toEqual(['OT', 'Epistle']);
    expect(ctx.readingsForRole('Liturgist', ctx.getReadingsForDate('2026-08-16')).map((i) => i.label))
      .toEqual(['OT', 'Epistle', 'Gospel', 'Psalm']);
    expect(ctx.readingsForRole('Elder', ctx.getReadingsForDate('2026-08-16'))).toEqual([]);
    expect(ctx.readingsForRole('Lector', null)).toEqual([]);
    // Both send paths call the shared builder rather than inlining their own.
    expect(SERVED_JS.match(/\.concat\(readingsTextLines\(assignments, readingsMode === 'inline' \? _esvText : null\)\)/g)).toHaveLength(2);
    // ...and neither kept a private copy of the OT/Epistle split.
    expect(SERVED_JS.match(/rd\.epistle\)\s+lines\.push/g)).toBeNull();
  });
});

// ── Editing, saving, clearing ────────────────────────────────────────────────

describe('editing readings', () => {
  it('labels each field with who receives it, not grouped by role', () => {
    // Grouping by role stopped working when the Liturgist began receiving all
    // four — OT and Epistle now go to both people.
    expect(SCHEDULER_HTML).not.toContain('Emailed to the Lector');
    expect(SCHEDULER_HTML).toMatch(/Old Testament[\s\S]{0,140}Lector &amp; Liturgist/);
    expect(SCHEDULER_HTML).toMatch(/Epistle[\s\S]{0,140}Lector &amp; Liturgist/);
    expect(SCHEDULER_HTML).toMatch(/Gospel[\s\S]{0,140}&mdash; Liturgist/);
    expect(SCHEDULER_HTML).toMatch(/Psalm[\s\S]{0,140}&mdash; Liturgist/);
  });

  it('opens the panel prefilled from the lectionary and says where the values came from', () => {
    const { ctx, el } = ready();
    ctx.openReadingsPanel('2026-08-16');
    expect(el('readings-ot').value).toBe('Isaiah 2:1-5');
    expect(el('readings-gospel').value).toBe('Matthew 21:1-11');
    expect(el('readings-panel-source').textContent).toContain('lectionary');
  });

  it('says so instead when the date has been set by hand', () => {
    const { ctx, el } = ready({
      localStorage: { ws_readings: JSON.stringify({ '2026-08-16': { ot: 'Jonah 3:1-5', epistle: '', gospel: '', psalm: '' } }) },
    });
    ctx.openReadingsPanel('2026-08-16');
    expect(el('readings-panel-source').textContent).toContain('Set by hand');
    expect(el('readings-ot').value).toBe('Jonah 3:1-5');
  });

  it('stores an override that the email then uses', () => {
    const { ctx, el, store } = ready();
    ctx.openReadingsPanel('2026-08-16');
    el('readings-ot').value = 'Jonah 3:1-5';
    el('readings-epistle').value = '';
    el('readings-gospel').value = '';
    el('readings-psalm').value = '';
    ctx.saveReadingsOverrides(Object.assign(ctx.getReadingsOverrides(), {
      '2026-08-16': { ot: 'Jonah 3:1-5', epistle: '', gospel: '', psalm: '' },
    }));
    expect(JSON.parse(store['ws_readings'])['2026-08-16'].ot).toBe('Jonah 3:1-5');
    expect(ctx.getReadingsForDate('2026-08-16').ot).toBe('Jonah 3:1-5');
  });

  it('resetting to the lectionary deletes the override rather than re-saving its values', () => {
    // Re-saving the lectionary's own text as an override looks identical but
    // pins the date, so a later lectionary correction would never reach it —
    // and the Sunday would keep reading "set by hand" with nothing set by hand.
    const { ctx, store } = ready({
      localStorage: { ws_readings: JSON.stringify({ '2026-08-16': { ot: 'Jonah 3:1-5', epistle: '', gospel: '', psalm: '' } }) },
    });
    expect(bodyFrom("getElementById('btn-reset-readings')")).toContain('delete overrides[_readingsDateISO]');

    ctx._readingsDateISO = '2026-08-16';
    const o = ctx.getReadingsOverrides();
    delete o['2026-08-16'];
    ctx.saveReadingsOverrides(o);
    expect(JSON.parse(store['ws_readings'])['2026-08-16']).toBeUndefined();
    expect(ctx.getReadingsForDate('2026-08-16').ot).toBe('Isaiah 2:1-5');
  });

  it('keeps overrides in the blob that syncs to D1, so they are not one browser only', () => {
    expect(SERVED_JS).toContain("localStorage.setItem('ws_readings'");
    // ws_readings is in api-admin.js's sync key list; the save path also queues
    // a push so a correction reaches the server without a manual sync.
    expect(bodyFrom("getElementById('btn-save-readings')")).toContain('queueD1Push()');
  });

  it('repaints the schedule after a save, so the strip is never stale', () => {
    expect(bodyFrom("getElementById('btn-save-readings')")).toContain('renderFocusWeek()');
  });

  it('everything the save and reset handlers call actually exists and runs', () => {
    // The handlers are wired with addEventListener, which this harness cannot
    // fire — so verify their dependencies resolve, since a ReferenceError here
    // would break Save with nothing on screen to explain it.
    const { ctx } = ready();
    ['queueD1Push', 'renderFocusWeek', 'saveReadingsOverrides', 'getReadingsOverrides',
     'showAlert', 'openReadingsPanel', 'focusWeekReadingsHtml', 'readingsTextLines',
     'readingsForRole', 'tidyReadingRef', 'bibleLink'].forEach((fn) => {
      expect(typeof ctx[fn], fn + ' is missing').toBe('function');
    });
    ctx._readingsDateISO = '2026-08-16';
    expect(() => { ctx.queueD1Push(); ctx.renderFocusWeek(); }).not.toThrow();
  });
});

// ── Embedding the ESV text ───────────────────────────────────────────────────
//
// Crossway's API terms (api.esv.org): free for non-commercial personal, church
// and ministry use; the text MAY be redistributed by email; 500 verses/query;
// 5,000 queries/day. Three attribution duties, each checked below: "(ESV)" with
// each quotation (the API's short copyright), the full notice somewhere, and a
// link to www.esv.org.

describe('embedding the full ESV text', () => {
  const assignmentsFor = (role) => ([{
    date: 'Aug 16, 2026', dateISO: '2026-08-16', svc: '8am', role,
  }]);
  const TEXT = {
    'Isaiah 2:1-5': '[1] The word that Isaiah the son of Amoz saw... (ESV)',
    'Romans 13:11-14': '[11] Besides this you know the time... (ESV)',
  };

  it('falls back to a plain link when no text was resolved', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '', {});
    expect(html).toContain('Isaiah 2:1-5');
    expect(html).toMatch(/href="https:\/\/www\.esv\.org\//);
    // and no copyright notice, because nothing was quoted
    expect(html).not.toContain('Crossway');
  });

  it('puts the passage words in the HTML email when text is supplied', () => {
    const { ctx } = ready();
    const html = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '', TEXT);
    expect(html).toContain('The word that Isaiah the son of Amoz saw');
    expect(html).toContain('Besides this you know the time');
    expect(html).toMatch(/href="https:\/\/www\.esv\.org\//);   // link duty
  });

  it('carries the full Crossway notice once, only when text is embedded', () => {
    const { ctx } = ready();
    const withText = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '', TEXT);
    expect(withText).toContain('Crossway');
    expect(withText).toContain('All rights reserved');
    expect(withText.match(/Good News Publishers/g)).toHaveLength(1);

    const noText = ctx.buildHtmlEmail({ name: 'L' }, assignmentsFor('Lector'), '', '', '', {});
    expect(noText).not.toContain('Good News Publishers');
  });

  it('puts the same words, and the notice, in the plain-text half', () => {
    const { ctx } = ready();
    const text = ctx.readingsTextLines(assignmentsFor('Lector'), TEXT).join('\n');
    expect(text).toContain('The word that Isaiah the son of Amoz saw');
    expect(text).toContain('Crossway');
    expect(text).toContain('https://www.esv.org/');
  });

  it('keys the text by the cleaned reference, so an optional-verse ref still matches', () => {
    // The lectionary stores "Romans 13:( 8-10 ) 11-14"; the API was asked for
    // "Romans 13:11-14". The lookup has to bridge that or the text silently
    // never appears.
    const { ctx } = ready();
    expect(ctx.esvTextFor(TEXT, 'Romans 13:( 8-10 ) 11-14')).toContain('Besides this');
    expect(ctx.esvTextFor(TEXT, 'Nahum 1:1')).toBe('');
    expect(ctx.esvTextFor(null, 'Isaiah 2:1-5')).toBe('');
  });

  it('asks for each distinct passage once per send, not once per recipient', () => {
    const { ctx } = ready();
    const tasks = [
      { assignments: assignmentsFor('Lector') },
      { assignments: assignmentsFor('Lector') },   // same readings, second volunteer
      { assignments: assignmentsFor('Liturgist') },
    ];
    const refs = ctx.esvRefsForTasks(tasks);
    expect(refs).toHaveLength(4);                 // OT, Epistle, Gospel, Psalm
    expect(new Set(refs).size).toBe(refs.length); // no duplicates
    expect(refs).toContain('Romans 13:11-14');    // cleaned, as the API needs
    expect(refs).not.toContain('Romans 13:( 8-10 ) 11-14');
  });

  it('collects nothing for roles that do not read', () => {
    const { ctx } = ready();
    expect(ctx.esvRefsForTasks([{ assignments: assignmentsFor('Acolyte') }])).toEqual([]);
    expect(ctx.esvRefsForTasks([])).toEqual([]);
  });

  it('goes through the Worker, so the key never reaches the browser', () => {
    // A direct browser call to api.esv.org is blocked by CSP connect-src 'self'
    // anyway, and would expose the key. (The string itself does appear in the
    // help text that tells an admin where to get a key — what must not exist is
    // a REQUEST to it, or any Authorization header, on the client.)
    expect(SERVED_JS).not.toMatch(/fetch\([^)]*api\.esv\.org/);
    expect(SERVED_JS).not.toMatch(/Authorization['"]?\s*:\s*['"]Token/);
    // The fetch must also keep the "s.workerUrl +" shape the embed transform
    // rewrites, or the embedded tab calls the wrong host and CSP blocks it.
    expect(bodyFrom('function esvFetchPassages')).toContain("fetch(s.workerUrl + '/esv/passage?q='");
    const embedded = getSchedulerInlineParts().js;
    const start = embedded.indexOf('function esvFetchPassages');
    expect(embedded.slice(start, embedded.indexOf('\n}', start))).toContain("fetch('/esv/passage?q='");
  });

  it('resolves rather than rejects when the lookup fails, so the email still sends', async () => {
    const { ctx } = ready();
    ctx.fetch = () => Promise.reject(new Error('offline'));
    await expect(ctx.esvFetchPassages(['Isaiah 2:1-5'])).resolves.toEqual({});
  });

  it('ignores an unconfigured response even if it carries text', async () => {
    // configured:false is the Worker saying it holds no key. Text arriving
    // alongside that would be a malformed response, not something to quote.
    const { ctx } = ready();
    ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ configured: false, passages: ['some text'] }) });
    await expect(ctx.esvFetchPassages(['Isaiah 2:1-5'])).resolves.toEqual({});
  });

  it('embeds nothing when the passage list is empty or blank', async () => {
    const { ctx } = ready();
    ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ configured: true, passages: [] }) });
    await expect(ctx.esvFetchPassages(['Isaiah 2:1-5'])).resolves.toEqual({});
    ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ configured: true, passages: ['   '] }) });
    await expect(ctx.esvFetchPassages(['Isaiah 2:1-5'])).resolves.toEqual({});
  });

  it('collects the passages the Worker returns', async () => {
    const { ctx } = ready();
    ctx.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ configured: true, passages: ['  the words  '] }),
    });
    const out = await ctx.esvFetchPassages(['Isaiah 2:1-5']);
    expect(out['Isaiah 2:1-5']).toBe('the words');
  });

  it('does not even ask when the Worker holds no key', () => {
    const { ctx } = ready();
    ctx._esvConfigured = false;
    expect(ctx.esvWantedNow()).toBe(false);
    ctx._esvConfigured = true;
    expect(ctx.esvWantedNow()).toBe(true);       // on by default once configured
  });

  it('locks the choice to link-only, and says why, when no key is configured', () => {
    const { ctx, el } = ready();
    ctx._esvConfigured = false;
    ctx.renderReminderEsvBlock();
    expect(el('reminder-readings-mode').disabled).toBe(true);
    expect(el('reminder-readings-mode').value).toBe('link');
    expect(el('reminder-esv-note').textContent).toContain('ESV_API_KEY');
    expect(ctx.readingsModeNow()).toBe('link');
  });

  it('defaults to the PDF once a key exists, since that is what keeps the email short', () => {
    const { ctx, el } = ready();
    ctx._esvConfigured = true;
    ctx.renderReminderEsvBlock();
    expect(el('reminder-readings-mode').disabled).toBe(false);
    expect(el('reminder-readings-mode').value).toBe('pdf');
    expect(ctx.readingsModeNow()).toBe('pdf');
    expect(ctx.esvWantedNow()).toBe(true);
  });

  it('remembers a chosen mode', () => {
    const withMode = (m) => {
      const h = ready({ localStorage: { ws_office_copy_pref: JSON.stringify({ readings: m }) } });
      h.ctx._esvConfigured = true;
      return h;
    };
    expect(withMode('link').ctx.readingsModeNow()).toBe('link');
    expect(withMode('inline').ctx.readingsModeNow()).toBe('inline');
    expect(withMode('pdf').ctx.readingsModeNow()).toBe('pdf');
    // A junk value falls back to the default rather than a mode that cannot run.
    expect(withMode('banana').ctx.readingsModeNow()).toBe('pdf');
    // ...and link-only still wins whenever there is no key, whatever is stored.
    const noKey = ready({ localStorage: { ws_office_copy_pref: JSON.stringify({ readings: 'inline' }) } });
    noKey.ctx._esvConfigured = false;
    expect(noKey.ctx.readingsModeNow()).toBe('link');
    expect(noKey.ctx.esvWantedNow()).toBe(false);
  });

  it('learns the key is configured from the scheduler config', () => {
    // _esvConfigured is set from /admin/api/scheduler/config's hasEsvApiKey.
    expect(getSchedulerInlineParts().js).toContain('_esvConfigured = !!cfg.hasEsvApiKey');
  });
});

// ── The readings PDF ─────────────────────────────────────────────────────────
//
// Four passages inline makes a very long email, so the full text can instead
// ride along as an attached sheet. Built in the browser and base64'd, exactly
// like the .ics already is — no library, since this app carries no third-party
// JS anywhere. Helvetica is a Base14 font so nothing is embedded.
//
// A companion check in test/readings-pdf-render.test.js parses the generated
// bytes with a real PDF reader; these tests cover the shape and the wiring.

describe('readings PDF attachment', () => {
  const assignmentsFor = (role) => ([{
    date: 'Aug 16, 2026', dateISO: '2026-08-16', svc: '8am', role,
  }]);
  const TEXT = {
    'Isaiah 2:1-5': '[1] The word that Isaiah the son of Amoz saw. (ESV)',
    'Romans 13:11-14': '[11] Besides this you know the time. (ESV)',
  };

  it('produces a real PDF, named for the Sunday', () => {
    const { ctx } = ready();
    const att = ctx.readingsPdfAttachment({ name: 'Larry Hawkins' }, assignmentsFor('Lector'), TEXT);
    expect(att.filename).toBe('Readings Aug 16, 2026.pdf');
    const pdf = Buffer.from(att.content, 'base64').toString('binary');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('attaches nothing when no text was resolved, rather than an empty sheet', () => {
    const { ctx } = ready();
    expect(ctx.readingsPdfAttachment({ name: 'L' }, assignmentsFor('Lector'), {})).toBeNull();
    expect(ctx.readingsPdfAttachment({ name: 'L' }, assignmentsFor('Acolyte'), TEXT)).toBeNull();
  });

  it('keeps the calendar file alongside the readings sheet', () => {
    const { ctx } = ready();
    const ical = { filename: 'worship-schedule.ics', content: 'aWNz' };
    const readings = { filename: 'Readings.pdf', content: 'cGRm' };
    expect(ctx.emailAttachments('aWNz', readings).map((a) => a.filename))
      .toEqual(['worship-schedule.ics', 'Readings.pdf']);
    // ...and the calendar still goes on its own when there is no sheet.
    expect(ctx.emailAttachments('aWNz', null)).toEqual([ical]);
  });

  it('strips characters a filename cannot carry', () => {
    const { ctx } = ready();
    const att = ctx.readingsPdfAttachment({ name: 'L' },
      [{ date: 'Aug/16 "2026"', dateISO: '2026-08-16', svc: '8am', role: 'Lector' }], TEXT);
    expect(att.filename).toBe('Readings Aug16 2026.pdf');
    expect(att.filename).not.toMatch(/[/"]/);
  });

  it('escapes the PDF string delimiters rather than corrupting the file', () => {
    const { ctx } = ready();
    const bs = String.fromCharCode(92);
    expect(ctx.pdfEscape('a(b)c')).toBe('a' + bs + '(b' + bs + ')c');
    expect(ctx.pdfEscape('a' + bs + 'b')).toBe('a' + bs + bs + 'b');
  });

  it('maps the punctuation ESV text really uses into WinAnsi', () => {
    const { ctx } = ready();
    // Curly quotes and dashes are mapped, not dropped — losing them would
    // change the words on the page.
    expect(ctx.pdfWinAnsi('“Quoted”').charCodeAt(0)).toBe(147);
    expect(ctx.pdfWinAnsi('“Quoted”').charCodeAt(7)).toBe(148);
    expect(ctx.pdfWinAnsi('a—b').charCodeAt(1)).toBe(151);
    expect(ctx.pdfWinAnsi('a’s').charCodeAt(1)).toBe(146);
    // Anything else becomes "?" rather than an invalid byte in the file.
    expect(ctx.pdfWinAnsi('中')).toBe('?');
    // Every byte must fit in a single char, or the xref offsets go wrong.
    const out = ctx.pdfWinAnsi('“a—b’c中é');
    for (let i = 0; i < out.length; i++) expect(out.charCodeAt(i)).toBeLessThan(256);
  });

  it('wraps to the column and breaks a word too long to fit', () => {
    const { ctx } = ready();
    const lines = ctx.pdfWrap('x'.repeat(400), 468, 11);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((l) => expect(ctx.pdfTextWidth(l, 11)).toBeLessThanOrEqual(468));
  });

  it('never emits a line wider than the column', () => {
    const { ctx } = ready();
    const words = 'Jerusalem plowshares pruning-hooks LORD nation anymore establishment'.split(' ');
    const para = Array.from({ length: 300 }, (_, i) => words[i % words.length]).join(' ');
    ctx.pdfWrap(para, 468, 11).forEach((l) => {
      expect(ctx.pdfTextWidth(l, 11)).toBeLessThanOrEqual(468);
    });
  });

  it('flows onto more pages rather than off the bottom of one', () => {
    const { ctx } = ready();
    // Comfortably more than one page holds (~44 lines x ~17 words), so this
    // really exercises the page break rather than passing on a short fixture.
    const long = { 'Isaiah 2:1-5': Array.from({ length: 2000 }, () => 'word').join(' ') };
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, assignmentsFor('Lector'), long);
    const count = (pdf.match(/\/Type \/Page[^s]/g) || []).length;
    expect(count).toBeGreaterThan(1);
    expect(pdf).toContain('/Count ' + count);
  });

  it('carries the Crossway notice on the sheet', () => {
    const { ctx } = ready();
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, assignmentsFor('Lector'), TEXT);
    expect(pdf).toContain('Crossway');
    expect(pdf).toContain('All rights reserved');
  });

  it('sends the text to the sheet OR the body, never both', () => {
    // Attaching the PDF *and* embedding the same words is the long email the
    // attachment exists to avoid.
    const both = SERVED_JS.match(/readingsMode === 'inline' \? _esvText : null/g);
    expect(both).toHaveLength(4);   // 2 send paths x (html + text)
    expect(SERVED_JS.match(/readingsMode === 'pdf'/g)).toHaveLength(2);
  });
});
