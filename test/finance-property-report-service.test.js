import { describe, expect, it } from 'vitest';
import { buildPropertyReportView, readSyntheticPropertyReport, readSyntheticPropertyReserves, readSyntheticPropertyLedgers } from '../apps/finance/property-report-service.js';

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

  it('reads a continuous synthetic property-tax reserve schedule', async () => {
    const reserveRows = [
      { reserve_key: 'property_tax', report_month: '2026-01', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2000000, contribution_cents: 500000, reserve_after_cents: 2500000, note: 'Synthetic fixture' },
      { reserve_key: 'property_tax', report_month: '2026-02', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2500000, contribution_cents: 500000, reserve_after_cents: 3000000, note: 'Synthetic fixture' },
    ];
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: reserveRows }]; } };
    await expect(readSyntheticPropertyReserves(db)).resolves.toEqual([
      { ...reserveRows[0], funded_pct: 2500000 / 6000000 * 100 },
      { ...reserveRows[1], funded_pct: 50 },
    ]);
  });

  it('fails closed on a broken reserve carry-forward', async () => {
    const results = [
      { reserve_key: 'property_tax', report_month: '2026-01', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2000000, contribution_cents: 500000, reserve_after_cents: 2500000, note: '' },
      { reserve_key: 'property_tax', report_month: '2026-02', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2400000, contribution_cents: 500000, reserve_after_cents: 2900000, note: '' },
    ];
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results }]; } };
    await expect(readSyntheticPropertyReserves(db)).rejects.toThrow('Synthetic Commercial Property reserve rows invalid');
  });

  it('reads and totals bounded synthetic capital and repair ledgers', async () => {
    const capital = [{ entry_date: '2026-01-15', amount_cents: 100000, payee: 'Synthetic Vendor', description: 'Synthetic capital project', project: 'Synthetic Project' }];
    const repairs = [{ entry_date: '2026-01-20', category: 'Synthetic repair', description: 'Synthetic repair item', amount_cents: 25000, payee: 'Synthetic Vendor', capitalized: 0 }];
    const db = { prepare(sql) { return { sql }; }, async batch(statements) { expect(statements).toHaveLength(2); return [{ results: capital }, { results: repairs }]; } };
    await expect(readSyntheticPropertyLedgers(db)).resolves.toEqual({
      capital,
      repairs,
      totals: { capital_cents: 100000, repairs_cents: 25000 },
    });
  });

  it('fails closed on malformed or empty property ledgers', async () => {
    const validCapital = [{ entry_date: '2026-01-15', amount_cents: 100000, payee: 'Synthetic Vendor', description: 'Synthetic capital project', project: 'Synthetic Project' }];
    const validRepairs = [{ entry_date: '2026-01-20', category: 'Synthetic repair', description: 'Synthetic repair item', amount_cents: 25000, payee: 'Synthetic Vendor', capitalized: 0 }];
    for (const pair of [[[], validRepairs], [validCapital, [{ ...validRepairs[0], amount_cents: -1 }]]]) {
      const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: pair[0] }, { results: pair[1] }]; } };
      await expect(readSyntheticPropertyLedgers(db)).rejects.toThrow(/Synthetic Commercial Property/);
    }
  });
});
