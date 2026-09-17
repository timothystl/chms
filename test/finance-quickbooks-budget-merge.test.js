import { describe, it, expect } from 'vitest';
import {
  mergeLeafCells, mergeSection, mergeTree, mergeProfitAndLossTree, fetchQboJson,
  mergeCurrentYearBudgetAndActual, buildBudgetVsActualFallback,
} from '../apps/finance/quickbooks-budget-merge.js';

// Fixture payloads below are shaped exactly like Intuit's real Budget entity (QueryResponse.
// Budget[].BudgetDetail[].{AccountRef:{value,name}, Amount}) and Reports API Columns/Rows tree
// (Section/Header/Rows/Summary, leaf rows as ColData), per src/api-finance.js's own comments and
// test/finance-church.test.js's existing coverage of the same tree shape in the legacy Worker.
// Nothing here makes a real request -- `client.budgets()`/`client.profitAndLoss()` below resolve
// to real `Response` objects built directly from these fixtures, standing in for a mocked HTTP
// response.

function budgetFixture() {
  return {
    QueryResponse: {
      Budget: [{
        Id: '1', Name: '2026 Operating Budget', StartDate: '2026-01-01', EndDate: '2026-12-31',
        BudgetEntryType: 'Monthly', Active: true,
        BudgetDetail: [
          { AccountRef: { value: 'acct-100', name: 'Contributions' }, Amount: '1000.00' },
          { AccountRef: { value: 'acct-100', name: 'Contributions' }, Amount: '1000.00' }, // second month line, same account
          { AccountRef: { value: 'acct-200', name: 'Payroll Expenses' }, Amount: '500.00' },
        ],
      }],
    },
  };
}

function profitAndLossFixture() {
  return {
    Rows: { Row: [
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Income' }] },
        Rows: { Row: [
          { ColData: [{ value: 'Contributions', id: 'acct-100' }, { value: '2500.00' }] },
        ] },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '2500.00' }] },
      },
      { ColData: [{ value: 'Net Operating Income' }, { value: '2500.00' }] },
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: { Row: [
          { ColData: [{ value: 'Payroll Expenses', id: 'acct-200' }, { value: '600.00' }] },
        ] },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '600.00' }] },
      },
      { ColData: [{ value: 'Net Income' }, { value: '1900.00' }] },
    ] },
  };
}

