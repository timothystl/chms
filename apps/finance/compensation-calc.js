// ── Compensation Planner calculator core ─────────────────────────────────────────────────────
// Mechanically extracted (not re-derived) from the legacy in-Connect Salary Planner
// (src/frontend/js-finance.js, the LCMS salary scale / FICA / Concordia pension&disability /
// health plan cost block, roughly lines 8098-8125 and 9507-9966 as of 2026-09-17) -- these are
// Andrew's real, correctness-critical financial formulas and published rate tables (LCMS MO
// District compensation scales, employer FICA, Concordia Retirement/Disability plan rates, the
// 2027 Concordia health plan quote), not something to re-derive by hand. Every exported function
// here is verified byte-for-byte equivalent to its legacy counterpart across a representative
// input grid (see test/finance-compensation-calc.test.js) before being used anywhere real.
//
// Deliberately NOT ported: FIN_CONCORDIA_SEED_BY_NAME (real staff names + real compensation
// benchmark figures hardcoded in the legacy frontend source -- out of scope for a general
// calculator module, and a separate data-handling question in its own right), _finSalaryRoster
// and other mutable browser-global UI state (this module is stateless; callers pass roster/
// override data in explicitly), and every DOM-rendering function (this module has no HTML in it
// at all -- see compensation-pages.js for rendering).
//
// One deliberate adaptation from the original: finCompPlanQuoteField (originally js-finance.js
// line ~11186, far from the rest of this block) read a mutable browser global
// (_finHealthPlanPremiumOverrides) directly instead of accepting it as a parameter, which only
// works for a page mutating one shared in-memory object -- not a stateless server request. This
// port threads premiumOverrides through explicitly instead; the lookup logic itself (override
// wins, else the quote's own figure) is unchanged.

