import { describe, expect, it } from 'vitest';
import {
  buildBalanceSheetView, readSyntheticBalanceSheet, readSyntheticBalanceTrends,
  resolveBalanceSheet, resolveBalanceSheetTrend, buildLiveBalanceSheetView,
} from '../apps/finance/balance-sheet-service.js';

const rows = [
  { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Assets', account_name: 'Synthetic Cash', own_balance_cents: 30000000 },
  { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Liabilities', account_name: 'Synthetic Note', own_balance_cents: 10000000 },
  { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Equity', account_name: 'Synthetic Net Assets', own_balance_cents: 20000000 },
];

describe('Finance synthetic Balance Sheet service', () => {
  it('runs one SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticBalanceSheet(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("source='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('groups classifications and reconciles the accounting equation', () => {
    expect(buildBalanceSheetView(rows)).toMatchObject({
      fiscalYear: 2026,
      asOfDate: '2026-12-31',
      totals: {
        assetsCents: 30000000,
        liabilitiesCents: 10000000,
        equityCents: 20000000,
        equationDifferenceCents: 0,
      },
    });
  });

  it('fails closed on empty or malformed fixture data', async () => {
    for (const results of [[], [{ ...rows[0], classification: 'Revenue' }]]) {
      const db = {
        prepare(sql) { return { sql }; },
        async batch() { return [{ results }]; },
      };
      await expect(readSyntheticBalanceSheet(db)).rejects.toThrow('Synthetic Balance Sheet rows invalid');
    }
  });

  it('derives reconciled multi-year position trends', async () => {
    const trendRows = [
      { fiscal_year: 2025, as_of_date: '2025-12-31', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 16000000 },
      { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
    ];
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: trendRows }]; } };
    await expect(readSyntheticBalanceTrends(db)).resolves.toEqual([
      { ...trendRows[0], net_assets_cents: 16000000 },
      { ...trendRows[1], net_assets_cents: 20000000 },
    ]);
  });

  it('fails closed on an incomplete or unreconciled position trend', async () => {
    for (const results of [[{ fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 }], [
      { fiscal_year: 2025, as_of_date: '2025-12-31', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 15000000 },
      { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
    ]]) {
      const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results }]; } };
      await expect(readSyntheticBalanceTrends(db)).rejects.toThrow('Synthetic Balance Sheet trend rows invalid');
    }
  });
});

function dbWith(results) {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      expect(statements).toHaveLength(1);
      expect(statements[0].sql).toMatch(/^SELECT\b/);
      expect(statements[0].sql).toContain("source='synthetic_fixture'");
      return [{ results }];
    },
  };
}

const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-balance-sheet.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  fiscalYear: new Date().getUTCFullYear(), asOfDate: '2026-12-31', generatedAt: '2026-09-14T12:00:00Z',
  accounts: [{
    classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash',
    depth: 0, hasChildren: false, ownBalanceCents: 30000000,
  }],
  totals: {
    assetsCents: 30000000, liabilitiesCents: 0, equityCents: 0,
    currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 30000000,
    liabilitiesPlusEquityCents: 0, balancedCents: 30000000,
  },
  equityReclass: {
    donorRestrictedCents: 0, unrestrictedCents: 0, totalEquityCents: 0,
    breakdown: {
      perpetual: { label: 'Perpetual endowments', cents: 0 },
      purpose_time: { label: 'Purpose/time restricted', cents: 0 },
      designated: { label: 'Designated ministry/purpose funds', cents: 0 },
    },
    unclassified: [],
  },
  reconciliation: { accountCount: 1, assetsCount: 1, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true },
};

describe('resolveBalanceSheet (live connect.finance-balance-sheet.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const result = await resolveBalanceSheet({}, dbWith(rows));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(rows);
  });

  it('requests the current fiscal year and returns the live payload as-is (camelCase, not remapped)', async () => {
    let requestedUrl;
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBalanceSheet(env, dbWith(rows));
    expect(result.source).toBe('live');
    expect(result.fiscalYear).toBe(new Date().getUTCFullYear());
    expect(requestedUrl.searchParams.get('fiscal_year')).toBe(String(new Date().getUTCFullYear()));
    expect(result.accounts).toEqual(VALID_LIVE_PAYLOAD.accounts);
    expect(result.asOfDate).toBe('2026-12-31');
    expect(result.equityReclass).toEqual(VALID_LIVE_PAYLOAD.equityReclass);
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-balance-sheet.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBalanceSheet(env, dbWith(rows));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(rows);
  });
});

