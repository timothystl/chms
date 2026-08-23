import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
// P25-E: finance-only functions moved out of the ext bundle into their own lazily-loaded
// bundle (see html-chms.js). This file only extracts source by regex/string search, so the
// two are simply concatenated back together for that purpose.
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;

// finReorganizeChurchTree() and its helpers live inside the served (String.raw) frontend script,
// not as exported module functions — extract them (none touch the DOM) and eval standalone.
// Same technique used elsewhere in this project (see CLAUDE.md SC3-BUG1 / TAP11 / FIN10).
function loadChurchTreeHelpers() {
  const names = ['finSetNodeDepth', 'finExtractNodesByLabel', 'finMakeGroupNode', 'finRecomputeTreeTotals', 'finPruneEmptyUnappliedCash', 'finReorganizeChurchTree'];
  const fnSrcs = names.map(name => {
    const m = CHMS_APP_EXT_JS_ALL.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  const varNames = ['FIN_CHURCH_CLASS_ORDER', 'FIN_STREAM_GROUP_LABELS'];
  const varSrcs = varNames.map(name => {
    const m = CHMS_APP_EXT_JS_ALL.match(new RegExp(`var ${name} = \\{[\\s\\S]*?\\};`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  // Single-line consts (a regex, a string) rather than object literals — matched to end of line.
  for (const name of ['FIN_UNAPPLIED_CASH_RE', 'FIN_UNAPPLIED_CASH_HINT']) {
    const m = CHMS_APP_EXT_JS_ALL.match(new RegExp(`var ${name} = .*;`));
    if (!m) throw new Error(`${name} not found in built script`);
    varSrcs.push(m[0]);
  }
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

  it('hides no account, so the tree can never disagree with the server-computed total', () => {
    // FIN14 dropped any account named exactly "Sales" from this tree while the Total Revenue stat
    // card still counted it. Confirmed 2026-08-07 that this church has no such account, so the
    // rule was vestigial; nothing is hidden now and every account reaches the rollup.
    const income = {
      path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false,
      children: [leaf('Income:Sales', 'Sales', 'Income', 1, 30000), leaf('Income:Donor Income', 'Donor Income', 'Income', 1, 500000)],
    };
    const out = finReorganizeChurchTree([income]);
    expect(out[0].children.map(c => c.label).sort()).toEqual(['Donor Income', 'Sales']);
    expect(out[0].totalActualCents).toBe(530000);
  });

  it('does not mutate the original tree passed in', () => {
    const roots = [{ path: 'Income', label: 'Income', classification: 'Income', depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: [leaf('Income:Facility Rental', 'Facility Rental', 'Income', 1, 100)] }];
    finReorganizeChurchTree(roots);
    expect(roots[0].label).toBe('Income'); // untouched
    expect(roots[0].children).toHaveLength(1); // still at the top level in the original
    expect(roots[0].children[0].label).toBe('Facility Rental');
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
        leaf('Income:Fundraisers', 'Fundraisers', 'Income', 1, 30000),
      ],
    });
    const map = {
      'Sunday Offering': 'donor', 'Facility Rental': 'earned', 'Fundraisers': 'earned',
      'Altar Guild': 'restricted', 'Endowment Draw': 'passive',
    };

    it('collects each non-donor stream into its own heading and leaves donor at the top level', () => {
      const revenue = finReorganizeChurchTree([buildIncome()], map)[0];
      const byLabel = {};
      revenue.children.forEach(c => { byLabel[c.label] = c; });
      expect(Object.keys(byLabel).sort()).toEqual(['Earned Income', 'Passive Income', 'Restricted Income', 'Sunday Offering']);
      expect(byLabel['Earned Income'].children.map(c => c.label).sort()).toEqual(['Facility Rental', 'Fundraisers']);
      expect(byLabel['Restricted Income'].children.map(c => c.label)).toEqual(['Altar Guild']);
      expect(byLabel['Passive Income'].children.map(c => c.label)).toEqual(['Endowment Draw']);
    });

    it('keeps every account in the rollup after regrouping', () => {
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
      expect(labels).toContain('Fundraisers');
      expect(revenue.totalActualCents, 'nothing may vanish from the rollup').toBe(500000 + 100000 + 12000 + 40000 + 30000);
    });
  });
});
