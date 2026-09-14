import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-chart-of-accounts-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-budget-v1';

async function call(role, { config = null, query = '?fiscal_year=2027' } = {}) {
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

describe('contracts/finance-budget-v1 access gate', () => {
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
CREATE TABLE IF NOT EXISTS finance_budget_plan (
  category             TEXT    NOT NULL,
  classification        TEXT    NOT NULL DEFAULT 'Expenses',
  fiscal_year           INTEGER NOT NULL,
  planned_amount_cents  INTEGER NOT NULL DEFAULT 0,
  basis                 TEXT    NOT NULL DEFAULT 'manual',
  growth_pct            REAL,
  base_amount_cents     INTEGER,
  notes                 TEXT    NOT NULL DEFAULT '',
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (category, fiscal_year)
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

describe('contracts/finance-budget-v1 real handler', () => {
  it('refuses without a valid fiscal_year', async () => {
    const env = { DB: makeTestDb() };
    for (const query of ['', '?fiscal_year=abc', '?fiscal_year=27', '?fiscal_year=99999']) {
      const url = new URL(`https://connect.example/admin/api/${SEG}${query}`);
      const req = { json: async () => ({}), headers: { get: () => null } };
      const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
      expect(res.status, query).toBe(400);
    }
  });

  it('returns a real 200 empty-categories contract for a fiscal year with no plan', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}?fiscal_year=2030`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-budget.v1');
    expect(body.fiscalYear).toBe(2030);
    expect(body.categories).toEqual([]);
    expect(body.reconciliation).toEqual({ categoryCount: 0, incomeCount: 0, expenseCount: 0, manualCount: 0, grownCount: 0, totalsMatch: true });
  });

  it('reflects real budget plan rows for the requested fiscal year only', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis, notes) VALUES (?,?,?,?,?,?)`
    ).run('Expenses:Staff:Pastoral Salary', 'Expenses', 2027, 8500000, 'manual', 'Set by council');
    db._raw.prepare(
      `INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis, notes) VALUES (?,?,?,?,?,?)`
    ).run('Expenses:Staff:Pastoral Salary', 'Expenses', 2028, 9000000, 'manual', '');
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}?fiscal_year=2027`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([{
      category: 'Expenses:Staff:Pastoral Salary', classification: 'Expenses', plannedAmountCents: 8500000,
      basis: 'manual', growthPct: null, baseAmountCents: null, notes: 'Set by council',
    }]);
  });
});
