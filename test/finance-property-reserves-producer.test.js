import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinancePropertyReservesV1 } from '../src/api-contracts.js';
import { validateFinancePropertyReservesV1 } from '../contracts/validators/finance-property-reserves-consumer.js';

// finance_property_reserves/finance_property_reserve_disbursements/finance_property_distributions
// are migrations/0022-0023 (production ledger), not part of migrations/0001_baseline.sql -- same
// reason Property Valuation's producer test adds finance_settings as EXTRA_SCHEMA. Column-for-
// column identical to those migrations' real CREATE TABLE statements.
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

describe('buildFinancePropertyReservesV1', () => {
  it('reflects real-shaped reserve/disbursement/distribution rows, computing fundedPct, and produces a valid contract', async () => {
    const db = makeTestDb();
    // Real 2024-04 row confirmed live 2026-09-15 -- reserve_after_cents is $0.01 off
    // reserve_before_cents + contribution_cents from monthly-contribution rounding.
    db._raw.prepare(`INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('ivanhoe', 'property_tax', '2024-04', 2024, 1160000, 386667, 96667, 483333, '');
    db._raw.prepare(`INSERT INTO finance_property_reserve_disbursements (property_key,reserve_key,period_key,amount_cents,paid_via_report_month,note) VALUES (?,?,?,?,?,?)`)
      .run('ivanhoe', 'property_tax', '2026', null, '', 'Not yet paid as of the May 2026 report.');
    db._raw.prepare(`INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES (?,?,?)`)
      .run('ivanhoe', '2026-04', 500000);

    const result = await buildFinancePropertyReservesV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    const validation = validateFinancePropertyReservesV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-property-reserves.v1');
    expect(result.reserves).toHaveLength(1);
    expect(result.reserves[0]).toMatchObject({ reserveKey: 'property_tax', reportMonth: '2024-04', reserveAfterCents: 483333 });
    expect(result.reserves[0].fundedPct).toBeCloseTo((483333 / 1160000) * 100, 6);

    expect(result.reserveDisbursements).toHaveLength(1);
    expect(result.reserveDisbursements[0]).toEqual({ reserveKey: 'property_tax', periodKey: '2026', amountCents: null, paidViaReportMonth: '', note: 'Not yet paid as of the May 2026 report.' });

    expect(result.distributions).toEqual([{ period: '2026-04', amountCents: 500000 }]);
  });

  it('gives a targetEstimateCents of 0 a fundedPct of 0, not a division error', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents) VALUES (?,?,?,?,?,?,?)`)
      .run('ivanhoe', 'property_tax', '2026-01', 0, 0, 0, 0);
    const result = await buildFinancePropertyReservesV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.reserves[0].fundedPct).toBe(0);
    expect(validateFinancePropertyReservesV1(result).ok).toBe(true);
  });

  it('answers with a valid, empty contract (not a 500) when nothing has been recorded for this property yet', async () => {
    const db = makeTestDb();
    const result = await buildFinancePropertyReservesV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.reserves).toEqual([]);
    expect(result.reserveDisbursements).toEqual([]);
    expect(result.distributions).toEqual([]);
    expect(validateFinancePropertyReservesV1(result).ok).toBe(true);
  });
});