function makeClient({ budgetsRes, plRes }) {
  return {
    budgets: async () => budgetsRes,
    profitAndLoss: async () => plRes,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('mergeLeafCells', () => {
  it('matches by account id even when the P&L label text does not match the Budget entity name at all', () => {
    const ctx = { budgetByName: new Map(), budgetIdsByName: new Map(), budgetByAccountId: new Map([['acct-42', 500]]), ambiguousNames: new Set() };
    const cells = [{ value: 'Some Different Display Label', id: 'acct-42' }, { value: '750.00' }];
    const result = mergeLeafCells(cells, ctx);
    expect(result.budget).toBe(500);
    expect(result.cells[2]).toEqual({ value: '500.00' });
    expect(result.cells[3]).toEqual({ value: '250.00' });
  });

  it('falls back to name matching when the cell carries no account id', () => {
    const ctx = { budgetByName: new Map([['Plants and Soil', 300]]), budgetIdsByName: new Map([['Plants and Soil', new Set(['acct-1'])]]), budgetByAccountId: new Map(), ambiguousNames: new Set() };
    const cells = [{ value: 'Plants and Soil' }, { value: '300.00' }];
    const result = mergeLeafCells(cells, ctx);
    expect(result.budget).toBe(300);
  });

  it('refuses to guess when two different accounts share the same display name, flagging it instead', () => {
    const ctx = {
      budgetByName: new Map([['Plants and Soil', 300]]),
      budgetIdsByName: new Map([['Plants and Soil', new Set(['acct-1', 'acct-2'])]]),
      budgetByAccountId: new Map(),
      ambiguousNames: new Set(),
    };
    const cells = [{ value: 'Plants and Soil' }, { value: '150.00' }];
    const result = mergeLeafCells(cells, ctx);
    expect(result.budget).toBe(0);
    expect(ctx.ambiguousNames.has('Plants and Soil')).toBe(true);
  });

  it('records a real, non-trivial actual with zero matched budget as unmatched (not silently $0)', () => {
    const ctx = { budgetByName: new Map(), budgetIdsByName: new Map(), budgetByAccountId: new Map([['acct-1', 100]]), ambiguousNames: new Set(), unmatched: [] };
    mergeLeafCells([{ value: 'Untracked Account', id: 'acct-9' }, { value: '42.00' }], ctx);
    expect(ctx.unmatched).toEqual([{ name: 'Untracked Account', actualAmt: 42, hadId: true }]);
  });
});

describe('mergeSection / mergeTree', () => {
  it('sums a nested section bottom-up, matching QuickBooks\' own "Total for X" math', () => {
    const ctx = { budgetByName: new Map([['Offerings', 400], ['Design Income', 600]]), budgetIdsByName: new Map(), budgetByAccountId: new Map(), ambiguousNames: new Set() };
    const tree = [{
      type: 'Section',
      Header: { ColData: [{ value: 'Revenue' }] },
      Rows: { Row: [
        { ColData: [{ value: 'Offerings' }, { value: '500.00' }] },
        { ColData: [{ value: 'Design Income' }, { value: '1000.00' }] },
      ] },
      Summary: { ColData: [{ value: 'Total for Revenue' }, { value: '1500.00' }] },
    }];
    const { rows, budgetSum } = mergeTree(tree, ctx);
    expect(budgetSum).toBe(1000);
    expect(rows[0].Summary.ColData).toEqual([{ value: 'Total for Revenue' }, { value: '1500.00' }, { value: '1000.00' }, { value: '500.00' }]);
  });
});

describe('mergeProfitAndLossTree', () => {
  it('carries Income section budget into the Net Operating Income subtotal, and accumulates every section into Net Income', () => {
    // Note: mergeProfitAndLossTree accumulates every Section's budget additively into
    // `mainBudget` (see the function body) -- it does not subtract an Expenses section's budget
    // from Income's. That is the exact, faithful behavior ported from
    // src/api-finance.js's mergeProfitAndLossTree; this test pins that real behavior rather than
    // a "more correct-looking" number this port does not actually produce.
    const ctx = { budgetByName: new Map(), budgetIdsByName: new Map(), budgetByAccountId: new Map([['acct-100', 2000], ['acct-200', 500]]), ambiguousNames: new Set(), unmatched: [] };
    const merged = mergeProfitAndLossTree(profitAndLossFixture().Rows.Row, ctx);
    const netOperating = merged.find((r) => r.ColData?.[0]?.value === 'Net Operating Income');
    const netIncome = merged.find((r) => r.ColData?.[0]?.value === 'Net Income');
    expect(netOperating.ColData).toEqual([{ value: 'Net Operating Income' }, { value: '2500.00' }, { value: '2000.00' }, { value: '500.00' }]);
    expect(netIncome.ColData).toEqual([{ value: 'Net Income' }, { value: '1900.00' }, { value: '2500.00' }, { value: '-600.00' }]);
  });

  it('recognizes "Net Revenue"/"Other Revenue" wording, not just QuickBooks\' internal "Income" wording', () => {
    const ctx = { budgetByName: new Map(), budgetIdsByName: new Map(), budgetByAccountId: new Map([['acct-1', 100]]), ambiguousNames: new Set(), unmatched: [] };
    const rows = [
      { type: 'Section', Header: { ColData: [{ value: 'Revenue' }] }, Rows: { Row: [
        { ColData: [{ value: 'Contributions', id: 'acct-1' }, { value: '200.00' }] },
      ] } },
      { ColData: [{ value: 'Net Revenue' }, { value: '200.00' }] },
    ];
    const merged = mergeProfitAndLossTree(rows, ctx);
    const netRow = merged.find((r) => r.ColData?.[0]?.value === 'Net Revenue');
    expect(netRow.ColData[2].value).toBe('100.00');
    expect(netRow.ColData[2].value).not.toBe('0.00');
  });
});

describe('fetchQboJson', () => {
  it('returns the parsed JSON body on a successful (mocked) response', async () => {
    const warnings = [];
    const result = await fetchQboJson('Account balances', Promise.resolve(jsonResponse({ QueryResponse: {} })), warnings);
    expect(result).toEqual({ QueryResponse: {} });
    expect(warnings).toHaveLength(0);
  });

  it('parses Intuit\'s structured Fault.Error[] body and records intuit_tid, without throwing', async () => {
    const warnings = [];
    const fault = { Fault: { Error: [{ Message: 'Object Not Found', Detail: 'Nothing found', code: '6240' }] } };
    const res = jsonResponse(fault, 400, { intuit_tid: 'tid-abc-123' });
    const result = await fetchQboJson('Budget entity', Promise.resolve(res), warnings);
    expect(result).toBeNull();
    expect(warnings[0]).toContain('HTTP 400');
    expect(warnings[0]).toContain('tid-abc-123');
    expect(warnings[0]).toContain('6240');
    expect(warnings[0]).toContain('Object Not Found');
  });

  it('records a network-level rejection as a warning rather than throwing', async () => {
    const warnings = [];
    const result = await fetchQboJson('Profit and Loss', Promise.reject(new Error('fetch failed: DNS')), warnings);
    expect(result).toBeNull();
    expect(warnings).toEqual(['Profit and Loss: fetch failed: DNS']);
  });
});

describe('mergeCurrentYearBudgetAndActual', () => {
  it('reconstructs Actual/Budget/Over-Budget from the Budget entity + a date-scoped ProfitAndLoss report', async () => {
    const client = makeClient({ budgetsRes: jsonResponse(budgetFixture()), plRes: jsonResponse(profitAndLossFixture()) });
    const warnings = [];
    const result = await mergeCurrentYearBudgetAndActual(client, 2026, warnings, null);
    expect(result).not.toBeNull();
    const incomeSection = result.rows.find((r) => r.Header?.ColData?.[0]?.value === 'Income');
    expect(incomeSection.Rows.Row[0].ColData).toEqual([{ value: 'Contributions' }, { value: '2500.00' }, { value: '2000.00' }, { value: '500.00' }]);
    const expensesSection = result.rows.find((r) => r.Header?.ColData?.[0]?.value === 'Expenses');
    expect(expensesSection.Rows.Row[0].ColData).toEqual([{ value: 'Payroll Expenses' }, { value: '600.00' }, { value: '500.00' }, { value: '100.00' }]);
    expect(warnings).toHaveLength(0);
  });

  it('honors an admin-selected preferredBudgetId over the year-guess/first-budget fallback', async () => {
    const twoBudgets = {
      QueryResponse: { Budget: [
        { Id: 'test-budget', Name: 'Leftover Test Budget', StartDate: '2026-01-01', BudgetDetail: [{ AccountRef: { value: 'acct-100', name: 'Contributions' }, Amount: '1.00' }] },
        { Id: 'real-budget', Name: '2026 Real Budget', StartDate: '2026-01-01', BudgetDetail: [{ AccountRef: { value: 'acct-100', name: 'Contributions' }, Amount: '2500.00' }] },
      ] },
    };
    const client = makeClient({ budgetsRes: jsonResponse(twoBudgets), plRes: jsonResponse(profitAndLossFixture()) });
    const warnings = [];
    const result = await mergeCurrentYearBudgetAndActual(client, 2026, warnings, 'real-budget');
    const incomeSection = result.rows.find((r) => r.Header?.ColData?.[0]?.value === 'Income');
    expect(incomeSection.Rows.Row[0].ColData[2]).toEqual({ value: '2500.00' });
  });

  it('warns and returns null when no Budget exists for the requested year at all', async () => {
    const client = makeClient({ budgetsRes: jsonResponse({ QueryResponse: { Budget: [] } }), plRes: jsonResponse(profitAndLossFixture()) });
    const warnings = [];
    const result = await mergeCurrentYearBudgetAndActual(client, 2026, warnings, null);
    expect(result).toBeNull();
    expect(warnings).toEqual(['Budget entity: no Budget found for 2026']);
  });

  it('warns and returns null when the Budget entity call itself fails', async () => {
    const client = makeClient({
      budgetsRes: jsonResponse({ Fault: { Error: [{ Message: 'Permission Denied', code: '5020' }] } }, 403),
      plRes: jsonResponse(profitAndLossFixture()),
    });
    const warnings = [];
    const result = await mergeCurrentYearBudgetAndActual(client, 2026, warnings, null);
    expect(result).toBeNull();
    expect(warnings[0]).toContain('5020');
  });

  it('flags accounts with real activity but no matching Budget line, distinguishing "had an id" from "no id at all"', async () => {
    const pl = profitAndLossFixture();
    // Appended INSIDE the Income section (like a real extra ledger line), not as a new top-level
    // flat row -- a top-level flat row is QuickBooks' own running-subtotal shape (Net Income,
    // Gross Profit, ...), handled by mergeProfitAndLossTree's own running-total math rather than
    // routed through mergeLeafCells' per-account matching at all.
    pl.Rows.Row[0].Rows.Row.push({ ColData: [{ value: 'Untracked Misc Income', id: 'acct-999' }, { value: '75.00' }] });
    const client = makeClient({ budgetsRes: jsonResponse(budgetFixture()), plRes: jsonResponse(pl) });
    const warnings = [];
    await mergeCurrentYearBudgetAndActual(client, 2026, warnings, null);
    const unmatchedWarning = warnings.find((w) => w.startsWith('Budget vs Actual:') && w.includes('no matching Budget line'));
    expect(unmatchedWarning).toContain('1 account(s)');
    expect(unmatchedWarning).toContain('Untracked Misc Income');
  });

  it('wraps the reconstruction in the generic Columns/Rows shape via buildBudgetVsActualFallback', async () => {
    const client = makeClient({ budgetsRes: jsonResponse(budgetFixture()), plRes: jsonResponse(profitAndLossFixture()) });
    const warnings = [];
    const fallback = await buildBudgetVsActualFallback(client, 2026, warnings, null);
    expect(fallback._synthesized).toBe(true);
    expect(fallback.Columns.Column.map((c) => c.ColTitle)).toEqual(['Account', 'Actual', 'Budget', 'Over Budget By']);
    expect(fallback.Rows.Row.length).toBeGreaterThan(0);
  });
});
