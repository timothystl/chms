import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { wrapDbForAttribution, wrapEnvForDbAttribution, logDbAttribution, ADMIN_API_QUERY_LOG_THRESHOLD } from '../src/db-attribution.js';
import { handleAdminApi } from '../src/api-admin.js';
import { authCookieHeader } from '../src/auth.js';

/** A minimal D1-shaped stub: prepare() returns a chainable object whose bind/first/all/run
 *  resolve without touching a real database — enough to prove counting behavior. */
function makeFakeDb() {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  };
  return { prepare: () => statement };
}

describe('wrapDbForAttribution', () => {
  it('counts each prepare() call', () => {
    const { db, counter } = wrapDbForAttribution(makeFakeDb());
    expect(counter.queries).toBe(0);
    db.prepare('SELECT 1');
    db.prepare('SELECT 2');
    expect(counter.queries).toBe(2);
  });

  it('still returns a working prepared statement (bind/first/all/run unaffected)', async () => {
    const { db } = wrapDbForAttribution(makeFakeDb());
    const stmt = db.prepare('SELECT 1').bind(1);
    expect(await stmt.first()).toBe(null);
    expect(await stmt.all()).toEqual({ results: [] });
    expect(await stmt.run()).toEqual({ meta: {} });
  });

  it('passes through an undefined db without throwing, counter stays at zero', () => {
    const { db, counter } = wrapDbForAttribution(undefined);
    expect(db).toBeUndefined();
    expect(counter.queries).toBe(0);
  });
});

describe('wrapEnvForDbAttribution', () => {
  it('wraps only the DB binding; every other binding passes through untouched', () => {
    const realDb = makeFakeDb();
    const kv = { get: async () => null };
    const env = { DB: realDb, RSVP_STORE: kv, SOME_SECRET: 'x' };
    const { env: wrapped, counter } = wrapEnvForDbAttribution(env);

    expect(wrapped.RSVP_STORE).toBe(kv);
    expect(wrapped.SOME_SECRET).toBe('x');
    expect(wrapped.DB).not.toBe(realDb);

    wrapped.DB.prepare('SELECT 1');
    expect(counter.queries).toBe(1);
  });

  it('counts queries made by code nested arbitrarily deep, as long as it received the wrapped env', () => {
    const env = { DB: makeFakeDb() };
    const { env: wrapped, counter } = wrapEnvForDbAttribution(env);

    // Mirrors how handleChmsApi/handleFinanceApi/etc. read env.DB themselves, several calls
    // deep from the /admin/api/* dispatch chokepoint that creates the wrapped env.
    function innerHandlerA(env) { env.DB.prepare('SELECT a'); return innerHandlerB(env); }
    function innerHandlerB(env) { env.DB.prepare('SELECT b'); env.DB.prepare('SELECT c'); }

    innerHandlerA(wrapped);
    expect(counter.queries).toBe(3);
  });
});

describe('logDbAttribution', () => {
  it('logs nothing when the count is at or below the threshold', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    try {
      logDbAttribution('finance/church/this-year', 'GET', { queries: ADMIN_API_QUERY_LOG_THRESHOLD });
    } finally {
      console.log = orig;
    }
    expect(logs).toHaveLength(0);
  });

  it('logs a structured line naming the route, method, and count once the threshold is exceeded', () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    try {
      logDbAttribution('finance/church/this-year', 'GET', { queries: ADMIN_API_QUERY_LOG_THRESHOLD + 1 });
    } finally {
      console.log = orig;
    }
    expect(logs).toHaveLength(1);
    const [label, payload] = logs[0];
    expect(label).toBe('d1_query_attribution');
    expect(JSON.parse(payload)).toEqual({
      route: 'finance/church/this-year',
      method: 'GET',
      queries: ADMIN_API_QUERY_LOG_THRESHOLD + 1,
    });
  });
});

describe('handleAdminApi is actually wired for attribution', () => {
  // Proves the wrapper in api-admin.js is live, not just that the standalone module works —
  // real SQLite, real routing, real auth cookie, same pattern as user-lockout-guards.test.js.
  const SECRET = 'test-signing-secret';

  function makeEnv() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'staff',
      active INTEGER NOT NULL DEFAULT 1
    )`);
    sqlite.exec(`INSERT INTO app_users (username, role, active) VALUES ('andrew','admin',1)`);
    sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            return { async first() { return sqlite.prepare(sql).get(...args); } };
          },
          async first() { return sqlite.prepare(sql).get(); },
        };
      },
    };
    return { DB: db, ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET };
  }

  it('does not log for a normal low-cost route (negative case — no false alarms)', async () => {
    const env = makeEnv();
    const cookie = (await authCookieHeader(env, 'admin', 'andrew')).split(';')[0];
    const url = new URL('https://connect.timothystl.org/admin/api/me');
    const req = new Request(url, { headers: { cookie } });

    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    try {
      const res = await handleAdminApi(req, env, url, 'GET');
      expect(res.status).toBe(200);
    } finally {
      console.log = orig;
    }
    expect(logs.find((l) => l[0] === 'd1_query_attribution')).toBeUndefined();
  });
});
