import { describe, expect, it } from 'vitest';
import { buildSyntheticBoardPacket, buildLiveBoardPacket } from '../apps/finance/board-packet-service.js';
import { SYNTHETIC_UNAVAILABLE } from '../apps/finance/synthetic-read-guard.js';

const input = {
  summary: { balanceSheet: { assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 } },
  churchReport: { fiscalYear: 2026, totals: { actualNetCents: 4000000, budgetNetCents: 4000000 } },
  churchTrends: [
    { fiscal_year: 2025, net_cents: 3200000 },
    { fiscal_year: 2026, net_cents: 4000000 },
  ],
  giving: { totals: { netCents: 145000 }, reconciliation: { sourceRecordCount: 6, totalsMatch: true } },
};

describe('Finance synthetic board packet', () => {
  it('assembles one reconciled decision snapshot from existing bounded reads', () => {
    expect(buildSyntheticBoardPacket(input)).toEqual({
      fiscalYear: 2026,
      operating: { actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0, disposition: 'on budget' },
      position: { assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000, equationDifferenceCents: 0 },
      giving: { netCents: 145000, sourceRecordCount: 6, reconciled: true },
      trend: { priorFiscalYear: 2025, currentFiscalYear: 2026, priorNetCents: 3200000, currentNetCents: 4000000, changeCents: 800000 },
      ready: true,
    });
  });

  it('labels a negative budget variance unfavorable', () => {
    const packet = buildSyntheticBoardPacket({
      ...input,
      churchReport: { ...input.churchReport, totals: { actualNetCents: 3000000, budgetNetCents: 4000000 } },
    });
    expect(packet.operating).toMatchObject({ varianceCents: -1000000, disposition: 'unfavorable' });
  });

  it('fails closed on unreconciled, incomplete, or mismatched inputs', () => {
    expect(() => buildSyntheticBoardPacket({ ...input, giving: { ...input.giving, reconciliation: { totalsMatch: false } } })).toThrow('Synthetic board packet inputs invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, churchTrends: [input.churchTrends[0]] })).toThrow('Synthetic board packet inputs invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, churchTrends: [input.churchTrends[0], { ...input.churchTrends[1], fiscal_year: 2027 }] })).toThrow('Synthetic board packet periods invalid');
    expect(() => buildSyntheticBoardPacket({ ...input, summary: { balanceSheet: { ...input.summary.balanceSheet, equity_cents: 19000000 } } })).toThrow('Synthetic board packet position unreconciled');
  });
});

