import { describe, expect, it } from 'vitest';
import { buildAccountHierarchy, buildAccountsReportView, readSyntheticAccountsReport, resolveAccountsReport } from '../apps/finance/accounts-report-service.js';

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

  it('builds a deterministic hierarchy without changing ledger or presentation labels', () => {
    expect(buildAccountHierarchy(rows)).toEqual([
      {
        label: 'Income', path: 'Income', depth: 0, account: null,
        children: [{
          label: 'Synthetic Contributions', path: 'Income:Synthetic Contributions', depth: 1,
          account: { name: 'Synthetic Contributions', boardCategoryLabel: 'Unrestricted Gifts', purposeTagLabel: 'Ministry' },
          children: [],
        }],
      },
      {
        label: 'Expenses', path: 'Expenses', depth: 0, account: null,
        children: [{
          label: 'Synthetic Programs', path: 'Expenses:Synthetic Programs', depth: 1,
          account: { name: 'Synthetic Programs', boardCategoryLabel: 'Programs', purposeTagLabel: 'Ministry' },
          children: [],
        }],
      },
    ]);
  });

  it('rejects empty segments and duplicate account leaves', () => {
    expect(() => buildAccountHierarchy([{ ...rows[0], category_path: 'Expenses::Programs' }])).toThrow('Synthetic account hierarchy path invalid');
    expect(() => buildAccountHierarchy([rows[0], { ...rows[0], account_name: 'Duplicate' }])).toThrow('Synthetic account hierarchy duplicate leaf');
  });

  it('retains arbitrary nested ledger path depth', () => {
    const nested = buildAccountHierarchy([{
      ...rows[1], category_path: 'Income:Donor:General', account_name: 'General offering',
    }]);
    expect(nested[0].children[0]).toMatchObject({
      label: 'Donor', path: 'Income:Donor', depth: 1, account: null,
      children: [{
        label: 'General', path: 'Income:Donor:General', depth: 2,
        account: { name: 'General offering', boardCategoryLabel: 'Unrestricted Gifts', purposeTagLabel: 'Ministry' },
      }],
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

describe('resolveAccountsReport (live connect.finance-chart-of-accounts.v1 with synthetic fallback)', () => {
  function fixtureDb() {
    return {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
  }

  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const result = await resolveAccountsReport({}, fixtureDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(rows);
  });

  it('maps a live contract payload onto the exact row shape the synthetic reader produces', async () => {
    const env = {
      CONNECT_SERVICE: {
        async fetch() {
          return new Response(JSON.stringify({
            contract: 'connect.finance-chart-of-accounts.v1', dataClassification: 'structural',
            sourceProduct: 'connect', consumerProduct: 'finance', generatedAt: '2026-06-15T00:00:00Z',
            accounts: [{
              classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund',
              depth: 1, hasChildren: false, boardCategoryKey: 'donor', boardCategoryLabel: 'Donor',
              purposeTagId: null, purposeTagLabel: null,
            }],
            reconciliation: { accountCount: 1, incomeCount: 1, expenseCount: 0, unassignedCount: 0 },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveAccountsReport(env, fixtureDb());
    expect(result.source).toBe('live');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.rows).toEqual([{
      classification: 'Income', category_path: 'Income:Offerings:General Fund', account_name: 'General Fund',
      board_category_key: 'donor', board_category_label: 'Donor', purpose_tag_id: null, purpose_tag_label: null,
    }]);
    // The mapped row shape must still satisfy buildAccountHierarchy/buildAccountsReportView unchanged.
    expect(buildAccountsReportView(result.rows).counts).toEqual({ total: 1, income: 1, expenses: 0, boardCategories: 1, purposeTags: 0 });
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-chart-of-accounts.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveAccountsReport(env, fixtureDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(rows);
  });
});
