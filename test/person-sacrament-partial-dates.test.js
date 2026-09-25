import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  normalizeSacramentFlag, isYearOnlyDate, isYearUnknownDate, isPartialDate,
  SACRAMENT_YES, SACRAMENT_NO, SACRAMENT_UNKNOWN,
} from '../src/api-utils.js';
import { handlePeopleApi } from '../src/api-people.js';
import { CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// ── Real schema, real handlers ────────────────────────────────────────────
// The .sql migrations don't carry every column: several were added through the
// runtime `migrations` array in db.js (locally_edited among them), so those ALTERs
// are pulled straight out of that file rather than restated here, where they could
// drift from what production actually has.
function realSchema() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    try { sqlite.exec(readFileSync(new URL(f, dir), 'utf8')); } catch { /* later migration, other tables */ }
  }
  const dbSrc = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
  for (const m of dbSrc.matchAll(/'(ALTER TABLE [^']+)'/g)) {
    try { sqlite.exec(m[1]); } catch { /* already present */ }
  }
  return sqlite;
}

function makeDb(sqlite) {
  return {
    prepare(sql) {
      const mk = (args) => ({
        async run() {
          const r = sqlite.prepare(sql).run(...args);
          // D1 exposes these under different names than node:sqlite does; the handlers
          // read the D1 spelling, so the shim has to translate rather than pass through.
          return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

async function callPeople(db, method, seg, body) {
  const req = new Request('https://x/admin/api/' + seg, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handlePeopleApi(req, {}, new URL(req.url), method, seg, db,
    true, true, true, true, true, 'admin');
  return { status: res.status, body: await res.json() };
}

describe('normalizeSacramentFlag — three states, not two', () => {
  it('keeps 0 meaning "not recorded" so pre-existing rows are not reinterpreted', () => {
    // Every row written before this existed is 0. If 0 had been repurposed as an
    // explicit "No", the whole congregation would have acquired a pastoral assertion
    // nobody made.
    expect(normalizeSacramentFlag(0)).toBe(SACRAMENT_UNKNOWN);
    expect(normalizeSacramentFlag(undefined)).toBe(SACRAMENT_UNKNOWN);
    expect(normalizeSacramentFlag(null)).toBe(SACRAMENT_UNKNOWN);
    expect(normalizeSacramentFlag('')).toBe(SACRAMENT_UNKNOWN);
  });

  it('reads yes and no from numbers, strings and the legacy booleans', () => {
    for (const v of [1, '1', true, 'yes', 'Yes', ' TRUE ']) expect(normalizeSacramentFlag(v)).toBe(SACRAMENT_YES);
    for (const v of [2, '2', 'no', 'No', 'false']) expect(normalizeSacramentFlag(v)).toBe(SACRAMENT_NO);
  });

  it('treats the legacy false as "not recorded", not as an explicit No', () => {
    // The old checkbox sent false for both, so promoting it to No would invent data.
    expect(normalizeSacramentFlag(false)).toBe(SACRAMENT_UNKNOWN);
  });

  it('falls back to "not recorded" for anything unrecognized', () => {
    for (const v of [3, -1, 'maybe', {}, []]) expect(normalizeSacramentFlag(v)).toBe(SACRAMENT_UNKNOWN);
  });
});

describe('partial-date sentinels', () => {
  it('tells the two kinds apart and treats neither as exact', () => {
    expect(isYearUnknownDate('0001-04-11')).toBe(true);
    expect(isYearOnlyDate('0001-04-11')).toBe(false);
    expect(isYearOnlyDate('1978-00-00')).toBe(true);
    expect(isYearUnknownDate('1978-00-00')).toBe(false);
    expect(isPartialDate('1978-04-11')).toBe(false);
    expect(isPartialDate('')).toBe(false);
  });

  it('SQLite strftime yields NULL for both, so date-driven queries skip them', () => {
    // This is what keeps a partial date off a bulletin: the birthday and
    // baptism-anniversary queries filter on strftime('%m', …), which matches nothing
    // here rather than announcing an invented day.
    const s = new DatabaseSync(':memory:');
    const row = s.prepare(
      `SELECT strftime('%m','1978-00-00') a, strftime('%m','0001-04-11') b, strftime('%m','1978-04-11') c`
    ).get();
    expect(row.a).toBe(null);
    expect(row.b).toBe('04'); // year-unknown keeps a usable month/day — by design
    expect(row.c).toBe('04');
  });
});

describe('PUT /people/:id stores all three sacrament states', () => {
  it('round-trips yes, no and not-recorded without truthiness collapsing No into Yes', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active) VALUES ('A','B','member',1)`);
    const id = sqlite.prepare('SELECT id FROM people').get().id;

    for (const [sent, stored] of [[1, 1], [2, 2], [0, 0]]) {
      const r = await callPeople(db, 'PUT', 'people/' + id,
        { first_name: 'A', last_name: 'B', baptized: sent, confirmed: sent });
      expect(r.status).toBe(200);
      const row = sqlite.prepare('SELECT baptized, confirmed FROM people WHERE id=?').get(id);
      expect(row.baptized).toBe(stored);
      expect(row.confirmed).toBe(stored);
    }
  });

  it('stores a year-only baptism date verbatim rather than an invented day', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active) VALUES ('A','B','member',1)`);
    const id = sqlite.prepare('SELECT id FROM people').get().id;
    await callPeople(db, 'PUT', 'people/' + id,
      { first_name: 'A', last_name: 'B', baptism_date: '1978-00-00', baptized: 1 });
    expect(sqlite.prepare('SELECT baptism_date FROM people WHERE id=?').get(id).baptism_date).toBe('1978-00-00');
  });
});

describe('POST /people records the sacrament flags it used to drop', () => {
  it('persists an explicit answer given at creation', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    const r = await callPeople(db, 'POST', 'people',
      { first_name: 'New', last_name: 'Person', baptized: 1, confirmed: 2 });
    expect(r.status).toBe(200);
    const row = sqlite.prepare('SELECT baptized, confirmed FROM people WHERE id=?').get(r.body.id);
    expect(row.baptized).toBe(SACRAMENT_YES);
    expect(row.confirmed).toBe(SACRAMENT_NO);
  });

  it('infers yes from a supplied date when no explicit answer is given', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    const r = await callPeople(db, 'POST', 'people',
      { first_name: 'D', last_name: 'Ated', baptism_date: '1990-06-01' });
    expect(sqlite.prepare('SELECT baptized FROM people WHERE id=?').get(r.body.id).baptized).toBe(SACRAMENT_YES);
  });

  it('never overrides an explicit No, even when a date is also present', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    const r = await callPeople(db, 'POST', 'people',
      { first_name: 'C', last_name: 'Onflict', baptism_date: '1990-06-01', baptized: 2 });
    expect(sqlite.prepare('SELECT baptized FROM people WHERE id=?').get(r.body.id).baptized).toBe(SACRAMENT_NO);
  });
});

describe('the sacrament people-filter is tri-state aware', () => {
  it('counts an explicit No as "not baptized", not as baptized', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active,baptized,confirmed) VALUES
      ('Yes','Both','member',1,1,1), ('No','Both','member',1,2,2), ('Un','Known','member',1,0,0)`);
    const req = new Request('https://x/admin/api/people?sacrament=neither&mt=all');
    const res = await handlePeopleApi(req, {}, new URL(req.url), 'GET', 'people', db,
      true, true, true, true, true, 'admin');
    const names = (await res.json()).people.map(p => p.first_name).sort();
    // Explicit No and "not recorded" both belong in `neither`; only a real Yes is excluded.
    expect(names).toEqual(['No', 'Un']);
  });
});

describe('bulk-sacrament can assert No, and "unset" still means "not recorded"', () => {
  it('writes 2 for no and 0 for unset', async () => {
    const sqlite = realSchema();
    const db = makeDb(sqlite);
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active) VALUES ('A','B','member',1),('C','D','member',1)`);
    const ids = sqlite.prepare('SELECT id FROM people').all().map(r => r.id);

    await callPeople(db, 'POST', 'people/bulk-sacrament', { ids, baptized: 'no' });
    expect(sqlite.prepare('SELECT baptized FROM people WHERE id=?').get(ids[0]).baptized).toBe(SACRAMENT_NO);

    await callPeople(db, 'POST', 'people/bulk-sacrament', { ids, baptized: 'unset' });
    expect(sqlite.prepare('SELECT baptized FROM people WHERE id=?').get(ids[0]).baptized).toBe(SACRAMENT_UNKNOWN);
  });
});

