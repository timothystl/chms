import { describe, expect, it } from 'vitest';
import {
  acceptFinanceBudgetV1,
  validateFinanceBudgetV1,
} from '../apps/finance/finance-budget-consumer.js';

const example = {
  contract: 'connect.finance-budget.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  fiscalYear: 2027,
  generatedAt: '2026-09-14T12:00:00Z',
  categories: [
    {
      category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000,
      basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
    },
    {
      category: 'Expenses:Program:Youth Ministry', classification: 'Expenses', plannedAmountCents: 1100000,
      basis: 'grown', growthPct: 0.1, baseAmountCents: 1000000, notes: 'Compounded 10%',
    },
  ],
  totals: { plannedIncomeCents: 130000000, plannedExpenseCents: 1100000, plannedNetCents: 128900000 },
  reconciliation: { categoryCount: 2, incomeCount: 1, expenseCount: 1, manualCount: 1, grownCount: 1, totalsMatch: true },
};

function changed(mutator) {
  const copy = structuredClone(example);
  mutator(copy);
  return copy;
}

describe('Finance consumer for connect.finance-budget.v1', () => {
  it('accepts and normalizes a valid producer payload', () => {
    const accepted = acceptFinanceBudgetV1(example);
    expect(accepted.contract).toBe('connect.finance-budget.v1');
    expect(accepted.fiscalYear).toBe(2027);
    expect(accepted.categories).toHaveLength(2);
    expect(accepted.totals).toEqual(example.totals);
  });

  it('accepts a fiscal year with no plan yet (empty categories)', () => {
    const empty = changed((v) => {
      v.categories = [];
      v.totals = { plannedIncomeCents: 0, plannedExpenseCents: 0, plannedNetCents: 0 };
      v.reconciliation = { categoryCount: 0, incomeCount: 0, expenseCount: 0, manualCount: 0, grownCount: 0, totalsMatch: true };
    });
    expect(validateFinanceBudgetV1(empty).ok).toBe(true);
  });

  it('accepts a manual category with null growthPct/baseAmountCents', () => {
    expect(validateFinanceBudgetV1(example).ok).toBe(true);
  });

  it.each([
    ['unknown major contract', (v) => { v.contract = 'connect.finance-budget.v2'; }],
    ['wrong classification', (v) => { v.dataClassification = 'structural'; }],
    ['wrong producer', (v) => { v.sourceProduct = 'finance'; }],
    ['wrong consumer', (v) => { v.consumerProduct = 'website'; }],
    ['wrong currency', (v) => { v.currency = 'CAD'; }],
    ['non-integer fiscalYear', (v) => { v.fiscalYear = 2027.5; }],
    ['fiscalYear out of range', (v) => { v.fiscalYear = 1900; }],
    ['unknown root field', (v) => { v.amountCents = 100; }],
    ['bad classification', (v) => { v.categories[0].classification = 'Assets'; }],
    ['category missing classification prefix', (v) => { v.categories[0].category = 'Offerings:General Fund'; }],
    ['non-integer plannedAmountCents', (v) => { v.categories[0].plannedAmountCents = 1.5; }],
    ['unknown basis', (v) => { v.categories[0].basis = 'imported'; }],
    ['manual category with a set growthPct', (v) => { v.categories[0].growthPct = 0.05; }],
    ['manual category with a set baseAmountCents', (v) => { v.categories[0].baseAmountCents = 1000; }],
    ['grown category missing growthPct', (v) => { v.categories[1].growthPct = null; }],
    ['grown category missing baseAmountCents', (v) => { v.categories[1].baseAmountCents = null; }],
    ['grown category with inconsistent arithmetic', (v) => { v.categories[1].plannedAmountCents = 9999999; }],
    ['non-string notes', (v) => { v.categories[0].notes = null; }],
    ['unknown category field', (v) => { v.categories[0].amountCents = 100; }],
    ['duplicate category/classification', (v) => { v.categories[1].category = v.categories[0].category; v.categories[1].classification = v.categories[0].classification; }],
    ['malformed generatedAt', (v) => { v.generatedAt = 'not-a-date'; }],
    ['totals arithmetic mismatch', (v) => { v.totals.plannedNetCents = 1; }],
    ['totals income does not match categories', (v) => { v.totals.plannedIncomeCents = 1; v.totals.plannedNetCents = 1 - v.totals.plannedExpenseCents; }],
    ['unknown totals field', (v) => { v.totals.extra = 1; }],
    ['categoryCount mismatch', (v) => { v.reconciliation.categoryCount = 99; }],
    ['incomeCount mismatch', (v) => { v.reconciliation.incomeCount = 99; }],
    ['manualCount mismatch', (v) => { v.reconciliation.manualCount = 99; }],
    ['grownCount mismatch', (v) => { v.reconciliation.grownCount = 99; }],
    ['totalsMatch not true', (v) => { v.reconciliation.totalsMatch = false; }],
    ['unknown reconciliation field', (v) => { v.reconciliation.total = 2; }],
  ])('fails closed on %s', (_label, mutate) => {
    const value = changed(mutate);
    expect(validateFinanceBudgetV1(value).ok).toBe(false);
    expect(() => acceptFinanceBudgetV1(value)).toThrow(/Rejected connect\.finance-budget\.v1/);
  });

  it('returns detached data rather than retaining producer-owned objects', () => {
    const source = structuredClone(example);
    const accepted = acceptFinanceBudgetV1(source);
    source.categories[0].plannedAmountCents = 1;
    source.reconciliation.categoryCount = 999;
    expect(accepted.categories[0].plannedAmountCents).toBe(130000000);
    expect(accepted.reconciliation.categoryCount).toBe(2);
  });
});
