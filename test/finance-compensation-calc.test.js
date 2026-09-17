import { describe, it, expect } from 'vitest';
import {
  finLcmsBaseSalaryCents, finHealthOptOutCentsFor, finLcmsHistoricalAvgGrowthPct, finLcmsMultiplierFor,
  finComputeLcmsSalary, finDefaultSelfEmployedFica, finComputeEmployerFicaCents,
  finConcordiaPensionRateFor, finConcordiaDisabilityRateFor, finFmtPctInput, finComputePensionCents,
  finRoundSalaryCents, finHealthTierMonthlyCents, finHealthAncillaryPerContractCents,
  finComputeHealthPlanTotalCents, finComputePlanOOPCents, finComputeHealthPlanSingleClaimantDeltaCents,
  finHealthPlanResolvedOption, finHealthPlanEffectiveLoneClaimantTermsCents, finComputeFamilyOOPCents,
  finComputeHealthPlanFamilyBreakevenCents,
  LCMS_MO_BASE_SALARY_BY_YEAR, LCMS_PASTOR_MULTIPLIERS, LCMS_EMPLOYER_FICA_RATE,
  CONCORDIA_PENSION_RATE_BY_YEAR, HEALTH_PLAN_QUOTE_2027,
} from '../apps/finance/compensation-calc.js';

// This calculator core is a mechanical, byte-verified extraction of the legacy in-Connect Salary
// Planner's own formulas and published rate tables (src/frontend/js-finance.js) -- see the module's
// own header comment. These tests check the ported module reproduces real, hand-verifiable results
// from those same published tables, not that the formulas themselves are "correct" in the abstract
// (that's the district's/Concordia's own published guidance, out of scope to second-guess here).

describe('finLcmsBaseSalaryCents', () => {
  it('returns the exact published 2027 base salary with no COLA applied', () => {
    const result = finLcmsBaseSalaryCents(2027, 0, {});
    expect(result).toEqual({ dollars: LCMS_MO_BASE_SALARY_BY_YEAR[2027], exact: true, sourceYear: 2027, colaApplied: false });
  });

  it('extrapolates forward with COLA from the latest published year when asked for a later year', () => {
    const result = finLcmsBaseSalaryCents(2029, 0.028, {});
    expect(result.sourceYear).toBe(2027);
    expect(result.exact).toBe(false);
    expect(result.colaApplied).toBe(true);
    expect(result.dollars).toBeCloseTo(LCMS_MO_BASE_SALARY_BY_YEAR[2027] * Math.pow(1.028, 2), 2);
  });

  it('prefers an explicit referenceByYear entry over the published table', () => {
    const result = finLcmsBaseSalaryCents(2027, 0, { 2027: { baseSalaryCents: 5200000 } });
    expect(result).toEqual({ dollars: 52000, exact: true, sourceYear: 2027, colaApplied: false });
  });
});

describe('finHealthOptOutCentsFor', () => {
  it('falls back to the nearest earlier saved year, then 0', () => {
    const ref = { 2025: { healthOptOutCents: 300000 } };
    expect(finHealthOptOutCentsFor(2025, ref)).toBe(300000);
    expect(finHealthOptOutCentsFor(2027, ref)).toBe(300000);
    expect(finHealthOptOutCentsFor(2020, ref)).toBe(0);
  });
});

describe('finLcmsHistoricalAvgGrowthPct', () => {
  it('is the compound annual growth rate implied by the published base-salary history', () => {
    const years = Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number).sort((a, b) => a - b);
    const first = years[0], last = years[years.length - 1];
    const expected = Math.pow(LCMS_MO_BASE_SALARY_BY_YEAR[last] / LCMS_MO_BASE_SALARY_BY_YEAR[first], 1 / (last - first)) - 1;
    expect(finLcmsHistoricalAvgGrowthPct()).toBeCloseTo(expected, 10);
  });
});