// ── Front end: run the real shipped bundle ────────────────────────────────
function makeCtx() {
  const store = {};
  const mkEl = (id) => ({
    id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    style: {}, dataset: {}, options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {},
  });
  const document = {
    getElementById: (id) => store[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: mkEl, addEventListener() {}, body: mkEl('body'),
    documentElement: mkEl('html'), activeElement: null,
  };
  const calls = [];
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt,
    isFinite, Number, String, Object, Array, Set, Promise, RegExp,
    encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: (path, opts) => { calls.push({ path, opts }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); },
    alert(m) { ctx.__alerts.push(m); },
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.__alerts = [];
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
  vm.runInContext(CHMS_APP_STAFF_JS, ctx, { filename: 'app-staff.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.__store = store; ctx.__calls = calls;
  ctx.__el = (id) => { if (!store[id]) store[id] = mkEl(id); return store[id]; };
  return ctx;
}

describe('fmtDate renders each precision honestly', () => {
  it('shows a year-only date as just the year', () => {
    const ctx = makeCtx();
    expect(ctx.fmtDate('1978-00-00')).toBe('1978');
    expect(ctx.fmtDate('0001-04-11')).toBe('Apr 11');
    expect(ctx.fmtDate('1978-04-11')).toBe('4/11/1978');
  });

  it('computes no age from a partial birthday', () => {
    const ctx = makeCtx();
    expect(ctx.calcAge('1978-00-00')).toBe('');
    expect(ctx.calcAge('0001-04-11')).toBe('');
    expect(ctx.calcAge('1978-04-11')).not.toBe('');
  });
});

describe('the date-precision control round-trips all three shapes', () => {
  const cases = [
    ['1978-04-11', 'exact', '1978-04-11', '1978-04-11'],
    ['0001-04-11', 'monthday', '2000-04-11', '0001-04-11'],
    ['1978-00-00', 'year', '1978-01-01', '1978-00-00'],
  ];
  for (const [stored, prec, shownInPicker, savedBack] of cases) {
    it(`${stored} loads as ${prec} and saves back unchanged`, () => {
      const ctx = makeCtx();
      expect(ctx.pmDatePrecision(stored)).toBe(prec);
      // The native picker can only hold a real calendar date, so a placeholder stands in
      // for the unknown part — the point is that it never reaches the database.
      expect(ctx.pmDateInputValue(stored)).toBe(shownInPicker);
      ctx.__el('d').value = shownInPicker;
      ctx.__el('d-prec').value = prec;
      expect(ctx.pmReadDate('d', 'd-noyear')).toBe(savedBack);
    });
  }

  it('still honors the old paired checkbox where no precision select exists', () => {
    const ctx = makeCtx();
    ctx.__el('d').value = '2000-04-11';
    ctx.__el('d-noyear').checked = true;
    expect(ctx.pmReadDate('d', 'd-noyear')).toBe('0001-04-11');
  });

  it('returns empty rather than throwing when the field is absent', () => {
    expect(makeCtx().pmReadDate('nope', 'nope-noyear')).toBe('');
  });
});

describe('the yes/no control', () => {
  it('reads back each of the three states', () => {
    const ctx = makeCtx();
    for (const [v, expected] of [['1', 1], ['2', 2], ['0', 0], ['garbage', 0]]) {
      ctx.__el('s').value = v;
      expect(ctx.pmReadSacrament('s')).toBe(expected);
    }
  });

  it('renders the stored state as the selected option', () => {
    const ctx = makeCtx();
    expect(ctx.pmSacramentSelect('s', 'baptized?', 2, '')).toContain('value="2" selected');
    expect(ctx.pmSacramentSelect('s', 'baptized?', 0, '')).toContain('value="0" selected');
  });

  it('displays No, and leaves "not recorded" blank rather than implying No', () => {
    const ctx = makeCtx();
    expect(ctx.pmSacramentDisplay(1, '')).toBe('Yes (date unknown)');
    expect(ctx.pmSacramentDisplay(2, '')).toBe('No');
    expect(ctx.pmSacramentDisplay(0, '')).toBe('');
    // A date always speaks for itself, whatever the flag says.
    expect(ctx.pmSacramentDisplay(0, '1978-00-00')).toBe('1978');
  });
});

// ── The live profile: the pvf* field registry ────────────────────────────
// The card-based profile renders read-only rows from this registry and edits a whole section
// at a time (pvfSectionEdit / pvfSectionSave). These tests target the renderer on screen.
function seedProfile(ctx, over) {
  ctx._userRole = 'admin';
  ctx._currentPvPerson = Object.assign({
    id: 42, first_name: 'Emma', last_name: 'Taylor', gender: '', marital_status: '',
    member_type: 'member', family_role: 'head', dob: '', baptism_date: '',
    confirmation_date: '', anniversary_date: '', baptized: 0, confirmed: 0, tags: [],
  }, over || {});
  ctx.pvfBuildRegistry(ctx._currentPvPerson);
  return ctx._currentPvPerson;
}

describe('baptized / confirmed are editable on the live profile', () => {
  it('registers them as yes/no fields — the gap that made them look removed', () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    for (const id of ['baptized', 'confirmed']) {
      expect(ctx._pvFields[id]).toBeTruthy();
      expect(ctx._pvFields[id].type).toBe('select');
      expect(ctx._pvFields[id].options.map(o => o.label)).toEqual(['Yes', 'No', 'Not recorded']);
    }
  });

  it('shows them in the Demographics card', () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    for (const id of ['baptized', 'confirmed']) {
      expect(ctx.pvfRowHtml(id)).toContain('pvf-' + id);
    }
  });

  it('renders No as No, and "not recorded" as the card\'s usual Not on file', () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptized: 2, confirmed: 0 });
    expect(ctx.pvfRowHtml('baptized')).toContain('>No<');
    // 0 is a real stored value; without the blankVals guard it would print "Not recorded"
    // as though someone had answered.
    expect(ctx.pvfRowHtml('confirmed')).toContain('Not on file');
  });

  it('PATCHes just the changed field when the section is saved', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    openChurchSection(ctx);
    ctx.__el('pvse-baptized').value = '2';
    ctx.__el('pvse-confirmed').value = '0'; // unchanged — must not be sent
    ctx.pvfSectionSave('church');
    await new Promise(r => setTimeout(r, 10));
    const call = ctx.__calls.find(c => c.opts && c.opts.method === 'PATCH');
    expect(call.path).toBe('/admin/api/people/42');
    expect(JSON.parse(call.opts.body)).toEqual({ baptized: '2' });
  });
});

