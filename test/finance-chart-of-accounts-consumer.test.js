import { describe, expect, it } from 'vitest';
import {
  acceptFinanceChartOfAccountsV1,
  validateFinanceChartOfAccountsV1,
} from '../apps/finance/finance-chart-of-accounts-consumer.js';

const example = {
  contract: 'connect.finance-chart-of-accounts.v1',
  dataClassification: 'structural',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  generatedAt: '2026-06-15T12:00:00Z',
  accounts: [
    {
      classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund',
      depth: 1, hasChildren: false, boardCategoryKey: 'donor', boardCategoryLabel: 'Donor',
      purposeTagId: null, purposeTagLabel: null,
    },
    {
      classification: 'Expenses', categoryPath: 'Expenses:Staff:Salaries', accountName: 'Pastoral Salary',
      depth: 2, hasChildren: false, boardCategoryKey: 'salaries', boardCategoryLabel: 'Salaries',
      purposeTagId: 'ministry', purposeTagLabel: 'Ministry',
    },
  ],
  reconciliation: { accountCount: 2, incomeCount: 1, expenseCount: 1, unassignedCount: 0 },
};

function changed(mutator) {
  const copy = structuredClone(example);
  mutator(copy);
  return copy;
}

describe('Finance consumer for connect.finance-chart-of-accounts.v1', () => {
  it('accepts and normalizes a valid producer payload', () => {
    const accepted = acceptFinanceChartOfAccountsV1(example);
    expect(accepted.contract).toBe('connect.finance-chart-of-accounts.v1');
    expect(accepted.accounts).toHaveLength(2);
    expect(accepted.reconciliation).toEqual(example.reconciliation);
  });

  it('accepts an empty ledger (no accounts imported yet)', () => {
    const empty = changed((v) => {
      v.accounts = [];
      v.reconciliation = { accountCount: 0, incomeCount: 0, expenseCount: 0, unassignedCount: 0 };
    });
    expect(validateFinanceChartOfAccountsV1(empty).ok).toBe(true);
  });

  it('accepts an unassigned account with no purpose tag', () => {
    const unassigned = changed((v) => {
      v.accounts[0].boardCategoryKey = 'unassigned';
      v.accounts[0].boardCategoryLabel = 'Unassigned';
      v.reconciliation.unassignedCount = 1;
    });
    expect(validateFinanceChartOfAccountsV1(unassigned).ok).toBe(true);
  });

  it.each([
    ['unknown major contract', (v) => { v.contract = 'connect.finance-chart-of-accounts.v2'; }],
    ['wrong classification', (v) => { v.dataClassification = 'aggregate'; }],
    ['wrong producer', (v) => { v.sourceProduct = 'finance'; }],
    ['wrong consumer', (v) => { v.consumerProduct = 'website'; }],
    ['unknown root field', (v) => { v.amountCents = 100; }],
    ['bad classification', (v) => { v.accounts[0].classification = 'Assets'; }],
    ['categoryPath missing classification prefix', (v) => { v.accounts[0].categoryPath = 'Offerings:General Fund'; }],
    ['empty accountName', (v) => { v.accounts[0].accountName = ''; }],
    ['negative depth', (v) => { v.accounts[0].depth = -1; }],
    ['fractional depth', (v) => { v.accounts[0].depth = 1.5; }],
    ['non-boolean hasChildren', (v) => { v.accounts[0].hasChildren = 'no'; }],
    ['uppercase boardCategoryKey', (v) => { v.accounts[0].boardCategoryKey = 'Donor'; }],
    ['empty boardCategoryLabel', (v) => { v.accounts[0].boardCategoryLabel = ''; }],
    ['purposeTagId set without label', (v) => { v.accounts[1].purposeTagLabel = null; }],
    ['purposeTagLabel set without id', (v) => { v.accounts[1].purposeTagId = null; }],
    ['unknown account field', (v) => { v.accounts[0].amountCents = 100; }],
    ['duplicate categoryPath', (v) => { v.accounts[1].categoryPath = v.accounts[0].categoryPath; v.accounts[1].classification = v.accounts[0].classification; }],
    ['malformed generatedAt', (v) => { v.generatedAt = 'not-a-date'; }],
    ['accountCount mismatch', (v) => { v.reconciliation.accountCount = 99; }],
    ['incomeCount mismatch', (v) => { v.reconciliation.incomeCount = 99; }],
    ['expenseCount mismatch', (v) => { v.reconciliation.expenseCount = 99; }],
    ['unassignedCount mismatch', (v) => { v.reconciliation.unassignedCount = 99; }],
    ['unknown reconciliation field', (v) => { v.reconciliation.total = 2; }],
  ])('fails closed on %s', (_label, mutate) => {
    const value = changed(mutate);
    expect(validateFinanceChartOfAccountsV1(value).ok).toBe(false);
    expect(() => acceptFinanceChartOfAccountsV1(value)).toThrow(/Rejected connect\.finance-chart-of-accounts\.v1/);
  });

  it('returns detached data rather than retaining producer-owned objects', () => {
    const source = structuredClone(example);
    const accepted = acceptFinanceChartOfAccountsV1(source);
    source.accounts[0].boardCategoryKey = 'earned';
    source.reconciliation.accountCount = 999;
    expect(accepted.accounts[0].boardCategoryKey).toBe('donor');
    expect(accepted.reconciliation.accountCount).toBe(2);
  });
});
