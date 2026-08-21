import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleApiEvents, handleSignup } from '../src/api-scheduler.js';

// Before this fix, a hidden event's short link fell all the way through the
// Worker's routing to the auth-gated scheduler block and answered a bare
// `{"error":"Unauthorized"}` — a dead end for a public visitor. The fix is
// that a hidden event still resolves (GET /api/events now includes it, with
// its `hidden` flag intact) so the page itself can render a locked
// "registrations are on hold" state instead. This file covers the two
// backend halves of that: the public events feed still names hidden events,
// and a direct POST to sign up for one is refused server-side too — the lock
// has to hold even if a stale tab or a replayed request bypasses the UI.

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE serve_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_time_slots INTEGER NOT NULL DEFAULT 1
  )`);
  sqlite.exec(`CREATE TABLE serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    slots INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    role_date TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    lead TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    role_id INTEGER,
    ministry TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT '[]',
    service TEXT NOT NULL DEFAULT '',
    sundays TEXT NOT NULL DEFAULT '[]',
    shirt_wanted INTEGER NOT NULL DEFAULT 0,
    shirt_size TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sms_reminder_opt_in INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE signup_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signup_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args) || null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get() || null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    _raw: sqlite,
  };
}

function makeReq(body) {
  return { json: async () => body, headers: { get: () => null } };
}

function seedEvent(db, name, hidden) {
  const r = db._raw.prepare('INSERT INTO serve_events (name,hidden) VALUES (?,?)').run(name, hidden ? 1 : 0);
  return Number(r.lastInsertRowid);
}

describe('GET /api/events includes hidden events', () => {
  it('returns a hidden event with hidden:1, not omitted', async () => {
    const db = makeTestDb();
    seedEvent(db, 'Open Event', 0);
    seedEvent(db, 'Paused Event', 1);
    const res = await handleApiEvents({ DB: db });
    const body = await res.json();
    expect(body.events.map(e => e.name).sort()).toEqual(['Open Event', 'Paused Event']);
    const paused = body.events.find(e => e.name === 'Paused Event');
    expect(paused.hidden).toBe(1);
    const open = body.events.find(e => e.name === 'Open Event');
    expect(open.hidden).toBe(0);
  });
});

describe('POST /serve/signup refuses a hidden event server-side', () => {
  it('409s and writes no signup row for a hidden event', async () => {
    const db = makeTestDb();
    const evId = seedEvent(db, 'Paused Event', 1);
    const res = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: evId }), { DB: db });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/on hold/i);
    const rows = db._raw.prepare('SELECT * FROM signups').all();
    expect(rows.length).toBe(0);
  });

  it('still accepts a signup for a non-hidden event', async () => {
    const db = makeTestDb();
    const evId = seedEvent(db, 'Open Event', 0);
    const res = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: evId }), { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const rows = db._raw.prepare('SELECT * FROM signups').all();
    expect(rows.length).toBe(1);
  });

  it('leaves the off-event (ministry-role, no event_id) signup path untouched', async () => {
    const db = makeTestDb();
    const res = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', ministry: 'worship', roles: ['Worship: Usher'] }), { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
