import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_church_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL DEFAULT 0,
  classification    TEXT    NOT NULL,
  category_path     TEXT    NOT NULL,
  account_name      TEXT    NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,
  own_actual_cents  INTEGER NOT NULL DEFAULT 0,
  own_budget_cents  INTEGER,
  account_qbo_id    TEXT    NOT NULL DEFAULT '',
  source            TEXT    NOT NULL DEFAULT 'qbo_sync',
  notes             TEXT    NOT NULL DEFAULT '',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, period_month, category_path, source)
);
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

const PATH = '/api/contracts/finance-chart-of-accounts-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', db = makeTestDb(), query = '?fiscal_year=2026' } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-chart-of-accounts-v1', () => {
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

  it('returns a real, valid, empty-state contract when nothing has ever been imported', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-chart-of-accounts.v1');
    expect(body.accounts).toEqual([]);
    expect(body.reconciliation).toMatchObject({ accountCount: 0, incomeCount: 0, expenseCount: 0, unassignedCount: 0 });
  });

  it('refuses a malformed fiscal_year with 400', async () => {
    const res = await call({ query: '?fiscal_year=abcd' });
    expect(res.status).toBe(400);
  });

  it('scopes to the requested year and carries each account\'s own actual for it', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, synced_at) VALUES (?,?,?,?,?,?)`
    ).run(2026, 'Expenses', 'Expenses:Staff:Pastoral Salary', 'Pastoral Salary', 512345, '2026-06-01T00:00:00Z');
    const res = await call({ db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.fiscalYear).toBe(2026);
    expect(body.accounts[0]).toMatchObject({ accountName: 'Pastoral Salary', boardCategoryKey: 'unassigned', actualCents: 512345, budgetCents: null });
    const other = await call({ db, query: '?fiscal_year=2025' });
    const otherBody = await other.json();
    expect(otherBody.accounts).toEqual([]);
    expect(otherBody.availableFiscalYears).toEqual([2026]);
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
