import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The property cash model (FIN61) is a set of mutually-referencing functions, so unlike the
// single-function regex extraction used by the sibling property tests, this loads the whole
// served bundle into a vm with a stub DOM and pulls the real functions out — the same technique
// CLAUDE.md records for AT7/FIN54/FIN57.
function loadBundle() {
  const ctx = { console, document: { getElementById: () => null } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_EXT_JS, ctx);
  return ctx;
}
const fin = loadBundle();

// The real 3277 Ivanhoe loan, as confirmed by the pastor on 2026-07-20.
const REAL_LOAN = {
  balance_cents: 27969113,
  balance_as_of_date: '2026-07-20',
  interest_rate_pct: 0.06375,
  monthly_payment_cents: 428303,   // principal + interest
  annual_debt_service_cents: 4539636, // mislabeled — actually the principal portion
};

describe('finAmortizationSchedule', () => {
  it('anchors to the lender-confirmed balance date, not to today', () => {
    const s = fin.finAmortizationSchedule(REAL_LOAN);
    expect(s.years[0].year).toBe(2026);
    expect(s.anchoredTo).toBe('2026-07-20');
    // July is month 7, so the anchor year holds exactly 6 months of payments.
    expect(s.years[0].monthsCovered).toBe(6);
  });

  it('falls back to today only when no as-of date is stored', () => {
    const { balance_as_of_date, ...noDate } = REAL_LOAN;
    const s = fin.finAmortizationSchedule(noDate, { now: '2030-03-15' });
    expect(s.years[0].year).toBe(2030);
    expect(s.years[0].monthsCovered).toBe(10); // Mar-Dec
  });

  it('pays the real loan off in 2033', () => {
    expect(fin.finAmortizationSchedule(REAL_LOAN).payoffYear).toBe(2033);
  });

  it('principal rises and interest falls every full year', () => {
    const s = fin.finAmortizationSchedule(REAL_LOAN);
    // Skip the partial first year and the partial payoff year.
    const full = s.years.filter((y) => y.monthsCovered === 12);
    for (let i = 1; i < full.length; i++) {
      expect(full[i].principalCents).toBeGreaterThan(full[i - 1].principalCents);
      expect(full[i].interestCents).toBeLessThan(full[i - 1].interestCents);
    }
  });

  it('never lets the final payment overshoot into a negative balance', () => {
    const s = fin.finAmortizationSchedule(REAL_LOAN);
    expect(s.years[s.years.length - 1].endingBalanceCents).toBe(0);
  });

  it('returns null when the payment cannot cover the interest, or fields are missing', () => {
    expect(fin.finAmortizationSchedule({ balance_cents: 10000000, interest_rate_pct: 0.10, monthly_payment_cents: 5000 })).toBeNull();
    expect(fin.finAmortizationSchedule({})).toBeNull();
    expect(fin.finAmortizationSchedule(null)).toBeNull();
  });
});

describe('finComputePropertyCapitalAllowanceCents', () => {
  it('averages real spend over the span the ledger covers, ignoring undated entries', () => {
    const d = { capitalLedger: [
      { entry_date: '', amount_cents: 988700 },            // opening balance, no date — excluded
      { entry_date: '2024-10-07', amount_cents: 1200000 },
      { entry_date: '2025-10-07', amount_cents: 1200000 },
    ] };
    const c = fin.finComputePropertyCapitalAllowanceCents(d);
    expect(c.totalCents).toBe(2400000);
    expect(c.years).toBeCloseTo(13 / 12, 5); // Oct 2024 -> Oct 2025 inclusive
    expect(c.cents).toBe(Math.round(2400000 / (13 / 12)));
  });

  it('never annualizes UP from a sub-year window', () => {
    // Three months of spending is not a quarter of a year's worth; treating it as one would
    // quadruple the deduction.
    const d = { capitalLedger: [
      { entry_date: '2026-01-01', amount_cents: 100000 },
      { entry_date: '2026-03-01', amount_cents: 100000 },
    ] };
    expect(fin.finComputePropertyCapitalAllowanceCents(d).cents).toBe(200000);
  });

  it('is zero for an empty ledger', () => {
    expect(fin.finComputePropertyCapitalAllowanceCents({ capitalLedger: [] }).cents).toBe(0);
  });
});

