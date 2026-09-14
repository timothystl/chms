import { describe, it, expect } from 'vitest';
import { validateFinanceChurchReportV1, acceptFinanceChurchReportV1 } from '../apps/finance/finance-church-report-consumer.js';

function validAccount(overrides = {}) {
  return {
    classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions',
    depth: 0, hasChildren: false, actualCents: 1300000, budgetCents: 1250000, source: 'import',
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-church-report.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear: 2026,
    generatedAt: '2026-09-14T12:00:00Z',
    accounts: [
      validAccount(),
      validAccount({ classification: 'Expenses', categoryPath: 'Expenses:51006 Bank Fees', accountName: '51006 Bank Fees', actualCents: 4200, budgetCents: null }),
    ],
    totals: {
      incomeActualCents: 1300000, incomeBudgetCents: 1250000,
      expenseActualCents: 4200, expenseBudgetCents: 0,
      netIncomeActualCents: 1295800, netIncomeBudgetCents: 1250000,
      hasBudgetData: true,
    },
    reconciliation: {
      accountCount: 2, incomeCount: 1, expenseCount: 1, otherIncomeCount: 0, otherExpenseCount: 0,
      costOfGoodsSoldCount: 0, accountsWithBudgetCount: 1, totalsMatch: true,
    },
    ...overrides,
  };
}

describe('validateFinanceChurchReportV1', () => {
  it('accepts a well-formed real-shaped payload', () => {
    const result = validateFinanceChurchReportV1(validPayload());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty-accounts payload for a fiscal year nothing has been synced/imported for', () => {
    const payload = validPayload({
      accounts: [],
      totals: { incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0, netIncomeActualCents: 0, netIncomeBudgetCents: 0, hasBudgetData: false },
      reconciliation: { accountCount: 0, incomeCount: 0, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0, costOfGoodsSoldCount: 0, accountsWithBudgetCount: 0, totalsMatch: true },
    });
    expect(validateFinanceChurchReportV1(payload).ok).toBe(true);
  });

  it('accepts a null budgetCents per account -- the common real-data case', () => {
    const payload = validPayload();
    expect(payload.accounts[1].budgetCents).toBeNull();
    expect(validateFinanceChurchReportV1(payload).ok).toBe(true);
  });

  it('rejects a non-integer budgetCents', () => {
    const payload = validPayload();
    payload.accounts[0].budgetCents = 12.5;
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects an unrecognized classification', () => {
    const payload = validPayload();
    payload.accounts[0].classification = 'Assets';
    const result = validateFinanceChurchReportV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('classification'))).toBe(true);
  });

  it('accepts every real P&L classification, including Other Income/Other Expenses/Cost of Goods Sold, with the correct reconciled bottom line', () => {
    // { headline income/expense contribution, netIncome sign } for one account of actualCents
    // 1300000 / budgetCents 1250000 in each classification, matching computeYearSummary's
    // Income - COGS - Expenses + (Other Income - Other Expenses) arithmetic.
    const cases = [
      { classification: 'Income', countKey: 'incomeCount', income: 1300000, expense: 0, netSign: 1 },
      { classification: 'Expenses', countKey: 'expenseCount', income: 0, expense: 1300000, netSign: -1 },
      { classification: 'Other Income', countKey: 'otherIncomeCount', income: 0, expense: 0, netSign: 1 },
      { classification: 'Other Expenses', countKey: 'otherExpenseCount', income: 0, expense: 0, netSign: -1 },
      { classification: 'Cost of Goods Sold', countKey: 'costOfGoodsSoldCount', income: 0, expense: 0, netSign: -1 },
    ];
    for (const { classification, countKey, income, expense, netSign } of cases) {
      const payload = validPayload({ accounts: [validAccount({ classification, categoryPath: `${classification}:X` })] });
      payload.reconciliation = { accountCount: 1, incomeCount: 0, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0, costOfGoodsSoldCount: 0, accountsWithBudgetCount: 1, totalsMatch: true };
      payload.reconciliation[countKey] = 1;
      payload.totals = {
        incomeActualCents: income, incomeBudgetCents: income ? 1250000 : 0,
        expenseActualCents: expense, expenseBudgetCents: expense ? 1250000 : 0,
        netIncomeActualCents: netSign * 1300000, netIncomeBudgetCents: netSign * 1250000,
        hasBudgetData: true,
      };
      expect(validateFinanceChurchReportV1(payload), classification).toMatchObject({ ok: true, errors: [] });
    }
  });

  it('rejects an unrecognized source', () => {
    const payload = validPayload();
    payload.accounts[0].source = 'hand_typed';
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects a duplicate categoryPath', () => {
    const payload = validPayload();
    payload.accounts.push(validAccount());
    const result = validateFinanceChurchReportV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects when totals.incomeActualCents does not match the summed Income accounts', () => {
    const payload = validPayload();
    payload.totals.incomeActualCents = 1;
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects when totals.incomeBudgetCents counts a null budget as zero incorrectly (must equal the sum of SET budgets only)', () => {
    // Income row has budgetCents 1250000 (the only Income row); this must be the exact total.
    const payload = validPayload();
    payload.totals.incomeBudgetCents = 0;
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects when netIncomeActualCents is not the reconciled bottom line', () => {
    const payload = validPayload();
    payload.totals.netIncomeActualCents = 999;
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects reconciliation counts that do not match the accounts array', () => {
    const payload = validPayload();
    payload.reconciliation.incomeCount = 99;
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects an extra top-level field (closed shape)', () => {
    const payload = validPayload({ extra: 'nope' });
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });

  it('rejects an extra account field (closed shape)', () => {
    const payload = validPayload();
    payload.accounts[0].extra = 'nope';
    expect(validateFinanceChurchReportV1(payload).ok).toBe(false);
  });
});

describe('acceptFinanceChurchReportV1', () => {
  it('returns a detached copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceChurchReportV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.accounts).not.toBe(payload.accounts);
    expect(accepted.totals).not.toBe(payload.totals);
  });

  it('throws on an invalid payload rather than returning something malformed', () => {
    const payload = validPayload();
    delete payload.fiscalYear;
    expect(() => acceptFinanceChurchReportV1(payload)).toThrow(/Rejected connect\.finance-church-report\.v1/);
  });
});
