import { describe, expect, it } from 'vitest';
import { buildAccountsReportView, readSyntheticAccountsReport } from '../apps/finance/accounts-report-service.js';

const rows = [
  { classification: 'Expenses', category_path: 'Expenses:Synthetic Programs', account_name: 'Synthetic Programs', board_category_key: 'programs', board_category_label: 'Programs', purpose_tag_id: 'ministry', purpose_tag_label: 'Ministry' },
  { classification: 'Income', category_path: 'Income:Synthetic Contributions', account_name: 'Synthetic Contributions', board_category_key: 'donor', board_category_label: 'Unrestricted Gifts', purpose_tag_id: 'ministry', purpose_tag_label: 'Ministry' },
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

  it('counts classifications and the independent presentation lenses', () => {
    expect(buildAccountsReportView(rows)).toMatchObject({
      counts: { total: 2, income: 1, expenses: 1, boardCategories: 2, purposeTags: 1 },
    });
  });

  it('fails closed on empty or malformed account paths', async () => {
    for (const results of [
      [],
      [{ ...rows[0], category_path: 'Income:Wrong' }],
      [{ ...rows[0], board_category_key: null }],
      [{ ...rows[0], purpose_tag_id: null }],
    ]) {
      const db = {
        prepare(sql) { return { sql }; },
        async batch() { return [{ results }]; },
      };
      await expect(readSyntheticAccountsReport(db)).rejects.toThrow('Synthetic Chart of Accounts rows invalid');
    }
  });
});
