import { describe, expect, it } from 'vitest';
import { buildPropertyForecastView, readSyntheticPropertyForecast } from '../apps/finance/property-forecast-service.js';

const rows = Array.from({ length: 12 }, (_, index) => ({
  property_key: 'synthetic-property', period: `2027-${String(index + 1).padStart(2, '0')}`,
  revenue_cents: 2200000, expenses_cents: 1300000, net_income_cents: 900000,
  source: 'synthetic_fixture',
}));

describe('Finance synthetic Commercial Property forecast', () => {
  it('reads one bounded fixture-only 12-month forecast', async () => {
    const statements = [];
    const db = { prepare(sql) { statements.push(sql); return { sql }; }, async batch() { return [{ results: rows }]; } };
    await expect(readSyntheticPropertyForecast(db)).resolves.toEqual(rows);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("period LIKE '2027-%'");
  });

  it('reconciles monthly rows into the annual forecast', () => {
    expect(buildPropertyForecastView(rows)).toEqual({
      fiscalYear: 2027, rows, reconciled: true,
      totals: { revenueCents: 26400000, expenseCents: 15600000, netIncomeCents: 10800000 },
    });
  });

  it('fails closed on missing months, gaps, and broken arithmetic', async () => {
    for (const invalid of [rows.slice(1), rows.map((row, i) => i === 5 ? { ...row, period: '2027-07' } : row), rows.map((row, i) => i === 0 ? { ...row, net_income_cents: 1 } : row)]) {
      const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: invalid }]; } };
      await expect(readSyntheticPropertyForecast(db)).rejects.toThrow('Synthetic Commercial Property forecast rows invalid');
    }
  });
});
