import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finAggregateDaycareByYear() lives inside the served (String.raw) frontend script — extract and
// eval standalone, same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 /
// TAP11 / FIN10 / finance-church-detail-body).
function loadHelper() {
  const orderM = CHMS_APP_EXT_JS.match(/var FIN_KNOWN_CATEGORY_ORDER = [\s\S]*?;\n/);
  const isIncomeM = CHMS_APP_EXT_JS.match(/function finIsIncomeCategory\([^)]*\) \{[\s\S]*?\n\}/);
  const aggM = CHMS_APP_EXT_JS.match(/function finAggregateDaycareByYear\([^)]*\) \{[\s\S]*?\n\}/);
  if (!orderM || !isIncomeM || !aggM) throw new Error('helper(s) not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${orderM[0]} ${isIncomeM[0]} ${aggM[0]} return finAggregateDaycareByYear; })()`);
}

function entry(period, category, entry_type, amount_cents, source) {
  return { period, category, entry_type, amount_cents, source: source || 'manual' };
}

describe('finAggregateDaycareByYear', () => {
  const finAggregateDaycareByYear = loadHelper();

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
});