describe('finComputePropertyBaseInterestCents', () => {
  const monthly = (n) => Array.from({ length: n }, (_, i) => ({
    period: '2025-' + String(i + 1).padStart(2, '0'), net_income_cents: 100000,
  }));

  it('uses the first TWELVE SCHEDULED MONTHS, not the first (partial) calendar year', () => {
    const sched = fin.finAmortizationSchedule(REAL_LOAN);
    const r = fin.finComputePropertyBaseInterestCents({ monthly: monthly(12) }, sched);
    expect(r.source).toBe('schedule');
    // A full twelve months at ~6.375% on ~$275k lands near $17k. Averaging the 6-month anchor
    // year against the next full year (the bug this guards) would land near $12k instead.
    expect(r.cents).toBeGreaterThan(1550000);
    expect(r.cents).toBeLessThan(1800000);
  });

  it('prefers the reports own interest only when EVERY month in the window has one', () => {
    const all = monthly(12).map((m) => ({ ...m, interest_expense_cents: 95205 }));
    expect(fin.finComputePropertyBaseInterestCents({ monthly: all }, null))
      .toEqual({ cents: 95205 * 12, source: 'reported' });
    // One month missing — a partial sum would understate it, so fall back instead.
    const partial = all.map((m, i) => (i === 0 ? { ...m, interest_expense_cents: null } : m));
    expect(fin.finComputePropertyBaseInterestCents({ monthly: partial }, fin.finAmortizationSchedule(REAL_LOAN)).source)
      .toBe('schedule');
  });
});

describe('finComputeRemittableForecast', () => {
  // Trailing twelve months of the real seeded data average to $43,003.75/yr of net income.
  const d = {
    monthly: Array.from({ length: 12 }, (_, i) => ({
      period: '2025-' + String(i + 1).padStart(2, '0'), net_income_cents: 358365,
    })),
    capitalLedger: [
      { entry_date: '2024-10-07', amount_cents: 1200000 },
      { entry_date: '2026-04-08', amount_cents: 1206075 },
    ],
    meta: { loan: REAL_LOAN },
  };
  const f = fin.finComputeRemittableForecast(d, { years: 10, growthPct: 0.02, now: '2026-08-07' });

  it('reconciles on every row: net income less principal less capital IS the remittable figure', () => {
    expect(f.rows.length).toBe(10);
    f.rows.forEach((r) => {
      expect(r.netIncomeCents - r.principalCents - r.capitalCents).toBe(r.remittableCents);
      expect(r.netIncomeCents).toBe(r.operatingCents - r.interestCents);
    });
  });

  it('subtracts mortgage principal — the omission that made the old card wrong', () => {
    const y2027 = f.rows[0];
    expect(y2027.year).toBe(2027);
    expect(y2027.principalCents).toBeGreaterThan(3000000); // over $30k of cash, invisible on the P&L
    expect(y2027.remittableCents).toBeLessThan(y2027.netIncomeCents - y2027.principalCents + 1);
  });

  it('drops principal AND interest to zero after payoff, with no debt-service add-back', () => {
    const post = f.rows.filter((r) => r.isPostPayoff);
    expect(post.length).toBeGreaterThan(0);
    post.forEach((r) => {
      expect(r.principalCents).toBe(0);
      expect(r.interestCents).toBe(0);
      // The old code ADDED annual_debt_service_cents on top here, double-counting it.
      expect(r.remittableCents).toBe(r.operatingCents - r.capitalCents);
      expect(r.remittableCents).toBeLessThan(r.operatingCents);
    });
  });

  it('grows operating income, not the fixed mortgage payment', () => {
    // Debt service is flat-ish by amortization, so it must not compound with the growth rate.
    const slow = fin.finComputeRemittableForecast(d, { years: 3, growthPct: 0, now: '2026-08-07' });
    const fast = fin.finComputeRemittableForecast(d, { years: 3, growthPct: 0.10, now: '2026-08-07' });
    expect(fast.rows[0].principalCents).toBe(slow.rows[0].principalCents);
    expect(fast.rows[0].operatingCents).toBeGreaterThan(slow.rows[0].operatingCents);
  });

  it('honours an explicit capital allowance override', () => {
    const o = fin.finComputeRemittableForecast(d, { years: 1, capitalAllowanceCents: 500000, now: '2026-08-07' });
    expect(o.rows[0].capitalCents).toBe(500000);
  });

  it('REALITY CHECK: 2027 lands near what the church actually receives, not near net income', () => {
    // Actual distributions: $34,000 (2024), $8,000 (2025), $4,000 (2026 YTD). The old card
    // projected $43,864 for 2027 — an order of magnitude above the recent run rate. This is the
    // assertion that would have caught the original bug.
    const y2027 = f.rows[0];
    expect(y2027.remittableCents).toBeLessThan(1000000);  // well under $10,000
    expect(y2027.remittableCents).toBeLessThan(y2027.netIncomeCents - 3000000);
  });

  it('still produces rows when there is no loan at all', () => {
    const noLoan = fin.finComputeRemittableForecast({ ...d, meta: {} }, { years: 2, now: '2026-08-07' });
    expect(noLoan.payoffYear).toBeNull();
    noLoan.rows.forEach((r) => {
      expect(r.principalCents).toBe(0);
      expect(r.remittableCents).toBe(r.netIncomeCents - r.capitalCents);
    });
  });
});

