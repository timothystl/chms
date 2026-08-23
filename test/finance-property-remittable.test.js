import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

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
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx);
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
    // Given an explicit allowance, so "remittable is strictly below operating" is a real check
    // rather than trivially true against the zero default.
    const withCap = fin.finComputeRemittableForecast(d, { years: 10, growthPct: 0.02, capitalAllowanceCents: 1519626, now: '2026-08-07' });
    const post = withCap.rows.filter((r) => r.isPostPayoff);
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

  it('honors an explicit capital allowance override', () => {
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

// ── Base period (FIN61 follow-up) ────────────────────────────────────────────────────────────
// The trailing-12 window for this property straddles a weak half-year and a strong one, so the
// choice of base swings the first projected year by tens of thousands. These pin each option.
describe('finComputePropertyBaseOptions', () => {
  // Six months of 2026 at ~$5,639/mo, six months of 2025 at ~$1,528/mo — the real shape.
  const mk = (year, n, cents) => Array.from({ length: n }, (_, i) => ({
    period: year + '-' + String(i + 1).padStart(2, '0'), net_income_cents: cents,
  }));
  const d = {
    monthly: [...mk(2025, 12, 303002), ...mk(2026, 6, 563926)],
    reserves: { property_tax: [{ report_month: '2026-07', target_estimate_cents: 1140000 }] },
  };
  const opts = fin.finComputePropertyBaseOptions(d, { now: '2026-08-07' });
  const byKey = (k) => opts.filter((o) => o.key === k)[0];

  it('offers trailing 12, current year and last full year', () => {
    expect(opts.map((o) => o.key)).toEqual(['trailing12', 'currentYear', 'lastFullYear']);
  });

  it('annualizes the current year LESS the property tax that has not been billed yet', () => {
    // Doubling a tax-free half-year would omit the bill entirely — the mirror image of the
    // double-count the forecast avoids elsewhere.
    const cur = byKey('currentYear');
    expect(cur.taxAdjustmentCents).toBe(1140000);
    expect(cur.annualCents).toBe(563926 * 12 - 1140000);
    expect(cur.caveat).toMatch(/not been billed yet/);
  });

  it('does not subtract the tax once the window already reaches November', () => {
    const late = { ...d, monthly: [...mk(2025, 12, 303002), ...mk(2026, 11, 563926)] };
    expect(fin.finComputePropertyBaseOptions(late, { now: '2026-12-01' }).filter((o) => o.key === 'currentYear')[0].taxAdjustmentCents).toBe(0);
  });

  it('uses the last full calendar year untouched, and omits it when incomplete', () => {
    expect(byKey('lastFullYear').annualCents).toBe(303002 * 12);
    const short = { monthly: mk(2026, 6, 563926) };
    expect(fin.finComputePropertyBaseOptions(short, { now: '2026-08-07' }).map((o) => o.key)).not.toContain('lastFullYear');
  });

  it('every option carries its own caveat', () => {
    opts.forEach((o) => expect(typeof o.caveat === 'string' && o.caveat.length > 20).toBe(true));
  });
});

describe('capital allowance defaults and date robustness', () => {
  const d = {
    monthly: Array.from({ length: 12 }, (_, i) => ({ period: '2025-' + String(i + 1).padStart(2, '0'), net_income_cents: 358365 })),
    capitalLedger: [{ entry_date: '2024-10-07', amount_cents: 1200000 }, { entry_date: '2026-04-08', amount_cents: 1206075 }],
    meta: { loan: REAL_LOAN },
  };

  // This assertion used to pin a hardcoded ZERO default here. The instinct was right — every
  // ledger entry is a finished one-off, so averaging them bills completed work forever — but the
  // default was applied in this function ALONE, while the Commercial Property pro forma fell back
  // to the ledger average, so the two screens quoted different cash for the same year. The
  // allowance is now an entered assumption resolved in ONE place
  // (finComputePropertyCapitalAllowanceCents), and by the church's own decision an unset
  // assumption still falls back to the ledger average — but visibly, with the resolver's source
  // field driving copy that names it as history rather than a forecast.
  it('reads the saved assumption, falling back to the flagged ledger average when none is set', () => {
    const f = fin.finComputeRemittableForecast(d, { years: 1, now: '2026-08-07' });
    expect(f.capital.source).toBe('ledger');
    expect(f.rows[0].capitalCents).toBe(f.capital.cents);
    expect(f.capital.cents).toBeGreaterThan(0);
    // ...and a saved assumption reaches this card without any per-call plumbing.
    const set = fin.finComputeRemittableForecast(
      { ...d, meta: { ...d.meta, capital: { method: 'flat', annual_allowance_cents: 250000 } } },
      { years: 1, now: '2026-08-07' });
    expect(set.rows[0].capitalCents).toBe(250000);
  });

  it('still honors an explicit allowance', () => {
    expect(fin.finComputeRemittableForecast(d, { years: 1, capitalAllowanceCents: 1519626, now: '2026-08-07' }).rows[0].capitalCents).toBe(1519626);
  });

  it('never returns NaN for the loose date formats the API accepts', () => {
    // POST validates /^\d{4}(-\d{2}(-\d{2})?)?$/, so a bare YYYY is storable — it used to make
    // the month arithmetic NaN and render "$NaN" as the remittable figure.
    [
      [{ entry_date: '2024', amount_cents: 100000 }, { entry_date: '2025-06', amount_cents: 100000 }],
      [{ entry_date: '2024', amount_cents: 100000 }],
      [{ entry_date: '2024-01-01', amount_cents: 100000 }, { entry_date: '2024-01', amount_cents: 100000 }],
    ].forEach((capitalLedger) => {
      const c = fin.finComputePropertyCapitalAllowanceCents({ capitalLedger });
      expect(Number.isFinite(c.cents)).toBe(true);
      expect(Number.isNaN(c.cents)).toBe(false);
    });
  });

  it('reports an empty ledger as empty rather than as a zero average', () => {
    const c = fin.finComputePropertyCapitalAllowanceCents({ capitalLedger: [{ entry_date: '', amount_cents: 988700 }] });
    expect(c.entries).toBe(0);
    expect(c.cents).toBe(0);
  });
});

describe('base period drives the forecast', () => {
  const d = {
    monthly: Array.from({ length: 12 }, (_, i) => ({ period: '2025-' + String(i + 1).padStart(2, '0'), net_income_cents: 358365 })),
    capitalLedger: [],
    meta: { loan: REAL_LOAN },
  };

  it('a higher base produces a higher remittable figure, principal unchanged', () => {
    const low = fin.finComputeRemittableForecast(d, { years: 1, baseAnnualCents: 4300375, now: '2026-08-07' });
    const high = fin.finComputeRemittableForecast(d, { years: 1, baseAnnualCents: 5627110, now: '2026-08-07' });
    expect(high.rows[0].remittableCents).toBeGreaterThan(low.rows[0].remittableCents);
    expect(high.rows[0].principalCents).toBe(low.rows[0].principalCents);
    // The gap is the base difference grown by the rate. Compared with a tolerance because the
    // model rounds (base + embedded interest) once, not each term separately.
    expect(high.rows[0].remittableCents - low.rows[0].remittableCents)
      .toBeCloseTo((5627110 - 4300375) * 1.02, -1);
  });

  it('falls back to the trailing-12 base when none is supplied', () => {
    expect(fin.finComputeRemittableForecast(d, { years: 1, now: '2026-08-07' }).baseAnnualCents)
      .toBe(fin.finComputePropertyTrailingNetIncome(d).annualCents);
  });
});
