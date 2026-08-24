import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { authCookieHeader } from '../src/auth.js';

// Incident, 2026-08-03: an admin changed their OWN account's role to member and was instantly
// locked out — every /admin/api/users route requires role='admin', so the next request 403'd
// and there was no way to undo it from inside the app. Recovery required the ADMIN_PASSWORD
// break-glass login. Demoting or deleting the last remaining admin is the same failure with a
// wider blast radius: nobody is left who can reverse it.
//
// These run the real handleAdminApi against real SQLite.

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
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
  };
  return { db, sqlite };
}

let db, sqlite, env;
beforeEach(() => {
  ({ db, sqlite } = makeDb());
  env = { DB: db, ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET };
  sqlite.exec(`INSERT INTO app_users (username, role, active) VALUES
    ('andrew','admin',1), ('betty','admin',1), ('carl','staff',1)`);
});

const idOf = (u) => sqlite.prepare('SELECT id FROM app_users WHERE username=?').get(u).id;
const roleOf = (u) => sqlite.prepare('SELECT role FROM app_users WHERE username=?').get(u).role;
const activeOf = (u) => sqlite.prepare('SELECT active FROM app_users WHERE username=?').get(u).active;

/** Call the real admin API as `asUser` (empty string = break-glass ADMIN_PASSWORD session). */
async function call(asUser, path, method, body) {
  const cookie = (await authCookieHeader(env, 'admin', asUser)).split(';')[0];
  const url = new URL('https://connect.timothystl.org/admin/api/' + path);
  const req = new Request(url, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleAdminApi(req, env, url, method);
  return { status: res.status, body: await res.json() };
}

describe('self-lockout guards', () => {
  it('refuses to let an admin demote their own account — the reported incident', async () => {
    const r = await call('andrew', 'users/' + idOf('andrew'), 'PUT', { role: 'member' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/your own role/i);
    expect(roleOf('andrew')).toBe('admin'); // unchanged
  });

  it('refuses to let an admin deactivate their own account', async () => {
    const r = await call('andrew', 'users/' + idOf('andrew'), 'PUT', { active: false });
    expect(r.status).toBe(400);
    expect(activeOf('andrew')).toBe(1);
  });

  it('refuses to let an admin delete their own account', async () => {
    const r = await call('andrew', 'users/' + idOf('andrew'), 'DELETE');
    expect(r.status).toBe(400);
    expect(roleOf('andrew')).toBe('admin');
  });

  it('still allows an admin to edit their own name, email and password', async () => {
    const r = await call('andrew', 'users/' + idOf('andrew'), 'PUT', {
      display_name: 'Andrew D', email: 'a@timothystl.org',
    });
    expect(r.status).toBe(200);
    expect(sqlite.prepare('SELECT display_name FROM app_users WHERE username=?').get('andrew').display_name).toBe('Andrew D');
  });

  it('still allows re-affirming your own role as admin (a no-op, not a demotion)', async () => {
    expect((await call('andrew', 'users/' + idOf('andrew'), 'PUT', { role: 'admin' })).status).toBe(200);
  });
});

describe('last-admin guards', () => {
  it('lets one admin demote another while a second admin remains', async () => {
    const r = await call('andrew', 'users/' + idOf('betty'), 'PUT', { role: 'staff' });
    expect(r.status).toBe(200);
    expect(roleOf('betty')).toBe('staff');
  });

  // Worth stating explicitly: for a NORMAL admin caller this guard is unreachable, because the
  // caller is themselves an active admin — demoting somebody else can never leave zero. The
  // reachable cases are the break-glass session (no app_users row, so it isn't counted) and
  // self-demotion, which the self-guard above catches first with a clearer message. Keeping the
  // guard anyway: it's the backstop if either of those assumptions ever changes.
  it('refuses to demote the last active admin (via the uncounted break-glass session)', async () => {
    await call('andrew', 'users/' + idOf('betty'), 'PUT', { role: 'staff' }); // andrew now sole admin
    const r = await call('', 'users/' + idOf('andrew'), 'PUT', { role: 'staff' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only active administrator/i);
    expect(roleOf('andrew')).toBe('admin');
  });

  it('refuses to deactivate or delete the last active admin', async () => {
    await call('andrew', 'users/' + idOf('betty'), 'PUT', { role: 'staff' });
    expect((await call('', 'users/' + idOf('andrew'), 'PUT', { active: false })).status).toBe(400);
    expect((await call('', 'users/' + idOf('andrew'), 'DELETE')).status).toBe(400);
    expect(activeOf('andrew')).toBe(1);
  });

  it('does not count a deactivated admin as a remaining admin', async () => {
    sqlite.exec(`UPDATE app_users SET active=0 WHERE username='betty'`);
    const r = await call('', 'users/' + idOf('andrew'), 'PUT', { role: 'staff' });
    expect(r.status).toBe(400);
  });

  // A demoted admin's existing session stops working immediately (SW3 live-checks the DB role
  // on every request), so they can't keep using admin routes on a stale cookie.
  it('immediately 403s a demoted admin on their next request', async () => {
    await call('andrew', 'users/' + idOf('betty'), 'PUT', { role: 'staff' });
    const r = await call('betty', 'users/' + idOf('carl'), 'PUT', { role: 'admin' });
    expect(r.status).toBe(403);
  });
});

describe('break-glass session is never blocked by the self-guards', () => {
  // The ADMIN_PASSWORD login has no app_users row (username ''), so it must stay able to
  // repair exactly the lockout these guards exist to prevent.
  it('can demote any account, including the last admin', async () => {
    await call('andrew', 'users/' + idOf('betty'), 'PUT', { role: 'staff' });
    const r = await call('', 'users/' + idOf('andrew'), 'PUT', { role: 'member' });
    expect(r.status).toBe(400); // last-admin guard still applies — it protects the org, not self
    // ...but promoting someone first clears the way, which is the documented recovery.
    expect((await call('', 'users/' + idOf('carl'), 'PUT', { role: 'admin' })).status).toBe(200);
    expect((await call('', 'users/' + idOf('andrew'), 'PUT', { role: 'member' })).status).toBe(200);
    expect(roleOf('andrew')).toBe('member');
  });

  it('can restore a locked-out admin — the actual recovery path', async () => {
    sqlite.exec(`UPDATE app_users SET role='member' WHERE username='andrew'`);
    const r = await call('', 'users/' + idOf('andrew'), 'PUT', { role: 'admin' });
    expect(r.status).toBe(200);
    expect(roleOf('andrew')).toBe('admin');
  });
});

describe('unchanged behavior', () => {
  it('still returns 403 for a non-admin caller', async () => {
    const cookie = (await authCookieHeader(env, 'member', 'carl')).split(';')[0];
    sqlite.exec(`UPDATE app_users SET role='member' WHERE username='carl'`);
    const url = new URL('https://connect.timothystl.org/admin/api/users');
    const res = await handleAdminApi(new Request(url, { headers: { cookie } }), env, url, 'GET');
    expect(res.status).toBe(403);
  });

  it('404s on a user id that does not exist', async () => {
    expect((await call('andrew', 'users/9999', 'PUT', { role: 'staff' })).status).toBe(404);
    expect((await call('andrew', 'users/9999', 'DELETE')).status).toBe(404);
  });
});
