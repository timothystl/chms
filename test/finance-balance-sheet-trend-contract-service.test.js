import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_church_balances (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  as_of_date        TEXT    NOT NULL DEFAULT '',
  classification    TEXT    NOT NULL,
  category_path     TEXT    NOT NULL,
  account_name      TEXT    NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,
  own_balance_cents INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL DEFAULT 'import',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, category_path, source)
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

const PATH = '/api/contracts/finance-balance-sheet-trend-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', db = makeTestDb() } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-balance-sheet-trend-v1', () => {
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

  it('returns a real, valid, empty-years contract when nothing is on file, with no query parameter required', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-balance-sheet-trend.v1');
    expect(body.years).toEqual([]);
  });

  it('reflects real balance rows across every fiscal year on file', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_church_balances (fiscal_year, as_of_date, classification, category_path, account_name, own_balance_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2026, '2026-12-31', 'Assets', 'Assets:11000 Cash', '11000 Cash', 30000000, 'import');
    const res = await call({ db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.years).toHaveLength(1);
    expect(body.years[0]).toMatchObject({ fiscalYear: 2026, assetsCents: 30000000 });
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
