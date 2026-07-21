import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finReorganizeChurchTree() and its helpers live inside the served (String.raw) frontend script,
// not as exported module functions — extract them (none touch the DOM) and eval standalone.
// Same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 / TAP11 / FIN10).
function loadChurchTreeHelpers() {
  const names = ['finSetNodeDepth', 'finRemoveNodesByLabel', 'finExtractNodesByLabel', 'finMakeGroupNode', 'finRecomputeTreeTotals', 'finReorganizeChurchTree'];
  const fnSrcs = names.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  const varMatch = CHMS_APP_EXT_JS.match(/var FIN_CHURCH_CLASS_ORDER = \{[\s\S]*?\};/);
  if (!varMatch) throw new Error('FIN_CHURCH_CLASS_ORDER not found in built script');
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${varMatch[0]} ${fnSrcs.join('\n')} return finReorganizeChurchTree; })()`);
}

function leaf(path, label, classification, depth, actualCents, budgetCents) {
  return { path, label, classification, depth, ownActualCents: actualCents, ownBudgetCents: budgetCents ?? null, totalActualCents: actualCents, totalBudgetCents: budgetCents || 0, hasBudgetInfo: budgetCents != null, children: [] };
}

describe('finReorganizeChurchTree', () => {
  const finReorganizeChurchTree = loadChurchTreeHelpers();

  it('relabels the Income root to Revenue and sorts it before Expenses', () => {
    const roots = [
      { path: 'Expenses', label: 'Expenses', classification: 'Expenses', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: [] },
      { path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: [] },
    ];
    const out = finReorganizeChurchTree(roots);
    expect(out[0].classification).toBe('Income');
    expect(out[0].label).toBe('Revenue');
    expect(out[1].classification).toBe('Expenses');
  });

  it('groups Facility Rental/Fundraisers/MDO under a new Earned Income heading, and totals correctly', () => {
    const income = {
      path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
      children: [
        leaf('Income:Facility Rental', 'Facility Rental', 'Income', 1, 100000, 90000),
        leaf('Income:Fundraisers', 'Fundraisers', 'Income', 1, 50000),
        leaf('Income:MDO', 'MDO', 'Income', 1, 25000),
        leaf('Income:Donor Income', 'Donor Income', 'Income', 1, 500000, 480000),
      ],
    };
    const out = finReorganizeChurchTree([income]);
    const revenue = out[0];
    const remaining = revenue.children.filter(c => c.label !== 'Earned Income');
    expect(remaining.map(c => c.label)).toEqual(['Donor Income']); // the 3 grouped accounts are gone from the top level
    const earned = revenue.children.find(c => c.label === 'Earned Income');
    expect(earned).toBeTruthy();
    expect(earned.children.map(c => c.label).sort()).toEqual(['Facility Rental', 'Fundraisers', 'MDO']);
    expect(earned.totalActualCents).toBe(100000 + 50000 + 25000);
    expect(earned.totalBudgetCents).toBe(90000); // only Facility Rental had a budget
    // Revenue root's own total reflects the regrouping, not the pre-move snapshot
    expect(revenue.totalActualCents).toBe(100000 + 50000 + 25000 + 500000);
  });

  it('groups Altar Guild under a new Restricted Income heading', () => {
    const income = {
      path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
      children: [leaf('Income:Altar Guild', 'Altar Guild', 'Income', 1, 12000)],
    };
    const out = finReorganizeChurchTree([income]);
    const restricted = out[0].children.find(c => c.label === 'Restricted Income');
    expect(restricted).toBeTruthy();
    expect(restricted.children).toHaveLength(1);
    expect(restricted.children[0].label).toBe('Altar Guild');
  });

  it('removes Sales entirely, and its removal is reflected in the ancestor totals', () => {
    const income = {
      path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
      children: [leaf('Income:Sales', 'Sales', 'Income', 1, 30000), leaf('Income:Donor Income', 'Donor Income', 'Income', 1, 500000)],
    };
    const out = finReorganizeChurchTree([income]);
    expect(out[0].children.map(c => c.label)).toEqual(['Donor Income']);
    expect(out[0].totalActualCents).toBe(500000); // Sales' $300 no longer counted in the parent rollup
  });

  it('does not mutate the original tree passed in', () => {
    const roots = [{ path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: [leaf('Income:Sales', 'Sales', 'Income', 1, 100)] }];
    finReorganizeChurchTree(roots);
    expect(roots[0].label).toBe('Income'); // untouched
    expect(roots[0].children).toHaveLength(1); // Sales still there in the original
  });
});
