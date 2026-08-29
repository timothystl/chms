import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// "Generate register entries from People" (Settings -> Import/Export -> Register Import) reads
// every baptized/confirmed person and inserts a church_register row for each one not already on
// file. It already had a duplicate check (person_id link, or exact event_date+name match) --
// but that's exactly what let 44 real duplicates through on 2026-04-16: the register's
// book-transcribed entries often carry a fuller name (middle name included) than
// `people.first_name + people.last_name` produces, e.g. "Ivan Alexander" (generated) never
// string-matched "Ivan Dean Alexander" (already in the register), so every one of those 44
// people got a second, redundant register row. Diagnosed and cleaned up by hand from production
// D1 on 2026-08-29; this closes the actual gap in the tool so it can't happen again.

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql);
      let binds = [];
      const api = {
        bind(...a) { binds = a; return api; },
        all() { return Promise.resolve({ results: st.all(...binds) }); },
        first() { return Promise.resolve(st.get(...binds) ?? null); },
        run() { const r = st.run(...binds); return Promise.resolve({ meta: { last_row_id: r.lastInsertRowid, changes: r.changes } }); },
      };
      return api;
    },
  };
  raw.exec(`
    CREATE TABLE church_register (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL DEFAULT '',
      event_date TEXT NOT NULL DEFAULT '',
      name       TEXT NOT NULL DEFAULT '',
      name2      TEXT NOT NULL DEFAULT '',
      officiant  TEXT NOT NULL DEFAULT '',
      notes      TEXT NOT NULL DEFAULT '',
      person_id  INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      record_type TEXT NOT NULL DEFAULT '',
      dob TEXT NOT NULL DEFAULT '',
      place_of_birth TEXT NOT NULL DEFAULT '',
      baptism_place TEXT NOT NULL DEFAULT '',
      father TEXT NOT NULL DEFAULT '',
      mother TEXT NOT NULL DEFAULT '',
      sponsors TEXT NOT NULL DEFAULT '',
      pdf_page TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      dob TEXT NOT NULL DEFAULT '',
      baptism_date TEXT NOT NULL DEFAULT '',
      confirmation_date TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function jreq(method, body) {
  return { method, json: () => Promise.resolve(body) };
}

const NOOP_FLAGS = [true, true, true, true]; // isAdmin, isFinance, isStaff, canEdit

async function run(db, body) {
  return handleImportApi(
    jreq('POST', body || {}), {}, new URL('http://x/import/register-from-people'),
    'POST', 'import/register-from-people', db, ...NOOP_FLAGS
  );
}

describe('import/register-from-people dedup', () => {
  it('imports a person with no existing register row', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO people (first_name,last_name,dob,baptism_date) VALUES (?,?,?,?)`)
      .bind('Jane', 'Doe', '1990-01-01', '1990-05-01').run();
    const res = await run(db, { types: ['baptism'] });
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(0);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(1);
  });

  it('skips a person already linked by person_id, even if the name differs', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO people (id,first_name,last_name,dob,baptism_date) VALUES (?,?,?,?,?)`)
      .bind(52, 'Ivan', 'Alexander', '2010-04-16', '2017-10-01').run();
    await db.prepare(`INSERT INTO church_register (type,event_date,name,dob,person_id) VALUES ('baptism',?,?,?,?)`)
      .bind('2017-10-01', 'Ivan Dean Alexander', '2010-04-16', 52).run();
    const res = await run(db, { types: ['baptism'] });
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(1);
  });

  it('reproduces and closes the exact 2026-04-16 failure: fuller book-transcribed name, unlinked, same dob+event_date', async () => {
    const db = makeDb();
    // The register already has the book-transcribed entry, with NO person_id link (this is what
    // every one of the 44 real duplicated rows looked like before the fix).
    await db.prepare(`INSERT INTO church_register (type,event_date,name,dob) VALUES ('baptism',?,?,?)`)
      .bind('2017-10-01', 'Ivan Dean Alexander', '2010-04-16').run();
    // The person record generates a shorter name that will never string-match the register row.
    await db.prepare(`INSERT INTO people (id,first_name,last_name,dob,baptism_date) VALUES (?,?,?,?,?)`)
      .bind(52, 'Ivan', 'Alexander', '2010-04-16', '2017-10-01').run();

    const res = await run(db, { types: ['baptism'] });
    const body = await res.json();
    expect(body.imported).toBe(0); // must NOT create a second "Ivan Alexander" row
    expect(body.skipped).toBe(1);
    const rows = (await db.prepare('SELECT * FROM church_register').all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ivan Dean Alexander'); // the original book row, untouched
  });

  it('does not skip a genuinely different person who happens to share a baptism date but not a dob', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register (type,event_date,name,dob) VALUES ('baptism',?,?,?)`)
      .bind('2019-11-24', 'Jadon Robert Oschwald', '2019-10-24').run();
    await db.prepare(`INSERT INTO people (id,first_name,last_name,dob,baptism_date) VALUES (?,?,?,?,?)`)
      .bind(900, 'Liam', 'Oschwald', '2018-03-02', '2019-11-24').run(); // same event_date, different dob
    const res = await run(db, { types: ['baptism'] });
    const body = await res.json();
    expect(body.imported).toBe(1); // a real second child baptized the same day is not a duplicate
    expect(body.skipped).toBe(0);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(2);
  });

  it('applies the same dob+event_date fallback to confirmation records', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register (type,event_date,name,dob) VALUES ('confirmation',?,?,?)`)
      .bind('2020-05-03', 'Samuel Andres Pozas Pozas', '2005-02-11').run();
    await db.prepare(`INSERT INTO people (id,first_name,last_name,dob,confirmation_date) VALUES (?,?,?,?,?)`)
      .bind(300, 'Sammy', 'Pozas', '2005-02-11', '2020-05-03').run();
    const res = await run(db, { types: ['confirmation'] });
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(1);
  });

  it('a blank dob on either side never matches -- never silently swallows a real new entry', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register (type,event_date,name,dob) VALUES ('baptism',?,?,?)`)
      .bind('2020-01-01', 'Someone Else', '').run(); // no dob on file
    await db.prepare(`INSERT INTO people (id,first_name,last_name,dob,baptism_date) VALUES (?,?,?,?,?)`)
      .bind(700, 'New', 'Person', '2019-01-01', '2020-01-01').run();
    const res = await run(db, { types: ['baptism'] });
    const body = await res.json();
    expect(body.imported).toBe(1);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(2);
  });
});
