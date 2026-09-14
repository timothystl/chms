import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-church-report-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-balance-sheet-v1';

async function call(role, { config = null, query = '?fiscal_year=2026' } = {}) {
  const env = { DB: mockDb(config) };
  const url = new URL(`https://connect.example/admin/api/${SEG}${query}`);
  const req = { json: async () => ({}), headers: { get: () => null } };
  try {
    const res = await handleChmsApi(req, env, url, 'GET', SEG, role);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if (e && e.message === REACHED_HANDLER) return { reached: true };
    throw e;
  }
}

describe('contracts/finance-balance-sheet-v1 access gate', () => {
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

describe('contracts/finance-balance-sheet-v1 real handler', () => {
  it('refuses without a valid fiscal_year', async () => {
    const env = { DB: makeTestDb() };
    for (const query of ['', '?fiscal_year=abc', '?fiscal_year=27', '?fiscal_year=99999']) {
      const url = new URL(`https://connect.example/admin/api/${SEG}${query}`);
      const req = { json: async () => ({}), headers: { get: () => null } };
      const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
      expect(res.status, query).toBe(400);
    }
  });

  it('returns a real 200 empty-accounts contract for a fiscal year with nothing on file', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}?fiscal_year=2030`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-balance-sheet.v1');
    expect(body.fiscalYear).toBe(2030);
    expect(body.accounts).toEqual([]);
  });

  it('reflects real balance rows for the requested fiscal year only, with the Designated-Funds-as-Equity reclassification applied', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_church_balances (fiscal_year, as_of_date, classification, category_path, account_name, own_balance_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2026, '2026-12-31', 'Assets', 'Assets:11000 Cash', '11000 Cash', 30000000, 'import');
    db._raw.prepare(
      `INSERT INTO finance_church_balances (fiscal_year, as_of_date, classification, category_path, account_name, own_balance_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2026, '2026-12-31', 'Liabilities', 'Liabilities:25000 Funds:25004 Building Fund', '25004 Building Fund', 68500, 'import');
    db._raw.prepare(
      `INSERT INTO finance_church_balances (fiscal_year, as_of_date, classification, category_path, account_name, own_balance_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2027, '2027-12-31', 'Assets', 'Assets:11000 Cash', '11000 Cash', 999999999, 'import');
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}?fiscal_year=2026`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
    const fund = body.accounts.find((a) => a.accountName === '25004 Building Fund');
    expect(fund).toMatchObject({ classification: 'Equity', categoryPath: 'Equity:25000 Funds:25004 Building Fund', ownBalanceCents: 68500 });
    expect(body.totals.liabilitiesCents).toBe(0);
    expect(body.totals.equityCents).toBe(68500);
  });
});