// OS3 (2026-09-25): editing is per section — the Edit button opens every field in the card and
// one Save sends a single PATCH of whatever changed.
function openChurchSection(ctx) {
  ctx.__el('pvf-body-church');
  ctx._pvSections = { church: ['baptized', 'baptism_date', 'confirmed', 'confirmation_date', 'anniversary_date'] };
  ctx.pvfSectionEdit('church');
  return ctx.__store['pvf-body-church'].innerHTML;
}

describe('the section date editor carries a precision', () => {
  it('offers all three precisions and preselects the stored one', () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '1994-00-00' });
    const html = openChurchSection(ctx);
    expect(html).toContain('Month &amp; day only');
    expect(html).toContain('value="year" selected');
    // The picker cannot hold 1994-00-00, so a placeholder stands in.
    expect(html).toContain('value="1994-01-01"');
  });

  it('saves a year-only edit as the sentinel, not as 1 January', async () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '' });
    openChurchSection(ctx);
    ctx.__el('pvse-baptism_date').value = '1994-01-01';
    ctx.__el('pvse-baptism_date-prec').value = 'year';
    ctx.pvfSectionSave('church');
    await new Promise(r => setTimeout(r, 10));
    expect(JSON.parse(ctx.__calls.find(c => c.opts && c.opts.method === 'PATCH').opts.body)).toEqual({ baptism_date: '1994-00-00' });
  });

  it('saves a month/day-only edit as the year-unknown sentinel', async () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '' });
    openChurchSection(ctx);
    ctx.__el('pvse-baptism_date').value = '2000-07-31';
    ctx.__el('pvse-baptism_date-prec').value = 'monthday';
    ctx.pvfSectionSave('church');
    await new Promise(r => setTimeout(r, 10));
    expect(JSON.parse(ctx.__calls.find(c => c.opts && c.opts.method === 'PATCH').opts.body)).toEqual({ baptism_date: '0001-07-31' });
  });

  it('sends nothing until Save, and nothing at all when no field changed', async () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '1994-00-00' });
    openChurchSection(ctx);
    ctx.__el('pvse-baptism_date').value = '1994-01-01';
    ctx.__el('pvse-baptism_date-prec').value = 'year';
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__calls.length).toBe(0);
    ctx.pvfSectionSave('church');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__calls.filter(c => c.opts && c.opts.method === 'PATCH').length).toBe(0);
  });
});

