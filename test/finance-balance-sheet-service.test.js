import { describe, expect, it } from 'vitest';
import { buildBalanceSheetView, readSyntheticBalanceSheet } from '../apps/finance/balance-sheet-service.js';

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
});
