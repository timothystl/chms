import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// Register import safety, added after a live incident (2026-08-26): the "Delete existing
// records of this type before importing" checkbox on the Register Import tool was checked
// for a Baptism import and wiped ~1,700 existing baptism entries down to the 594 rows in the
// new file, with no confirmation and no undo short of a full Cloudflare D1 point-in-time
// restore. That destructive path (POST /admin/api/register/clear, and the frontend checkbox
// that called it) is now removed entirely. In its place, POST /admin/api/register/batch
// skips any row that already matches an existing entry (same type + event_date + name) instead
// of inserting a duplicate -- an import can add new records or safely no-op on ones already on
// file, but it can never delete or double up what's already there.

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
  `);
  return db;
}

function jreq(method, body) {
  return { method, json: () => Promise.resolve(body) };
}

const NOOP_FLAGS = [true, true, true, true]; // isAdmin, isFinance, isStaff, canEdit

describe('register/batch import safety', () => {
  it('imports new rows normally', async () => {
    const db = makeDb();
    const rows = [
      { type: 'baptism', event_date: '1990-05-01', name: 'Jane Doe', officiant: 'Rev. Smith' },
      { type: 'baptism', event_date: '1991-06-02', name: 'John Roe', officiant: 'Rev. Smith' },
    ];
    const res = await handleImportApi(jreq('POST', rows), {}, new URL('http://x/register/batch'), 'POST', 'register/batch', db, ...NOOP_FLAGS);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.duplicates).toBe(0);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(2);
  });

  it('skips a row that already matches an existing entry instead of duplicating it', async () => {
    const db = makeDb();
    await db.prepare(
      `INSERT INTO church_register (type,event_date,name) VALUES (?,?,?)`
    ).bind('baptism', '1990-05-01', 'Jane Doe').run();

    const rows = [
      { type: 'baptism', event_date: '1990-05-01', name: 'Jane Doe', officiant: 'Rev. Smith' }, // exact dup
      { type: 'baptism', event_date: '1990-05-01', name: '  jane doe  ', officiant: 'Rev. Smith' }, // whitespace/case variant, still a dup
      { type: 'baptism', event_date: '1992-01-01', name: 'New Person', officiant: 'Rev. Smith' }, // genuinely new
    ];
    const res = await handleImportApi(jreq('POST', rows), {}, new URL('http://x/register/batch'), 'POST', 'register/batch', db, ...NOOP_FLAGS);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.duplicates).toBe(2);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(2); // the original + the one genuinely new row, never 4
  });

  it('never inserts two copies of the same row within one import batch', async () => {
    const db = makeDb();
    const rows = [
      { type: 'baptism', event_date: '1990-05-01', name: 'Jane Doe' },
      { type: 'baptism', event_date: '1990-05-01', name: 'Jane Doe' }, // same row appears twice in the file
    ];
    const res = await handleImportApi(jreq('POST', rows), {}, new URL('http://x/register/batch'), 'POST', 'register/batch', db, ...NOOP_FLAGS);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.duplicates).toBe(1);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(1);
  });

  it('re-importing an entire file that overlaps existing data adds nothing new and deletes nothing', async () => {
    const db = makeDb();
    const rows = [
      { type: 'baptism', event_date: '1990-05-01', name: 'Jane Doe' },
      { type: 'baptism', event_date: '1991-06-02', name: 'John Roe' },
    ];
    await handleImportApi(jreq('POST', rows), {}, new URL('http://x/register/batch'), 'POST', 'register/batch', db, ...NOOP_FLAGS);
    // Re-run the exact same import a second time, as if the file were re-uploaded by mistake.
    const res2 = await handleImportApi(jreq('POST', rows), {}, new URL('http://x/register/batch'), 'POST', 'register/batch', db, ...NOOP_FLAGS);
    const body2 = await res2.json();
    expect(body2.imported).toBe(0);
    expect(body2.duplicates).toBe(2);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(2);
  });

  it('the destructive register/clear route no longer exists', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register (type,event_date,name) VALUES (?,?,?)`)
      .bind('baptism', '1990-05-01', 'Jane Doe').run();
    const res = await handleImportApi(
      jreq('POST', { type: 'baptism' }), {}, new URL('http://x/register/clear'), 'POST', 'register/clear', db, ...NOOP_FLAGS
    );
    // Falls through to the generic 404 rather than returning an {ok:true} wipe response.
    expect(res.status).toBe(404);
    const count = (await db.prepare('SELECT COUNT(*) as c FROM church_register').all()).results[0].c;
    expect(count).toBe(1); // untouched
  });
});
