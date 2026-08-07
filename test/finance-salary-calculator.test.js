import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// The LCMS salary calculator's data tables and pure compute functions live inside the served
// (String.raw) frontend script, not as exported module functions — extract them (none touch the
// DOM) and eval standalone. Same technique used elsewhere in this project (see CLAUDE.md
// SC3-BUG1 / TAP11 / FIN10/FIN11) — this is also exactly the class of bug it caught this time: a
// literal backtick in a comment inside the String.raw template silently truncated the whole
// served script until fixed (verified via the extract-and-`node --check` step before this).
function loadSalaryCalculator() {
  const varNames = ['LCMS_MO_BASE_SALARY_BY_YEAR', 'LCMS_PASTOR_MULTIPLIERS', 'LCMS_COMMISSIONED_TRACKS', 'LCMS_OTHER_WORKER_TRACKS'];
  const varSrcs = varNames.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`var ${name} = [\\s\\S]*?;\\n`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  // Brace-counting extractor (not a non-greedy regex) — some of these functions (e.g. the health
  // plan breakeven finder) declare an inner nested function, whose own closing brace would
  // prematurely satisfy a naive `[\s\S]*?\n\}` match and truncate the outer function.
  function extractFunction(name) {
    const startMatch = CHMS_APP_EXT_JS.match(new RegExp(`function ${name}\\([^)]*\\) \\{`));
    if (!startMatch) throw new Error(`${name} not found in built script`);
    const start = startMatch.index;
    let depth = 0, i = start;
    for (; i < CHMS_APP_EXT_JS.length; i++) {
      const ch = CHMS_APP_EXT_JS[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return CHMS_APP_EXT_JS.slice(start, i);
  }
  const fnNames = ['finLcmsBaseSalaryCents', 'finLcmsMultiplierFor', 'finComputeLcmsSalary', 'finLcmsHistoricalAvgGrowthPct', 'finDefaultSelfEmployedFica', 'finComputeEmployerFicaCents', 'finComputePensionCents', 'finConcordiaPensionRateFor', 'finConcordiaDisabilityRateFor', 'finHealthTierMonthlyCents', 'finHealthAncillaryPerContractCents', 'finComputeHealthPlanTotalCents', 'finComputePlanOOPCents', 'finCompPlanQuoteField', 'finHealthPlanResolvedOption', 'finComputeFamilyOOPCents', 'finHealthFamilySizeMatters', 'finHealthPlanEffectiveLoneClaimantTermsCents', 'finComputeHealthPlanSingleClaimantDeltaCents', 'finComputeHealthPlanFamilyBreakevenCents'];
  const fnSrcs = fnNames.map(extractFunction);
  const ficaRateM = CHMS_APP_EXT_JS.match(/var LCMS_EMPLOYER_FICA_RATE = [^\n]*\n/);
  if (!ficaRateM) throw new Error('LCMS_EMPLOYER_FICA_RATE not found in built script');
  const ssaColaM = CHMS_APP_EXT_JS.match(/var SSA_COLA_REFERENCE_PCT = [^\n]*\n/);
  if (!ssaColaM) throw new Error('SSA_COLA_REFERENCE_PCT not found in built script');
  const pensionRateM = CHMS_APP_EXT_JS.match(/var CONCORDIA_PENSION_RATE_BY_YEAR = [^\n]*\n/);
  if (!pensionRateM) throw new Error('CONCORDIA_PENSION_RATE_BY_YEAR not found in built script');
  const disabilityRateM = CHMS_APP_EXT_JS.match(/var CONCORDIA_DISABILITY_RATE_BY_YEAR = [\s\S]*?\n};\n/);
  if (!disabilityRateM) throw new Error('CONCORDIA_DISABILITY_RATE_BY_YEAR not found in built script');
  const healthPlanM = CHMS_APP_EXT_JS.match(/var HEALTH_PLAN_QUOTE_2027 = [\s\S]*?\n};\n/);
  if (!healthPlanM) throw new Error('HEALTH_PLAN_QUOTE_2027 not found in built script');
  const tiersM = CHMS_APP_EXT_JS.match(/var FIN_HEALTH_TIERS = [\s\S]*?\n\];\n/);
  if (!tiersM) throw new Error('FIN_HEALTH_TIERS not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { var _finHealthPlanPremiumOverrides = {}; var _finHealthFamilySize = 2; ${varSrcs.join('\n')} ${ficaRateM[0]} ${ssaColaM[0]} ${pensionRateM[0]} ${disabilityRateM[0]} ${tiersM[0]} ${healthPlanM[0]} ${fnSrcs.join('\n')} return { finLcmsBaseSalaryCents, finLcmsMultiplierFor, finComputeLcmsSalary, finLcmsHistoricalAvgGrowthPct, finDefaultSelfEmployedFica, finComputeEmployerFicaCents, finComputePensionCents, finConcordiaPensionRateFor, finConcordiaDisabilityRateFor, LCMS_EMPLOYER_FICA_RATE, SSA_COLA_REFERENCE_PCT, finComputeHealthPlanTotalCents, finComputePlanOOPCents, finComputeHealthPlanSingleClaimantDeltaCents, finComputeHealthPlanFamilyBreakevenCents, finHealthPlanEffectiveLoneClaimantTermsCents, finComputeFamilyOOPCents, finHealthFamilySizeMatters, finHealthPlanResolvedOption, HEALTH_PLAN_QUOTE_2027, setFamilySize: function(n) { _finHealthFamilySize = n; }, setQuoteOverride: function(k, f, cents) { if (!_finHealthPlanPremiumOverrides[k]) _finHealthPlanPremiumOverrides[k] = {}; _finHealthPlanPremiumOverrides[k][f] = cents; }, clearQuoteOverrides: function() { _finHealthPlanPremiumOverrides = {}; } }; })()`);
}

