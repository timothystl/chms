import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

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
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

const PATH = '/api/contracts/finance-data-status-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', db = makeTestDb() } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-data-status-v1', () => {
  it('refuses with 503 when no key is configured on this Worker at all', async () => {
    const env = { DB: makeTestDb() };
    const req = new Request(`https://connect.example${PATH}`, { headers: { 'X-Contract-Key': 'whatever' } });
    const res = await handleContractsServiceApi(req, env, PATH);
    expect(res.status).toBe(503);
  });

  it('refuses with 401 when no header or the wrong key is sent', async () => {
    for (const key of [null, 'wrong-secret', '']) {
      const res = await call({ key });
      expect(res.status, String(key)).toBe(401);
    }
  });

  it('returns a real, valid, empty-state contract when nothing has ever imported or connected', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-data-status.v1');
    expect(body.imports).toEqual({ mostRecentImportAt: null, importerCount: 0 });
    expect(body.quickbooks).toEqual({ connected: false, lastSyncedAt: null });
  });

  it('reflects real import log and QuickBooks connection rows, and never includes tokens', async () => {
    const db = makeTestDb();
    db._raw.exec(`
      INSERT INTO finance_import_log (importer_key, last_imported_at, note) VALUES
        ('church_budget', '2026-06-01T00:00:00Z', ''),
        ('property_monthly_csv', '2026-06-10T08:00:00Z', '');
      INSERT INTO finance_qb_connection (id, realm_id, access_token, refresh_token, connected_at, last_synced_at)
        VALUES (1, 'realm-1', 'secret-access-token', 'secret-refresh-token', '2026-01-01T00:00:00Z', '2026-06-14T00:00:00Z');
    `);
    const res = await call({ db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imports).toEqual({ mostRecentImportAt: '2026-06-10T08:00:00Z', importerCount: 2 });
    expect(body.quickbooks).toEqual({ connected: true, lastSyncedAt: '2026-06-14T00:00:00Z' });
    expect(JSON.stringify(body)).not.toContain('secret-access-token');
    expect(JSON.stringify(body)).not.toContain('secret-refresh-token');
  });

  it('answers 404 for any other path once authenticated', async () => {
    const env = { DB: makeTestDb(), FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const req = new Request('https://connect.example/api/contracts/something-else', {
      headers: { 'X-Contract-Key': 'right-secret' },
    });
    const res = await handleContractsServiceApi(req, env, '/api/contracts/something-else');
    expect(res.status).toBe(404);
  });
});
