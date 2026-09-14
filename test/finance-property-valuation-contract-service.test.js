import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

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

const PATH = '/api/contracts/finance-property-valuation-v1';

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

function seededDb() {
  const db = makeTestDb();
  db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
    'finance_property_ivanhoe_meta', JSON.stringify({ valuation: REAL_SHAPED_VALUATION }),
  );
  return db;
}

function call({ key = 'right-secret', expectedKey = 'right-secret', db = seededDb(), query = '' } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-property-valuation-v1', () => {
  it('refuses with 503 when no key is configured on this Worker at all', async () => {
    const env = { DB: seededDb() };
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

  it('returns a real, valid contract for the default (ivanhoe) property', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-property-valuation.v1');
    expect(body.propertyKey).toBe('ivanhoe');
    expect(body.rentRoll).toHaveLength(1);
  });

  it('returns a real 500 (fail closed) for a property with no worksheet configured', async () => {
    const res = await call({ db: makeTestDb() });
    expect(res.status).toBe(500);
  });

  it('honors an explicit property_key query parameter', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
      'finance_property_other_meta', JSON.stringify({ valuation: REAL_SHAPED_VALUATION }),
    );
    const res = await call({ db, query: '?property_key=other' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.propertyKey).toBe('other');
  });

  it('answers 404 for any other path once authenticated', async () => {
    const env = { DB: seededDb(), FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const req = new Request('https://connect.example/api/contracts/something-else', {
      headers: { 'X-Contract-Key': 'right-secret' },
    });
    const res = await handleContractsServiceApi(req, env, '/api/contracts/something-else');
    expect(res.status).toBe(404);
  });
});
