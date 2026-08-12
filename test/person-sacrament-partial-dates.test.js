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

  it('still honours the old paired checkbox where no precision select exists', () => {
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
// The card-based profile edits one field at a time through pvfStart/pvfCommit. An older
// set of whole-card editors (pvEditDemo & co.) used to sit alongside it writing full-row
// PUTs; their containers had already been dropped from the markup, so they were dead and
// have been removed. These tests target the renderer that is actually on screen.
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

  it('renders No as No, and "not recorded" as the card\'s usual Not set', () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptized: 2, confirmed: 0 });
    expect(ctx.pvfRowHtml('baptized')).toContain('>No<');
    // 0 is a real stored value; without the blankVals guard it would print "Not recorded"
    // as though someone had answered.
    expect(ctx.pvfRowHtml('confirmed')).toContain('Not set');
  });

  it('PATCHes just that field when answered', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    ctx.__el('pvf-baptized');
    ctx.pvfStart('baptized');
    ctx.__el('pvfi-baptized').value = '2';
    ctx.pvfCommit('baptized');
    await new Promise(r => setTimeout(r, 10));
    const call = ctx.__calls.at(-1);
    expect(call.opts.method).toBe('PATCH');
    expect(JSON.parse(call.opts.body)).toEqual({ baptized: '2' });
  });
});

describe('the live date editor carries a precision', () => {
  it('offers all three precisions and preselects the stored one', () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '1994-00-00' });
    ctx.__el('pvf-baptism_date');
    ctx.pvfStart('baptism_date');
    const html = ctx.__store['pvf-baptism_date'].innerHTML;
    expect(html).toContain('Month &amp; day only');
    expect(html).toContain('value="year" selected');
    // The picker cannot hold 1994-00-00, so a placeholder stands in.
    expect(html).toContain('value="1994-01-01"');
  });

  it('saves a year-only edit as the sentinel, not as 1 January', async () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '' });
    ctx.__el('pvf-baptism_date');
    ctx.pvfStart('baptism_date');
    ctx.__el('pvfi-baptism_date').value = '1994-01-01';
    ctx.__el('pvfi-baptism_date-prec').value = 'year';
    ctx.pvfCommit('baptism_date');
    await new Promise(r => setTimeout(r, 10));
    expect(JSON.parse(ctx.__calls.at(-1).opts.body)).toEqual({ baptism_date: '1994-00-00' });
  });

  it('saves a month/day-only edit as the year-unknown sentinel', async () => {
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '' });
    ctx.__el('pvf-baptism_date');
    ctx.pvfStart('baptism_date');
    ctx.__el('pvfi-baptism_date').value = '2000-07-31';
    ctx.__el('pvfi-baptism_date-prec').value = 'monthday';
    ctx.pvfCommit('baptism_date');
    await new Promise(r => setTimeout(r, 10));
    expect(JSON.parse(ctx.__calls.at(-1).opts.body)).toEqual({ baptism_date: '0001-07-31' });
  });

  it('does not commit while focus is still inside the cell', async () => {
    // The date cell holds two controls; tabbing from picker to precision fires blur, and
    // committing there would tear the select out from under the click.
    const ctx = makeCtx();
    seedProfile(ctx, { baptism_date: '' });
    const cell = ctx.__el('pvf-baptism_date');
    ctx.pvfStart('baptism_date');
    const prec = ctx.__el('pvfi-baptism_date-prec');
    // A CHANGED value, or pvfCommit would return early on its own and the guard would
    // never be the reason nothing was sent — which is how the first version of this test
    // passed against a deliberately removed guard.
    ctx.__el('pvfi-baptism_date').value = '2000-07-31';
    prec.value = 'monthday';
    cell.contains = (n) => n === prec;

    ctx.document.activeElement = prec;
    ctx.pvfDateBlur('baptism_date');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__calls.length).toBe(0);

    ctx.document.activeElement = null;
    ctx.pvfDateBlur('baptism_date');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__calls.length).toBe(1);
    expect(JSON.parse(ctx.__calls[0].opts.body)).toEqual({ baptism_date: '0001-07-31' });
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

