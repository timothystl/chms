import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleIntakeApi } from '../src/api-intake.js';

// A website contact-form submission (POST /api/intake/connect-card) must NOT create a new
// `people` row -- staff reported the directory filling up with one-off/spam website
// contacts nobody actually added. It should only ever link to an EXISTING active person by
// email, and always store the submitter's own name/email/phone on the follow-up item itself
// so staff can see and reply to them without opening a person record.

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
        run() { const r = st.run(...binds); return Promise.resolve({ meta: { last_row_id: r.lastInsertRowid } }); },
      };
      return api;
    },
  };
  raw.exec(`
    CREATE TABLE people(id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
      phone TEXT, member_type TEXT, status TEXT, active INTEGER, first_contact_date TEXT,
      followup_status TEXT);
    CREATE TABLE follow_up_items(id INTEGER PRIMARY KEY, person_id INTEGER, type TEXT, notes TEXT,
      due_date TEXT DEFAULT '', completed INTEGER DEFAULT 0, completed_at TEXT DEFAULT '',
      created_at TEXT, requester_name TEXT DEFAULT '', requester_email TEXT DEFAULT '',
      requester_phone TEXT DEFAULT '');
    CREATE TABLE prayer_requests(id INTEGER PRIMARY KEY, person_id INTEGER, requester_name TEXT,
      requester_email TEXT, request_text TEXT, source TEXT, submitted_at TEXT, status TEXT);
    CREATE TABLE funds(id INTEGER PRIMARY KEY, name TEXT, active INTEGER, sort_order INTEGER);

    INSERT INTO people (id,first_name,last_name,email,phone,member_type,status,active) VALUES
      (1,'Kelly','Schallon','kelly@example.org','','Member','active',1);
  `);
  // RSVP_STORE backs the intake rate limiter, which fails CLOSED (429) when unbound (P22-E) —
  // a fake KV store here so these tests exercise the real handler, not the missing-binding path.
  const kv = new Map();
  const rsvpStore = {
    get: (k) => Promise.resolve(kv.has(k) ? kv.get(k) : null),
    put: (k, v) => { kv.set(k, v); return Promise.resolve(); },
  };
  return { DB: db, CHMS_INTAKE_API_KEY: 'testkey', RSVP_STORE: rsvpStore };
}

function req(body, headers) {
  return {
    method: 'POST',
    headers: {
      get(name) {
        const h = { 'X-Intake-Key': 'testkey', 'Content-Length': '', ...headers };
        return h[name] ?? null;
      },
    },
    json: () => Promise.resolve(body),
  };
}

describe('POST /api/intake/connect-card', () => {
  it('does NOT create a new person for an unrecognized email', async () => {
    const env = makeDb();
    const before = (await env.DB.prepare('SELECT COUNT(*) c FROM people').first()).c;
    const res = await handleIntakeApi(
      req({ name: 'New Stranger', email: 'stranger@example.org', message: 'hello there' }),
      env, '/api/intake/connect-card'
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.person_id).toBeNull();
    const after = (await env.DB.prepare('SELECT COUNT(*) c FROM people').first()).c;
    expect(after).toBe(before); // no new person row
  });

  it('stores the submitter name/email/phone on the follow-up item', async () => {
    const env = makeDb();
    await handleIntakeApi(
      req({ name: 'Kelly Schallon', email: 'kelly-new@example.org', phone: '(314) 555-0199', message: 'Was hoping to see if you had records of my baptism' }),
      env, '/api/intake/connect-card'
    );
    const row = await env.DB.prepare('SELECT * FROM follow_up_items ORDER BY id DESC LIMIT 1').first();
    expect(row.requester_name).toBe('Kelly Schallon');
    expect(row.requester_email).toBe('kelly-new@example.org');
    expect(row.requester_phone).toBe('(314) 555-0199');
    expect(row.notes).toContain('Was hoping to see if you had records');
    expect(row.person_id).toBeNull();
  });

  it('links to an existing active person by email instead of creating one', async () => {
    const env = makeDb();
    const res = await handleIntakeApi(
      req({ name: 'Kelly Schallon', email: 'kelly@example.org', message: 'baptism records please' }),
      env, '/api/intake/connect-card'
    );
    const body = await res.json();
    expect(body.person_id).toBe(1);
    const row = await env.DB.prepare('SELECT * FROM follow_up_items ORDER BY id DESC LIMIT 1').first();
    expect(row.person_id).toBe(1);
    expect(row.requester_email).toBe('kelly@example.org');
  });
});