describe('a partial date never claims an elapsed time', () => {
  it('drops the "years ago" line rather than counting from year 1', () => {
    // A month/day-only baptism printed "Jul 31" above "2024 years ago".
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '0001-07-31' });
    const html = ctx.pvfRowHtml('baptism_date');
    expect(html).toContain('Jul 31');
    expect(html).not.toContain('years ago');
    expect(ctx.pvfYearsAgo('1994-00-00')).toBe('');
    expect(ctx.pvfYearsAgo('1994-07-31')).toContain('years ago');
  });
});

// The per-field editor these replaced committed on blur, which is where the reported
// re-entrant "Save failed" came from. Section saving commits only from Save, so what is left
// to pin is that a save updates the record and a failed one keeps the edits and says why.
function openPersonalSection(ctx) {
  ctx.__el('pvf-body-personal');
  ctx._pvSections = { personal: ['first_name', 'last_name', 'gender', 'marital_status'] };
  ctx.pvfSectionEdit('personal');
}

describe('saving a section', () => {
  it('updates the local record once the server confirms', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    openPersonalSection(ctx);
    ctx.__el('pvse-gender').value = 'Female';
    ctx.pvfSectionSave('personal');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__alerts).toEqual([]);
    expect(ctx._currentPvPerson.gender).toBe('Female');
  });

  it('keeps the edits and includes the reason when the save fails', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    openPersonalSection(ctx);
    ctx.__el('pvse-gender').value = 'Female';
    const err = ctx.__el('pvse-err-personal');
    // Not JSON — the shape that used to produce a reasonless "Save failed".
    ctx.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('Unexpected token < in JSON')) });
    ctx.pvfSectionSave('personal');
    await new Promise(r => setTimeout(r, 10));
    expect(err.textContent).toContain('Your edits are still here');
    expect(err.textContent).toContain('Unexpected token');
    expect(ctx._currentPvPerson.gender).toBe('');
    expect(ctx.__store['pvse-gender'].value).toBe('Female');
  });

  it('refuses to save a blank first name', () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    openPersonalSection(ctx);
    ctx.__el('pvse-first_name').value = '  ';
    const err = ctx.__el('pvse-err-personal');
    ctx.pvfSectionSave('personal');
    expect(err.textContent).toBe('Enter a first name.');
    expect(ctx.__calls.length).toBe(0);
  });
});