describe('LCMS Missouri District salary calculator', () => {
  const { finLcmsBaseSalaryCents, finComputeLcmsSalary, finLcmsHistoricalAvgGrowthPct, finDefaultSelfEmployedFica, finComputeEmployerFicaCents, finComputePensionCents, finConcordiaPensionRateFor, finConcordiaDisabilityRateFor, LCMS_EMPLOYER_FICA_RATE, SSA_COLA_REFERENCE_PCT, finComputeHealthPlanTotalCents, finComputePlanOOPCents, finComputeHealthPlanSingleClaimantDeltaCents, finComputeHealthPlanFamilyBreakevenCents } = loadSalaryCalculator();

  it('looks up the exact published base salary for a known year', () => {
    expect(finLcmsBaseSalaryCents(2027)).toMatchObject({ dollars: 51529, exact: true });
    expect(finLcmsBaseSalaryCents(2016)).toMatchObject({ dollars: 39900, exact: true });
  });

  it('falls back to the most recent known year rather than fabricating a number for an unpublished year', () => {
    const r = finLcmsBaseSalaryCents(2030);
    expect(r.exact).toBe(false);
    expect(r.sourceYear).toBe(2027);
    expect(r.dollars).toBe(51529);
    expect(r.colaApplied).toBe(false);
  });

  it('grows the base salary forward with a COLA % instead of freezing flat, when one is supplied', () => {
    const flat = finLcmsBaseSalaryCents(2030); // no colaPct arg — flat fallback, unchanged
    expect(flat.dollars).toBe(51529);
    const withCola = finLcmsBaseSalaryCents(2030, 0.025); // 2.5% COLA, compounded 3 years past 2027
    expect(withCola.exact).toBe(false);
    expect(withCola.sourceYear).toBe(2027);
    expect(withCola.colaApplied).toBe(true);
    expect(withCola.dollars).toBeCloseTo(51529 * Math.pow(1.025, 3), 2);
    expect(withCola.dollars).toBeGreaterThan(flat.dollars);
  });

  it('computes the LCMS district historical average growth rate from the published base salary table itself (2016-2027)', () => {
    // (51529/39900)^(1/11) - 1, computed independently here to lock in the derived figure
    const expected = Math.pow(51529 / 39900, 1 / 11) - 1;
    expect(finLcmsHistoricalAvgGrowthPct()).toBeCloseTo(expected, 10);
    expect(finLcmsHistoricalAvgGrowthPct()).toBeCloseTo(0.0235, 4); // ~2.35%/yr
  });

  it('exposes a Social Security COLA reference rate as a real constant', () => {
    expect(SSA_COLA_REFERENCE_PCT).toBeGreaterThan(0);
    expect(SSA_COLA_REFERENCE_PCT).toBeLessThan(0.10); // sanity bound — COLA is never double digits in practice
  });

  it('computes employer pension contribution as a straight percentage of salary, same shape as FICA', () => {
    expect(finComputePensionCents(10000000, 0.10)).toBe(1000000); // 10% of $100,000 = $10,000
    expect(finComputePensionCents(10000000, 0)).toBe(0);
    expect(finComputePensionCents(0, 0.10)).toBe(0);
  });

  // Real rates from the church's own "Overview of your Concordia Plans Participation" statement
  // (Traditional Option pension: 10.70% for 2026, 11.70% for 2027; Disability and Survivor:
  // 1.20% without dependents / 1.75% with dependents, unchanged between 2026 and 2027).
  describe('Real Concordia Plans rates (Pension + Disability & Survivor)', () => {
    it('looks up the exact published pension rate for a known year', () => {
      expect(finConcordiaPensionRateFor(2026)).toMatchObject({ rate: 0.1070, exact: true, sourceYear: 2026 });
      expect(finConcordiaPensionRateFor(2027)).toMatchObject({ rate: 0.1170, exact: true, sourceYear: 2027 });
    });

    it('falls back to the most recent known pension rate for an unpublished year, rather than fabricating one', () => {
      const r = finConcordiaPensionRateFor(2028);
      expect(r).toMatchObject({ rate: 0.1170, exact: false, sourceYear: 2027 });
    });

    it('looks up the disability rate by year AND dependent status', () => {
      expect(finConcordiaDisabilityRateFor(2026, false)).toMatchObject({ rate: 0.0120, exact: true, sourceYear: 2026 });
      expect(finConcordiaDisabilityRateFor(2026, true)).toMatchObject({ rate: 0.0175, exact: true, sourceYear: 2026 });
      expect(finConcordiaDisabilityRateFor(2027, false)).toMatchObject({ rate: 0.0120, exact: true, sourceYear: 2027 });
      expect(finConcordiaDisabilityRateFor(2027, true)).toMatchObject({ rate: 0.0175, exact: true, sourceYear: 2027 });
    });

    it('falls back to the most recent known disability rate for an unpublished year', () => {
      const r = finConcordiaDisabilityRateFor(2028, true);
      expect(r).toMatchObject({ rate: 0.0175, exact: false, sourceYear: 2027 });
    });

    it('computes the real dollar cost for a $73,473.75 salary (the Director of Parish Music example from earlier)', () => {
      const salaryCents = 7347375;
      const pension2027 = finConcordiaPensionRateFor(2027).rate;
      const disabilityWithDeps2027 = finConcordiaDisabilityRateFor(2027, true).rate;
      expect(finComputePensionCents(salaryCents, pension2027)).toBe(Math.round(salaryCents * 0.1170));
      expect(finComputePensionCents(salaryCents, disabilityWithDeps2027)).toBe(Math.round(salaryCents * 0.0175));
    });
  });

  it('does not apply COLA growth for an exactly-published year, even if a colaPct is supplied', () => {
    const r = finLcmsBaseSalaryCents(2027, 0.025);
    expect(r).toMatchObject({ dollars: 51529, exact: true, colaApplied: false });
  });

  it('reproduces the published Pastor compensation scale exactly (Section 1.1, base year 2027)', () => {
    // Table: years 0/5/10/20/30 -> $74,717 / $80,901 / $88,630 / $103,573 / $113,879 (the PDF's
    // own printed column rounds the raw base-x-multiplier product to the nearest whole dollar).
    const dollars = years => Math.round(finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: years }).salaryCents / 100);
    expect(dollars(0)).toBe(74717);
    expect(dollars(5)).toBe(80901);
    expect(dollars(10)).toBe(88630);
    expect(dollars(20)).toBe(103573);
    expect(dollars(30)).toBe(113879);
  });

  it('grows the pastor multiplier by 0.02/year beyond the published 30-year cap', () => {
    // Year 30 multiplier is 2.21; year 32 should be 2.21 + 0.02*2 = 2.25
    const r = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 32 });
    expect(r.multiplier).toBeCloseTo(2.25, 5);
  });

  it('reproduces the published Commissioned Worker table exactly (Section 1.2, MA+20hrs PhD track)', () => {
    // Row 0: $61,835; Row 10: $75,748; Row 25: $96,359
    const dollars = years => Math.round(finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'ma20phd', yearsExperience: years }).salaryCents / 100);
    expect(dollars(0)).toBe(61835);
    expect(dollars(10)).toBe(75748);
    expect(dollars(25)).toBe(96359);
  });

  it('caps the B.S.-only commissioned track at its published final year instead of growing further', () => {
    const atCap = finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'bs', yearsExperience: 10 });
    const beyondCap = finComputeLcmsSalary({ year: 2027, role: 'commissioned', trackKey: 'bs', yearsExperience: 20 });
    expect(atCap.multiplier).toBe(1.20);
    expect(beyondCap.multiplier).toBe(1.20); // frozen, not grown further
  });

  it('reproduces the published Other Church Workers table exactly (Section 1.3)', () => {
    // The PDF's own worked examples say "the base salary set for 2026 is $51,529" — but the
    // document's own Base Salary History table lists 2026 as $50,028 and 2027 as $51,529. Using
    // $51,529 (i.e. year 2027 in this table) reproduces the worked examples' figures exactly, so
    // that mislabeled "2026" in the prose is treated as a carried-over typo, not a data source.
    // Secretary, 8 years experience: base $51,529 x 0.97 = $49,983 (the PDF's own worked example)
    const r = finComputeLcmsSalary({ year: 2027, role: 'other', trackKey: 'secretary', yearsExperience: 8 });
    expect(r.multiplier).toBe(0.97);
    expect(Math.round(r.salaryCents / 100)).toBe(49983);
    // New-hire custodian: base $51,529 x 0.65 = $33,494 (the PDF's own worked example)
    const r2 = finComputeLcmsSalary({ year: 2027, role: 'other', trackKey: 'custodian', yearsExperience: 0 });
    expect(r2.multiplier).toBe(0.65);
    expect(Math.round(r2.salaryCents / 100)).toBe(33494);
  });

  it('adds a responsibility stipend and (pastor-only) attendance bonus on top of the base multiplier', () => {
    const base = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 10 });
    const withBonus = finComputeLcmsSalary({ year: 2027, role: 'pastor', yearsExperience: 10, attendanceBonus: 0.20 });
    expect(withBonus.multiplier).toBeCloseTo(base.multiplier + 0.20, 5);
    expect(withBonus.salaryCents).toBeGreaterThan(base.salaryCents);
  });

  // FICA/SECA employer-cost distinction: Pastors and Commissioned Ministers (e.g. DCEs) are
  // self-employed for Social Security by default (the church pays no employer FICA for them —
  // they pay their own SECA), while Other Church Workers are regular employees (the church pays
  // the standard employer FICA share). Confirmed against real Concordia Plans estimates for
  // Timothy Lutheran's actual Pastor and DCE (both self-employed, no employer FICA) and Director
  // of Parish Music (treated as a regular employee at this specific church despite nominally
  // qualifying for minister tax treatment elsewhere) — the per-worker override exists exactly to
  // handle that last case, since the role default alone would get it wrong.
  describe('FICA/SECA employer-cost distinction', () => {
    it('defaults Pastors and Commissioned Ministers to self-employed (SECA), Other Church Workers to regular-employee', () => {
      expect(finDefaultSelfEmployedFica('pastor')).toBe(true);
      expect(finDefaultSelfEmployedFica('commissioned')).toBe(true);
      expect(finDefaultSelfEmployedFica('other')).toBe(false);
    });

    it('charges $0 employer FICA for a self-employed (SECA) worker regardless of salary', () => {
      expect(finComputeEmployerFicaCents(10000000, true)).toBe(0);
    });

    it('charges the standard employer FICA rate for a regular-employee worker', () => {
      const salaryCents = 7347375; // $73,473.75 — the real Concordia estimate for this church's Director of Parish Music
      const expected = Math.round(salaryCents * LCMS_EMPLOYER_FICA_RATE);
      expect(finComputeEmployerFicaCents(salaryCents, false)).toBe(expected);
      expect(finComputeEmployerFicaCents(salaryCents, false)).toBeGreaterThan(0);
    });

    it('lets a per-worker override diverge from the role default (Director of Parish Music treated as a regular employee at this church)', () => {
      // Role default for a Commissioned Minister would be self-employed=true, but this specific
      // church's real-world practice for its Director of Parish Music is employer-paid FICA —
      // the override must win over the role default.
      const roleDefault = finDefaultSelfEmployedFica('commissioned');
      expect(roleDefault).toBe(true);
      const overridden = false; // this worker's actual per-row toggle
      expect(finComputeEmployerFicaCents(7347375, overridden)).toBeGreaterThan(0);
    });
  });

  // Health insurance renewal quote (Concordia Plans #0560500326, effective 2027).
  //
  // Medical reconciles to the packet's own printed Total Monthly / Total Annual. Dental and vision
  // are PER COVERED WORKER, confirmed by the church — the packet simply does not tier-price them,
  // so they appear as one annual figure each rather than a rate per coverage tier. These totals are
  // therefore at the quoted enrolment of 2 family contracts: medical $49,224.00, plus dental and
  // vision twice over. Previously the two ancillary figures were read as a single group bill, which
  // priced a covered worker at $26,871.24 instead of the church's own $29,130.48.
  describe('Health plan renewal quote (2027)', () => {
    it('reproduces the quote\'s printed medical totals and prices dental/vision per worker', () => {
      const r = finComputeHealthPlanTotalCents('renewal');
      expect(r.medicalCents).toBe(4922400); // $49,224.00 — the packet's own Total Annual
      expect(r.contracts).toBe(2);
      expect(r.dentalCents).toBe(304680 * 2);   // $3,046.80 each
      expect(r.visionCents).toBe(147168 * 2);   // $1,471.68 each
      expect(r.totalCents).toBe(5826096);       // $58,260.96 = 2 x $29,130.48
    });

    it('prices one family-tier worker at the church\'s own $29,130.48', () => {
      const r = finComputeHealthPlanTotalCents('renewal');
      expect(r.totalCents / r.contracts).toBe(2913048);
    });

    it('scales the group total with how many are covered', () => {
      const one = finComputeHealthPlanTotalCents('renewal', null, { self: 0, selfSpouse: 0, selfChild: 0, family: 1 });
      const three = finComputeHealthPlanTotalCents('renewal', null, { self: 0, selfSpouse: 0, selfChild: 0, family: 3 });
      expect(one.totalCents).toBe(2913048);
      expect(three.totalCents).toBe(2913048 * 3);
    });

    it('reproduces the printed medical totals for Current, Option 1/2/3', () => {
      // Quoted enrolment is 2 FAMILY contracts, so it is each option's family rate that applies.
      expect(finComputeHealthPlanTotalCents('current').medicalCents).toBe(188736 * 2 * 12);
      expect(finComputeHealthPlanTotalCents('option1').medicalCents).toBe(238815 * 2 * 12);
      expect(finComputeHealthPlanTotalCents('option2').medicalCents).toBe(218835 * 2 * 12);
      expect(finComputeHealthPlanTotalCents('option3').medicalCents).toBe(183886 * 2 * 12);
    });

    it('returns null for an unrecognized option key', () => {
      expect(finComputeHealthPlanTotalCents('nonexistent')).toBeNull();
    });
  });

  // "Is it worth it?" breakeven analysis (Renewal -> Option B), worked out by hand and cross-checked
  // here: per-household premium diff is $1,648.20/yr (half the doubled $3,296.40/yr quote total,
  // since HEALTH_PLAN_QUOTE_2027 totals cover both of the church's 2 Family contracts combined).
  describe('Health plan "is it worth it?" breakeven', () => {
    it('computes plain deductible-then-coinsurance-to-OOP-max out-of-pocket cost', () => {
      // Renewal: $4,000 deductible, 20% coinsurance, $8,000 OOP max
      expect(finComputePlanOOPCents(400000, 800000, 0.20, 200000)).toBe(200000); // below deductible: pays it all
      expect(finComputePlanOOPCents(400000, 800000, 0.20, 1000000)).toBe(520000); // $4,000 + 20% of $6,000 = $5,200
      expect(finComputePlanOOPCents(400000, 800000, 0.20, 5000000)).toBe(800000); // saturates at OOP max
    });

    it('a single family member alone accounts for all costs: Option B never breaks even vs. Renewal, worst case $500 more', () => {
      // Renewal (embedded): lone claimant capped at the individual OOP max, $8,000.
      // Option B (non-embedded): a lone claimant must clear the FAMILY OOP max, $8,500, since
      // there's no smaller individual sub-limit on a family contract.
      const worstCase = finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option2', 100000000);
      expect(worstCase).toBe(50000); // Option B costs $500 more in the worst case for a lone claimant
      // Confirmed via the moderate-claim example worked out with the user: $10,000 in costs for
      // one person costs $5,200 under Renewal vs. $6,800 under Option B — a $1,600 gap, worse
      // than the eventual $500 worst-case gap since neither plan's OOP max is reached yet.
      const moderate = finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option2', 1000000);
      expect(moderate).toBe(160000);
    });

    it('reproduces the hand-computed $18,741 family-wide breakeven for Renewal -> Option B', () => {
      // Per-household premium diff: ($52,520.40 - $49,224.00) / 2 = $1,648.20/yr = 164820 cents
      const breakeven = finComputeHealthPlanFamilyBreakevenCents('renewal', 'option2', 164820);
      expect(breakeven).toBe(1874100); // $18,741.00 — solved algebraically by hand, confirmed here
    });

    it('spread across 2+ family members, Option B saves money above the breakeven and up to $7,500/yr at saturation', () => {
      const rate = 0.20;
      const belowBreakevenSavings = finComputePlanOOPCents(800000, 1600000, rate, 1000000) - finComputePlanOOPCents(600000, 850000, rate, 1000000);
      expect(belowBreakevenSavings).toBeLessThan(164820); // not yet worth it at $10,000 family-wide
      const highSpendSavings = finComputePlanOOPCents(800000, 1600000, rate, 10000000) - finComputePlanOOPCents(600000, 850000, rate, 10000000);
      expect(highSpendSavings).toBe(750000); // $7,500/yr once both plans are fully saturated
    });

    it('Option A (Renewal -> Option 1): costs $4,045.80/yr more per household, breaks even at $28,229 family-wide, ties Renewal in the single-claimant worst case', () => {
      const perHouseholdDiffCents = 404580; // ($57,315.60 - $49,224.00) / 2
      const breakeven = finComputeHealthPlanFamilyBreakevenCents('renewal', 'option1', perHouseholdDiffCents);
      expect(breakeven).toBe(2822900); // $28,229.00
      // Renewal's individual OOP max ($8,000) exactly equals Option 1's family OOP max ($8,000),
      // so a lone claimant ends up paying the same worst-case amount under either plan.
      expect(finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option1', 100000000)).toBe(0);
    });

    it('Option D (Renewal -> Option 3): saves $2,545.68/yr per household in premium, but costs up to $500 more for a lone claimant in a worst-case year', () => {
      const calc3 = finComputeHealthPlanTotalCents('option3');
      const baseline = finComputeHealthPlanTotalCents('renewal');
      const perHouseholdDiffCents = Math.round((calc3.totalCents - baseline.totalCents) / 2);
      expect(perHouseholdDiffCents).toBe(-254568); // saves $2,545.68/yr — cheaper premium, not costlier
      expect(finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option3', 100000000)).toBe(50000); // $500 worse worst-case (embedded $8,500 vs $8,000)
      // Family-wide worst case: Option 3's $17,000 family OOP max vs. Renewal's $16,000 — $1,000
      // worse at saturation, which is still smaller than the $2,545.68 guaranteed premium
      // savings, so Option 3 comes out ahead overall even in a fully-saturated bad year.
      const familyWorstCase = finComputePlanOOPCents(1100000, 1700000, 0.20, 100000000) - finComputePlanOOPCents(800000, 1600000, 0.20, 100000000);
      expect(familyWorstCase).toBe(100000); // $1,000
      expect(Math.abs(familyWorstCase)).toBeLessThan(Math.abs(perHouseholdDiffCents));
    });
  });
});

