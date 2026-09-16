import { describe, expect, it } from 'vitest';
import { buildFinancialMixView, buildLiveFinancialMixView } from '../apps/finance/financial-mix-service.js';

const rows = [
  { fiscal_year: 2026, classification: 'Income', account_name: 'Contributions', own_actual_cents: 9000000 },
  { fiscal_year: 2026, classification: 'Income', account_name: 'Program income', own_actual_cents: 3000000 },
  { fiscal_year: 2026, classification: 'Expenses', account_name: 'Programs', own_actual_cents: 6000000 },
  { fiscal_year: 2026, classification: 'Expenses', account_name: 'Operations', own_actual_cents: 2000000 },
];

describe('Finance synthetic revenue and expense mix', () => {
  it('calculates account shares and reconciles both sides to source totals', () => {
    expect(buildFinancialMixView(rows)).toEqual({
      fiscalYear: 2026,
      income: {
        totalCents: 12000000,
        items: [
          { accountName: 'Contributions', amountCents: 9000000, sharePct: 75 },
          { accountName: 'Program income', amountCents: 3000000, sharePct: 25 },
        ],
        reconciled: true,
      },
      expenses: {
        totalCents: 8000000,
        items: [
          { accountName: 'Programs', amountCents: 6000000, sharePct: 75 },
          { accountName: 'Operations', amountCents: 2000000, sharePct: 25 },
        ],
        reconciled: true,
      },
    });
  });

  it('fails closed on incomplete, negative, zero-total, or mixed-period inputs', () => {
    expect(() => buildFinancialMixView(rows.filter((row) => row.classification === 'Income'))).toThrow('Synthetic financial mix totals invalid');
    expect(() => buildFinancialMixView([{ ...rows[0], own_actual_cents: -1 }, ...rows.slice(1)])).toThrow('Synthetic financial mix rows invalid');
    expect(() => buildFinancialMixView(rows.map((row) => ({ ...row, own_actual_cents: 0 })))).toThrow('Synthetic financial mix totals invalid');
    expect(() => buildFinancialMixView([rows[0], { ...rows[2], fiscal_year: 2025 }])).toThrow('Synthetic financial mix fiscal year mismatch');
  });
});

describe('Finance live revenue and expense mix (connect.finance-church-report.v1-derived)', () => {
  const accounts = [
    { classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: 'Contributions', depth: 0, hasChildren: false, actualCents: 9000000, budgetCents: 8800000, source: 'import' },
    { classification: 'Income', categoryPath: 'Income:40100 Program Income', accountName: 'Program income', depth: 0, hasChildren: false, actualCents: 3000000, budgetCents: 2900000, source: 'import' },
    { classification: 'Expenses', categoryPath: 'Expenses:50000 Programs', accountName: 'Programs', depth: 0, hasChildren: false, actualCents: 6000000, budgetCents: 5800000, source: 'import' },
    { classification: 'Expenses', categoryPath: 'Expenses:50100 Operations', accountName: 'Operations', depth: 0, hasChildren: false, actualCents: 2000000, budgetCents: 1900000, source: 'import' },
  ];
  const totals = { incomeActualCents: 12000000, expenseActualCents: 8000000 };

  it('calculates account shares from the live totals rather than re-summing accounts', () => {
    expect(buildLiveFinancialMixView(accounts, 2026, totals)).toEqual({
      fiscalYear: 2026,
      income: {
        totalCents: 12000000,
        items: [
          { accountName: 'Contributions', amountCents: 9000000, sharePct: 75 },
          { accountName: 'Program income', amountCents: 3000000, sharePct: 25 },
        ],
        reconciled: true,
      },
      expenses: {
        totalCents: 8000000,
        items: [
          { accountName: 'Programs', amountCents: 6000000, sharePct: 75 },
          { accountName: 'Operations', amountCents: 2000000, sharePct: 25 },
        ],
        reconciled: true,
      },
    });
  });

  it('fails closed on a missing fiscal year, an empty side, or a nonpositive total', () => {
    expect(() => buildLiveFinancialMixView(accounts, null, totals)).toThrow('Live financial mix requires a fiscal year');
    expect(() => buildLiveFinancialMixView(accounts.filter((a) => a.classification === 'Income'), 2026, totals)).toThrow('Live financial mix totals invalid');
    expect(() => buildLiveFinancialMixView(accounts, 2026, { ...totals, expenseActualCents: 0 })).toThrow('Live financial mix totals invalid');
  });
});
