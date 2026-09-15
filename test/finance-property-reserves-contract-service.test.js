import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_property_reserves (
  property_key TEXT NOT NULL DEFAULT 'ivanhoe', reserve_key TEXT NOT NULL, report_month TEXT NOT NULL,
  tax_year INTEGER, target_estimate_cents INTEGER, reserve_before_cents INTEGER, contribution_cents INTEGER,
  reserve_after_cents INTEGER, note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (property_key, reserve_key, report_month)
);
CREATE TABLE IF NOT EXISTS finance_property_reserve_disbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  reserve_key TEXT NOT NULL, period_key TEXT NOT NULL, amount_cents INTEGER,
  paid_via_report_month TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  UNIQUE(property_key, reserve_key, period_key)
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

const PATH = '/api/contracts/finance-property-reserves-v1';

function seededDb() {
  const db = makeTestDb();
  db._raw.prepare(`INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents) VALUES (?,?,?,?,?,?,?,?)`)
    .run('ivanhoe', 'property_tax', '2026-05', 2026, 1140000, 380000, 95000, 475000);
  return db;
}

function call({ key = 'right-secret', expectedKey = 'right-secret', db = seededDb(), query = '' } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-property-reserves-v1', () => {
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
    expect(body.contract).toBe('connect.finance-property-reserves.v1');
    expect(body.propertyKey).toBe('ivanhoe');
    expect(body.reserves).toHaveLength(1);
  });

  it('answers with a valid, empty contract (not a 500) for a property with nothing recorded yet', async () => {
    const res = await call({ db: makeTestDb() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reserves).toEqual([]);
  });

  it('honors an explicit property_key query parameter', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents) VALUES (?,?,?,?,?,?,?)`)
      .run('other', 'property_tax', '2026-05', 1140000, 380000, 95000, 475000);
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