describe('creating a person inside a household', () => {
  function setup(ctx, household) {
    ctx._addToHhId = 3;
    ctx._addToHhHousehold = household;
    ctx.__el('anh-first').value = 'Kid';
    ctx.__el('anh-last').value = 'Smith';
    ctx.__el('anh-type').value = 'Member';
  }

  it('inherits the household address instead of leaving it blank', () => {
    const ctx = makeCtx();
    setup(ctx, { id: 3, address1: '1 Main St', address2: 'Apt 2', city: 'St. Louis', state: 'MO', zip: '63139' });
    ctx.createAndAddToHh();
    const body = JSON.parse(ctx.__calls.at(-1).opts.body);
    expect(body).toMatchObject({
      household_id: 3, address1: '1 Main St', address2: 'Apt 2',
      city: 'St. Louis', state: 'MO', zip: '63139',
    });
  });

  it('still creates the person when the household has no address', () => {
    const ctx = makeCtx();
    setup(ctx, { id: 3, address1: '', city: '', state: '', zip: '' });
    ctx.createAndAddToHh();
    const body = JSON.parse(ctx.__calls.at(-1).opts.body);
    expect(body.first_name).toBe('Kid');
    expect(body.address1).toBeUndefined();
  });

  it('never borrows a different household\'s address', () => {
    // The fetch is async, so a stale object from a previously-opened household must not
    // be applied to whichever household is open now.
    const ctx = makeCtx();
    setup(ctx, { id: 99, address1: 'Somewhere Else' });
    ctx.createAndAddToHh();
    expect(JSON.parse(ctx.__calls.at(-1).opts.body).address1).toBeUndefined();
  });

  it('names the address that will be inherited rather than applying it invisibly', () => {
    const ctx = makeCtx();
    ctx._addToHhId = 3;
    ctx._addToHhHousehold = { id: 3, address1: '1 Main St', city: 'St. Louis', state: 'MO', zip: '63139' };
    ctx.__el('anh-address-note');
    ctx.renderAddHhAddressNote();
    expect(ctx.__store['anh-address-note'].innerHTML).toContain('1 Main St');
    ctx._addToHhHousehold = { id: 3 };
    ctx.renderAddHhAddressNote();
    expect(ctx.__store['anh-address-note'].innerHTML).toContain('no address on file');
  });
});

