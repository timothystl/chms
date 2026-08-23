import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
// P25-E: finance-only functions moved out of the ext bundle into their own lazily-loaded
// bundle (see html-chms.js). This file only extracts source by regex/string search, so the
// two are simply concatenated back together for that purpose.
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;

// finComputeMortgageAmortization() lives inside the served (String.raw) frontend script, not as
// an exported module function. It used to be extractable on its own, but since FIN61 it delegates
// to finAmortizationSchedule, so load the whole bundle in a vm with a stub DOM and take the real
// function out of it — the same technique used elsewhere in this project (see CLAUDE.md AT7 /
// FIN54 / FIN57) to verify served-only logic without a browser.
function loadFinComputeMortgageAmortization() {
  const ctx = { console, document: { getElementById: () => null } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_EXT_JS_ALL, ctx);
  if (typeof ctx.finComputeMortgageAmortization !== 'function') throw new Error('finComputeMortgageAmortization not found in built script');
  return ctx.finComputeMortgageAmortization;
}

// finComputePropertyValuation() references the sibling FIN_VAL_OP_COST_FIELDS var — extract
// both together so the itemized-cost lookup works standalone.
function loadFinComputePropertyValuation() {
  const varMatch = CHMS_APP_EXT_JS_ALL.match(/var FIN_VAL_OP_COST_FIELDS = \[[\s\S]*?\];/);
  const fnMatch = CHMS_APP_EXT_JS_ALL.match(/function finComputePropertyValuation\(inputs\) \{[\s\S]*?\n\}/);
  if (!varMatch || !fnMatch) throw new Error('finComputePropertyValuation (or its FIN_VAL_OP_COST_FIELDS dependency) not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${varMatch[0]} return ${fnMatch[0]}; })()`);
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

describe('finComputePropertyValuation', () => {
  const finComputePropertyValuation = loadFinComputePropertyValuation();

  // Real figures from AHRA's actual valuation worksheet (3277_Ivanhoe_Valuation_2.xlsx,
  // uploaded 2026-07-20) — reconciles to Gross Rental Income $119,055.85, Total Operating
  // Costs $64,150.66, NOI $54,905.19, Capitalized Value $686,314.86 at an 8% cap rate.
  const REAL_INPUTS = {
    rentRoll: [
      { tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 },
      { tenant: 'Apartment 2', sqft: 1450, annual_rent_cents: 1499300 },
      { tenant: 'RJBJ - Crossfit', sqft: 3066, annual_rent_cents: 2759400 },
      { tenant: 'Magnatone', sqft: 7519, annual_rent_cents: 4082817 },
    ],
    utility_reimbursement_cents: 1626068,
    vacancy_rate_pct: 0,
    operating_costs: {
      utilities_cents: 1961363, trash_cents: 310668, maintenance_repairs_cents: 828700,
      landscaping_snow_cents: 400000, legal_cents: 0, taxes_cents: 1200000, insurance_cents: 1000000,
    },
    management_fee_pct: 0.06,
    cap_rate: 0.08,
  };

  it('reconciles exactly to the real worksheet totals', () => {
    const out = finComputePropertyValuation(REAL_INPUTS);
    expect(out.totalAnnualRentCents).toBe(10279517); // $102,795.17
    expect(out.grossRentalIncomeCents).toBe(11905585); // $119,055.85
    expect(out.itemizedOpCostsCents).toBe(5700731); // $57,007.31, before management fee
    expect(out.totalOperatingCostsCents).toBe(6415066); // $64,150.66 incl. mgmt fee
    expect(out.noiCents).toBe(5490519); // $54,905.19
    // Capitalized value has a few cents of rounding drift vs. the worksheet's un-quantized
    // arithmetic (this pipeline rounds to cents at the management-fee step) — assert it's
    // within a nickel of the real $686,314.86, not byte-exact.
    expect(Math.abs(out.capitalizedValueCents - 68631486)).toBeLessThanOrEqual(5);
  });

  it('a higher vacancy rate reduces effective income and therefore value', () => {
    const withVacancy = finComputePropertyValuation({ ...REAL_INPUTS, vacancy_rate_pct: 0.1 });
    const noVacancy = finComputePropertyValuation(REAL_INPUTS);
    expect(withVacancy.effectiveRentalIncomeCents).toBeLessThan(noVacancy.effectiveRentalIncomeCents);
    expect(withVacancy.capitalizedValueCents).toBeLessThan(noVacancy.capitalizedValueCents);
  });

  it('a higher cap rate produces a lower capitalized value for the same NOI', () => {
    const lowCap = finComputePropertyValuation({ ...REAL_INPUTS, cap_rate: 0.06 });
    const highCap = finComputePropertyValuation({ ...REAL_INPUTS, cap_rate: 0.10 });
    expect(lowCap.noiCents).toBe(highCap.noiCents); // cap rate doesn't affect NOI, only value
    expect(highCap.capitalizedValueCents).toBeLessThan(lowCap.capitalizedValueCents);
  });

  it('handles an empty rent roll and a zero cap rate without throwing', () => {
    const out = finComputePropertyValuation({ rentRoll: [], operating_costs: {}, cap_rate: 0 });
    expect(out.totalAnnualRentCents).toBe(0);
    expect(out.capitalizedValueCents).toBe(0);
  });
});