describe('finComputeLcmsSalary', () => {
  it('a pastor with 0 years experience gets exactly the base salary times the first published multiplier', () => {
    const result = finComputeLcmsSalary({
      year: 2027, role: 'pastor', yearsExperience: 0, colaPct: 0, responsibilityStipend: 0, attendanceBonus: 0,
    });
    expect(result.multiplier).toBe(LCMS_PASTOR_MULTIPLIERS[0]);
    expect(result.salaryCents).toBe(Math.round(LCMS_MO_BASE_SALARY_BY_YEAR[2027] * 100 * LCMS_PASTOR_MULTIPLIERS[0]));
  });

  it('adds responsibility stipend and attendance bonus on top of the base multiplier', () => {
    const base = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 0, colaPct: 0, responsibilityStipend: 0, attendanceBonus: 0 });
    const withBonus = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 0, colaPct: 0, responsibilityStipend: 0.3, attendanceBonus: 0.1 });
    expect(withBonus.multiplier).toBeCloseTo(base.multiplier + 0.4, 10);
  });

  it('returns null for an unrecognized commissioned/other-worker track', () => {
    expect(finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'not-a-real-track', yearsExperience: 0 })).toBeNull();
  });

  it('caps a B.S.-only commissioned track at its last published multiplier past that many years', () => {
    const capped = finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'bs', yearsExperience: 999, colaPct: 0, responsibilityStipend: 0, attendanceBonus: 0 });
    expect(capped.multiplier).toBe(1.20); // bs track's last published multiplier
  });
});

describe('finDefaultSelfEmployedFica / finComputeEmployerFicaCents', () => {
  it('pastors and commissioned ministers default to self-employed (SECA), others do not', () => {
    expect(finDefaultSelfEmployedFica('pastor')).toBe(true);
    expect(finDefaultSelfEmployedFica('commissioned')).toBe(true);
    expect(finDefaultSelfEmployedFica('other')).toBe(false);
  });

  it('charges the church $0 employer FICA for a self-employed worker, the full published rate otherwise', () => {
    expect(finComputeEmployerFicaCents(5000000, true)).toBe(0);
    expect(finComputeEmployerFicaCents(5000000, false)).toBe(Math.round(5000000 * LCMS_EMPLOYER_FICA_RATE));
  });
});

describe('finConcordiaPensionRateFor / finConcordiaDisabilityRateFor', () => {
  it('returns the exact published 2027 pension rate', () => {
    expect(finConcordiaPensionRateFor(2027)).toEqual({ rate: CONCORDIA_PENSION_RATE_BY_YEAR[2027], exact: true, sourceYear: 2027 });
  });

  it('falls back to the nearest earlier published year for a later, unpublished year', () => {
    const result = finConcordiaPensionRateFor(2030);
    expect(result.exact).toBe(false);
    expect(result.sourceYear).toBe(2027);
    expect(result.rate).toBe(CONCORDIA_PENSION_RATE_BY_YEAR[2027]);
  });

  it('disability rate depends on dependent status', () => {
    expect(finConcordiaDisabilityRateFor(2027, false).rate).toBe(0.0120);
    expect(finConcordiaDisabilityRateFor(2027, true).rate).toBe(0.0175);
  });
});

describe('finFmtPctInput / finComputePensionCents', () => {
  it('formats a fraction as a clean percent, masking float noise', () => {
    expect(finFmtPctInput(0.117)).toBe(11.7);
  });

  it('computes pension cost as salary times rate, rounded', () => {
    expect(finComputePensionCents(5000000, 0.117)).toBe(Math.round(5000000 * 0.117));
  });
});

describe('finRoundSalaryCents', () => {
  it('rounds the per-period paycheck to the nearest $5, then multiplies back by 26 periods', () => {
    // $51,831.60/yr -> $1,993.523.../period -> rounds to $1,995/period -> $51,870/yr
    expect(finRoundSalaryCents(5183160)).toBe(5187000);
  });
});

describe('finComputeHealthPlanTotalCents', () => {
  it("reproduces the church's own real enrollment (2 Family) 2027 renewal quote exactly: $49,224.00 medical", () => {
    const result = finComputeHealthPlanTotalCents('renewal', {}, undefined);
    expect(result.medicalCents).toBe(4922400);
    expect(result.dentalCents).toBe(HEALTH_PLAN_QUOTE_2027.options.renewal.dentalCents * 2);
    expect(result.visionCents).toBe(HEALTH_PLAN_QUOTE_2027.options.renewal.visionCents * 2);
    expect(result.totalCents).toBe(result.medicalCents + result.dentalCents + result.visionCents);
    expect(result.overridden).toBe(false);
  });

  it('honors an admin premium override for one option without touching the others', () => {
    const overrides = { renewal: { medicalCents: 5000000 } };
    const overridden = finComputeHealthPlanTotalCents('renewal', overrides, undefined);
    expect(overridden.medicalCents).toBe(5000000);
    expect(overridden.overridden).toBe(true);
    const untouched = finComputeHealthPlanTotalCents('current', overrides, undefined);
    expect(untouched.overridden).toBe(false);
  });

  it('returns null for an unrecognized plan option', () => {
    expect(finComputeHealthPlanTotalCents('not-a-real-option', {}, undefined)).toBeNull();
  });
});