// The deductible/out-of-pocket figures are now typed on the rates page (Deductible — single /
// family, Out-of-pocket max — single / family) rather than being hardcoded-only. Before this,
// every one of these functions read HEALTH_PLAN_QUOTE_2027 directly, so correcting a deductible
// changed the number printed on screen and nothing else — the breakeven analysis silently kept
// using the shipped quote. These pin the wiring: an edited figure has to move the maths.
describe('rates-page edits actually drive the plan maths', () => {
  it('an edited SINGLE deductible changes the lone-claimant terms on an embedded plan', () => {
    const c = loadSalaryCalculator();
    // Renewal is embedded, so one family member alone is capped at the INDIVIDUAL figures.
    expect(c.finHealthPlanEffectiveLoneClaimantTermsCents('renewal').deductibleCents).toBe(400000);
    c.setQuoteOverride('renewal', 'deductibleIndividualCents', 450000);
    expect(c.finHealthPlanEffectiveLoneClaimantTermsCents('renewal').deductibleCents).toBe(450000);
    c.clearQuoteOverrides();
  });

  it('an edited FAMILY deductible moves the family-wide breakeven', () => {
    const c = loadSalaryCalculator();
    // Uses two NON-embedded options deliberately. On an embedded plan the family deductible above
    // twice the single one can never bind — members hit their own limits first — so overriding it
    // there would correctly change nothing and prove nothing about the wiring.
    // option1 has the better deductible of the two, so it is the one worth paying up FOR. The
    // premium gap has to sit below the most these two can ever differ by ($500), or the answer is
    // legitimately "never breaks even" both before and after and the test proves nothing. The
    // override lowers option2's deductible so it actually binds at the breakeven spend — raising
    // it above that spend would correctly change nothing.
    const before = c.finComputeHealthPlanFamilyBreakevenCents('option2', 'option1', 40000);
    c.setQuoteOverride('option2', 'deductibleFamilyCents', 300000); // was $6,000, now $3,000
    const after = c.finComputeHealthPlanFamilyBreakevenCents('option2', 'option1', 40000);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    c.clearQuoteOverrides();
  });

  it('an edited SINGLE out-of-pocket max changes the single-claimant worst case', () => {
    const c = loadSalaryCalculator();
    const before = c.finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option2', 100000000);
    c.setQuoteOverride('renewal', 'oopMaxIndividualCents', 900000); // was $8,000
    const after = c.finComputeHealthPlanSingleClaimantDeltaCents('renewal', 'option2', 100000000);
    expect(after).not.toBe(before);
    c.clearQuoteOverrides();
  });
});

