import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

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

const PATH = '/api/contracts/finance-budget-v1';

function call({ key = 'right-secret', expectedKey = 'right-secret', db = makeTestDb(), query = '?fiscal_year=2027' } = {}) {
  const env = { DB: db, FINANCE_CONTRACT_API_KEY: expectedKey };
  const req = new Request(`https://connect.example${PATH}${query}`, {
    headers: key === null ? {} : { 'X-Contract-Key': key },
  });
  return handleContractsServiceApi(req, env, PATH);
}

describe('handleContractsServiceApi finance-budget-v1', () => {
  it('refuses with 503 when no key is configured on this Worker at all', async () => {
    const env = { DB: makeTestDb() };
    const req = new Request(`https://connect.example${PATH}?fiscal_year=2027`, { headers: { 'X-Contract-Key': 'whatever' } });
    const res = await handleContractsServiceApi(req, env, PATH);
    expect(res.status).toBe(503);
  });

  it('refuses with 401 when no header or the wrong key is sent', async () => {
    for (const key of [null, 'wrong-secret', '']) {
      const res = await call({ key });
      expect(res.status, String(key)).toBe(401);
    }
  });

  it('refuses with 400 when fiscal_year is missing or malformed', async () => {
    for (const query of ['', '?fiscal_year=abc', '?fiscal_year=27']) {
      const res = await call({ query });
      expect(res.status, query).toBe(400);
    }
  });

  it('returns a real, valid, empty-categories contract for a fiscal year with nothing planned', async () => {
    const res = await call({ query: '?fiscal_year=2030' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-budget.v1');
    expect(body.fiscalYear).toBe(2030);
    expect(body.categories).toEqual([]);
  });

  it('reflects real budget plan rows for the requested fiscal year only', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis) VALUES (?,?,?,?,?)`
    ).run('Income:Offerings:General Fund', 'Income', 2027, 130000000, 'manual');
    const res = await call({ db, query: '?fiscal_year=2027' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]).toMatchObject({ category: 'Income:Offerings:General Fund', plannedAmountCents: 130000000 });
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
