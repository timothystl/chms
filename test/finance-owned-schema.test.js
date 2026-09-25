import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import {
  FINANCE_OWNED_SCHEMAS, ensureFinanceOwnedSchema, isAdditiveStatement, resetEnsuredSchemasForTests, schemaStatements,
} from '../apps/finance/finance-owned-schema.js';

function emptyDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  const calls = [];
  const db = {
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      calls.push(stmts.map((s) => s.sql));
      const out = [];
      for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
      return out;
    },
  };
  return { db, sqlite, calls };
}

beforeEach(() => resetEnsuredSchemasForTests());

describe('Finance-owned schema', () => {
  it('matches each migration file exactly and contains only additive IF NOT EXISTS statements', () => {
    for (const schema of Object.values(FINANCE_OWNED_SCHEMAS)) {
      const file = readFileSync(new URL(`../apps/finance/migrations/${schema.migration}`, import.meta.url), 'utf8');
      expect(schema.sql).toBe(file);
      const statements = schemaStatements(schema.sql);
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) expect(isAdditiveStatement(s), s.slice(0, 60)).toBe(true);
    }
    expect(isAdditiveStatement('DROP TABLE finance_facility_assets')).toBe(false);
    expect(isAdditiveStatement('CREATE TABLE finance_x (id INTEGER)')).toBe(false);
  });

  it('creates the tables once per isolate, is harmless to repeat, and keeps existing rows', async () => {
    const { db, sqlite, calls } = emptyDb();
    expect(await ensureFinanceOwnedSchema(db, 'facilities')).toBe(true);
    sqlite.exec("INSERT INTO finance_facility_assets (name, category, installed_month, expected_life_years) VALUES ('Boiler', 'Boilers', '2014-09', 25)");
    expect(await ensureFinanceOwnedSchema(db, 'facilities')).toBe(true);
    expect(calls).toHaveLength(1);
    resetEnsuredSchemasForTests();
    expect(await ensureFinanceOwnedSchema(db, 'facilities')).toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_assets').get().n).toBe(1);
  });

  it('reports failure without caching it, and ignores unknown keys', async () => {
    let fail = true;
    const db = { prepare: (sql) => ({ sql }), batch: async () => { if (fail) throw new Error('down'); return []; } };
    expect(await ensureFinanceOwnedSchema(db, 'facilities')).toBe(false);
    fail = false;
    expect(await ensureFinanceOwnedSchema(db, 'facilities')).toBe(true);
    expect(await ensureFinanceOwnedSchema(db, 'nope')).toBe(false);
  });

  it('lets Facilities work on a database that has never had migration 0010', async () => {
    const { db, sqlite } = emptyDb();
    const env = {
      ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
      CONNECT_SERVICE: { fetch: async () => new Response(JSON.stringify({ role: 'admin', identity: 'office@example.com', permissions: { finance: 'edit', giving: 'edit' } })) },
    };
    const page = await (await worker.fetch(new Request('https://finance.test/?section=facilities', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env)).text();
    expect(page).toContain('Assets on record');
    expect(page).not.toContain('could not be read');
    const res = await worker.fetch(new Request('https://finance.test/api/v1/facilities/asset-save', {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ name: 'Walk-in cooler', category: 'Kitchen', installed_month: '2011-04', expected_life_years: '15' }),
    }), env);
    expect(res.headers.get('Location')).toContain('status=ok');
    expect(sqlite.prepare('SELECT name FROM finance_facility_assets').get().name).toBe('Walk-in cooler');
  });
});
