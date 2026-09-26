import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildFinancePropertyPolicyV1 } from '../src/api-property-policy-contracts.js';
import { acceptFinancePropertyPolicyV1, validateFinancePropertyPolicyV1 } from '../contracts/validators/finance-property-policy-consumer.js';

function db(value) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if (value !== undefined) sqlite.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_property_ivanhoe_meta',?)").run(value);
  return { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args); } }; } }; } };
}

describe('connect.finance-property-policy.v1', () => {
  it('reads the exact reserve and capital policy from the shared metadata record', async () => {
    const payload = await buildFinancePropertyPolicyV1(db(JSON.stringify({
      reserves: { base_minimum_cents: 450000 },
      capital: { method: 'flat_plus_sqft', annual_allowance_cents: 1200000, per_sqft_cents: 20 },
      loan: { balance_cents: 1 },
    })), { now: new Date('2026-09-26T00:00:00Z') });
    expect(payload.reservePolicy).toEqual({ baseMinimumCents: 450000 });
    expect(payload.capitalPolicy).toEqual({ method: 'flat_plus_sqft', annualAllowanceCents: 1200000, perSquareFootCents: 20 });
    expect(validateFinancePropertyPolicyV1(payload)).toEqual({ ok: true, errors: [] });
    const accepted = acceptFinancePropertyPolicyV1(payload);
    accepted.reservePolicy.baseMinimumCents = 0;
    expect(payload.reservePolicy.baseMinimumCents).toBe(450000);
  });

  it('uses the legacy defaults for a missing or malformed metadata record and rejects shape drift', async () => {
    const missing = await buildFinancePropertyPolicyV1(db());
    expect(missing.reservePolicy).toEqual({ baseMinimumCents: 0 });
    expect(missing.capitalPolicy).toEqual({ method: 'ledger', annualAllowanceCents: null, perSquareFootCents: null });
    expect(validateFinancePropertyPolicyV1({ ...missing, extra: true }).ok).toBe(false);
    const invalid = structuredClone(missing);
    invalid.capitalPolicy.method = 'invented';
    expect(validateFinancePropertyPolicyV1(invalid).ok).toBe(false);
  });
});
