import { describe, expect, it } from 'vitest';
import { buildPropertyReportView, readSyntheticPropertyReport } from '../apps/finance/property-report-service.js';

const rows = [
  { property_key: 'synthetic-property', period: '2026-01', occupancy_pct: 90, total_revenue_cents: 2000000, total_expenses_cents: 1200000, net_income_cents: 800000, net_operating_income_cents: 900000, available_for_distribution_cents: 500000, reserve_balance_cents: 2500000 },
];

describe('Finance synthetic Commercial Property service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticPropertyReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("source_report='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('totals monthly property performance and retains the latest reserve', () => {
    expect(buildPropertyReportView(rows)).toMatchObject({
      propertyKey: 'synthetic-property',
      periodStart: '2026-01',
      periodEnd: '2026-01',
      averageOccupancyPct: 90,
      totals: {
        revenueCents: 2000000,
        expenseCents: 1200000,
        netIncomeCents: 800000,
        distributableCents: 500000,
        latestReserveCents: 2500000,
      },
    });
  });

  it('fails closed on empty or malformed fixture data', async () => {
    for (const results of [[], [{ ...rows[0], property_key: 'ivanhoe' }]]) {
      const db = {
        prepare(sql) { return { sql }; },
        async batch() { return [{ results }]; },
      };
      await expect(readSyntheticPropertyReport(db)).rejects.toThrow('Synthetic Commercial Property rows invalid');
    }
  });
});