export function finLcmsBaseSalaryCents(year, colaPct, referenceByYear) {
  var ref = referenceByYear || {};
  if (ref[year] && ref[year].baseSalaryCents != null) {
    return { dollars: ref[year].baseSalaryCents / 100, exact: true, sourceYear: year, colaApplied: false };
  }
  var known = {};
  Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).forEach(function(y) { known[y] = LCMS_MO_BASE_SALARY_BY_YEAR[y]; });
  Object.keys(ref).forEach(function(y) { if (ref[y] && ref[y].baseSalaryCents != null) known[y] = ref[y].baseSalaryCents / 100; });
  var years = Object.keys(known).map(Number).sort(function(a, b) { return a - b; });
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  var sourceDollars = known[sourceYear];
  var rate = Number(colaPct) || 0;
  var yearsPast = year - sourceYear;
  var colaApplied = rate !== 0 && yearsPast > 0;
  var dollars = colaApplied ? sourceDollars * Math.pow(1 + rate, yearsPast) : sourceDollars;
  return { dollars: dollars, exact: sourceYear === year, sourceYear: sourceYear, colaApplied: colaApplied };
}
// Resolves the health-insurance opt-out cash figure for "year" the same way — an editable
// per-year dollar figure (tied loosely to the premium, bumped modestly year to year by hand), not
// a computed fraction of the premium. Falls back to the nearest earlier saved year, then 0 (forces
// an explicit entry rather than guessing).
export function finHealthOptOutCentsFor(year, referenceByYear) {
  var ref = referenceByYear || {};
  if (ref[year] && ref[year].healthOptOutCents != null) return ref[year].healthOptOutCents;
  var years = Object.keys(ref).map(Number).filter(function(y) { return ref[y] && ref[y].healthOptOutCents != null && y <= year; }).sort(function(a, b) { return a - b; });
  return years.length ? ref[years[years.length - 1]].healthOptOutCents : 0;
}
export const LCMS_MO_BASE_SALARY_BY_YEAR = { 2016: 39900, 2017: 40000, 2018: 40250, 2019: 40900, 2020: 41718, 2021: 42625, 2022: 43515, 2023: 45475, 2024: 47066, 2025: 48713, 2026: 50028, 2027: 51529 };
// Section 1.1 — Annual Compensation Scale for Pastors, years of experience 0-30; the district
// recommends +0.02/year of additional multiplier for service beyond 30 years (no hard cap).
export const LCMS_PASTOR_MULTIPLIERS = [1.45,1.47,1.49,1.51,1.54,1.57,1.60,1.63,1.66,1.69,1.72,1.75,1.78,1.81,1.84,1.87,1.90,1.93,1.96,1.99,2.01,2.03,2.05,2.07,2.09,2.11,2.13,2.15,2.17,2.19,2.21];
// Section 1.2 — Annual Compensation Scale for Commissioned Workers (educators/DCE/DCO/Deaconess/
// etc). Each education track's multiplier caps at the printed table's last year (the district's
// own footnote: reaching the end of a column stops further years-of-service increases, to
// encourage further formal education) EXCEPT the three degree tracks at/above a Master's, which
// the district recommends growing +0.02/year beyond year 25 instead of capping.
export const LCMS_COMMISSIONED_TRACKS = {
  bs:      { label: 'B.S., no further hours', multipliers: [1.00,1.02,1.04,1.06,1.08,1.10,1.12,1.14,1.16,1.18,1.20], capped: true },
  bs10:    { label: 'B.S. + 10 hrs (working toward MA)', multipliers: [1.03,1.05,1.07,1.09,1.12,1.15,1.18,1.20,1.22,1.24,1.26,1.28,1.30], capped: true },
  bs20:    { label: 'B.S. + 20 hrs (working toward MA)', multipliers: [1.06,1.08,1.10,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.35,1.37,1.39,1.41,1.43], capped: true },
  ma:      { label: 'M.A.', multipliers: [1.12,1.14,1.16,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.53,1.55,1.57,1.59,1.61,1.63,1.65,1.67,1.69,1.71,1.73], growBeyond: 0.02 },
  ma10phd: { label: 'M.A. + 10 hrs (working toward PhD)', multipliers: [1.16,1.18,1.20,1.22,1.25,1.28,1.31,1.34,1.37,1.40,1.43,1.46,1.49,1.52,1.55,1.58,1.61,1.64,1.66,1.68,1.70,1.72,1.74,1.76,1.78,1.80], growBeyond: 0.02 },
  ma20phd: { label: 'M.A. + 20 hrs (working toward PhD)', multipliers: [1.20,1.22,1.24,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68,1.71,1.74,1.77,1.79,1.81,1.83,1.85,1.87], growBeyond: 0.02 },
};
// Section 1.3 — Annual Compensation Scale for Other Church Workers, years 0-20; the district
// recommends +0.02/year beyond year 20 for all four of these (no cap, unlike the B.S.-only
// commissioned tracks above).
export const LCMS_OTHER_WORKER_TRACKS = {
  custodian:              { label: 'Custodian', multipliers: [0.65,0.67,0.69,0.72,0.75,0.78,0.81,0.84,0.87,0.90,0.93,0.96,0.99,1.02,1.05,1.08,1.11,1.14,1.17,1.19,1.21], growBeyond: 0.02 },
  secretary:              { label: 'Secretary', multipliers: [0.75,0.77,0.79,0.82,0.85,0.88,0.91,0.94,0.97,1.00,1.03,1.06,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.29,1.31], growBeyond: 0.02 },
  childcare_director:     { label: 'Child Care Director', multipliers: [1.05,1.07,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.54,1.57,1.59,1.61], growBeyond: 0.02 },
  business_manager_music: { label: 'Business Manager / Director of Music', multipliers: [1.10,1.12,1.14,1.17,1.20,1.23,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68], growBeyond: 0.02 },
};
// Section 1.6 — additional multiplier for extra responsibility, added on top of the base
// education/experience multiplier (e.g. a teacher who is also Principal). Ranges as published;
// the calculator uses the midpoint as a starting default, hand-adjustable per worker.
export const LCMS_RESPONSIBILITY_STIPENDS = [
  { key: 'none', label: 'None', range: [0, 0] },
  { key: 'exec_director', label: 'Executive Director', range: [0.25, 0.45] },
  { key: 'principal', label: 'Principal', range: [0.20, 0.40] },
  { key: 'early_childhood_director', label: 'Early Childhood Director', range: [0.10, 0.20] },
  { key: 'assistant_principal', label: 'Assistant Principal', range: [0.10, 0.20] },
  { key: 'dce', label: 'Director of Christian Education', range: [0.10, 0.20] },
  { key: 'music_director', label: 'Director of Music for Congregation', range: [0.05, 0.15] },
  { key: 'youth_director', label: 'Director of Youth', range: [0.05, 0.15] },
  { key: 'part_time_admin', label: 'Administrator for Part-Time Agencies', range: [0.05, 0.15] },
  { key: 'athletic_director', label: 'Athletic Director', range: [0.05, 0.15] },
  { key: 'tech_coordinator', label: 'Technology Coordinator', range: [0.05, 0.15] },
];
// Section 1.4 — additional multiplier for a sole/senior pastor, based on worship attendance.
export const LCMS_ATTENDANCE_BONUS_BANDS = [
  { key: 'none', label: 'Not applicable / under 150', range: [0, 0] },
  { key: 'band1', label: '150–350 average attendance', range: [0.05, 0.10] },
  { key: 'band2', label: '351–750 average attendance', range: [0.10, 0.15] },
  { key: 'band3', label: '750+ average attendance', range: [0.15, 0.25] },
];
// Pure — no DOM — the compound annual growth rate implied by the district's own published base
// salary history (first published year to last), as one data-backed growth-rate option — derived
// from the table itself, so it never needs separate updating when the table grows.
export function finLcmsHistoricalAvgGrowthPct() {
  var years = Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var first = years[0], last = years[years.length - 1];
  if (last === first) return 0;
  return Math.pow(LCMS_MO_BASE_SALARY_BY_YEAR[last] / LCMS_MO_BASE_SALARY_BY_YEAR[first], 1 / (last - first)) - 1;
}
// The most recent OFFICIAL (not projected) Social Security COLA at the time this was written —
// 2.8%, effective for 2026. The SSA doesn't announce a given year's COLA until October of the
// prior year (based on Jul-Sep CPI data), so this needs a manual update once the 2027 figure is
// officially announced; various projections as of mid-2026 estimate it around 3.7-3.8%.
export const SSA_COLA_REFERENCE_PCT = 0.028;
// Looks up (or extrapolates) a multiplier from one of the tables above. growBeyond extends the
// scale past its last published year; capped freezes at the last published value instead
// (matches the district's own distinction between the B.S.-only commissioned tracks, which cap
// to encourage further education, and every other track, which the district recommends growing).
export function finLcmsMultiplierFor(track, yearsExperience) {
  var years = Math.max(0, Math.floor(Number(yearsExperience) || 0));
  var multipliers = track.multipliers;
  if (years < multipliers.length) return multipliers[years];
  var last = multipliers[multipliers.length - 1];
  if (track.capped || !track.growBeyond) return last;
  return Math.round((last + track.growBeyond * (years - (multipliers.length - 1))) * 100) / 100;
}
// Pure — no DOM — computes one worker's salary per the LCMS MO District formula: base salary (by
// year) × (role/education/experience multiplier + any responsibility stipend + any attendance
// bonus, the latter only meaningful for a sole/senior pastor per Section 1.4).
export function finComputeLcmsSalary(opts) {
  var base = finLcmsBaseSalaryCents(opts.year, opts.colaPct, opts.referenceByYear);
  var track;
  if (opts.role === 'pastor') track = { multipliers: LCMS_PASTOR_MULTIPLIERS, growBeyond: 0.02 };
  else if (opts.role === 'commissioned') track = LCMS_COMMISSIONED_TRACKS[opts.trackKey];
  else track = LCMS_OTHER_WORKER_TRACKS[opts.trackKey];
  if (!track) return null;
  var multiplier = finLcmsMultiplierFor(track, opts.yearsExperience) + (Number(opts.responsibilityStipend) || 0) + (Number(opts.attendanceBonus) || 0);
  var salaryCents = Math.round(base.dollars * 100 * multiplier);
  return { baseDollars: base.dollars, baseExact: base.exact, baseSourceYear: base.sourceYear, multiplier: multiplier, salaryCents: salaryCents };
}

