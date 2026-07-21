import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// finRenderChurchDetailBody() and its helpers live inside the served (String.raw) frontend
// script, not as exported module functions — extract them and eval standalone. Same technique
// used elsewhere in this project (see CLAUDE.md SC3-BUG1 / TAP11 / FIN10 / finance-church-tree).
function loadDetailBodyHelpers() {
  // esc() itself lives in the CORE bundle (shared across all tabs), not EXT — stub a plain
  // equivalent here since it isn't what this test is verifying.
  const escStub = 'function esc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;"); }';
  const names = ['finFmtMoney', 'finMoneyClass', 'finRenderDetailTreeRows', 'finRenderChurchTotalRow', 'finRenderChurchDetailBody', 'finChurchAsOfDate'];
  const fnSrcs = names.map(name => {
    const m = CHMS_APP_EXT_JS.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`${name} not found in built script`);
    return m[0];
  });
  // eslint-disable-next-line no-eval
  return eval(`(function() { ${escStub} ${fnSrcs.join('\n')} return { finRenderChurchDetailBody, finChurchAsOfDate }; })()`);
}

function leaf(path, label, classification, depth, actualCents, budgetCents, children) {
  return {
    path, label, classification, depth,
    ownActualCents: actualCents, ownBudgetCents: budgetCents ?? null,
    totalActualCents: actualCents, totalBudgetCents: budgetCents || 0,
    hasBudgetInfo: budgetCents != null, children: children || [],
  };
}

describe('finRenderChurchDetailBody', () => {
  const { finRenderChurchDetailBody, finChurchAsOfDate } = loadDetailBodyHelpers();

  it('renders each section\'s own account lines before its Total row, not a header above them', () => {
    const donorIncome = leaf('Income:40 Donor Income', '40 Donor Income', 'Income', 1, 22671104, 42500000);
    const revenue = leaf('Income', 'Revenue', 'Income', 0, 0, null, [donorIncome]);
    revenue.totalActualCents = donorIncome.totalActualCents;
    revenue.totalBudgetCents = donorIncome.totalBudgetCents;
    revenue.hasBudgetInfo = true;

    const mdoExpense = leaf('Expenses:57 MDO Expenses', '57 MDO Expenses', 'Expenses', 1, 12000000, 13000000);
    const expenses = leaf('Expenses', 'Expenses', 'Expenses', 0, 0, null, [mdoExpense]);
    expenses.totalActualCents = mdoExpense.totalActualCents;
    expenses.totalBudgetCents = mdoExpense.totalBudgetCents;
    expenses.hasBudgetInfo = true;

    const netIncome = { actualCents: revenue.totalActualCents - expenses.totalActualCents, budgetCents: revenue.totalBudgetCents - expenses.totalBudgetCents };
    const html = finRenderChurchDetailBody([revenue, expenses], netIncome, true);

    const donorIdx = html.indexOf('40 Donor Income');
    const totalRevenueIdx = html.indexOf('Total Revenue');
    const mdoIdx = html.indexOf('57 MDO Expenses');
    const totalExpensesIdx = html.indexOf('Total Expenses');
    const netIdx = html.indexOf('Net Income');

    expect(donorIdx).toBeGreaterThan(-1);
    expect(totalRevenueIdx).toBeGreaterThan(donorIdx);
    expect(mdoIdx).toBeGreaterThan(totalRevenueIdx);
    expect(totalExpensesIdx).toBeGreaterThan(mdoIdx);
    expect(netIdx).toBeGreaterThan(totalExpensesIdx);
  });

  it('sums the Net Income row from the passed-in totals, matching the summary card figure', () => {
    const revenue = leaf('Income', 'Revenue', 'Income', 0, 50000, null, []);
    revenue.totalActualCents = 50000; revenue.totalBudgetCents = 0; revenue.hasBudgetInfo = false;
    const expenses = leaf('Expenses', 'Expenses', 'Expenses', 0, 30000, null, []);
    expenses.totalActualCents = 30000; expenses.totalBudgetCents = 0; expenses.hasBudgetInfo = false;
    const netIncome = { actualCents: 20000, budgetCents: 0 };
    const html = finRenderChurchDetailBody([revenue, expenses], netIncome, false);
    expect(html).toContain('Net Income');
    expect(html).toContain('$200.00');
  });

  it('finChurchAsOfDate picks the most recent synced_at among entries', () => {
    const entries = [
      { synced_at: '2026-06-01T00:00:00.000Z' },
      { synced_at: '2026-07-15T12:00:00.000Z' },
      { synced_at: '' },
    ];
    const label = finChurchAsOfDate(entries);
    expect(label).toContain('2026');
    expect(label).toContain('July');
  });

  it('finChurchAsOfDate returns empty string when no entries have a synced_at', () => {
    expect(finChurchAsOfDate([])).toBe('');
    expect(finChurchAsOfDate([{ synced_at: '' }])).toBe('');
  });
});