// The plan's own definition, supplied by the church:
//   Non-embedded — a true family deductible. No individual limits; members pool expenses and one
//     person can pay the full amount on behalf of the family.
//   Embedded — each member has their own limit inside the family limit. No member contributes more
//     than the individual limit toward the family deductible, and once they meet their own
//     deductible they pay coinsurance even if the family deductible has not been met.
// The spread-across-the-family model used to apply the family deductible only, which overstates an
// embedded plan's cost to a household whose costs are shared around.
describe('family out-of-pocket model follows the embedded / non-embedded rule', () => {
  const RATE = 0.2;

  it('reduces to the old family-only calculation for a non-embedded plan, at any member count', () => {
    const c = loadSalaryCalculator();
    const o = c.finHealthPlanResolvedOption('option1'); // not embedded
    expect(o.embedded).toBe(false);
    [1, 2, 5].forEach(n => {
      expect(c.finComputeFamilyOOPCents(o, RATE, 1200000, n))
        .toBe(c.finComputePlanOOPCents(o.deductibleFamilyCents, o.oopMaxFamilyCents, RATE, 1200000));
    });
  });

  it('reduces to the lone-claimant case at one member, both kinds of plan', () => {
    const c = loadSalaryCalculator();
    ['renewal', 'option1'].forEach(k => {
      const o = c.finHealthPlanResolvedOption(k);
      const lone = c.finHealthPlanEffectiveLoneClaimantTermsCents(k);
      expect(c.finComputeFamilyOOPCents(o, RATE, 1200000, 1))
        .toBe(c.finComputePlanOOPCents(lone.deductibleCents, lone.oopMaxCents, RATE, 1200000));
    });
  });

  // The exact condition, derived rather than assumed: the refinement can only change a figure when
  // (members x single deductible) < family deductible. Below that the members are still inside
  // their own limits and the pooled family deductible has not bound yet.
  it('is identical to the family-only model for this quote, at every member count of 2 or more', () => {
    const c = loadSalaryCalculator();
    // Every option here sets family at exactly 2x single, so two or more people always reach the
    // pooled limit together — the refinement provably cannot move these numbers.
    ['current', 'renewal', 'option1', 'option2', 'option3'].forEach(k => {
      const o = c.finHealthPlanResolvedOption(k);
      expect(o.deductibleFamilyCents).toBe(2 * o.deductibleIndividualCents);
      [2, 3, 5].forEach(n => {
        for (let spend = 100000; spend <= 3000000; spend += 100000) {
          expect(c.finComputeFamilyOOPCents(o, RATE, spend, n))
            .toBe(c.finComputePlanOOPCents(o.deductibleFamilyCents, o.oopMaxFamilyCents, RATE, spend));
        }
      });
    });
  });

  it('DOES cost less than the family-only model where the family limit is more than twice the single one', () => {
    const c = loadSalaryCalculator();
    const synthetic = { embedded: true, deductibleIndividualCents: 400000, deductibleFamilyCents: 1200000,
                        oopMaxIndividualCents: 800000, oopMaxFamilyCents: 2400000 };
    // $15,000 of care across 2 members: each clears their own $4,000 deductible, so only $8,000 is
    // deductible and the rest is coinsurance — the family-only model would charge all $12,000.
    const shared = c.finComputeFamilyOOPCents(synthetic, RATE, 1500000, 2);
    const familyOnly = c.finComputePlanOOPCents(synthetic.deductibleFamilyCents, synthetic.oopMaxFamilyCents, RATE, 1500000);
    expect(shared).toBe(800000 + 700000 * RATE);
    expect(shared).toBeLessThan(familyOnly);
    // At 3 members the pooled family deductible binds again and the two agree.
    expect(c.finComputeFamilyOOPCents(synthetic, RATE, 1500000, 3)).toBe(familyOnly);
  });

  it('never exceeds the family out-of-pocket max', () => {
    const c = loadSalaryCalculator();
    ['current', 'renewal', 'option1', 'option2', 'option3'].forEach(k => {
      const o = c.finHealthPlanResolvedOption(k);
      [1, 2, 4].forEach(n => {
        expect(c.finComputeFamilyOOPCents(o, RATE, 100000000, n)).toBeLessThanOrEqual(o.oopMaxFamilyCents);
      });
    });
  });

  it('flags that the member count is inert for every option in this quote', () => {
    const c = loadSalaryCalculator();
    // What the UI uses to decide whether to offer a family-size control at all.
    ['current', 'renewal', 'option1', 'option2', 'option3'].forEach(k => {
      expect(c.finHealthFamilySizeMatters(c.finHealthPlanResolvedOption(k))).toBe(false);
    });
    expect(c.finHealthFamilySizeMatters({ embedded: true, deductibleIndividualCents: 400000, deductibleFamilyCents: 1200000 })).toBe(true);
    expect(c.finHealthFamilySizeMatters({ embedded: false, deductibleIndividualCents: 400000, deductibleFamilyCents: 1200000 })).toBe(false);
  });
});
