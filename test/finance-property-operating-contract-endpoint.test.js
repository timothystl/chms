import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-property-valuation-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-property-operating-v1';

async function call(role, { config = null, query = '' } = {}) {
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

describe('contracts/finance-property-operating-v1 access gate', () => {
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
CREATE TABLE IF NOT EXISTS finance_property_monthly (
  property_key TEXT NOT NULL DEFAULT 'ivanhoe', period TEXT NOT NULL, occupancy_pct REAL,
  total_revenue_cents INTEGER, total_expenses_cents INTEGER, net_income_cents INTEGER,
  net_operating_income_cents INTEGER, available_for_distribution_cents INTEGER, reserve_balance_cents INTEGER,
  source_report TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  loan_payment_cents INTEGER, interest_expense_cents INTEGER,
  PRIMARY KEY (property_key, period)
);
CREATE TABLE IF NOT EXISTS finance_property_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  period TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0, UNIQUE(property_key, period)
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

describe('contracts/finance-property-operating-v1 real handler', () => {
  it('answers with a valid, empty contract (not a 500) when the requested property has no rows yet', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.periods).toEqual([]);
  });

  it('reflects real rows for the default (ivanhoe) property', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_monthly (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,source_report) VALUES (?,?,?,?,?,?,?)`)
      .run('ivanhoe', '2026-06', 1, 976527, 446248, 530279, 'AHRA June 2026');
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-property-operating.v1');
    expect(body.propertyKey).toBe('ivanhoe');
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0].occupancyPct).toBe(1);
  });

  it('honors an explicit property_key query parameter', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_monthly (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,source_report) VALUES (?,?,?,?,?,?,?)`)
      .run('other', '2026-06', 1, 100, 40, 60, '');
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}?property_key=other`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propertyKey).toBe('other');
    expect(body.periods).toHaveLength(1);
  });
});