// Pastors and Commissioned Ministers (e.g. DCEs) are classified by the IRS as self-employed for
// Social Security purposes ("Ministers of Religion") — the church does not pay the employer half
// of FICA for them, the worker pays the full SECA amount themselves. Other Church Workers are
// regular W-2 employees, so the church does pay the standard employer share. This default can be
// wrong for a specific real worker (e.g. a Director of Parish Music who is treated as a regular
// employee at a given congregation despite nominally qualifying for minister tax treatment
// elsewhere), so it's a per-worker override, not a hardcoded role rule.
export function finDefaultSelfEmployedFica(role) {
  return role === 'pastor' || role === 'commissioned';
}
export const LCMS_EMPLOYER_FICA_RATE = 0.0765; // combined employer OASDI (6.2%) + Medicare (1.45%)
// Employer-side FICA cost to the church — $0 for a self-employed (SECA) worker, since the church
// has no employer-FICA obligation for them at all; the worker pays their own full SECA share
// outside of what the church budgets here.
export function finComputeEmployerFicaCents(salaryCents, selfEmployedFica) {
  if (selfEmployedFica) return 0;
  return Math.round((salaryCents || 0) * LCMS_EMPLOYER_FICA_RATE);
}
export const CONCORDIA_PENSION_RATE_BY_YEAR = { 2026: 0.1070, 2027: 0.1170 }; // Concordia Retirement Plan, Traditional Option
export const CONCORDIA_DISABILITY_RATE_BY_YEAR = { // Concordia Disability and Survivor Plan — rate depends on the worker's dependent status
  2026: { withoutDependents: 0.0120, withDependents: 0.0175 },
  2027: { withoutDependents: 0.0120, withDependents: 0.0175 }
};
export function finConcordiaPensionRateFor(year) {
  var years = Object.keys(CONCORDIA_PENSION_RATE_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var found = CONCORDIA_PENSION_RATE_BY_YEAR[year];
  if (found != null) return { rate: found, exact: true, sourceYear: year };
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  return { rate: CONCORDIA_PENSION_RATE_BY_YEAR[sourceYear], exact: false, sourceYear: sourceYear };
}
export function finConcordiaDisabilityRateFor(year, hasDependents) {
  var years = Object.keys(CONCORDIA_DISABILITY_RATE_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var key = hasDependents ? 'withDependents' : 'withoutDependents';
  var found = CONCORDIA_DISABILITY_RATE_BY_YEAR[year];
  if (found != null) return { rate: found[key], exact: true, sourceYear: year };
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  return { rate: CONCORDIA_DISABILITY_RATE_BY_YEAR[sourceYear][key], exact: false, sourceYear: sourceYear };
}

export const _finSalaryRoster = [];
// Pure — no DOM — a straight percentage-of-salary employer cost (shared math for both Pension and
// Disability & Survivor — same shape as employer FICA, just with rates set by Concordia yearly).
// Percent-as-fraction round-trips through the storage layer (typed "11.7" -> /100 -> 0.117 ->
// *100 for display) pick up float noise (0.117*100 = 11.700000000000001) — .toFixed(2) used to
// mask that, but reformatting the LIVE value on every keystroke (this whole card rerenders on
// oninput) fights the user's typing exactly like the District Reference Data bug documented
// above: the displayed value changes out from under them mid-type, reading as "typing backward."
// Rounding to a clean number instead (not a zero-padded string) fixes both — no float garbage,
// and the redisplayed value matches what was actually typed instead of being reformatted.
export function finFmtPctInput(fraction) {
  return Math.round((Number(fraction) || 0) * 10000) / 100;
}
export function finComputePensionCents(salaryCents, pensionPct) {
  return Math.round((salaryCents || 0) * (Number(pensionPct) || 0));
}
// Real paychecks: divide the exact LCMS-formula annual figure by the number of pay periods,
// round THAT per-period amount to the nearest $5, then multiply back by the period count — so the
// annual salary is always an exact whole multiple of a clean per-period paycheck (26 biweekly
// periods/yr), rather than a round annual figure that itself doesn't divide evenly. Deliberately
// NOT applied inside finComputeLcmsSalary itself — that function's exactness is what the PDF
// reconciliation tests depend on; this rounding only touches the "real compensation" computation
// path (roster table, Total Compensation, scenario comparison, bottom line).
export const FIN_SALARY_PAY_PERIODS = 26;
export function finRoundSalaryCents(cents) {
  var perPeriodCents = cents / FIN_SALARY_PAY_PERIODS;
  var perPeriodRounded = Math.round(perPeriodCents / 500) * 500;
  return perPeriodRounded * FIN_SALARY_PAY_PERIODS;
}
export const FIN_HEALTH_TIERS = [
  { key: 'self', label: 'Self' },
  { key: 'selfSpouse', label: 'Self & Spouse' },
  { key: 'selfChild', label: 'Self & Child' },
  { key: 'family', label: 'Family' }
];
// Concordia Plans quote #0560500326, effective 2027. tiersMonthlyCents is the packet's Enrollment
// and Rates block verbatim; dental and vision are NOT tier-priced there, so they stay annual group
// figures shared evenly across whoever is enrolled. Medical annual therefore falls out of
// enrollment x tier rate x 12 rather than being stored — for this church's real enrollment (2 Family)
// that reproduces the packet's own $49,224.00 exactly.
export const HEALTH_PLAN_QUOTE_2027 = {
  effectiveYear: 2027,
  enrollmentContracts: 2, // kept for the pre-tier save shape; real counts now come from the roster
  enrollmentCounts: { self: 0, selfSpouse: 0, selfChild: 0, family: 2 },
  coinsuranceRate: 0.20,  // "Coinsurance 20%" — the same for every option in this quote
  options: {
    current: { label: 'Current — Healthy Me HSA-C (BCBS)', tiersMonthlyCents: { self: 70424, selfSpouse: 141552, selfChild: 117608, family: 188736 }, dentalCents: 144732, visionCents: 73584, embedded: true, deductibleFamilyCents: 700000, oopMaxFamilyCents: 1400000, deductibleIndividualCents: 350000, oopMaxIndividualCents: 700000 },
    renewal: { label: 'Renewal — Stay in Current Plan (Healthy Me HSA-C)', tiersMonthlyCents: { self: 76530, selfSpouse: 153825, selfChild: 127805, family: 205100 }, dentalCents: 152340, visionCents: 73584, embedded: true, deductibleFamilyCents: 800000, oopMaxFamilyCents: 1600000, deductibleIndividualCents: 400000, oopMaxIndividualCents: 800000 },
    option1: { label: 'Option 1 — Healthy Me HSA-A (BCBS)', tiersMonthlyCents: { self: 89110, selfSpouse: 179111, selfChild: 148814, family: 238815 }, dentalCents: 152340, visionCents: 73584, embedded: false, deductibleFamilyCents: 400000, oopMaxFamilyCents: 800000, deductibleIndividualCents: 200000, oopMaxIndividualCents: 400000 },
    option2: { label: 'Option 2 — Healthy Me HSA-B (BCBS)', tiersMonthlyCents: { self: 81655, selfSpouse: 164127, selfChild: 136364, family: 218835 }, dentalCents: 152340, visionCents: 73584, embedded: false, deductibleFamilyCents: 600000, oopMaxFamilyCents: 850000, deductibleIndividualCents: 300000, oopMaxIndividualCents: 600000 },
    option3: { label: 'Option 3 — Healthy Me HSA-D (BCBS)', tiersMonthlyCents: { self: 68614, selfSpouse: 137914, selfChild: 114585, family: 183886 }, dentalCents: 152340, visionCents: 73584, embedded: true, deductibleFamilyCents: 1100000, oopMaxFamilyCents: 1700000, deductibleIndividualCents: 550000, oopMaxIndividualCents: 850000 }
  }
};
// The monthly rate for one tier of one option, honoring an admin override typed on the rates page.
export function finHealthTierMonthlyCents(optionKey, tierKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  var t = ov.tiersMonthlyCents || {};
  return t[tierKey] != null ? t[tierKey] : (opt.tiersMonthlyCents || {})[tierKey];
}
// { [optionKey]: { medicalCents, dentalCents, visionCents } } — an admin can override any of the
// 3 premium lines for any plan option (the quote is a fixed 2027 snapshot; a future year's renewal
// quote will have different real numbers), unset fields fall back to the quote's own figure.
export const _finHealthPlanPremiumOverrides = {};
// Pure — no DOM — returns the Medical/Dental/Vision breakdown + total annual employer cost in
// cents for one of the HEALTH_PLAN_QUOTE_2027 options (after applying any admin override on top
// of the quote's own figures), or null for an unrecognized key.
// Enrollment defaults to the quote's own counts so this stays a pure function of the quote — the
// live roster's counts are passed in by the UI. A legacy medicalCents override (the pre-tier save
// shape, one annual figure for the whole group) still wins if one is stored, so nothing an admin
// typed under the old card is silently discarded.
// Dental and vision are PER COVERED WORKER, confirmed by the church against real premiums:
// $120.61/mo dental and $61.32/mo vision each on the current plan, i.e. $1,447.32 and $735.84 a
// year per worker. The figures stored above are those per-worker annual amounts.
//
// ⚠ The renewal packet's own dental and vision lines are TWICE these, because they are quoted for
// the two contracts enrolled at the time. Transcribing a packet line straight in therefore doubles
// every covered worker's dental and vision. Check a packet figure against the per-worker monthly
// premium before entering it.
//
// This used to treat those figures as a single group bill divided across whoever was enrolled, so
// a covered worker's dental and vision fell every time a colleague joined, and adding a covered
// worker added nothing at all to the church's total. At the church's stated figures a family-tier
// worker costs $24,612.00 medical + $3,046.80 dental + $1,471.68 vision = $29,130.48.
export function finHealthAncillaryPerContractCents(optionKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return { dentalCents: 0, visionCents: 0 };
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  return {
    dentalCents: ov.dentalCents != null ? ov.dentalCents : opt.dentalCents,
    visionCents: ov.visionCents != null ? ov.visionCents : opt.visionCents
  };
}
export function finComputeHealthPlanTotalCents(optionKey, premiumOverrides, enrollment) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  var counts = enrollment || HEALTH_PLAN_QUOTE_2027.enrollmentCounts;
  var tiers = {}, monthlyCents = 0, contracts = 0;
  FIN_HEALTH_TIERS.forEach(function(t) {
    var rate = finHealthTierMonthlyCents(optionKey, t.key, premiumOverrides) || 0;
    var n = Math.max(0, Math.floor(Number(counts[t.key]) || 0));
    tiers[t.key] = { monthlyCents: rate, count: n };
    monthlyCents += rate * n;
    contracts += n;
  });
  var medicalCents = ov.medicalCents != null ? ov.medicalCents : monthlyCents * 12;
  // Scaled to who is actually covered — see finHealthAncillaryPerContractCents.
  var perContract = finHealthAncillaryPerContractCents(optionKey, premiumOverrides);
  var dentalCents = perContract.dentalCents * contracts;
  var visionCents = perContract.visionCents * contracts;
  var totalCents = medicalCents + dentalCents + visionCents;
  var overridden = ov.medicalCents != null || ov.dentalCents != null || ov.visionCents != null
    || Object.keys(ov.tiersMonthlyCents || {}).length > 0;
  return {
    label: opt.label, medicalCents: medicalCents, dentalCents: dentalCents, visionCents: visionCents,
    totalCents: totalCents, overridden: overridden, tiers: tiers, contracts: contracts,
    monthlyCents: monthlyCents, monthlyTotalCents: Math.round(totalCents / 12)
  };
}
// Pure — no DOM — a plan's own out-of-pocket cost for a given total billed amount, under a plain
// deductible-then-coinsurance-up-to-an-OOP-max design (every option in this quote works this way).
export function finComputePlanOOPCents(deductibleCents, oopMaxCents, coinsuranceRate, spendCents) {
  if (spendCents <= deductibleCents) return spendCents;
  var coinsuranceCapCents = oopMaxCents - deductibleCents;
  var oopFromCoinsurance = Math.min((spendCents - deductibleCents) * coinsuranceRate, coinsuranceCapCents);
  return deductibleCents + oopFromCoinsurance;
}
// Pure — no DOM — the extra (or reduced) out-of-pocket cost of being on toKey instead of fromKey
// for ONE family, assuming the whole family's medical costs (spendCents) are concentrated in a
// single member (not spread across 2+ people) — the case a non-embedded plan's aggregate
// deductible/OOP-max hits hardest, since one person alone has to clear the same (family-size)
// threshold that an embedded plan would have capped at a smaller individual number. Positive =
// toKey costs the family more at that spend level; this is the worst-case comparison, not the
// typical one — see finComputeHealthPlanFamilyBreakevenCents for the multi-member case.
export function finComputeHealthPlanSingleClaimantDeltaCents(fromKey, toKey, spendCents, premiumOverrides) {
  var fromTerms = finHealthPlanEffectiveLoneClaimantTermsCents(fromKey, premiumOverrides), toTerms = finHealthPlanEffectiveLoneClaimantTermsCents(toKey, premiumOverrides);
  if (!fromTerms || !toTerms) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  return finComputePlanOOPCents(toTerms.deductibleCents, toTerms.oopMaxCents, rate, spendCents) - finComputePlanOOPCents(fromTerms.deductibleCents, fromTerms.oopMaxCents, rate, spendCents);
}
// Pure — no DOM — one plan option with its four deductible/out-of-pocket figures resolved through
// any admin override typed into the rates table. Every consumer below used to read
// HEALTH_PLAN_QUOTE_2027 directly, so a corrected deductible changed the displayed figure and
// nothing else: the breakeven analysis silently kept using the hardcoded quote. Anything that
// reasons about these numbers must go through here.
// finCompPlanQuoteField, originally at js-finance.js:11186 (far from the rest of this block --
// not part of the contiguous extraction), read the mutable browser global
// _finHealthPlanPremiumOverrides directly rather than accepting it as a parameter like every
// other function ported here does. That works for a page that mutates one shared in-memory object
// as an admin edits a rates table, but not for a stateless server request -- so this port adds an
// explicit premiumOverrides parameter (defaulting to {}, i.e. no override, same as an unset global
// would resolve to) rather than reading a module-level global. The lookup logic itself --
// override wins, else the quote's own figure -- is unchanged.
export function finCompPlanQuoteField(optionKey, field, premiumOverrides) {
  var ov = ((premiumOverrides || {})[optionKey] || {})[field];
  return ov != null ? ov : HEALTH_PLAN_QUOTE_2027.options[optionKey][field];
}
export function finHealthPlanResolvedOption(optionKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  // Carries every original field through (label, tier rates, dental/vision) — callers treat this
  // as the option itself, so returning only the four resolved numbers silently blanked things
  // like opt.label at the call sites.
  var out = {};
  Object.keys(opt).forEach(function(k) { out[k] = opt[k]; });
  ['deductibleIndividualCents', 'deductibleFamilyCents', 'oopMaxIndividualCents', 'oopMaxFamilyCents'].forEach(function(f) {
    out[f] = finCompPlanQuoteField(optionKey, f, premiumOverrides);
  });
  return out;
}
// Pure — no DOM — the deductible/OOP-max that actually applies to ONE family member who alone
// accounts for all of a family contract's costs: the plan's own individual figures if it's
// embedded (each person protected separately), or its family figures if not (no individual
// sub-limit — a lone claimant has to clear the same aggregate threshold as the whole family).
export function finHealthPlanEffectiveLoneClaimantTermsCents(optionKey, premiumOverrides) {
  var opt = finHealthPlanResolvedOption(optionKey, premiumOverrides);
  if (!opt) return null;
  return opt.embedded
    ? { deductibleCents: opt.deductibleIndividualCents, oopMaxCents: opt.oopMaxIndividualCents }
    : { deductibleCents: opt.deductibleFamilyCents, oopMaxCents: opt.oopMaxFamilyCents };
}
// How many people a "family" contract is assumed to cover when modeling costs spread across the
// household. Only matters for an EMBEDDED plan, where each member has their own limit inside the
// family one; a non-embedded plan pools everything and the count makes no difference. Default 2 —
// every option in this quote sets the family deductible at exactly 2x the individual one.
export const _finHealthFamilySize = 2;
// Pure — no DOM — what a whole family actually pays out of pocket for spendCents of billed care,
// split evenly across a given number of people.
//
// Non-embedded: one pooled family deductible, one family out-of-pocket max — the member count is
// irrelevant, and this reduces exactly to the old family-figures-only calculation.
//
// Embedded: each member's contribution TOWARD the family deductible is capped at the individual
// deductible, and once a member has met their own deductible they start paying coinsurance even
// though the family deductible may not be met yet. Modelling only the family deductible (what this
// used to do) therefore overstates what an embedded plan costs a family whose costs are spread
// around — it charged full deductible dollars past the point real members would already have
// flipped to coinsurance. Caps are applied both per member (individual OOP max) and to the
// household (family OOP max).
//
// With members = 1 this reduces to the lone-claimant case in both directions, which is why
// finHealthPlanEffectiveLoneClaimantTermsCents stays consistent with it.
export function finComputeFamilyOOPCents(opt, rate, spendCents, members) {
  if (!opt) return null;
  var n = Math.max(1, Math.floor(Number(members) || 1));
  if (!opt.embedded) return finComputePlanOOPCents(opt.deductibleFamilyCents, opt.oopMaxFamilyCents, rate, spendCents);
  var perMemberSpend = spendCents / n;
  // Deductible dollars actually collected: each member contributes at most their individual
  // deductible, and the family deductible caps the pooled total.
  var perMemberDed = Math.min(perMemberSpend, opt.deductibleIndividualCents);
  var aggregateDed = Math.min(n * perMemberDed, opt.deductibleFamilyCents);
  var coinsurance = Math.max(0, spendCents - aggregateDed) * rate;
  var perMemberCap = n * opt.oopMaxIndividualCents;
  return Math.min(aggregateDed + coinsurance, perMemberCap, opt.oopMaxFamilyCents);
}
// Pure — no DOM — the total family-wide annual medical spend (in cents, assumed spread across 2+
// family members so the FAMILY deductible/OOP-max apply, not a single person's) at which moving
// from fromKey to toKey starts saving more in reduced out-of-pocket costs than the extra premium
// costs (perHouseholdPremiumDiffCents, positive = toKey costs more per household per year). Returns
// null if the plan never breaks even even at a very high spend level (e.g. toKey's premium is
// higher with no compensating deductible/OOP-max improvement at all).
export function finComputeHealthPlanFamilyBreakevenCents(fromKey, toKey, perHouseholdPremiumDiffCents, premiumOverrides, familySize) {
  var from = finHealthPlanResolvedOption(fromKey, premiumOverrides), to = finHealthPlanResolvedOption(toKey, premiumOverrides);
  if (!from || !to) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  var members = familySize == null ? _finHealthFamilySize : familySize;
  function savings(spendCents) {
    return finComputeFamilyOOPCents(from, rate, spendCents, members)
         - finComputeFamilyOOPCents(to, rate, spendCents, members);
  }
  var maxSpendCents = Math.max(from.oopMaxFamilyCents, to.oopMaxFamilyCents) * 4;
  if (savings(maxSpendCents) < perHouseholdPremiumDiffCents) return null;
  var lo = 0, hi = maxSpendCents;
  for (var i = 0; i < 60; i++) {
    var mid = (lo + hi) / 2;
    if (savings(mid) >= perHouseholdPremiumDiffCents) hi = mid; else lo = mid;
  }
  return Math.round(hi);
}