describe('committing a select does not crash re-rendering its own cell', () => {
  // The reported "Save failed" on gender and marital status was this, and the PATCH had
  // already succeeded. Replacing the cell removes the still-focused <select>, the browser
  // fires blur synchronously mid-assignment, that blur re-enters pvfCommit -> pvfCancel,
  // and the nested innerHTML set throws "The node to be removed is no longer a child of
  // this node". A <select> commits from onchange so it is still focused; a text input
  // commits from onblur and is not — which is why only the two selects were reported.
  // `onReplace` stands in for the browser's synchronous blur: assigning innerHTML removes
  // the focused control, and the blur handler runs before the assignment finishes.
  // Throwing on a nested assignment is what a real DOM does here.
  function cellThatBlursOnRerender(ctx, id, onReplace) {
    const cell = ctx.__el('pvf-' + id);
    let depth = 0, maxDepth = 0, raw = '';
    Object.defineProperty(cell, 'innerHTML', {
      configurable: true,
      get() { return raw; },
      set(v) {
        depth++; maxDepth = Math.max(maxDepth, depth);
        if (depth > 1) { depth--; throw new Error('The node to be removed is no longer a child of this node'); }
        raw = v;
        try { onReplace(); } finally { depth--; }
      },
    });
    return () => maxDepth;
  }

  it('pvfCancel refuses to re-enter itself mid-assignment', () => {
    // Targets the pvfCancel guard on its own. The re-entrant call is what the reported
    // DOMException came out of, so it must be stopped here and not only upstream.
    const ctx = makeCtx();
    seedProfile(ctx);
    const maxDepth = cellThatBlursOnRerender(ctx, 'gender', () => ctx.pvfCancel('gender'));
    expect(() => ctx.pvfCancel('gender')).not.toThrow();
    expect(maxDepth()).toBe(1);
  });

  it('holds the commit guard up across the re-render', async () => {
    // Targets the ordering on its own: the guard used to be cleared before pvfCancel, so
    // the blur that pvfCancel triggers re-entered pvfCommit instead of being turned away.
    const ctx = makeCtx();
    seedProfile(ctx);
    let guardDuringRender = null;
    cellThatBlursOnRerender(ctx, 'gender', () => { guardDuringRender = ctx._pvfCommitting.gender; });
    ctx.pvfStart('gender');
    ctx.__el('pvfi-gender').value = 'Female';
    ctx.pvfCommit('gender');
    await new Promise(r => setTimeout(r, 10));
    expect(guardDuringRender).toBe(true);
  });

  it('completes the whole commit without alerting', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    const maxDepth = cellThatBlursOnRerender(ctx, 'gender', () => ctx.pvfCommit('gender'));
    ctx.pvfStart('gender');
    ctx.__el('pvfi-gender').value = 'Female';
    ctx.pvfCommit('gender');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__alerts).toEqual([]);
    expect(maxDepth()).toBe(1);
    expect(ctx._currentPvPerson.gender).toBe('Female');
  });

  it('leaves the field committable again afterwards', async () => {
    // The guard is cleared after the re-render, not before — but it must still be cleared,
    // or the field would silently refuse every later edit.
    const ctx = makeCtx();
    seedProfile(ctx);
    cellThatBlursOnRerender(ctx, 'gender', () => ctx.pvfCommit('gender'));
    ctx.pvfStart('gender');
    ctx.__el('pvfi-gender').value = 'Female';
    ctx.pvfCommit('gender');
    await new Promise(r => setTimeout(r, 10));

    ctx.__el('pvfi-gender').value = 'Male';
    ctx.pvfCommit('gender');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx._currentPvPerson.gender).toBe('Male');
    expect(ctx.__calls.length).toBe(2);
  });
});

describe('the inline editor surfaces why a save failed', () => {
  it('includes the reason instead of a bare "Save failed"', async () => {
    const ctx = makeCtx();
    seedProfile(ctx);
    ctx.__el('pvf-gender');
    ctx.pvfStart('gender');
    ctx.__el('pvfi-gender').value = 'Female';
    // Not JSON — which is exactly the shape that reaches the catch and produced the
    // reasonless alert that was reported.
    ctx.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('Unexpected token < in JSON')) });
    ctx.pvfCommit('gender');
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.__alerts.join('')).toContain('Unexpected token');
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
  // behaviour is pinned rather than assumed.
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
