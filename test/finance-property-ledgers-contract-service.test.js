import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_property_capital_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  entry_date TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0,
  payee TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  check_ref TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS finance_property_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  entry_date TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER, payee TEXT NOT NULL DEFAULT '', capitalized INTEGER NOT NULL DEFAULT 0
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

const PATH = '/api/contracts/finance-property-ledgers-v1';

function seededDb() {
  const db = makeTestDb();
  db._raw.prepare(`INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,project) VALUES (?,?,?,?)`)
    .run('ivanhoe', '2026-01-01', 100000, 'Roof replacement');
  return db;
}

function call({ key = 'right-secret', expectedKey = 'right-secret', db = seededDb(), query = '' } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-property-ledgers-v1', () => {
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
    expect(body.contract).toBe('connect.finance-property-ledgers.v1');
    expect(body.propertyKey).toBe('ivanhoe');
    expect(body.capital).toHaveLength(1);
  });

  it('answers with a valid, empty contract (not a 500) for a property with nothing recorded yet', async () => {
    const res = await call({ db: makeTestDb() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capital).toEqual([]);
    expect(body.repairs).toEqual([]);
  });

  it('honors an explicit property_key query parameter', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,project) VALUES (?,?,?,?)`)
      .run('other', '2026-01-01', 100, 'Project');
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
