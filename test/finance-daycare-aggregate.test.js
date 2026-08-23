import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
// P25-E: finance-only functions moved out of the ext bundle into their own lazily-loaded
// bundle (see html-chms.js). This file only extracts source by regex/string search, so the
// two are simply concatenated back together for that purpose.
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;

// finAggregateDaycareByYear() lives inside the served (String.raw) frontend script — extract and
// eval standalone, same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 /
// TAP11 / FIN10 / finance-church-detail-body).
function loadHelper() {
  const orderM = CHMS_APP_EXT_JS_ALL.match(/var FIN_KNOWN_CATEGORY_ORDER = [\s\S]*?;\n/);
  const isIncomeM = CHMS_APP_EXT_JS_ALL.match(/function finIsIncomeCategory\([^)]*\) \{[\s\S]*?\n\}/);
  const countedM = CHMS_APP_EXT_JS_ALL.match(/var FIN_DAYCARE_COUNTED_SOURCES = [\s\S]*?;\n/);
  const otherTotalsM = CHMS_APP_EXT_JS_ALL.match(/function finDaycareOtherSourceTotals\([^)]*\) \{[\s\S]*?\n\}/);
  const aggM = CHMS_APP_EXT_JS_ALL.match(/function finAggregateDaycareByYear\([^)]*\) \{[\s\S]*?\n\}/);
  if (!orderM || !isIncomeM || !countedM || !otherTotalsM || !aggM) throw new Error('helper(s) not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${orderM[0]} ${isIncomeM[0]} ${countedM[0]} ${otherTotalsM[0]} ${aggM[0]} return { finAggregateDaycareByYear, finDaycareOtherSourceTotals }; })()`);
}

function entry(period, category, entry_type, amount_cents, source) {
  return { period, category, entry_type, amount_cents, source: source || 'manual' };
}

describe('finAggregateDaycareByYear', () => {
  const { finAggregateDaycareByYear } = loadHelper();

  it('sums actual and budget normally when there is no override', () => {
    const agg = finAggregateDaycareByYear([
      entry('2025', 'Tuition Income', 'actual', 28500000, 'church_budget_import'),
      entry('2025', 'Tuition Income', 'budget', 30000000, 'church_budget_import'),
    ]);
    expect(agg.byYear['2025'].categories['Tuition Income']).toEqual({ actual: 285000, budget: 300000 });
  });

  it('a manual_budget_override REPLACES the budget for that (year, category) instead of adding to it', () => {
    const agg = finAggregateDaycareByYear([
      entry('2025', 'Tuition Income', 'actual', 28500000, 'church_budget_import'),
      entry('2025', 'Tuition Income', 'budget', 30000000, 'church_budget_import'),
      entry('2025', 'Tuition Income', 'budget', 27500000, 'manual_budget_override'),
    ]);
    const cat = agg.byYear['2025'].categories['Tuition Income'];
    expect(cat.actual).toBe(285000); // actual untouched
    expect(cat.budget).toBe(275000); // override wins, not 300000+275000
    expect(agg.byYear['2025'].incomeBudget).toBe(275000);
  });

  it('does not double-count when re-applied and does not affect other categories', () => {
    const agg = finAggregateDaycareByYear([
      entry('2025', 'Tuition Income', 'budget', 30000000, 'church_budget_import'),
      entry('2025', 'Tuition Income', 'budget', 27500000, 'manual_budget_override'),
      entry('2025', 'Payroll', 'budget', 20000000, 'church_budget_import'),
    ]);
    expect(agg.byYear['2025'].categories['Tuition Income'].budget).toBe(275000);
    expect(agg.byYear['2025'].categories['Payroll'].budget).toBe(200000);
    expect(agg.byYear['2025'].expenseBudget).toBe(200000); // only Payroll (an expense) counted, Tuition is income
  });

  it('an override can establish a brand-new category with no other entries', () => {
    const agg = finAggregateDaycareByYear([entry('2025', 'Other Expenses', 'budget', 500000, 'manual_budget_override')]);
    expect(agg.categories).toContain('Other Expenses');
    expect(agg.byYear['2025'].categories['Other Expenses']).toEqual({ actual: 0, budget: 5000 });
  });

  it('Utilities/Insurance allocation and a manual override on the same category do not conflict (allocation sets actual, override sets budget)', () => {
    const allocationByYear = { '2025': { mdoUtilityCents: 500000, mdoInsuranceCents: 200000 } };
    const agg = finAggregateDaycareByYear([
      entry('2025', 'Utilities', 'budget', 100000, 'manual_budget_override'),
    ], allocationByYear);
    expect(agg.byYear['2025'].categories['Utilities']).toEqual({ actual: 5000, budget: 1000 });
  });

  // Per the user's explicit decision: "there should really only be one source, the church import
  // is fine" — daycare_api (app sync) and plain 'manual' rows are excluded from every total.
  it('ignores daycare_api and manual sources entirely — only church_budget_import and manual_budget_override count', () => {
    const agg = finAggregateDaycareByYear([
      entry('2025', 'Tuition Income', 'actual', 28500000, 'church_budget_import'),
      entry('2025', 'Tuition Income', 'actual', 99999999, 'daycare_api'),
      entry('2025', 'Payroll', 'actual', 12345, 'manual'),
    ]);
    expect(agg.byYear['2025'].categories['Tuition Income'].actual).toBe(285000);
    expect(agg.byYear['2025'].categories['Payroll']).toBeUndefined(); // the manual-only row never counted at all
  });

  it('a year with ONLY excluded-source data does not appear in years at all', () => {
    const agg = finAggregateDaycareByYear([entry('2024', 'Tuition Income', 'actual', 1000000, 'daycare_api')]);
    expect(agg.years).toEqual([]);
  });
});

describe('finDaycareOtherSourceTotals', () => {
  const { finDaycareOtherSourceTotals } = loadHelper();

  it('sums entries from every source except church_budget_import/manual_budget_override, per year', () => {
    const totals = finDaycareOtherSourceTotals([
      entry('2023', 'Tuition Income', 'actual', 100000, 'daycare_api'),
      entry('2023', 'Payroll', 'actual', 50000, 'manual'),
      entry('2024', 'Tuition Income', 'actual', 25000, 'daycare_api'),
      entry('2025', 'Tuition Income', 'actual', 999999, 'church_budget_import'), // excluded from this total
    ]);
    expect(totals).toEqual({ '2023': 150000, '2024': 25000 });
  });

  it('returns an empty object when there is nothing outside the counted sources', () => {
    expect(finDaycareOtherSourceTotals([entry('2025', 'Tuition Income', 'actual', 1000, 'church_budget_import')])).toEqual({});
  });
});