describe('finPropertyLoanDataWarnings', () => {
  it('surfaces the payment-vs-annual-figure contradiction instead of silently picking one', () => {
    const w = fin.finPropertyLoanDataWarnings({ meta: { loan: REAL_LOAN }, monthly: [] });
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/principal portion only/);
  });

  it('flags a reported interest figure that implies a different balance', () => {
    const w = fin.finPropertyLoanDataWarnings({
      meta: { loan: REAL_LOAN },
      monthly: [{ period: '2026-06', interest_expense_cents: 95205 }],
    });
    expect(w.length).toBe(2);
    expect(w[1]).toMatch(/implies a loan balance near/);
  });

  it('says nothing when the loan record is self-consistent', () => {
    const clean = { ...REAL_LOAN, annual_debt_service_cents: 428303 * 12 };
    expect(fin.finPropertyLoanDataWarnings({ meta: { loan: clean }, monthly: [] })).toEqual([]);
  });
});

describe('finComputeAvailableForDistribution', () => {
  it('now subtracts year-to-date mortgage principal as well', () => {
    const d = {
      annualSummary: [{ year: 2026, net_income_cents: 3383555 }],
      reserves: { property_tax: [{ report_month: '2026-07', contribution_cents: 110833 }] },
      capitalLedger: [{ entry_date: '2026-04-08', amount_cents: 400000 }],
      meta: { loan: REAL_LOAN },
    };
    const a = fin.finComputeAvailableForDistribution(d, { now: '2026-08-07' });
    expect(a.principalCents).toBeGreaterThan(0);
    expect(a.availableCents).toBe(a.annualNetCents - a.reserveContribCents - a.capitalCents - a.principalCents);
  });

  it('subtracts no principal once the loan is paid off', () => {
    const d = {
      annualSummary: [{ year: 2040, net_income_cents: 5000000 }],
      reserves: {}, capitalLedger: [], meta: { loan: REAL_LOAN },
    };
    expect(fin.finComputeAvailableForDistribution(d, { now: '2040-06-01' }).principalCents).toBe(0);
  });
});
