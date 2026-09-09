import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/giving-anon-gate.test.js ────────────────
const REACHED_HANDLER = 'REACHED_HANDLER';
function mockDb(configJson) {
  return {
    prepare(sql) {
      if (String(sql).includes('role_permissions_json')) {
        return { first: async () => (configJson ? { value: configJson } : null) };
      }
      throw new Error(REACHED_HANDLER);
    },
    batch() { throw new Error(REACHED_HANDLER); },
  };
}

const SEG = 'contracts/connect-giving-summary-v1';

async function call(role, { config = null, query = 'from=2026-01-01&to=2026-01-31' } = {}) {
  const env = { DB: mockDb(config) };
  const url = new URL(`https://connect.example/admin/api/${SEG}?${query}`);
  const req = { json: async () => ({}), headers: { get: () => null } };
  try {
    const res = await handleChmsApi(req, env, url, 'GET', SEG, role);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if (e && e.message === REACHED_HANDLER) return { reached: true };
    throw e;
  }
}

describe('contracts/connect-giving-summary-v1 access gate', () => {
  it('lets admin and finance reach the real handler', async () => {
    for (const role of ['admin', 'finance']) {
      const r = await call(role);
      expect(r.reached, role).toBe(true);
    }
  });

  // staff's default 'giving' permission is 'none' (see DEFAULT_ROLE_PERMISSIONS in
  // api-utils.js) — staff has never had Giving access, so this contract correctly inherits
  // that rather than opening a new hole. An admin can grant staff 'giving' view/edit, which
  // would grant this too, same as every other giving-item endpoint.
  it('refuses staff by default, the same as every other giving endpoint', async () => {
    const r = await call('staff');
    expect(r.status).toBe(403);
  });

  it('refuses council (anonymous-giving tier) — new anonymous endpoints are denied by default', async () => {
    const r = await call('council');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/totals only/);
  });

  it('refuses member and volunteer outright', async () => {
    for (const role of ['member', 'volunteer']) {
      const r = await call(role);
      expect(r.status, role).toBe(403);
    }
  });

  // No handler in this file answers POST for this segment (it is deliberately read-only), so
  // the request falls through every dispatcher to api-import.js's own not-found response —
  // the same fallthrough every other route in this file relies on for an unsupported method.
  it('does not answer POST — falls through to the generic not-found response, not a write', async () => {
    const env = { DB: mockDb(null) };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'POST', SEG, 'admin');
    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.contract).toBeUndefined();
  });
});

// ── Full HTTP path with a real seeded database ──────────────────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      // Both call shapes are exercised on the real path: handleChmsApi's own
      // getRolePermissions() calls .first() with no .bind() (no parameters), while this
      // endpoint's own query always binds. Support both, like the real D1 prepared-statement
      // object does.
      return {
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    _raw: sqlite,
  };
}

async function callReal(query) {
  const env = { DB: makeTestDb() };
  const url = new URL(`https://connect.example/admin/api/${SEG}?${query}`);
  const req = { json: async () => ({}), headers: { get: () => null } };
  const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
  return { status: res.status, body: await res.json() };
}

describe('contracts/connect-giving-summary-v1 request validation', () => {
  it('rejects missing or malformed dates with 400, not a malformed contract', async () => {
    for (const query of ['', 'from=2026-01-01', 'to=2026-01-31', 'from=nope&to=2026-01-31', 'from=2026-13-01&to=2026-01-31']) {
      const r = await callReal(query);
      expect(r.status, query).toBe(400);
    }
  });

  it('rejects from after to', async () => {
    const r = await callReal('from=2026-02-01&to=2026-01-01');
    expect(r.status).toBe(400);
  });

  it('rejects a period ending in the future', async () => {
    const farFuture = `${new Date().getUTCFullYear() + 5}-01-31`;
    const r = await callReal(`from=2026-01-01&to=${farFuture}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/future/);
  });

  it('returns a real 200 contract for an empty but valid period', async () => {
    const r = await callReal('from=2026-01-01&to=2026-01-31');
    expect(r.status).toBe(200);
    expect(r.body.contract).toBe('connect.giving-summary.v1');
    expect(r.body.funds).toEqual([]);
  });
});
