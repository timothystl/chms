import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finComputeMortgageAmortization() lives inside the served (String.raw) frontend script, not as
// an exported module function — extract just that one function (it touches no DOM, unlike its
// callers) and eval it standalone. Same technique used elsewhere in this project (see CLAUDE.md
// SC3-BUG1 / TAP11) to verify served-only logic without a browser.
function loadFinComputeMortgageAmortization() {
  const m = CHMS_APP_EXT_JS.match(/function finComputeMortgageAmortization\(loan\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('finComputeMortgageAmortization not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(${m[0]})`);
}

describe('finComputeMortgageAmortization', () => {
  const finComputeMortgageAmortization = loadFinComputeMortgageAmortization();

  it('amortizes the real 3277 Ivanhoe loan figures to a plausible payoff', () => {
    const loan = { balance_cents: 27969113, interest_rate_pct: 0.06375, monthly_payment_cents: 428303 };
    const r = finComputeMortgageAmortization(loan);
    expect(r).not.toBeNull();
    // Closed-form check: n = -ln(1 - r*P/M) / ln(1+r)
    const rate = loan.interest_rate_pct / 12, P = loan.balance_cents / 100, M = loan.monthly_payment_cents / 100;
    const expectedMonths = -Math.log(1 - rate * P / M) / Math.log(1 + rate);
    expect(r.months).toBeGreaterThanOrEqual(Math.floor(expectedMonths));
    expect(r.months).toBeLessThanOrEqual(Math.ceil(expectedMonths) + 1);
    expect(r.totalInterestCents).toBeGreaterThan(0);
  });

  it('returns null when the payment does not cover the interest', () => {
    const loan = { balance_cents: 10000000, interest_rate_pct: 0.10, monthly_payment_cents: 5000 }; // $50/mo on a $100k loan at 10%
    expect(finComputeMortgageAmortization(loan)).toBeNull();
  });

  it('returns null when required loan fields are missing', () => {
    expect(finComputeMortgageAmortization({})).toBeNull();
    expect(finComputeMortgageAmortization(null)).toBeNull();
  });

  it('a larger payment produces a strictly shorter payoff and less total interest', () => {
    const base = { balance_cents: 10000000, interest_rate_pct: 0.06, monthly_payment_cents: 60000 };
    const faster = { ...base, monthly_payment_cents: 90000 };
    const r1 = finComputeMortgageAmortization(base);
    const r2 = finComputeMortgageAmortization(faster);
    expect(r2.months).toBeLessThan(r1.months);
    expect(r2.totalInterestCents).toBeLessThan(r1.totalInterestCents);
  });
});
