import { describe, expect, it } from 'vitest';
import { buildFinancialHealthView } from '../apps/finance/health-view-model.js';
import { SYNTHETIC_UNAVAILABLE } from '../apps/finance/synthetic-read-guard.js';

const SYNTHETIC_SUMMARY = {
  church: {
    income_actual_cents: 12000000, expense_actual_cents: 8000000,
    income_budget_cents: 12500000, expense_budget_cents: 8500000,
  },
  balanceSheet: { assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
};
const GIVING = {
  funds: [{
    fundRef: '1', fundLabel: 'General Fund', giftCount: 6, householdCount: 4,
    amounts: { grossCents: 150000, refundCents: 5000, netCents: 145000 }, isGeneralFund: true,
  }],
  totals: { grossCents: 150000, refundCents: 5000, netCents: 145000 },
  reconciliation: { sourceRecordCount: 6, totalsMatch: true },
};

const LIVE_CHURCH_REPORT = {
  source: 'live',
  fiscalYear: 2026,
  accounts: [],
  totals: {
    incomeActualCents: 17500000, incomeBudgetCents: 16000000, expenseActualCents: 9500000, expenseBudgetCents: 9000000,
    netIncomeActualCents: 8000000, netIncomeBudgetCents: 7000000, hasBudgetData: true,
  },
};
const SYNTHETIC_FALLBACK_CHURCH_REPORT = { source: 'synthetic-fallback', fallbackReason: 'not_configured', rows: [] };

const LIVE_BALANCE_SHEET = {
  source: 'live',
  fiscalYear: 2026,
  asOfDate: '2026-09-15',
  accounts: [],
  totals: {
    assetsCents: 45000000, liabilitiesCents: 15000000, equityCents: 30000000,
    currentAssetsCents: 45000000, fixedAssetsCents: 0, otherAssetsCents: 0,
    liabilitiesPlusEquityCents: 45000000, balancedCents: 0,
  },
  equityReclass: { donorRestrictedCents: 10000000, unrestrictedCents: 20000000, totalEquityCents: 30000000 },
};
const SYNTHETIC_FALLBACK_BALANCE_SHEET = { source: 'synthetic-fallback', fallbackReason: 'not_configured', rows: [] };

describe('isolated Financial Health view model', () => {
  it('derives the existing decision-oriented concepts from synthetic aggregates when no live result is passed', () => {
    const view = buildFinancialHealthView(SYNTHETIC_SUMMARY, GIVING);

    expect(view.operating).toEqual({
      incomeActualCents: 12000000, expenseActualCents: 8000000,
      actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0,
      source: 'synthetic-fallback',
    });
    expect(view.position).toEqual({
      assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000,
      source: 'synthetic-fallback',
    });
    expect(view.giving).toMatchObject({ grossCents: 150000, refundCents: 5000, netCents: 145000, sourceRecordCount: 6, reconciled: true });
    expect(view.decisions.map(({ authority }) => authority)).toEqual([
      'Full control', 'Reported, not managed', 'Timing decision',
    ]);
  });

  // The board's headline giving figure (Andrew, 2026-09-17): General Fund only, not every
  // restricted/designated fund summed together -- giving.totals (all funds) stays available for
  // Charts/Board packet, which still want the whole-church figure.
  it('sums only funds flagged isGeneralFund, ignoring restricted/designated funds in giving.totals', () => {
    const multiFund = {
      funds: [
        { fundRef: '1', fundLabel: 'General Fund', giftCount: 3, householdCount: 2,
          amounts: { grossCents: 100000, refundCents: 1000, netCents: 99000 }, isGeneralFund: true },
        { fundRef: '2', fundLabel: 'Building Fund', giftCount: 2, householdCount: 1,
          amounts: { grossCents: 50000, refundCents: 0, netCents: 50000 }, isGeneralFund: false },
      ],
      totals: { grossCents: 150000, refundCents: 1000, netCents: 149000 },
      reconciliation: { sourceRecordCount: 5, totalsMatch: true },
    };
    const view = buildFinancialHealthView(SYNTHETIC_SUMMARY, multiFund);
    expect(view.giving).toEqual({
      grossCents: 100000, refundCents: 1000, netCents: 99000, sourceRecordCount: 3, reconciled: true,
    });
  });

  it('prefers live Church Report/Balance Sheet totals over the synthetic summary when both live results succeed', () => {
    const view = buildFinancialHealthView(SYNTHETIC_SUMMARY, GIVING, {
      churchReportLive: LIVE_CHURCH_REPORT,
      balanceSheetLive: LIVE_BALANCE_SHEET,
    });

    expect(view.operating).toEqual({
      incomeActualCents: 17500000, expenseActualCents: 9500000,
      actualNetCents: 8000000, budgetNetCents: 7000000, varianceCents: 1000000,
      source: 'live',
    });
    // "Net assets" is totals.equityCents -- the whole reclassified Equity total, guaranteed equal
    // to equityReclass.totalEquityCents (see resolvePosition's own comment) -- not a slice of it.
    expect(view.position).toEqual({
      assetsCents: 45000000, liabilitiesCents: 15000000, netAssetsCents: 30000000,
      source: 'live',
    });
  });

  it('falls back to the synthetic summary per-card when a live result is present but not actually live (its own synthetic-fallback)', () => {
    const view = buildFinancialHealthView(SYNTHETIC_SUMMARY, GIVING, {
      churchReportLive: SYNTHETIC_FALLBACK_CHURCH_REPORT,
      balanceSheetLive: SYNTHETIC_FALLBACK_BALANCE_SHEET,
    });

    expect(view.operating).toEqual({
      incomeActualCents: 12000000, expenseActualCents: 8000000,
      actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0,
      source: 'synthetic-fallback',
    });
    expect(view.position).toEqual({
      assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000,
      source: 'synthetic-fallback',
    });
  });

  it('lets one card be live while the other independently falls back to synthetic', () => {
    const churchLiveOnly = buildFinancialHealthView(SYNTHETIC_SUMMARY, GIVING, {
      churchReportLive: LIVE_CHURCH_REPORT,
      balanceSheetLive: SYNTHETIC_FALLBACK_BALANCE_SHEET,
    });
    expect(churchLiveOnly.operating.source).toBe('live');
    expect(churchLiveOnly.operating.actualNetCents).toBe(8000000);
    expect(churchLiveOnly.position.source).toBe('synthetic-fallback');
    expect(churchLiveOnly.position.netAssetsCents).toBe(20000000);

    const balanceLiveOnly = buildFinancialHealthView(SYNTHETIC_SUMMARY, GIVING, {
      churchReportLive: SYNTHETIC_FALLBACK_CHURCH_REPORT,
      balanceSheetLive: LIVE_BALANCE_SHEET,
    });
    expect(balanceLiveOnly.operating.source).toBe('synthetic-fallback');
    expect(balanceLiveOnly.operating.actualNetCents).toBe(4000000);
    expect(balanceLiveOnly.position.source).toBe('live');
    expect(balanceLiveOnly.position.netAssetsCents).toBe(30000000);
  });

  it('degrades each card independently to null -- never a fabricated $0 -- when neither its live result nor the synthetic summary is usable', () => {
    // SYNTHETIC_UNAVAILABLE summary (the shell.js sentinel for "the synthetic read itself failed",
    // see synthetic-read-guard.js) with no live override at all.
    const bothUnavailable = buildFinancialHealthView(SYNTHETIC_UNAVAILABLE, GIVING);
    expect(bothUnavailable.operating).toBeNull();
    expect(bothUnavailable.position).toBeNull();
    // Giving is unaffected -- it never depends on `summary`.
    expect(bothUnavailable.giving).toMatchObject({ netCents: 145000, reconciled: true });

    // A live attempt whose OWN synthetic fallback also failed (SYNTHETIC_UNAVAILABLE) plus an
    // unusable summary -- still null, still never throws.
    const liveAlsoUnavailable = buildFinancialHealthView(SYNTHETIC_UNAVAILABLE, GIVING, {
      churchReportLive: SYNTHETIC_UNAVAILABLE,
      balanceSheetLive: SYNTHETIC_UNAVAILABLE,
    });
    expect(liveAlsoUnavailable.operating).toBeNull();
    expect(liveAlsoUnavailable.position).toBeNull();
  });

  it('still recovers via the live result even when the synthetic summary itself is unavailable', () => {
    const view = buildFinancialHealthView(SYNTHETIC_UNAVAILABLE, GIVING, {
      churchReportLive: LIVE_CHURCH_REPORT,
      balanceSheetLive: LIVE_BALANCE_SHEET,
    });
    expect(view.operating).toEqual({
      incomeActualCents: 17500000, expenseActualCents: 9500000,
      actualNetCents: 8000000, budgetNetCents: 7000000, varianceCents: 1000000,
      source: 'live',
    });
    expect(view.position.source).toBe('live');
  });
});