const TREND_ROWS = [
  { fiscal_year: 2025, as_of_date: '2025-12-31', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 16000000 },
  { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
];

const VALID_LIVE_TREND_PAYLOAD = {
  contract: 'connect.finance-balance-sheet-trend.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  generatedAt: '2026-09-16T12:00:00Z',
  years: [
    { fiscalYear: 2025, asOfDate: 'FY2025', assetsCents: 27000000, liabilitiesCents: 11000000, equityCents: 16000000, netAssetsCents: 16000000, balancedCents: 0 },
    { fiscalYear: 2026, asOfDate: '2026-12-31', assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000, netAssetsCents: 20000000, balancedCents: 0 },
  ],
  reconciliation: { yearCount: 2, totalsMatch: true },
};

describe('resolveBalanceSheetTrend (live connect.finance-balance-sheet-trend.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic trend fixture when the live contract is not configured', async () => {
    const result = await resolveBalanceSheetTrend({}, dbWith(TREND_ROWS));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(TREND_ROWS.map((row) => ({ ...row, net_assets_cents: row.assets_cents - row.liabilities_cents })));
  });

  it('requests no fiscal_year parameter and remaps the live camelCase years to the same snake_case row shape the synthetic fixture returns', async () => {
    let requestedUrl;
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify(VALID_LIVE_TREND_PAYLOAD), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBalanceSheetTrend(env, dbWith(TREND_ROWS));
    expect(result.source).toBe('live');
    expect(requestedUrl.pathname).toBe('/api/contracts/finance-balance-sheet-trend-v1');
    expect(requestedUrl.searchParams.has('fiscal_year')).toBe(false);
    expect(result.rows).toEqual([
      { fiscal_year: 2025, as_of_date: 'FY2025', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 16000000, net_assets_cents: 16000000 },
      { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000, net_assets_cents: 20000000 },
    ]);
  });

  it('falls back to the synthetic trend fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-balance-sheet-trend.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBalanceSheetTrend(env, dbWith(TREND_ROWS));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(TREND_ROWS.map((row) => ({ ...row, net_assets_cents: row.assets_cents - row.liabilities_cents })));
  });
});

describe('buildLiveBalanceSheetView', () => {
  it('requires a fiscal year', () => {
    expect(() => buildLiveBalanceSheetView([], undefined, '', {}, {})).toThrow('Live Balance Sheet requires a fiscal year');
  });

  it('groups accounts by classification and carries totals/equityReclass through untouched', () => {
    const accounts = [
      { classification: 'Assets', categoryPath: 'Assets:A', accountName: 'A', depth: 0, hasChildren: false, ownBalanceCents: 500000 },
      { classification: 'Liabilities', categoryPath: 'Liabilities:B', accountName: 'B', depth: 0, hasChildren: false, ownBalanceCents: 200000 },
      { classification: 'Equity', categoryPath: 'Equity:C', accountName: 'C', depth: 0, hasChildren: false, ownBalanceCents: 300000 },
    ];
    const totals = { assetsCents: 500000, liabilitiesCents: 200000, equityCents: 300000, currentAssetsCents: 500000, fixedAssetsCents: 0, otherAssetsCents: 0, liabilitiesPlusEquityCents: 500000, balancedCents: 0 };
    const equityReclass = VALID_LIVE_PAYLOAD.equityReclass;
    const view = buildLiveBalanceSheetView(accounts, 2026, '2026-12-31', totals, equityReclass);
    expect(view.fiscalYear).toBe(2026);
    expect(view.asOfDate).toBe('2026-12-31');
    expect(view.assets).toEqual([accounts[0]]);
    expect(view.liabilities).toEqual([accounts[1]]);
    expect(view.equity).toEqual([accounts[2]]);
    expect(view.totals).toEqual({ assetsCents: 500000, liabilitiesCents: 200000, equityCents: 300000, equationDifferenceCents: 0 });
    expect(view.equityReclass).toBe(equityReclass);
  });

  it('handles an empty-accounts fiscal year without fabricating totals', () => {
    const totals = { assetsCents: 0, liabilitiesCents: 0, equityCents: 0, currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 0, liabilitiesPlusEquityCents: 0, balancedCents: 0 };
    const view = buildLiveBalanceSheetView([], 2030, '', totals, VALID_LIVE_PAYLOAD.equityReclass);
    expect(view.assets).toEqual([]);
    expect(view.liabilities).toEqual([]);
    expect(view.equity).toEqual([]);
    expect(view.totals).toEqual({ assetsCents: 0, liabilitiesCents: 0, equityCents: 0, equationDifferenceCents: 0 });
  });
});
