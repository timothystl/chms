import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-balance-sheet-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-property-valuation-v1';

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

describe('contracts/finance-property-valuation-v1 access gate', () => {
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

const REAL_SHAPED_VALUATION = {
  as_of_date: '2026-08-12',
  rent_roll: [{ tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 }],
  utility_reimbursement_cents: 0,
  vacancy_rate_pct: 0,
  operating_costs: {
    utilities_cents: 0, trash_cents: 0, maintenance_repairs_cents: 0,
    landscaping_snow_cents: 0, legal_cents: 0, taxes_cents: 0, insurance_cents: 0,
  },
  management_fee_pct: 0,
  cap_rate: 0.08,
};

describe('contracts/finance-property-valuation-v1 real handler', () => {
  it('returns a real 500 (fail closed) when the requested property has no worksheet configured', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(500);
  });

  it('reflects the real worksheet for the default (ivanhoe) property', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
      'finance_property_ivanhoe_meta', JSON.stringify({ valuation: REAL_SHAPED_VALUATION }),
    );
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-property-valuation.v1');
    expect(body.propertyKey).toBe('ivanhoe');
    expect(body.rentRoll).toHaveLength(1);
    expect(body.totals.capitalizedValueCents).toBe(Math.round(1938000 / 0.08));
  });

  it('honors an explicit property_key query parameter', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
      'finance_property_other_meta', JSON.stringify({ valuation: REAL_SHAPED_VALUATION }),
    );
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}?property_key=other`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propertyKey).toBe('other');
  });
});