describe('Finance live-first board packet (buildLiveBoardPacket)', () => {
  const LIVE_CHURCH_REPORT = {
    source: 'live', fiscalYear: 2026,
    totals: { netIncomeActualCents: 8000000, netIncomeBudgetCents: 7000000 },
  };
  const SYNTHETIC_CHURCH_REPORT_FALLBACK = {
    source: 'synthetic-fallback',
    rows: [
      { fiscal_year: 2026, classification: 'Income', account_name: 'Contributions', own_actual_cents: 12000000, own_budget_cents: 12000000 },
      { fiscal_year: 2026, classification: 'Expenses', account_name: 'Programs', own_actual_cents: 8000000, own_budget_cents: 8000000 },
    ],
  };
  const LIVE_BALANCE_SHEET = {
    source: 'live',
    totals: { assetsCents: 45000000, liabilitiesCents: 15000000, equityCents: 30000000 },
  };
  const SYNTHETIC_BALANCE_SHEET_FALLBACK = {
    source: 'synthetic-fallback',
    rows: [
      { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Assets', account_name: 'Cash', own_balance_cents: 30000000 },
      { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Liabilities', account_name: 'Note', own_balance_cents: 10000000 },
      { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Equity', account_name: 'Net Assets', own_balance_cents: 20000000 },
    ],
  };
  const LIVE_TREND = {
    source: 'live',
    years: [
      { fiscalYear: 2025, netIncomeActualCents: 3200000 },
      { fiscalYear: 2026, netIncomeActualCents: 4000000 },
    ],
  };
  const SYNTHETIC_TREND_FALLBACK = {
    source: 'synthetic-fallback',
    rows: [
      { fiscal_year: 2025, net_cents: 3200000 },
      { fiscal_year: 2026, net_cents: 4000000 },
    ],
  };
  const GIVING = { totals: { netCents: 145000 }, reconciliation: { sourceRecordCount: 6, totalsMatch: true } };

  it('prefers real live data on every card, independently, and labels each one live', () => {
    const packet = buildLiveBoardPacket({
      churchReportLive: LIVE_CHURCH_REPORT, balanceSheetLive: LIVE_BALANCE_SHEET, churchTrendLive: LIVE_TREND,
      giving: GIVING, givingSource: 'live',
    });
    expect(packet.ready).toBe(true);
    expect(packet.reconciled).toBe(true);
    expect(packet.fiscalYear).toBe(2026);
    expect(packet.operating).toEqual({
      fiscalYear: 2026, actualNetCents: 8000000, budgetNetCents: 7000000, varianceCents: 1000000, disposition: 'favorable', source: 'live',
    });
    expect(packet.position).toEqual({
      assetsCents: 45000000, liabilitiesCents: 15000000, netAssetsCents: 30000000, equationDifferenceCents: 0, source: 'live',
    });
    expect(packet.trend).toEqual({
      priorFiscalYear: 2025, currentFiscalYear: 2026, priorNetCents: 3200000, currentNetCents: 4000000, changeCents: 800000, source: 'live',
    });
    expect(packet.giving).toEqual({ netCents: 145000, sourceRecordCount: 6, reconciled: true, source: 'live' });
  });

  it('falls back to the same synthetic fixture arithmetic, per card, labeled synthetic-fallback, matching the retired all-or-nothing function\'s own numbers', () => {
    const packet = buildLiveBoardPacket({
      churchReportLive: SYNTHETIC_CHURCH_REPORT_FALLBACK, balanceSheetLive: SYNTHETIC_BALANCE_SHEET_FALLBACK, churchTrendLive: SYNTHETIC_TREND_FALLBACK,
      giving: GIVING, givingSource: 'synthetic-fallback',
    });
    // Same input shape as the `input` fixture at the top of this file, so the same reconciled
    // snapshot buildSyntheticBoardPacket(input) produces above -- proving this replacement doesn't
    // silently change the arithmetic for the pure-synthetic case, only how it degrades.
    expect(packet.ready).toBe(true);
    expect(packet.reconciled).toBe(true);
    expect(packet.operating).toMatchObject({ actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0, disposition: 'on budget', source: 'synthetic-fallback' });
    expect(packet.position).toMatchObject({ assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000, equationDifferenceCents: 0, source: 'synthetic-fallback' });
    expect(packet.trend).toMatchObject({ priorFiscalYear: 2025, currentFiscalYear: 2026, priorNetCents: 3200000, currentNetCents: 4000000, changeCents: 800000, source: 'synthetic-fallback' });
    expect(packet.giving).toMatchObject({ netCents: 145000, sourceRecordCount: 6, reconciled: true, source: 'synthetic-fallback' });
  });

  it('degrades only the cards without usable data, independently, when sources are mixed', () => {
    // Church Report live; Balance Sheet's own live read failed entirely (SYNTHETIC_UNAVAILABLE,
    // see synthetic-read-guard.js -- e.g. its synthetic fallback read also threw against an empty
    // table); trend stayed on the synthetic fallback. Operating/trend/giving must still render.
    const packet = buildLiveBoardPacket({
      churchReportLive: LIVE_CHURCH_REPORT, balanceSheetLive: SYNTHETIC_UNAVAILABLE, churchTrendLive: SYNTHETIC_TREND_FALLBACK,
      giving: GIVING, givingSource: 'synthetic-fallback',
    });
    expect(packet.ready).toBe(false);
    expect(packet.reconciled).toBe(false);
    expect(packet.operating).not.toBeNull();
    expect(packet.operating.source).toBe('live');
    expect(packet.position).toBeNull();
    expect(packet.trend).not.toBeNull();
    expect(packet.giving).not.toBeNull();
  });

  it('degrades every card to null, never throwing, when nothing at all is available', () => {
    const packet = buildLiveBoardPacket({
      churchReportLive: SYNTHETIC_UNAVAILABLE, balanceSheetLive: SYNTHETIC_UNAVAILABLE, churchTrendLive: SYNTHETIC_UNAVAILABLE,
      giving: null, givingSource: undefined,
    });
    expect(packet).toEqual({
      fiscalYear: null, operating: null, position: null, trend: null, giving: null, ready: false, reconciled: false,
    });
  });

  it('shows an imbalanced live position rather than hiding it, and marks the packet unreconciled', () => {
    const packet = buildLiveBoardPacket({
      churchReportLive: LIVE_CHURCH_REPORT,
      balanceSheetLive: { source: 'live', totals: { assetsCents: 45000000, liabilitiesCents: 15000000, equityCents: 29000000 } },
      churchTrendLive: LIVE_TREND, giving: GIVING, givingSource: 'live',
    });
    expect(packet.ready).toBe(true);
    expect(packet.position).toEqual({
      assetsCents: 45000000, liabilitiesCents: 15000000, netAssetsCents: 29000000, equationDifferenceCents: 1000000, source: 'live',
    });
    expect(packet.reconciled).toBe(false);
  });

  it('does not require the trend\'s current fiscal year to equal the operating card\'s fiscal year, unlike the retired all-or-nothing function', () => {
    // Operating result is live for FY2026; the trend card is independently on the synthetic
    // fallback and still renders, even though its own "current" year matches by coincidence here
    // and its source differs entirely from operating's.
    const packet = buildLiveBoardPacket({
      churchReportLive: LIVE_CHURCH_REPORT,
      balanceSheetLive: LIVE_BALANCE_SHEET,
      churchTrendLive: { source: 'synthetic-fallback', rows: [{ fiscal_year: 2024, net_cents: 1000000 }, { fiscal_year: 2025, net_cents: 1500000 }] },
      giving: GIVING, givingSource: 'live',
    });
    expect(packet.ready).toBe(true);
    expect(packet.trend).toMatchObject({ priorFiscalYear: 2024, currentFiscalYear: 2025, source: 'synthetic-fallback' });
  });
});