describe('finComputePlanOOPCents', () => {
  it('is the full spend when under the deductible, then deductible plus capped coinsurance above it', () => {
    expect(finComputePlanOOPCents(400000, 800000, 0.20, 200000)).toBe(200000);
    // At the deductible exactly, OOP = deductible.
    expect(finComputePlanOOPCents(400000, 800000, 0.20, 400000)).toBe(400000);
    // Coinsurance applies above the deductible, capped at the OOP max.
    expect(finComputePlanOOPCents(400000, 800000, 0.20, 3000000)).toBe(800000);
  });
});

describe('finHealthPlanResolvedOption / finCompPlanQuoteField adaptation', () => {
  it('resolves to the quote figure when no override is passed', () => {
    const opt = finHealthPlanResolvedOption('renewal');
    expect(opt.deductibleFamilyCents).toBe(HEALTH_PLAN_QUOTE_2027.options.renewal.deductibleFamilyCents);
    expect(opt.label).toBe(HEALTH_PLAN_QUOTE_2027.options.renewal.label);
  });

  it('resolves to an explicitly passed override instead of the quote figure -- the ported behavior for the one function that used to read a mutable global', () => {
    const opt = finHealthPlanResolvedOption('renewal', { renewal: { deductibleFamilyCents: 999999 } });
    expect(opt.deductibleFamilyCents).toBe(999999);
  });
});

describe('finComputeHealthPlanSingleClaimantDeltaCents / finComputeFamilyOOPCents / finComputeHealthPlanFamilyBreakevenCents', () => {
  it('a non-embedded option can cost a LONE claimant more than an embedded one, even with lower headline individual figures -- the worst-case comparison this function is documented to make', () => {
    // current is embedded (deductibleIndividualCents 350000 / oopMaxIndividualCents 700000 apply
    // directly to a lone claimant). option1 is NOT embedded, so a lone claimant instead has to
    // clear its FAMILY threshold (deductibleFamilyCents 400000 / oopMaxFamilyCents 800000) --
    // higher than current's individual one despite option1's own individual figures being lower.
    // At a high spend both plans cap at their OOP max, so the delta is exactly that gap: $1,000.
    const delta = finComputeHealthPlanSingleClaimantDeltaCents('current', 'option1', 5000000);
    expect(delta).toBe(HEALTH_PLAN_QUOTE_2027.options.option1.oopMaxFamilyCents - HEALTH_PLAN_QUOTE_2027.options.current.oopMaxIndividualCents);
    expect(delta).toBe(100000);
  });

  it('finds a real breakeven point for moving to a cheaper-OOP option with a higher premium', () => {
    const fromOpt = finHealthPlanResolvedOption('current');
    const toOpt = finHealthPlanResolvedOption('option1');
    const rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
    const premiumDiffCents = 200000; // toKey costs $2,000/yr more in premium
    const breakeven = finComputeHealthPlanFamilyBreakevenCents('current', 'option1', premiumDiffCents, {}, 2);
    expect(breakeven).not.toBeNull();
    // At the returned breakeven spend, the OOP savings should just clear the premium difference.
    const savingsAtBreakeven = finComputeFamilyOOPCents(fromOpt, rate, breakeven, 2) - finComputeFamilyOOPCents(toOpt, rate, breakeven, 2);
    expect(savingsAtBreakeven).toBeGreaterThanOrEqual(premiumDiffCents - 1); // integer rounding tolerance
  });

  it('returns null when the richer option never breaks even against its own premium', () => {
    // A trivially huge premium difference no OOP savings could ever clear.
    expect(finComputeHealthPlanFamilyBreakevenCents('current', 'option1', 100000000, {}, 2)).toBeNull();
  });
});
