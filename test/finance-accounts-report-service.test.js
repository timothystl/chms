import { describe, expect, it } from 'vitest';
import { buildAccountsReportView, readSyntheticAccountsReport } from '../apps/finance/accounts-report-service.js';

const rows = [
  { classification: 'Expenses', category_path: 'Expenses:Synthetic Programs', account_name: 'Synthetic Programs' },
  { classification: 'Income', category_path: 'Income:Synthetic Contributions', account_name: 'Synthetic Contributions' },
];

describe('Finance synthetic Chart of Accounts service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticAccountsReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("source='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('counts the account inventory by classification', () => {
    expect(buildAccountsReportView(rows)).toMatchObject({
      counts: { total: 2, income: 1, expenses: 1 },
    });
  });

  it('fails closed on empty or malformed account paths', async () => {
    for (const results of [[], [{ ...rows[0], category_path: 'Income:Wrong' }]]) {
      const db = {
        prepare(sql) { return { sql }; },
        async batch() { return [{ results }]; },
      };
      await expect(readSyntheticAccountsReport(db)).rejects.toThrow('Synthetic Chart of Accounts rows invalid');
    }
  });
});
