import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinancePropertyForecastV1 } from '../src/api-contracts.js';
import { validateFinancePropertyForecastV1 } from '../apps/finance/finance-property-forecast-consumer.js';

// finance_property_budget_monthly is migrations/0025 (production ledger), not part of
// migrations/0001_baseline.sql -- same reason Property Operating's producer test adds its own
// EXTRA_SCHEMA. Column-for-column identical to migrations/0025's real CREATE TABLE statement.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_property_budget_monthly (
  property_key     TEXT    NOT NULL DEFAULT 'ivanhoe',
  period            TEXT    NOT NULL,
  revenue_cents     INTEGER NOT NULL DEFAULT 0,
  expenses_cents    INTEGER NOT NULL DEFAULT 0,
  net_income_cents  INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL DEFAULT 'ahra_import',
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_key, period)
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

function insertBudget(db, propertyKey, row) {
  db._raw.prepare(
    `INSERT INTO finance_property_budget_monthly (property_key,period,revenue_cents,expenses_cents,net_income_cents,source)
     VALUES (?,?,?,?,?,?)`
  ).run(propertyKey, row.period, row.revenue_cents, row.expenses_cents, row.net_income_cents, row.source || 'ahra_import');
}

function insertRealIvanhoe2026(db) {
  // Real production shape confirmed live 2026-09-16: 12 rows, all reconciling, December's net
  // income genuinely negative (a large annual expense landing in one month).
  const revenue = 979775;
  const rows = [
    ['2026-01', revenue, 462704, 517071], ['2026-02', revenue, 461719, 518056],
    ['2026-03', revenue, 460730, 519045], ['2026-04', revenue, 459738, 520037],
    ['2026-05', revenue, 458742, 521033], ['2026-06', revenue, 457743, 522032],
    ['2026-07', revenue, 456741, 523034], ['2026-08', revenue, 455734, 524041],
    ['2026-09', revenue, 454722, 525053], ['2026-10', revenue, 453708, 526067],
    ['2026-11', revenue, 452691, 527084], ['2026-12', revenue, 1591671, -611896],
  ];
  for (const [period, revenue_cents, expenses_cents, net_income_cents] of rows) {
    insertBudget(db, 'ivanhoe', { period, revenue_cents, expenses_cents, net_income_cents });
  }
}

describe('buildFinancePropertyForecastV1', () => {
  it('reflects the real Ivanhoe 2026 shape -- a complete current-year 12-month budget, a negative December net income, and full reconciliation', async () => {
    const db = makeTestDb();
    insertRealIvanhoe2026(db);
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    const validation = validateFinancePropertyForecastV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-property-forecast.v1');
    expect(result.propertyKey).toBe('ivanhoe');
    expect(result.forecastYear).toBe(2026);
    expect(result.periods).toHaveLength(12);
    expect(result.periods.every((p) => p.reconciled)).toBe(true);
    const december = result.periods.find((p) => p.period === '2026-12');
    expect(december.netIncomeCents).toBe(-611896);
    expect(december.revenueCents).toBeGreaterThanOrEqual(0);
    expect(december.expensesCents).toBeGreaterThanOrEqual(0);
    expect(result.totals).toEqual({
      revenueCents: 979775 * 12,
      expensesCents: 462704 + 461719 + 460730 + 459738 + 458742 + 457743 + 456741 + 455734 + 454722 + 453708 + 452691 + 1591671,
      netIncomeCents: 517071 + 518056 + 519045 + 520037 + 521033 + 522032 + 523034 + 524041 + 525053 + 526067 + 527084 - 611896,
      reconciled: true,
    });
  });

  it('answers with a valid, empty contract (not a 500) when nothing has been budgeted for this property yet', async () => {
    const db = makeTestDb();
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.periods).toEqual([]);
    expect(result.forecastYear).toBeNull();
    expect(result.totals).toEqual({ revenueCents: 0, expensesCents: 0, netIncomeCents: 0, reconciled: false });
    expect(validateFinancePropertyForecastV1(result).ok).toBe(true);
  });

  it('does not leak a different property\'s rows into this property\'s contract', async () => {
    const db = makeTestDb();
    insertBudget(db, 'ivanhoe', { period: '2026-01', revenue_cents: 100, expenses_cents: 50, net_income_cents: 50 });
    insertBudget(db, 'other', { period: '2026-01', revenue_cents: 999999, expenses_cents: 0, net_income_cents: 999999 });
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0].revenueCents).toBe(100);
  });

  it('selects the single complete year even when it is the current year, not a future one -- real-data-shaped, not the synthetic fixture\'s 2027-only assumption', async () => {
    const db = makeTestDb();
    insertRealIvanhoe2026(db);
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.forecastYear).toBe(2026);
  });

  it('picks the nearest complete future/current year when a partial year is also on file', async () => {
    const db = makeTestDb();
    insertRealIvanhoe2026(db); // complete 2026
    // A partial 2027 -- only 3 months on file, should not be selected.
    insertBudget(db, 'ivanhoe', { period: '2027-01', revenue_cents: 100000, expenses_cents: 40000, net_income_cents: 60000 });
    insertBudget(db, 'ivanhoe', { period: '2027-02', revenue_cents: 100000, expenses_cents: 40000, net_income_cents: 60000 });
    insertBudget(db, 'ivanhoe', { period: '2027-03', revenue_cents: 100000, expenses_cents: 40000, net_income_cents: 60000 });
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.forecastYear).toBe(2026);
    expect(result.periods).toHaveLength(15);
  });

  it('falls back to the most recent complete past year when no complete year is current or future', async () => {
    const db = makeTestDb();
    // A complete year, but entirely in the past relative to `now`.
    for (let i = 1; i <= 12; i++) {
      insertBudget(db, 'ivanhoe', { period: `2024-${String(i).padStart(2, '0')}`, revenue_cents: 1000, expenses_cents: 400, net_income_cents: 600 });
    }
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.forecastYear).toBe(2024);
    expect(result.totals.revenueCents).toBe(12000);
  });

  it('carries a non-reconciling row through honestly (reconciled:false) rather than throwing', async () => {
    const db = makeTestDb();
    insertBudget(db, 'ivanhoe', { period: '2026-01', revenue_cents: 1000, expenses_cents: 400, net_income_cents: 999 }); // does not reconcile
    const result = await buildFinancePropertyForecastV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-16T12:00:00Z') });
    expect(result.periods[0].reconciled).toBe(false);
    expect(validateFinancePropertyForecastV1(result).ok).toBe(true);
  });
});
