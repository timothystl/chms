import { describe, it, expect } from 'vitest';
import { renderBalancePage, renderBalanceTrendRows } from '../apps/finance/balance-pages.js';

const ROWS = [
  { fiscal_year: 2025, as_of_date: '2025-12-31', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 16000000, net_assets_cents: 16000000 },
  { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000, net_assets_cents: 20000000 },
];

describe('renderBalanceTrendRows', () => {
  it('renders one row per fiscal year with the net-assets column', () => {
    const html = renderBalanceTrendRows(ROWS);
    expect(html).toContain('2025');
    expect(html).toContain('2026');
    expect(html).toContain('$270,000');
    expect(html).toContain('$160,000');
  });
});

describe("renderBalancePage 'multi-year' (resolveBalanceSheetTrend's { source, rows } shape)", () => {
  it('renders live data with a Live from Connect badge and no fallback note', () => {
    const html = renderBalancePage('multi-year', { balanceTrends: { source: 'live', rows: ROWS } });
    expect(html).toContain('Multi-year financial position');
    expect(html).toContain('Live from Connect');
    expect(html).not.toContain('Synthetic staging');
    expect(html).not.toContain('committed synthetic fixture');
    expect(html).toContain('$300,000');
    expect(html).toContain('$100,000');
    expect(html).toContain('$200,000');
  });

  it('renders a synthetic-fallback badge and fallback note with the failure reason', () => {
    const html = renderBalancePage('multi-year', { balanceTrends: { source: 'synthetic-fallback', fallbackReason: 'not_configured', rows: ROWS } });
    expect(html).toContain('Synthetic staging');
    expect(html).toContain('the live endpoint is not configured or did not answer: not_configured');
    expect(html).not.toContain('Live from Connect');
  });

  it('renders an empty table without throwing when no fiscal year is on file yet', () => {
    const html = renderBalancePage('multi-year', { balanceTrends: { source: 'live', rows: [] } });
    expect(html).toContain('Multi-year financial position');
  });
});
