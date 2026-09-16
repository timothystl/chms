import { describe, expect, it } from 'vitest';
import {
  buildPropertyForecastView, readSyntheticPropertyForecast, resolvePropertyForecast, buildLivePropertyForecastView,
} from '../apps/finance/property-forecast-service.js';

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

// Real production shape confirmed live 2026-09-16: exactly one complete year (2026, the current
// fiscal year -- not a future one, unlike the committed synthetic fixture's own 2027-only
// convention) with all 12 months reconciling exactly, plus a genuinely negative December net
// income. resolvePropertyForecast/buildLivePropertyForecastView must handle that shape, and honest
// edge cases (a partial year, no complete year at all) without throwing.
const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-property-forecast.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-16T12:00:00Z', forecastYear: 2026,
  periods: [
    { period: '2026-01', revenueCents: 979775, expensesCents: 462704, netIncomeCents: 517071, reconciled: true, source: 'ahra_import' },
    { period: '2026-12', revenueCents: 979775, expensesCents: 1591671, netIncomeCents: -611896, reconciled: true, source: 'ahra_import' },
  ],
  totals: { revenueCents: 1959550, expensesCents: 2054375, netIncomeCents: -94825, reconciled: true },
};

const SYNTHETIC_ROWS = Array.from({ length: 12 }, (_, index) => ({
  property_key: 'synthetic-property', period: `2027-${String(index + 1).padStart(2, '0')}`,
  revenue_cents: 2200000, expenses_cents: 1300000, net_income_cents: 900000, source: 'synthetic_fixture',
}));

describe('resolvePropertyForecast (live connect.finance-property-forecast.v1 with synthetic fallback)', () => {
  it('falls back to the caller\'s already-fetched synthetic rows when the live contract is not configured', async () => {
    const result = await resolvePropertyForecast({}, SYNTHETIC_ROWS);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toBe(SYNTHETIC_ROWS);
  });

  it('resolves the real contract shape live, unmodified (camelCase, not reshaped)', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyForecast(env, SYNTHETIC_ROWS);
    expect(result.source).toBe('live');
    expect(result.propertyKey).toBe('ivanhoe');
    expect(result.forecastYear).toBe(2026);
    expect(result.periods).toHaveLength(2);
    expect(result.totals).toEqual(VALID_LIVE_PAYLOAD.totals);
  });

  it('falls back, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-property-forecast.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyForecast(env, SYNTHETIC_ROWS);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toBe(SYNTHETIC_ROWS);
  });
});

describe('buildLivePropertyForecastView', () => {
  it('filters periods down to the selected forecast year and carries totals through untouched', () => {
    const periods = [
      ...VALID_LIVE_PAYLOAD.periods,
      { period: '2027-01', revenueCents: 1, expensesCents: 1, netIncomeCents: 0, reconciled: true, source: 'ahra_import' },
    ];
    const view = buildLivePropertyForecastView(periods, 2026, VALID_LIVE_PAYLOAD.totals);
    expect(view.hasForecastYear).toBe(true);
    expect(view.fiscalYear).toBe(2026);
    expect(view.rows).toHaveLength(2);
    expect(view.rows.every((r) => r.period.startsWith('2026'))).toBe(true);
    expect(view.totals).toBe(VALID_LIVE_PAYLOAD.totals);
  });

  it('real-data-shaped edge case: renders an honest "no complete forecast year" state instead of throwing when only a partial year is on file', () => {
    const partialYearPeriods = [
      { period: '2027-01', revenueCents: 100000, expensesCents: 40000, netIncomeCents: 60000, reconciled: true, source: 'ahra_import' },
      { period: '2027-02', revenueCents: 100000, expensesCents: 40000, netIncomeCents: 60000, reconciled: true, source: 'ahra_import' },
    ];
    const view = buildLivePropertyForecastView(partialYearPeriods, null, { revenueCents: 0, expensesCents: 0, netIncomeCents: 0, reconciled: false });
    expect(view.hasForecastYear).toBe(false);
    expect(view.fiscalYear).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('real-data-shaped edge case: carries a non-reconciling totals through honestly rather than throwing (unlike buildPropertyForecastView)', () => {
    const nonReconcilingTotals = { revenueCents: 1000, expensesCents: 400, netIncomeCents: 601, reconciled: false };
    const view = buildLivePropertyForecastView(VALID_LIVE_PAYLOAD.periods, 2026, nonReconcilingTotals);
    expect(view.hasForecastYear).toBe(true);
    expect(view.totals.reconciled).toBe(false);
  });
});
