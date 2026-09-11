import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
const CHMS_APP_EXT_JS_ALL = CHMS_APP_EXT_JS + '\n' + CHMS_APP_FINANCE_JS;

// Balance Sheet's "Full account detail" table has no separate print sheet (unlike Planning/
// Compensation) — window.print() just prints the tab as rendered, so hiding a line for print
// means hiding it from the table itself. These are the pure tree-filtering helpers behind
// "Hide zero-balance lines" and "Hide individual lines…" (js-finance.js) — none touch the DOM —
// extracted and eval'd standalone, same technique as finReorganizeChurchTree in
// finance-church-tree.test.js.
function loadBalanceHideHelpers() {
  const names = ['finBuildBalanceTreeFromFlatRows', 'finBalanceFilterHiddenWalk', 'finBalanceRecomputeTotals', 'finBalanceFilterHidden', 'finBalanceCollectLeaves'];
  const fnSrcs = names.map(name => {
    const m = CHMS_APP_EXT_JS_ALL.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${fnSrcs.join('\n')} return { finBuildBalanceTreeFromFlatRows, finBalanceFilterHidden, finBalanceCollectLeaves }; })()`);
}

const rows = [
  { category_path: 'Assets', account_name: 'Assets', classification: 'Assets', depth: 0, own_balance_cents: 0 },
  { category_path: 'Assets:Checking', account_name: 'Checking', classification: 'Assets', depth: 1, own_balance_cents: 500000 },
  { category_path: 'Assets:Old Grant Fund', account_name: 'Old Grant Fund', classification: 'Assets', depth: 1, own_balance_cents: 0 },
  { category_path: 'Equity', account_name: 'Equity', classification: 'Equity', depth: 0, own_balance_cents: 0 },
  { category_path: 'Equity:Memorial Fund', account_name: 'Memorial Fund', classification: 'Equity', depth: 1, own_balance_cents: 200000 },
  { category_path: 'Equity:Spent-Down Fund', account_name: 'Spent-Down Fund', classification: 'Equity', depth: 1, own_balance_cents: 0 },
];

describe('Balance Sheet detail table: hide zero-balance / manually-hidden lines', () => {
  const { finBuildBalanceTreeFromFlatRows, finBalanceFilterHidden, finBalanceCollectLeaves } = loadBalanceHideHelpers();

  it('drops every $0.00 leaf when hideZero is on, keeping non-zero leaves and their parents', () => {
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    const out = finBalanceFilterHidden(tree, {}, true);
    const labels = [];
    (function walk(nodes) { nodes.forEach(n => { labels.push(n.label); walk(n.children); }); })(out);
    expect(labels).toContain('Checking');
    expect(labels).toContain('Memorial Fund');
    expect(labels).not.toContain('Old Grant Fund');
    expect(labels).not.toContain('Spent-Down Fund');
  });

  it('keeps $0.00 leaves when hideZero is off', () => {
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    const out = finBalanceFilterHidden(tree, {}, false);
    const labels = [];
    (function walk(nodes) { nodes.forEach(n => { labels.push(n.label); walk(n.children); }); })(out);
    expect(labels).toContain('Old Grant Fund');
    expect(labels).toContain('Spent-Down Fund');
  });

  it('drops a manually-hidden leaf even with a non-zero balance, and recomputes its parent total', () => {
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    const out = finBalanceFilterHidden(tree, { 'Equity:Memorial Fund': true }, false);
    const equity = out.find(n => n.label === 'Equity');
    expect(equity.children.map(n => n.label)).not.toContain('Memorial Fund');
    // Memorial Fund's $2,000.00 no longer counts toward Equity's total once hidden.
    expect(equity.totalBalanceCents).toBe(0);
  });

  it('a group left with no children after filtering is dropped entirely, not left as a bare $0 header', () => {
    // Every dollar in Equity comes from Memorial Fund (Spent-Down Fund is already $0) — hide it
    // and the whole Equity branch should disappear, matching finPlanFilterExcludedWalk's rule.
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    const out = finBalanceFilterHidden(tree, { 'Equity:Memorial Fund': true }, true);
    expect(out.map(n => n.label)).not.toContain('Equity');
    expect(out.map(n => n.label)).toContain('Assets');
  });

  it('does not mutate the tree passed in', () => {
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    finBalanceFilterHidden(tree, { 'Equity:Memorial Fund': true }, true);
    const equity = tree.find(n => n.label === 'Equity');
    expect(equity.children.map(n => n.label)).toEqual(['Memorial Fund', 'Spent-Down Fund']);
  });

  it('finBalanceCollectLeaves lists every leaf from the full tree, including zero-balance and any that would be hidden — so the "Hide individual lines…" panel can always find and restore one', () => {
    const tree = finBuildBalanceTreeFromFlatRows(rows);
    const leaves = finBalanceCollectLeaves(tree);
    expect(leaves.map(n => n.label).sort()).toEqual(
      ['Checking', 'Memorial Fund', 'Old Grant Fund', 'Spent-Down Fund'].sort()
    );
  });
});
