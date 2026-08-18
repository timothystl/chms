import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleSignup } from '../src/api-scheduler.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as
// test/market-signup-summary.test.js / test/scheduler-volunteers.test.js —
// real SQL, not a hand-rolled mock.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slots INTEGER NOT NULL DEFAULT 0,
    role_date TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT ''
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

function seedRole(db, eventId, name, slots, date) {
  const r = db._raw.prepare('INSERT INTO serve_roles (event_id,name,slots,role_date,start_time,end_time) VALUES (?,?,?,?,?,?)')
    .run(eventId, name, slots, date, '9:00 AM', '11:00 AM');
  return Number(r.lastInsertRowid);
}

describe('handleSignup — additional shifts / additional ways to serve', () => {
  it('adds a second time-slotted shift to the same event instead of rejecting the resubmit', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const roleA = seedRole(db, 1, 'Setup Crew', 5, '2026-12-04');
    const roleB = seedRole(db, 1, 'Cashier', 2, '2026-12-05');

    const r1 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleA] }), env);
    const b1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(b1.ok).toBe(true);
    expect(b1.merged).toBe(false);
    expect(b1.all_role_ids).toEqual([roleA]);

    // Same person, same event, DIFFERENT shift — must not be 409'd.
    const r2 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'JANE@example.com', event_id: 1, role_ids: [roleB] }), env);
    const b2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(b2.ok).toBe(true);
    expect(b2.signup_id).toBe(b1.signup_id);
    expect(b2.merged).toBe(true);
    expect(b2.already_signed_up).toBe(false);
    expect(b2.all_role_ids.sort()).toEqual([roleA, roleB].sort());

    // Only one signups row exists for this person+event — a real merge,
    // not a second disconnected row.
    const count = await env.DB.prepare('SELECT COUNT(*) as n FROM signups WHERE email=? AND event_id=1').bind('jane@example.com').first();
    expect(count.n).toBe(1);
    const slots = await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(b1.signup_id).all();
    expect(slots.results.map(r => r.role_id).sort()).toEqual([roleA, roleB].sort());
  });

  it('re-submitting the exact same shift again is a no-op, not a duplicate slot row', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const roleA = seedRole(db, 1, 'Setup Crew', 5, '2026-12-04');
    const r1 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleA] }), env);
    const b1 = await r1.json();

    const r2 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleA] }), env);
    const b2 = await r2.json();
    expect(b2.ok).toBe(true);
    expect(b2.merged).toBe(false);
    expect(b2.already_signed_up).toBe(true);
    expect(b2.all_role_ids).toEqual([roleA]);

    const slots = await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(b1.signup_id).all();
    expect(slots.results.length).toBe(1);
  });

  it('still blocks a NEW shift request when that shift is full, even for someone already signed up for the event', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const roleA = seedRole(db, 1, 'Setup Crew', 5, '2026-12-04');
    const roleFull = seedRole(db, 1, 'Cashier', 1, '2026-12-05');
    await handleSignup(makeReq({ name: 'Someone Else', email: 'other@example.com', event_id: 1, role_ids: [roleFull] }), env);

    const r1 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleA] }), env);
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);

    const r2 = await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleFull] }), env);
    expect(r2.status).toBe(409);
    const b2 = await r2.json();
    expect(b2.ok).toBe(false);
  });

  it('merges an additional ministry role (a different way to serve) into one signup instead of a new row', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const r1 = await handleSignup(makeReq({ name: 'Bob Smith', email: 'bob@example.com', ministry: 'worship', roles: ['Usher'] }), env);
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);
    expect(b1.merged).toBe(false);

    const r2 = await handleSignup(makeReq({ name: 'Bob Smith', email: 'bob@example.com', ministry: 'education', roles: ['Sunday School Teacher'] }), env);
    const b2 = await r2.json();
    expect(b2.ok).toBe(true);
    expect(b2.signup_id).toBe(b1.signup_id);
    expect(b2.merged).toBe(true);
    expect(b2.all_roles).toEqual(['Usher', 'Sunday School Teacher']);

    const count = await env.DB.prepare("SELECT COUNT(*) as n FROM signups WHERE email=? AND (event_id IS NULL OR event_id=0)").bind('bob@example.com').first();
    expect(count.n).toBe(1);
    const row = await env.DB.prepare('SELECT ministry FROM signups WHERE id=?').bind(b1.signup_id).first();
    expect(row.ministry).toContain('worship');
    expect(row.ministry).toContain('education');
  });

  it('a brand-new email still creates its own fresh signup', async () => {
    const db = makeTestDb();
    const env = { DB: db };
    const roleA = seedRole(db, 1, 'Setup Crew', 5, '2026-12-04');
    await handleSignup(makeReq({ name: 'Jane Doe', email: 'jane@example.com', event_id: 1, role_ids: [roleA] }), env);
    const r2 = await handleSignup(makeReq({ name: 'Someone New', email: 'new@example.com', event_id: 1, role_ids: [roleA] }), env);
    const b2 = await r2.json();
    expect(b2.merged).toBe(false);
    expect(b2.already_signed_up).toBe(false);
    const count = await env.DB.prepare('SELECT COUNT(*) as n FROM signups WHERE event_id=1').first();
    expect(count.n).toBe(2);
  });
});