describe('cold-start backfill: a date on file means yes', () => {
  // Requested directly: set baptized/confirmed to yes for anyone who already has a date.
  // The statements live in _doInitDb; they are run here against the real schema so the
  // behavior is pinned rather than assumed.
  function runBackfill(sqlite) {
    const src = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
    const stmts = [...src.matchAll(/"(UPDATE people SET (?:baptized|confirmed)=1 WHERE[^"]+)"/g)].map(m => m[1]);
    expect(stmts.length).toBe(2); // both flags, or this test is only checking half the job
    for (const s of stmts) sqlite.exec(s);
  }

  it('fills in yes for every dated row, including partial dates', () => {
    const sqlite = realSchema();
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active,baptism_date,confirmation_date,baptized,confirmed) VALUES
      ('Exact','Date','member',1,'1994-07-31','2006-05-01',0,0),
      ('Year','Only','member',1,'1978-00-00','',0,0),
      ('MonthDay','Only','member',1,'0001-04-11','',0,0),
      ('No','Dates','member',1,'','',0,0)`);
    runBackfill(sqlite);
    const rows = Object.fromEntries(sqlite.prepare('SELECT first_name, baptized, confirmed FROM people').all()
      .map(r => [r.first_name, [r.baptized, r.confirmed]]));
    expect(rows.Exact).toEqual([SACRAMENT_YES, SACRAMENT_YES]);
    expect(rows.Year).toEqual([SACRAMENT_YES, SACRAMENT_UNKNOWN]);
    expect(rows.MonthDay).toEqual([SACRAMENT_YES, SACRAMENT_UNKNOWN]);
    // Nothing on file stays nothing on file — the backfill reads dates, it doesn't invent them.
    expect(rows.No).toEqual([SACRAMENT_UNKNOWN, SACRAMENT_UNKNOWN]);
  });

  it('never overwrites an explicit No, even against a date', () => {
    // A human answered; a contradictory date is not grounds to overturn it.
    const sqlite = realSchema();
    sqlite.exec(`INSERT INTO people (first_name,last_name,member_type,active,baptism_date,baptized) VALUES
      ('Said','No','member',1,'1994-07-31',2)`);
    runBackfill(sqlite);
    expect(sqlite.prepare('SELECT baptized FROM people').get().baptized).toBe(SACRAMENT_NO);
  });
});
