import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { handleChmsApi } from '../src/api-chms.js';
import { authCookieHeader } from '../src/auth.js';

// A new "compensation" role: view+edit access to the Compensation Planner sub-tab of the
// Finance module only, and nothing else in the app — requested so someone who helps plan
// staff pay can log in and work the Compensation Planner without a full finance/staff/admin
// account. Modeled on the volunteer role's "structurally separate, hardcoded" shape (see
// test/volunteer-role.test.js), not the configurable finance/staff/council matrix.
//
// Its one write, the salary planner, is forked into its own chms_config key so it can never
// overwrite the shared admin/finance roster (see api-finance.js).

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
  sqlite.exec(`CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  sqlite.exec(`CREATE TABLE finance_qb_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    realm_id TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    access_token_expires_at TEXT NOT NULL DEFAULT '',
    refresh_token_expires_at TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT 'production',
    connected_at TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT ''
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
  env = { DB: db, ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET };
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

describe('compensation role — GET /admin/api/me', () => {
  it('resolves finance:view and everything else none, so only the Finance sidebar item renders', async () => {
    const r = await call('compensation', 'me', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('compensation');
    expect(r.body.display_name).toBe('Compensation (Compensation Planner only)');
    expect(r.body.permissions.finance).toBe('view');
    expect(r.body.permissions.giving).toBe('none');
    expect(r.body.permissions.attendance).toBe('none');
    expect(r.body.permissions.reports).toBe('none');
  });
});

describe('compensation role — Compensation Planner access', () => {
  it('can read finance/status (part of the bootstrap the tab needs)', async () => {
    const r = await call('compensation', 'finance/status', 'GET');
    expect(r.status).toBe(200);
  });

  it('can read the salary planner (empty roster, nothing saved yet)', async () => {
    const r = await call('compensation', 'finance/planning/salary', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.data).toBe(null);
  });

  it('can save the salary planner, and it is stored under its own key, not the shared one', async () => {
    const r = await call('compensation', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Test Worker' }] });
    expect(r.status).toBe(200);
    expect(sqlite.prepare("SELECT value FROM finance_settings WHERE key='finance_salary_planner_compensation'").get()).toBeTruthy();
    expect(sqlite.prepare("SELECT value FROM finance_settings WHERE key='finance_salary_planner'").get()).toBeFalsy();
  });

  it('a compensation save never overwrites the shared admin/finance roster', async () => {
    await call('admin', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }] });
    await call('compensation', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Compensation Draft Worker' }] });
    const adminRead = await call('admin', 'finance/planning/salary', 'GET');
    expect(adminRead.body.data.roster[0].name).toBe('Admin Worker');
    const compRead = await call('compensation', 'finance/planning/salary', 'GET');
    expect(compRead.body.data.roster[0].name).toBe('Compensation Draft Worker');
  });

  it('until it has saved, it reads the same shared roster everyone else starts from', async () => {
    await call('admin', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }] });
    const r = await call('compensation', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster[0].name).toBe('Admin Worker');
  });
});

describe('compensation role — denied everywhere else', () => {
  it('403s GET /admin/api/people', async () => {
    const r = await call('compensation', 'people', 'GET');
    expect(r.status).toBe(403);
  });

  it('403s the rest of the Finance module (e.g. Church Report balances)', async () => {
    const r = await call('compensation', 'finance/church/balances', 'GET');
    expect(r.status).toBe(403);
  });

  it('403s connecting QuickBooks (GET method, but not on the allowlist)', async () => {
    const r = await call('compensation', 'finance/qb/connect', 'GET');
    expect(r.status).toBe(403);
  });

  it('403s writing to the church budget plan', async () => {
    const r = await call('compensation', 'finance/planning/church/override', 'POST', { category: 'Expenses:Utilities', year: 2027, amount: 100 });
    expect(r.status).toBe(403);
  });

  it('403s the Users management screen', async () => {
    const r = await call('compensation', 'users', 'GET');
    expect(r.status).toBe(403);
  });

  it('handleChmsApi itself refuses an unlisted segment directly, regardless of method', async () => {
    const cookie = await cookieFor('compensation');
    const req = new Request('https://connect.timothystl.org/admin/api/dashboard', { headers: { cookie } });
    const res = await handleChmsApi(req, env, new URL(req.url), 'GET', 'dashboard', 'compensation');
    expect(res.status).toBe(403);
  });
});

describe('creating a compensation account', () => {
  it('an admin can create a user with role=compensation', async () => {
    const r = await call('admin', 'users', 'POST', { username: 'comptester', password: 'a-real-password', role: 'compensation' });
    expect(r.status).toBe(200);
    expect(sqlite.prepare('SELECT role FROM app_users WHERE username=?').get('comptester').role).toBe('compensation');
  });
});
