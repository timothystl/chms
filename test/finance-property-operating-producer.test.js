import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinancePropertyOperatingV1 } from '../src/api-contracts.js';
import { validateFinancePropertyOperatingV1 } from '../apps/finance/finance-property-operating-consumer.js';

// finance_property_monthly/finance_property_distributions are migrations/0022 (production
// ledger), not part of migrations/0001_baseline.sql -- same reason Property Valuation's producer
// test adds finance_settings as EXTRA_SCHEMA. Column-for-column identical to migrations/0022's
// and migrations/0026's real CREATE TABLE/ALTER TABLE statements.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_property_monthly (
  property_key                     TEXT    NOT NULL DEFAULT 'ivanhoe',
  period                           TEXT    NOT NULL,
  occupancy_pct                    REAL,
  total_revenue_cents              INTEGER,
  total_expenses_cents             INTEGER,
  net_income_cents                 INTEGER,
  net_operating_income_cents       INTEGER,
  available_for_distribution_cents INTEGER,
  reserve_balance_cents            INTEGER,
  source_report                    TEXT    NOT NULL DEFAULT '',
  updated_at                       TEXT    NOT NULL DEFAULT (datetime('now')),
  loan_payment_cents               INTEGER,
  interest_expense_cents           INTEGER,
  PRIMARY KEY (property_key, period)
);
CREATE TABLE IF NOT EXISTS finance_property_distributions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
  period        TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(property_key, period)
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

function insertMonthly(db, propertyKey, row) {
  db._raw.prepare(
    `INSERT INTO finance_property_monthly (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,loan_payment_cents,interest_expense_cents,source_report)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    propertyKey, row.period, row.occupancy_pct, row.total_revenue_cents, row.total_expenses_cents ?? null,
    row.net_income_cents, row.net_operating_income_cents ?? null, row.available_for_distribution_cents ?? null,
    row.reserve_balance_cents ?? null, row.loan_payment_cents ?? null, row.interest_expense_cents ?? null,
    row.source_report || '',
  );
}

function insertDistribution(db, propertyKey, period, amountCents) {
  db._raw.prepare(`INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES (?,?,?)`).run(propertyKey, period, amountCents);
}

describe('buildFinancePropertyOperatingV1', () => {
  it('reflects real-shaped rows -- 0-1 occupancy fraction, nullable expenses -- and produces a valid contract', async () => {
    const db = makeTestDb();
    // Real production shape confirmed live 2026-09-15: occupancy_pct is a 0-1 fraction, and
    // total_expenses_cents can be null (derivable from revenue - net income).
    insertMonthly(db, 'ivanhoe', { period: '2025-12', occupancy_pct: 1, total_revenue_cents: 1041355, total_expenses_cents: 1463143, net_income_cents: -421788 });
    insertMonthly(db, 'ivanhoe', { period: '2026-01', occupancy_pct: 1, total_revenue_cents: 932721, total_expenses_cents: null, net_income_cents: 509994 });
    insertDistribution(db, 'ivanhoe', '2025-12', 500000);

    const result = await buildFinancePropertyOperatingV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    const validation = validateFinancePropertyOperatingV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-property-operating.v1');
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]).toEqual({
      period: '2025-12', occupancyPct: 1, totalRevenueCents: 1041355, totalExpensesCents: 1463143,
      netIncomeCents: -421788, netOperatingIncomeCents: null, availableForDistributionCents: null,
      reserveBalanceCents: null, loanPaymentCents: null, interestExpenseCents: null, sourceReport: '',
    });
    expect(result.periods[1].totalExpensesCents).toBeNull();

    // computePropertyAnnualSummary is reused, not reimplemented -- 2025's expenses derive
    // straight from its own row, 2026's is derived from revenue - net income (the real
    // convention documented on that function).
    const y2025 = result.annualSummary.find((y) => y.year === 2025);
    const y2026 = result.annualSummary.find((y) => y.year === 2026);
    expect(y2025).toEqual({
      year: 2025, totalRevenueCents: 1041355, totalExpensesCents: 1463143, netIncomeCents: -421788,
      avgOccupancyPct: 1, confirmedDistributionsCents: 500000, expenseMonthsDerived: 0, notes: '',
    });
    expect(y2026.totalExpensesCents).toBe(932721 - 509994);
    expect(y2026.expenseMonthsDerived).toBe(1);
  });

  it('answers with a valid, empty contract (not a 500) when nothing has been reported for this property yet', async () => {
    const db = makeTestDb();
    const result = await buildFinancePropertyOperatingV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.periods).toEqual([]);
    expect(result.annualSummary).toEqual([]);
    expect(validateFinancePropertyOperatingV1(result).ok).toBe(true);
  });

  it('does not leak a different property\'s rows into this property\'s contract', async () => {
    const db = makeTestDb();
    insertMonthly(db, 'ivanhoe', { period: '2026-01', occupancy_pct: 1, total_revenue_cents: 100, total_expenses_cents: 50, net_income_cents: 50 });
    insertMonthly(db, 'other', { period: '2026-01', occupancy_pct: 1, total_revenue_cents: 999999, total_expenses_cents: 0, net_income_cents: 999999 });
    const result = await buildFinancePropertyOperatingV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0].totalRevenueCents).toBe(100);
  });
});
