import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finComputeAvailableForDistribution() lives inside the served (String.raw) frontend script, not
// as an exported module function — extract and eval standalone, same technique used elsewhere in
// this project (see CLAUDE.md SC3-BUG1 / TAP11 / FIN10 / finance-church-detail-body).
function loadHelper() {
  const m = CHMS_APP_EXT_JS.match(/function finComputeAvailableForDistribution\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeAvailableForDistribution not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeAvailableForDistribution; })()`);
}

describe('finComputeAvailableForDistribution', () => {
  const finComputeAvailableForDistribution = loadHelper();
  const thisYear = new Date().getFullYear();

  it('subtracts this year\'s reserve contributions and capital spend from annual net income', () => {
    const d = {
      annualSummary: [{ year: thisYear, net_income_cents: 5000000 }, { year: thisYear - 1, net_income_cents: 999999 }],
      reserves: {
        property_tax: [
          { report_month: `${thisYear}-01`, contribution_cents: 100000 },
          { report_month: `${thisYear}-02`, contribution_cents: 100000 },
          { report_month: `${thisYear - 1}-12`, contribution_cents: 999999 }, // prior year — excluded
        ],
      },
      capitalLedger: [
        { entry_date: `${thisYear}-03-01`, amount_cents: 500000 },
        { entry_date: `${thisYear - 1}-11-01`, amount_cents: 999999 }, // prior year — excluded
      ],
    };
    const result = finComputeAvailableForDistribution(d);
    expect(result.year).toBe(thisYear);
    expect(result.annualNetCents).toBe(5000000);
    expect(result.reserveContribCents).toBe(200000);
    expect(result.capitalCents).toBe(500000);
    expect(result.availableCents).toBe(5000000 - 200000 - 500000);
  });

  it('handles no data for the current year gracefully', () => {
    const result = finComputeAvailableForDistribution({ annualSummary: [], reserves: {}, capitalLedger: [] });
    expect(result.annualNetCents).toBe(0);
    expect(result.reserveContribCents).toBe(0);
    expect(result.capitalCents).toBe(0);
    expect(result.availableCents).toBe(0);
  });
});

function loadDistributedHelper() {
  const m = CHMS_APP_EXT_JS.match(/function finComputeDistributedThisYear\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeDistributedThisYear not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeDistributedThisYear; })()`);
}

describe('finComputeDistributedThisYear', () => {
  const finComputeDistributedThisYear = loadDistributedHelper();
  const thisYear = new Date().getFullYear();

  it('sums only this calendar year\'s confirmed distributions', () => {
    const d = {
      distributions: [
        { period: `${thisYear}-01`, amount_cents: 300000 },
        { period: `${thisYear}-04`, amount_cents: 450000 },
        { period: `${thisYear - 1}-11`, amount_cents: 999999 }, // prior year — excluded
      ],
    };
    const result = finComputeDistributedThisYear(d);
    expect(result.year).toBe(thisYear);
    expect(result.cents).toBe(750000);
  });

  it('handles no distributions gracefully', () => {
    const result = finComputeDistributedThisYear({ distributions: [] });
    expect(result.cents).toBe(0);
  });
});

function loadMortgageHelper() {
  const m = CHMS_APP_EXT_JS.match(/function finComputeMortgageRemainingCents\([^)]*\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeMortgageRemainingCents not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${m[0]} return finComputeMortgageRemainingCents; })()`);
}

describe('finComputeMortgageRemainingCents', () => {
  const finComputeMortgageRemainingCents = loadMortgageHelper();
  const loan = { balance_cents: 27969113, balance_as_of_date: '2026-07-20' };

  it('reproduces the real June 2026 reconciliation exactly ($2,830.98 principal)', () => {
    const monthly = [{ period: '2026-06', loan_payment_cents: 378303, interest_expense_cents: 95205 }];
    // June predates the confirmed as-of date (2026-07-20) — already reflected in the anchor, not subtracted
    const result = finComputeMortgageRemainingCents(loan, monthly);
    expect(result.cents).toBe(27969113);
    expect(result.asOf).toBe('2026-07-20');
    expect(result.monthsApplied).toEqual([]);
  });

  it('rolls the balance forward using a real month after the confirmed as-of date', () => {
    const monthly = [{ period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: 95000 }];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    const principal = 378303 - 95000;
    expect(result.cents).toBe(27969113 - principal);
    expect(result.asOf).toBe('2026-08');
    expect(result.monthsApplied).toEqual(['2026-08']);
  });

  it('applies multiple months after the anchor in chronological order', () => {
    const monthly = [
      { period: '2026-09', loan_payment_cents: 378303, interest_expense_cents: 94000 },
      { period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: 95000 },
    ];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    const expected = 27969113 - (378303 - 95000) - (378303 - 94000);
    expect(result.cents).toBe(expected);
    expect(result.asOf).toBe('2026-09');
    expect(result.monthsApplied).toEqual(['2026-08', '2026-09']);
  });

  it('ignores months missing either loan_payment_cents or interest_expense_cents', () => {
    const monthly = [{ period: '2026-08', loan_payment_cents: 378303, interest_expense_cents: null }];
    const result = finComputeMortgageRemainingCents(loan, monthly);
    expect(result.cents).toBe(27969113);
    expect(result.monthsApplied).toEqual([]);
  });

  it('falls back to the raw balance when there is no confirmed as-of date', () => {
    const result = finComputeMortgageRemainingCents({ balance_cents: 5000000 }, []);
    expect(result.cents).toBe(5000000);
    expect(result.monthsApplied).toEqual([]);
  });
});
