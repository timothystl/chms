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
  const varNames = ['FIN_CHURCH_CLASS_ORDER', 'FIN_STREAM_GROUP_LABELS'];
  const varSrcs = varNames.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`var ${name} = \\{[\\s\\S]*?\\};`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${varSrcs.join('\n')} ${fnSrcs.join('\n')} return finReorganizeChurchTree; })()`);
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

  // The four cases above pin the FALLBACK, used only when no saved classification is available.
  // With a map, the same grouping is driven by the admin's own choices instead of these regexes,
  // so one decision on Data & Imports drives both this page and Financial Health.
  describe('driven by the saved revenue-stream classification', () => {
    const buildIncome = () => ({
      path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
      children: [
        leaf('Income:Sunday Offering', 'Sunday Offering', 'Income', 1, 500000, 480000),
        leaf('Income:Facility Rental', 'Facility Rental', 'Income', 1, 100000, 90000),
        leaf('Income:Altar Guild', 'Altar Guild', 'Income', 1, 12000),
        leaf('Income:Endowment Draw', 'Endowment Draw', 'Income', 1, 40000),
        leaf('Income:Sales', 'Sales', 'Income', 1, 30000),
      ],
    });
    const map = {
      'Sunday Offering': 'donor', 'Facility Rental': 'earned', 'Sales': 'earned',
      'Altar Guild': 'restricted', 'Endowment Draw': 'passive',
    };

    it('collects each non-donor stream into its own heading and leaves donor at the top level', () => {
      const revenue = finReorganizeChurchTree([buildIncome()], map)[0];
      const byLabel = {};
      revenue.children.forEach(c => { byLabel[c.label] = c; });
      expect(Object.keys(byLabel).sort()).toEqual(['Earned Income', 'Passive Income', 'Restricted Income', 'Sunday Offering']);
      expect(byLabel['Earned Income'].children.map(c => c.label).sort()).toEqual(['Facility Rental', 'Sales']);
      expect(byLabel['Restricted Income'].children.map(c => c.label)).toEqual(['Altar Guild']);
      expect(byLabel['Passive Income'].children.map(c => c.label)).toEqual(['Endowment Draw']);
    });

    it('stops hiding Sales, so the tree and the server-computed revenue total agree', () => {
      // The fallback drops Sales from the tree while its dollars still count in Total Revenue —
      // a stated inconsistency (FIN14) that an editable classification removes the need for.
      const revenue = finReorganizeChurchTree([buildIncome()], map)[0];
      expect(revenue.totalActualCents).toBe(500000 + 100000 + 12000 + 40000 + 30000);
    });

    it('does not invent a heading for a stream with no accounts in it', () => {
      const income = {
        path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
        children: [leaf('Income:Sunday Offering', 'Sunday Offering', 'Income', 1, 500000)],
      };
      const revenue = finReorganizeChurchTree([income], map)[0];
      expect(revenue.children.map(c => c.label)).toEqual(['Sunday Offering']);
    });

    it('leaves a group the map does not mention at the top level rather than dropping it', () => {
      const revenue = finReorganizeChurchTree([buildIncome()], { 'Facility Rental': 'earned' })[0];
      const labels = revenue.children.map(c => c.label);
      expect(labels).toContain('Sunday Offering');
      expect(labels).toContain('Altar Guild');
      expect(labels).toContain('Sales');
      expect(revenue.totalActualCents, 'nothing may vanish from the rollup').toBe(500000 + 100000 + 12000 + 40000 + 30000);
    });
  });
});
