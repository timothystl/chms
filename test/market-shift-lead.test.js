import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleApiEvents } from '../src/api-scheduler.js';
import { handleAdminApi } from '../src/api-admin.js';
import { authCookieHeader } from '../src/auth.js';

// The job lead is a NEW column, and it is the one field in this payload that names
// a person. These tests cover the two halves the summary endpoint's own tests
// cannot: that the coordinator's write path actually stores it, and that the
// UNAUTHENTICATED public events endpoint does not hand it out.

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
  sqlite.exec(`CREATE TABLE signup_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signup_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL
  )`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    _raw: sqlite,
  };
}

// handleAdminApi resolves the caller's role through getAuthRole, which verifies a
// real HMAC-signed cookie. Minting one with the same helper the login path uses
// means these drive the real route, role guard and all, rather than a copy of the
// handler body -- which is the only way the guard itself stays covered.
function adminReq(method, body, cookie) {
  const headers = new Map([['cookie', cookie]]);
  headers.get = Map.prototype.get.bind(headers);
  return { method, headers, json: async () => body };
}

const ENV_BASE = { ADMIN_PASSWORD: 'test-admin-password', SESSION_SECRET: 'test-session-secret' };

async function adminCookie(env, role = 'admin') {
  const set = await authCookieHeader(env, role);
  return set.split(';')[0];
}

describe('a shift carries a job lead through the coordinator write path', () => {
  let db, env;
  beforeEach(async () => {
    db = makeTestDb();
    env = { ...ENV_BASE, DB: db };
    db._raw.prepare('INSERT INTO serve_events (name) VALUES (?)').run('Christmas Market');
  });

  async function post(body) {
    const c = await adminCookie(env);
    return handleAdminApi(adminReq('POST', body, c), env,
      new URL('https://connect.timothystl.org/admin/api/events/1/roles'), 'POST');
  }
  async function put(rid, body) {
    const c = await adminCookie(env);
    return handleAdminApi(adminReq('PUT', body, c), env,
      new URL(`https://connect.timothystl.org/admin/api/events/1/roles/${rid}`), 'PUT');
  }
  const row = (id) => db._raw.prepare('SELECT * FROM serve_roles WHERE id=?').get(id);

  it('refuses the write outright without a valid admin session', async () => {
    // ⚠ Signed with a DIFFERENT key than the one the route verifies against (SESSION_SECRET,
    // per P23-A -- this used to be ADMIN_PASSWORD), so this really is an unverifiable cookie.
    // Re-pointing env.SESSION_SECRET alone would move BOTH sides and the cookie would still
    // verify -- which is exactly how a guard test passes while pinning nothing.
    const forged = await adminCookie({ SESSION_SECRET: 'a-different-signing-key' });
    const res = await handleAdminApi(
      adminReq('POST', { name: 'Kitchen', slots: 3, lead: 'Rick Vogel' }, forged), env,
      new URL('https://connect.timothystl.org/admin/api/events/1/roles'), 'POST');
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM serve_roles').get().n).toBe(0);
  });

  it('refuses a member-role session, which can read the site but not run it', async () => {
    const memberCookie = await adminCookie(env, 'member');
    const res = await handleAdminApi(
      adminReq('POST', { name: 'Kitchen', slots: 3, lead: 'Rick Vogel' }, memberCookie), env,
      new URL('https://connect.timothystl.org/admin/api/events/1/roles'), 'POST');
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM serve_roles').get().n).toBe(0);
  });

  it('stores a lead typed on a new shift', async () => {
    const res = await post({ name: 'Set up tents', slots: 18, role_date: '2026-12-04', start_time: '9:00 AM', end_time: '11:00 AM', lead: 'Rick Vogel' });
    expect(res.status).toBe(200);
    expect(row((await res.json()).id).lead).toBe('Rick Vogel');
  });

  it('stores a blank lead as blank, never as a placeholder', async () => {
    const res = await post({ name: 'Trash', slots: 1 });
    expect(row((await res.json()).id).lead).toBe('');
  });

  it('trims a lead so a stray space is not a different person', async () => {
    const res = await post({ name: 'Kitchen', slots: 3, lead: '  Marla Beck  ' });
    expect(row((await res.json()).id).lead).toBe('Marla Beck');
  });

  it('edits an existing shift lead in place', async () => {
    const id = (await (await post({ name: 'Kitchen', slots: 3, lead: 'Rick Vogel' })).json()).id;
    await put(id, { name: 'Kitchen', slots: 3, lead: 'Marla Beck' });
    expect(row(id).lead).toBe('Marla Beck');
  });

  it('clears a lead when the coordinator empties the box', async () => {
    const id = (await (await post({ name: 'Kitchen', slots: 3, lead: 'Rick Vogel' })).json()).id;
    await put(id, { name: 'Kitchen', slots: 3, lead: '' });
    expect(row(id).lead).toBe('');
  });
});

describe('the public events endpoint names nobody', () => {
  it('withholds the job lead from the unauthenticated /api/events payload', async () => {
    const db = makeTestDb();
    db._raw.prepare('INSERT INTO serve_events (name) VALUES (?)').run('Christmas Market');
    db._raw.prepare(
      'INSERT INTO serve_roles (event_id,name,slots,role_date,start_time,end_time,lead) VALUES (?,?,?,?,?,?,?)'
    ).run(1, 'Set up tents', 18, '2026-12-04', '9:00 AM', '11:00 AM', 'Rick Vogel');

    const d = await (await handleApiEvents({ DB: db })).json();
    const role = d.events[0].roles[0];

    // Everything a visitor needs is still here...
    expect(role).toMatchObject({ name: 'Set up tents', slots: 18, start_time: '9:00 AM' });
    expect(role.filled_count).toBe(0);
    // ...and the one field that names a person is not, on a route with no auth
    // in front of it. This response named nobody before the column existed and
    // still names nobody now.
    expect(role).not.toHaveProperty('lead');
    expect(JSON.stringify(d)).not.toContain('Rick Vogel');
  });
});
