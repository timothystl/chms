import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_property_ivanhoe_meta',?)").run(JSON.stringify({ reserves: { base_minimum_cents: 450000 }, capital: { method: 'flat', annual_allowance_cents: 1200000 } }));
  return { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args); } }; } }; } };
}

describe('GET /api/contracts/finance-property-policy-v1', () => {
  it('requires the contract key and serves the closed policy contract', async () => {
    const env = { DB: db(), FINANCE_CONTRACT_API_KEY: 'secret' };
    const unauthorized = await handleContractsServiceApi(new Request('https://connect.test/api/contracts/finance-property-policy-v1'), env, '/api/contracts/finance-property-policy-v1');
    expect(unauthorized.status).toBe(401);
    const response = await handleContractsServiceApi(new Request('https://connect.test/api/contracts/finance-property-policy-v1?property_key=ivanhoe', { headers: { 'X-Contract-Key': 'secret' } }), env, '/api/contracts/finance-property-policy-v1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contract).toBe('connect.finance-property-policy.v1');
    expect(body.reservePolicy.baseMinimumCents).toBe(450000);
    expect(body.capitalPolicy).toEqual({ method: 'flat', annualAllowanceCents: 1200000, perSquareFootCents: null });
  });

  it('rejects an unsafe property key', async () => {
    const response = await handleContractsServiceApi(new Request('https://connect.test/api/contracts/finance-property-policy-v1?property_key=../bad', { headers: { 'X-Contract-Key': 'secret' } }), { DB: db(), FINANCE_CONTRACT_API_KEY: 'secret' }, '/api/contracts/finance-property-policy-v1');
    expect(response.status).toBe(400);
  });
});
