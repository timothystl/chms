import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { handleChmsApi } from '../src/api-chms.js';
import { authCookieHeader } from '../src/auth.js';

// A new "volunteer" role: a narrow, read-only tester/manager account for the public
// sign-up flow, requested so someone testing the Christmas Market registration can log
// into Connect and see it land under Volunteers -> Signups without being handed a full
// staff account. It sees ONLY the Volunteers screen (Signups / Ministry Roles / Events /
// Templates), read-only — every write on that surface still requires admin/staff, and
// everything else in the app (People, Giving, Reports, ...) is denied outright.
//
// Reads on events/signups/ministry-roles/templates were already open to any authenticated
// role before this change (only writes were admin/staff-gated) — these tests pin that this
// role rides that existing pattern correctly, and that it is denied everywhere else, both
// through the real handleAdminApi/handleChmsApi dispatch with a real HMAC-signed cookie.

const SECRET = 'test-signing-secret';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  )`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  sqlite.exec(`CREATE TABLE serve_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_time_slots INTEGER NOT NULL DEFAULT 1,
    slug TEXT
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
    event_id INTEGER, role_id INTEGER, ministry TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT '[]', service TEXT NOT NULL DEFAULT '', sundays TEXT NOT NULL DEFAULT '[]',
    shirt_wanted INTEGER NOT NULL DEFAULT 0, shirt_size TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), person_id INTEGER DEFAULT NULL,
    contacted_at TEXT NOT NULL DEFAULT '', contact_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new', sms_reminder_opt_in INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE signup_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, signup_id INTEGER NOT NULL, role_id INTEGER NOT NULL)`);
  sqlite.exec(`CREATE TABLE ministry_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ministry TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', commitment TEXT NOT NULL DEFAULT '', training TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(`CREATE TABLE volunteer_email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', ministry TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    batch(stmts) { return Promise.all(stmts.map(s => s.run())); },
  };
  return { db, sqlite };
}

let db, sqlite, env;
beforeEach(() => {
  ({ db, sqlite } = makeDb());
  env = { DB: db, ADMIN_PASSWORD: SECRET };
  sqlite.exec(`INSERT INTO serve_events (name) VALUES ('Christmas Market')`);
  sqlite.exec(`INSERT INTO ministry_roles (ministry, name) VALUES ('worship', 'Usher')`);
  sqlite.exec(`INSERT INTO signups (name, email, ministry) VALUES ('Jane Tester', 'jane@example.com', 'events')`);
});

async function cookieFor(role) {
  return (await authCookieHeader(env, role)).split(';')[0];
}

async function call(role, path, method, body) {
  const cookie = await cookieFor(role);
  const url = new URL('https://connect.timothystl.org/admin/api/' + path);
  const req = new Request(url, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleAdminApi(req, env, url, method);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

describe('volunteer role — reads its own screen', () => {
  it('can read Events', async () => {
    const r = await call('volunteer', 'events', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.events.map(e => e.name)).toContain('Christmas Market');
  });

  it('can read Signups', async () => {
    const r = await call('volunteer', 'signups', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.signups.map(s => s.email)).toContain('jane@example.com');
  });

  it('can read Ministry Roles', async () => {
    const r = await call('volunteer', 'ministry-roles', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.roles.map(x => x.name)).toContain('Usher');
  });

  it('can read Volunteer Email Templates', async () => {
    const r = await call('volunteer', 'volunteer-templates', 'GET');
    expect(r.status).toBe(200);
  });

  it('shows up correctly at GET /admin/api/me', async () => {
    const r = await call('volunteer', 'me', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('volunteer');
    expect(r.body.display_name).toBe('Volunteer (read-only)');
    // Not part of the configurable matrix — every item resolves to 'none', same as an
    // unrecognized role. Its real access (Volunteers) isn't gated through this at all.
    expect(Object.values(r.body.permissions)).toEqual(Object.values(r.body.permissions).map(() => 'none'));
  });
});

describe('volunteer role — cannot write on its own screen', () => {
  it('403s creating an event', async () => {
    const r = await call('volunteer', 'events', 'POST', { name: 'New Event' });
    expect(r.status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM serve_events').get().n).toBe(1);
  });

  it('403s changing a signup status', async () => {
    const id = sqlite.prepare('SELECT id FROM signups WHERE email=?').get('jane@example.com').id;
    const r = await call('volunteer', `signups/${id}/status`, 'PUT', { status: 'contacted' });
    expect(r.status).toBe(403);
    expect(sqlite.prepare('SELECT status FROM signups WHERE id=?').get(id).status).toBe('new');
  });

  it('403s creating a ministry role', async () => {
    const r = await call('volunteer', 'ministry-roles', 'POST', { name: 'Greeter', ministry: 'worship' });
    expect(r.status).toBe(403);
  });

  it('403s deleting a signup', async () => {
    const id = sqlite.prepare('SELECT id FROM signups WHERE email=?').get('jane@example.com').id;
    const r = await call('volunteer', `signups/${id}`, 'DELETE');
    expect(r.status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM signups').get().n).toBe(1);
  });
});

describe('volunteer role — denied everywhere else', () => {
  it('403s GET /admin/api/people (handleChmsApi deny)', async () => {
    const r = await call('volunteer', 'people', 'GET');
    expect(r.status).toBe(403);
  });

  it('handleChmsApi itself refuses the volunteer role directly, regardless of segment', async () => {
    const cookie = await cookieFor('volunteer');
    const req = new Request('https://connect.timothystl.org/admin/api/dashboard', { headers: { cookie } });
    const res = await handleChmsApi(req, env, new URL(req.url), 'GET', 'dashboard', 'volunteer');
    expect(res.status).toBe(403);
  });

  it('403s the Users management screen', async () => {
    const r = await call('volunteer', 'users', 'GET');
    expect(r.status).toBe(403);
  });
});

describe('creating a volunteer account', () => {
  it('an admin can create a user with role=volunteer', async () => {
    const r = await call('admin', 'users', 'POST', { username: 'tester1', password: 'a-real-password', role: 'volunteer' });
    expect(r.status).toBe(200);
    expect(sqlite.prepare('SELECT role FROM app_users WHERE username=?').get('tester1').role).toBe('volunteer');
  });

  it('an unrecognized role on create still falls back to staff, not volunteer by accident', async () => {
    const r = await call('admin', 'users', 'POST', { username: 'tester2', password: 'a-real-password', role: 'bogus' });
    expect(r.status).toBe(200);
    expect(sqlite.prepare('SELECT role FROM app_users WHERE username=?').get('tester2').role).toBe('staff');
  });
});
