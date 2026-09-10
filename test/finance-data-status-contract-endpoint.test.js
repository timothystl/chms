import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/giving-summary-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-data-status-v1';

async function call(role, { config = null } = {}) {
  const env = { DB: mockDb(config) };
  const url = new URL(`https://connect.example/admin/api/${SEG}`);
  const req = { json: async () => ({}), headers: { get: () => null } };
  try {
    const res = await handleChmsApi(req, env, url, 'GET', SEG, role);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if (e && e.message === REACHED_HANDLER) return { reached: true };
    throw e;
  }
}

describe('contracts/finance-data-status-v1 access gate', () => {
  it('lets admin and finance reach the real handler (plain finance item, same as every other Finance segment)', async () => {
    for (const role of ['admin', 'finance']) {
      const r = await call(role);
      expect(r.reached, role).toBe(true);
    }
  });

  it('refuses staff by default (default finance permission is none)', async () => {
    const r = await call('staff');
    expect(r.status).toBe(403);
  });

  it('refuses council, member, and volunteer outright', async () => {
    for (const role of ['council', 'member', 'volunteer']) {
      const r = await call(role);
      expect(r.status, role).toBe(403);
    }
  });
});

// ── Full HTTP path with a real seeded database ──────────────────────────────────────────────
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_import_log (
  importer_key TEXT PRIMARY KEY,
  last_imported_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS finance_qb_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  realm_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT NOT NULL DEFAULT ''
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
  return {
    prepare(sql) {
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
  };
}

describe('contracts/finance-data-status-v1 real handler', () => {
  it('returns a real 200 contract from an empty database', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-data-status.v1');
    expect(body.imports).toEqual({ mostRecentImportAt: null, importerCount: 0 });
    expect(body.quickbooks).toEqual({ connected: false, lastSyncedAt: null });
  });
});
