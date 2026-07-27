import { describe, it, expect } from 'vitest';
import { computeChurchCategoryActualCents, computeMdoUtilityInsuranceAllocation } from '../src/api-finance.js';

function row(category_path, account_name, own_actual_cents) {
  return { category_path, account_name, own_actual_cents };
}

describe('computeChurchCategoryActualCents', () => {
  it('matches on category_path even when the leaf account name itself does not contain the word', () => {
    const rows = [
      row('Expenses:34 Utilities:34010 Electric', 'Electric', 500000),
      row('Expenses:34 Utilities:34020 Gas', 'Gas', 300000),
      row('Expenses:35 Insurance', 'Insurance', 200000),
      row('Expenses:36 Office Supplies', 'Office Supplies', 100000),
    ];
    expect(computeChurchCategoryActualCents(rows, /utilit/i)).toBe(800000);
    expect(computeChurchCategoryActualCents(rows, /insuranc/i)).toBe(200000);
  });

  it('also matches on account_name directly (covers a leaf whose own name says the word)', () => {
    const rows = [row('Expenses:99 Misc', 'Utilities Reimbursement', 5000)];
    expect(computeChurchCategoryActualCents(rows, /utilit/i)).toBe(5000);
  });

  it('sums every matching row without double-counting (own_actual_cents is always non-cumulative)', () => {
    const rows = [
      row('Expenses:34 Utilities', 'Utilities', 0), // pure grouping header, no own posting
      row('Expenses:34 Utilities:34010 Electric', 'Electric', 500000),
    ];
    expect(computeChurchCategoryActualCents(rows, /utilit/i)).toBe(500000);
  });

  it('returns 0 when nothing matches', () => {
    expect(computeChurchCategoryActualCents([row('Expenses:1 Other', 'Other', 1000)], /utilit/i)).toBe(0);
  });
});

describe('computeMdoUtilityInsuranceAllocation', () => {
  it('applies the given percentages against each year\'s church actual totals', () => {
    const rowsByYear = {
      2025: [row('Expenses:34 Utilities:34010 Electric', 'Electric', 1000000), row('Expenses:35 Insurance', 'Insurance', 400000)],
      2026: [row('Expenses:34 Utilities:34010 Electric', 'Electric', 1200000), row('Expenses:35 Insurance', 'Insurance', 500000)],
    };
    const result = computeMdoUtilityInsuranceAllocation(rowsByYear, 0.5, 0.5);
    expect(result[2025]).toEqual({ utilityActualCents: 1000000, insuranceActualCents: 400000, mdoUtilityCents: 500000, mdoInsuranceCents: 200000 });
    expect(result[2026]).toEqual({ utilityActualCents: 1200000, insuranceActualCents: 500000, mdoUtilityCents: 600000, mdoInsuranceCents: 250000 });
  });

  it('supports different percentages for utilities vs insurance and rounds to the nearest cent', () => {
    const rowsByYear = { 2025: [row('Expenses:34 Utilities', 'Electric', 333), row('Expenses:35 Insurance', 'Insurance', 777)] };
    const result = computeMdoUtilityInsuranceAllocation(rowsByYear, 0.2, 0.75);
    expect(result[2025].mdoUtilityCents).toBe(Math.round(333 * 0.2));
    expect(result[2025].mdoInsuranceCents).toBe(Math.round(777 * 0.75));
  });

  it('returns an entry (all zeros) for a year with no matching church rows', () => {
    const result = computeMdoUtilityInsuranceAllocation({ 2025: [] }, 0.5, 0.5);
    expect(result[2025]).toEqual({ utilityActualCents: 0, insuranceActualCents: 0, mdoUtilityCents: 0, mdoInsuranceCents: 0 });
  });
});
