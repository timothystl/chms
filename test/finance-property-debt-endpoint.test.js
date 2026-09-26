import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE finance_property_monthly (property_key TEXT, period TEXT, loan_payment_cents INTEGER, interest_expense_cents INTEGER)');
  sqlite.prepare("INSERT INTO finance_settings VALUES ('finance_property_ivanhoe_meta', ?)").run(JSON.stringify({ loan: { balance_cents: 10000000, balance_as_of_date: '2026-01-01', interest_rate_pct: 0.06, monthly_payment_cents: 100000 } }));
  const statement = (sql, args = []) => ({ bind: (...next) => statement(sql, next), async first() { return sqlite.prepare(sql).get(...args); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } });
  return { prepare: (sql) => statement(sql) };
}

describe('GET /api/contracts/finance-property-debt-v1', () => {
  it('requires the contract key and returns the closed debt projection', async () => {
    const env = { DB: db(), FINANCE_CONTRACT_API_KEY: 'secret' };
    expect((await handleContractsServiceApi(new Request('https://x/api/contracts/finance-property-debt-v1'), env, '/api/contracts/finance-property-debt-v1')).status).toBe(401);
    const response = await handleContractsServiceApi(new Request('https://x/api/contracts/finance-property-debt-v1?property_key=ivanhoe', { headers: { 'X-Contract-Key': 'secret' } }), env, '/api/contracts/finance-property-debt-v1');
    expect(response.status).toBe(200);
    expect((await response.json()).projection.status).toBe('ready');
  });
  it('rejects an unsafe property key', async () => {
    const response = await handleContractsServiceApi(new Request('https://x/api/contracts/finance-property-debt-v1?property_key=../bad', { headers: { 'X-Contract-Key': 'secret' } }), { DB: db(), FINANCE_CONTRACT_API_KEY: 'secret' }, '/api/contracts/finance-property-debt-v1');
    expect(response.status).toBe(400);
  });
});
