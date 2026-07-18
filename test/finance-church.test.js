import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { flattenReportTree, makeCurrentYearExtractor, makeMultiYearExtractor, makeMonthlyExtractor, parseMonthColTitle, mergeProfitAndLossTree, persistChurchEntries, persistChurchEntriesImport, resolveChurchYearPrecedence, computeYearSummary, computeYtdComparison, parseBudgetVsActualsGrid, normalizeChurchClassification } from '../src/api-finance.js';

// ── Minimal D1-shaped wrapper around node:sqlite, so persistChurchEntries() runs against real
// SQL (real UNIQUE/ON CONFLICT semantics) instead of a hand-rolled re-implementation of what the
// real D1 binding would do. ──
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}
function allChurchRows(db) {
  return db._raw.prepare('SELECT * FROM finance_church_entries ORDER BY fiscal_year, category_path, source').all();
}

// ── Fixtures shaped exactly like the real QuickBooks sandbox export that surfaced the
// Budget-vs-Actual double-counting bug (FIN2/v1.26.1) — same tree used to verify that fix,
// reused here so flattenReportTree() is checked against the same real-world shape. ──

function leaf(name, actual) { return { ColData: [{ value: name }, { value: String(actual) }] }; }
function section(label, headerAmt, children, hasSummary) {
  return {
    type: 'Section',
    Header: headerAmt != null ? { ColData: [{ value: label }, { value: String(headerAmt) }] } : { ColData: [{ value: label }] },
    Rows: { Row: children },
    Summary: hasSummary ? { ColData: [{ value: 'Total for ' + label }, { value: '0' }] } : undefined,
  };
}

// A minimal but real double-nesting case: "Job Expenses" has BOTH its own direct posting
// (155.07) AND a nested "Job Materials" section with its own children — this is the exact
// shape that broke the old flat/alphabetized reconstruction.
const plRows = [
  section('Income', null, [
    leaf('Design income', 2250.00),
  ], true),
  section('Cost of Goods Sold', null, [
    leaf('Cost of Goods Sold', 405.00),
  ], true),
  leaf('Gross Profit', 1845.00),
  section('Expenses', null, [
    section('Job Expenses', 155.07, [
      section('Job Materials', null, [
        leaf('Decks and Patios', 234.04),
        leaf('Plants and Soil', 353.12),
      ], true),
    ], true),
  ], true),
  leaf('Net Operating Income', 1102.86),
  section('Other Income', null, [], true),
  section('Other Expenses', null, [
    leaf('Miscellaneous', 100.00),
  ], true),
  leaf('Net Other Income', -100.00),
  leaf('Net Income', 1002.86),
];

describe('flattenReportTree — current-year (single-value) extractor', () => {
  const rows = flattenReportTree(plRows, [], null, makeCurrentYearExtractor(2026));

  it('includes the Income section itself (the exact bug being regression-tested)', () => {
    const income = rows.find(r => r.category_path === 'Income');
    expect(income).toBeUndefined(); // bare "Income" header has no own amount — correctly NOT emitted
    const designIncome = rows.find(r => r.category_path === 'Income:Design income');
    expect(designIncome).toBeDefined();
    expect(designIncome.classification).toBe('Income');
    expect(designIncome.own_actual_cents).toBe(225000);
  });

  it('never emits a "Total for X" row', () => {
    expect(rows.some(r => r.account_name.startsWith('Total for'))).toBe(false);
  });

  it('never emits a running-subtotal row (Gross Profit, Net Income, etc.)', () => {
    ['Gross Profit', 'Net Operating Income', 'Net Other Income', 'Net Income'].forEach(label => {
      expect(rows.some(r => r.account_name === label)).toBe(false);
    });
  });

  it('emits a row for a Section that owns a direct posting AND has children ("Job Expenses")', () => {
    const jobExpenses = rows.find(r => r.category_path === 'Expenses:Job Expenses');
    expect(jobExpenses).toBeDefined();
    expect(jobExpenses.own_actual_cents).toBe(15507);
    expect(jobExpenses.has_children).toBe(1);
    expect(jobExpenses.classification).toBe('Expenses');
  });

  it('emits its nested children at the correct depth/path without double-counting the parent', () => {
    const decks = rows.find(r => r.category_path === 'Expenses:Job Expenses:Job Materials:Decks and Patios');
    expect(decks).toBeDefined();
    expect(decks.own_actual_cents).toBe(23404);
    expect(decks.depth).toBe(3);
    expect(decks.has_children).toBe(0);
    // Summing every stored row under "Expenses" reproduces the real total without any stored subtotal.
    const expensesRows = rows.filter(r => r.category_path === 'Expenses' || r.category_path.startsWith('Expenses:'));
    const total = expensesRows.reduce((s, r) => s + r.own_actual_cents, 0);
    expect(total).toBe(15507 + 23404 + 35312); // Job Expenses(own) + Decks + Plants and Soil
  });

  it('skips a bare empty Section with no children and no own amount ("Other Income")', () => {
    expect(rows.some(r => r.account_name === 'Other Income')).toBe(false);
  });

  it('applies budget too, when merged in first via mergeProfitAndLossTree', () => {
    const budgetByName = new Map([['Design income', 2000]]);
    const budgetIdsByName = new Map([['Design income', new Set(['acct-1'])]]);
    const merged = mergeProfitAndLossTree(plRows, { budgetByName, budgetIdsByName, ambiguousNames: new Set() });
    const flat = flattenReportTree(merged, [], null, makeCurrentYearExtractor(2026));
    const designIncome = flat.find(r => r.category_path === 'Income:Design income');
    expect(designIncome.own_actual_cents).toBe(225000);
    expect(designIncome.own_budget_cents).toBe(200000);
  });
});

describe('flattenReportTree — multi-year extractor', () => {
  // Multi-year report shape: cells are [Account, Year1Value, Year2Value, ...], no budget.
  const multiYearRows = [
    section('Income', null, [
      { ColData: [{ value: 'Design income' }, { value: '1000.00' }, { value: '1200.00' }] },
    ], true),
  ];
  const extractor = makeMultiYearExtractor([2024, 2025]);
  const rows = flattenReportTree(multiYearRows, [], null, extractor);

  it('emits one row per year for the same account', () => {
    const forYear = y => rows.find(r => r.category_path === 'Income:Design income' && r.fiscal_year === y);
    expect(forYear(2024).own_actual_cents).toBe(100000);
    expect(forYear(2025).own_actual_cents).toBe(120000);
  });

  it('leaves own_budget_cents null (multi-year report has no budget data)', () => {
    expect(rows[0].own_budget_cents).toBeNull();
  });

  it('skips a null year column (e.g. a trailing "Total" column)', () => {
    const extractorWithTotal = makeMultiYearExtractor([2024, 2025, null]);
    const withTotalCol = flattenReportTree([
      { ColData: [{ value: 'Design income' }, { value: '1000.00' }, { value: '1200.00' }, { value: '2200.00' }] },
    ], [], 'Income', extractorWithTotal);
    expect(withTotalCol.length).toBe(2);
  });
});

describe('parseMonthColTitle', () => {
  it('parses QBO\'s "Mon YYYY" monthly column format', () => {
    expect(parseMonthColTitle('Jan 2026')).toEqual({ year: 2026, month: 1 });
    expect(parseMonthColTitle('Dec 2025')).toEqual({ year: 2025, month: 12 });
  });
  it('returns null for a non-matching title (e.g. a trailing "Total" column)', () => {
    expect(parseMonthColTitle('Total')).toBeNull();
    expect(parseMonthColTitle('')).toBeNull();
  });
});

describe('flattenReportTree — monthly extractor', () => {
  const monthlyRows = [
    section('Income', null, [
      { ColData: [{ value: 'Design income' }, { value: '500.00' }, { value: '700.00' }, { value: '1200.00' }] },
    ], true),
  ];
  // Columns: Account, Jan 2026, Feb 2026, Total (skipped via null)
  const colPeriods = [{ year: 2026, month: 1 }, { year: 2026, month: 2 }, null];
  const rows = flattenReportTree(monthlyRows, [], null, makeMonthlyExtractor(colPeriods));

  it('emits one row per month, tagged with the right period_month', () => {
    const jan = rows.find(r => r.period_month === 1);
    const feb = rows.find(r => r.period_month === 2);
    expect(jan.own_actual_cents).toBe(50000);
    expect(feb.own_actual_cents).toBe(70000);
    expect(jan.fiscal_year).toBe(2026);
  });
  it('skips the null (Total) column', () => {
    expect(rows.length).toBe(2);
  });
});

describe('computeYtdComparison', () => {
  it('returns available:false when either year has no monthly rows yet', () => {
    expect(computeYtdComparison([], [], [], 6).available).toBe(false);
    expect(computeYtdComparison([{ classification: 'Income', own_actual_cents: 100 }], [], [], 6).available).toBe(false);
  });

  it('computes YTD-to-date and a prior-year-ratio projection', () => {
    // This year, Jan-Jun: Income 60000 cents. Last year same window: Income 50000 cents.
    // Last year full year: Income 120000 cents -> ratio 120000/50000 = 2.4 -> projected 60000*2.4=144000.
    const curMonthly = [
      { classification: 'Income', own_actual_cents: 60000 },
      { classification: 'Expenses', own_actual_cents: 30000 },
    ];
    const priorMonthly = [
      { classification: 'Income', own_actual_cents: 50000 },
      { classification: 'Expenses', own_actual_cents: 25000 },
    ];
    const priorAnnual = [
      { fiscal_year: 2025, source: 'qbo_sync', classification: 'Income', own_actual_cents: 120000 },
      { fiscal_year: 2025, source: 'qbo_sync', classification: 'Expenses', own_actual_cents: 60000 },
    ];
    const result = computeYtdComparison(curMonthly, priorMonthly, priorAnnual, 6);
    expect(result.available).toBe(true);
    expect(result.income.currentYtdCents).toBe(60000);
    expect(result.income.priorYtdCents).toBe(50000);
    expect(result.income.priorFullYearCents).toBe(120000);
    expect(result.income.projectedFullYearCents).toBe(144000);
    expect(result.income.method).toBe('prior-year-ratio');
    expect(result.expenses.projectedFullYearCents).toBe(72000); // 30000 * (60000/25000)
    expect(result.net.currentYtdCents).toBe(30000); // 60000 income - 30000 expenses
  });

  it('falls back to straight-line when prior-year YTD-at-this-point was exactly zero', () => {
    const curMonthly = [{ classification: 'Income', own_actual_cents: 60000 }];
    const priorMonthly = [{ classification: 'Income', own_actual_cents: 0 }];
    const priorAnnual = [{ fiscal_year: 2025, source: 'qbo_sync', classification: 'Income', own_actual_cents: 100000 }];
    const result = computeYtdComparison(curMonthly, priorMonthly, priorAnnual, 6);
    expect(result.income.method).toBe('straight-line');
    expect(result.income.projectedFullYearCents).toBe(120000); // 60000 * (12/6)
  });
});

describe('persistChurchEntries — real SQL against the actual migration', () => {
  it('inserts rows and they are readable back', async () => {
    const db = makeTestDb();
    await persistChurchEntries(db, [
      { fiscal_year: 2025, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: null },
    ], '2026-07-17T00:00:00Z');
    const rows = allChurchRows(db);
    expect(rows.length).toBe(1);
    expect(rows[0].own_actual_cents).toBe(100000);
    expect(rows[0].own_budget_cents).toBeNull();
  });

  it('a later row for the same (fiscal_year, category_path, source) wins over an earlier one — the ordering the sync handler relies on', async () => {
    const db = makeTestDb();
    // Simulates the sync handler's write order: multi-year (actuals-only) row first, then the
    // richer current-year budget-merge row second, for the SAME year/category.
    await persistChurchEntries(db, [
      { fiscal_year: 2026, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: null },
      { fiscal_year: 2026, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: 90000 },
    ], '2026-07-17T00:00:00Z');
    const rows = allChurchRows(db);
    expect(rows.length).toBe(1); // upserted into one row, not two
    expect(rows[0].own_budget_cents).toBe(90000);
  });

  it('scopes the wholesale-replace to only the fiscal years present in the new rows, leaving other years untouched', async () => {
    const db = makeTestDb();
    await persistChurchEntries(db, [
      { fiscal_year: 2024, classification: 'Income', category_path: 'Income:Old Account', account_name: 'Old Account', depth: 1, has_children: 0, own_actual_cents: 5000, own_budget_cents: null },
      { fiscal_year: 2026, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: null },
    ], '2026-07-17T00:00:00Z');
    // Re-sync only 2026 with different data.
    await persistChurchEntries(db, [
      { fiscal_year: 2026, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 999999, own_budget_cents: null },
    ], '2026-08-01T00:00:00Z');
    const rows = allChurchRows(db);
    const y2024 = rows.filter(r => r.fiscal_year === 2024);
    const y2026 = rows.filter(r => r.fiscal_year === 2026);
    expect(y2024.length).toBe(1);
    expect(y2024[0].own_actual_cents).toBe(5000); // untouched by the 2026-only re-sync
    expect(y2026.length).toBe(1);
    expect(y2026[0].own_actual_cents).toBe(999999);
  });

  it('never deletes source=\'import\' rows when a qbo_sync re-sync runs for the same year', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, depth, own_actual_cents, own_budget_cents, source)
       VALUES (2026, 'Income', 'Income:Hand Entered', 'Hand Entered', 1, 42000, 40000, 'import')`
    ).bind().run();
    await persistChurchEntries(db, [
      { fiscal_year: 2026, classification: 'Income', category_path: 'Income:Design income', account_name: 'Design income', depth: 1, has_children: 0, own_actual_cents: 100000, own_budget_cents: null },
    ], '2026-07-17T00:00:00Z');
    const rows = allChurchRows(db);
    const importRow = rows.find(r => r.source === 'import');
    expect(importRow).toBeDefined();
    expect(importRow.own_actual_cents).toBe(42000);
    const syncRow = rows.find(r => r.source === 'qbo_sync');
    expect(syncRow).toBeDefined();
  });

  it('does nothing when given an empty rows array (no-op, no DELETE fired)', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, depth, own_actual_cents, source)
       VALUES (2026, 'Income', 'Income:Existing', 'Existing', 1, 100, 'qbo_sync')`
    ).bind().run();
    await persistChurchEntries(db, [], '2026-07-17T00:00:00Z');
    expect(allChurchRows(db).length).toBe(1);
  });
});

describe('resolveChurchYearPrecedence', () => {
  it('uses qbo_sync rows for a year with no import/manual rows', () => {
    const rows = [
      { fiscal_year: 2026, source: 'qbo_sync', category_path: 'Income:A', own_actual_cents: 100 },
      { fiscal_year: 2026, source: 'qbo_sync', category_path: 'Income:B', own_actual_cents: 200 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(2);
  });

  it('uses ONLY import rows for a year that has any import/manual row, discarding qbo_sync rows for that year', () => {
    const rows = [
      { fiscal_year: 2026, source: 'qbo_sync', category_path: 'Income:A', own_actual_cents: 100 },
      { fiscal_year: 2026, source: 'import', category_path: 'Income:A', own_actual_cents: 999 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(1);
    expect(resolved[0].source).toBe('import');
    expect(resolved[0].own_actual_cents).toBe(999);
  });

  it('resolves precedence independently per year', () => {
    const rows = [
      { fiscal_year: 2025, source: 'import', category_path: 'Income:A', own_actual_cents: 1 },
      { fiscal_year: 2026, source: 'qbo_sync', category_path: 'Income:A', own_actual_cents: 2 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(2);
    expect(resolved.find(r => r.fiscal_year === 2025).source).toBe('import');
    expect(resolved.find(r => r.fiscal_year === 2026).source).toBe('qbo_sync');
  });
});

describe('computeYearSummary', () => {
  it('derives Gross Profit / Net Operating Income / Net Other Income / Net Income from classification totals, matching the real export figures', () => {
    // Same totals as the real uploaded QuickBooks export used to verify the Budget-vs-Actual fix:
    // Income 10200.77, COGS 405.00, Expenses 5237.31, Other Expenses 2916.00 -> Net Income 1642.46.
    const rows = [
      { classification: 'Income', own_actual_cents: 1020077, own_budget_cents: 1020077 },
      { classification: 'Cost of Goods Sold', own_actual_cents: 40500, own_budget_cents: 40500 },
      { classification: 'Expenses', own_actual_cents: 523731, own_budget_cents: 523731 },
      { classification: 'Other Expenses', own_actual_cents: 291600, own_budget_cents: 291600 },
    ];
    const summary = computeYearSummary(rows);
    expect(summary.grossProfit.actualCents).toBe(1020077 - 40500);
    expect(summary.netOperatingIncome.actualCents).toBe(1020077 - 40500 - 523731);
    expect(summary.netOtherIncome.actualCents).toBe(0 - 291600);
    expect(summary.netIncome.actualCents).toBe(1020077 - 40500 - 523731 - 291600);
    expect(summary.hasBudgetData).toBe(true);
  });

  it('reports hasBudgetData=false when no row in the year has a known budget (e.g. a plain multi-year actuals-only sync)', () => {
    const rows = [
      { classification: 'Income', own_actual_cents: 100000, own_budget_cents: null },
      { classification: 'Expenses', own_actual_cents: 50000, own_budget_cents: null },
    ];
    const summary = computeYearSummary(rows);
    expect(summary.hasBudgetData).toBe(false);
    expect(summary.netIncome.actualCents).toBe(50000);
    expect(summary.netIncome.budgetCents).toBe(0);
  });

  it('handles a classification with zero rows gracefully (e.g. no Other Income/Other Expenses this year)', () => {
    const rows = [{ classification: 'Income', own_actual_cents: 100000, own_budget_cents: 90000 }];
    const summary = computeYearSummary(rows);
    expect(summary.netIncome.actualCents).toBe(100000);
    expect(summary.netIncome.budgetCents).toBe(90000);
  });
});

// ── Budget import: the "Budget vs. Actuals" Excel export shape ──────────────────────────────
// Fixture mirrors the real uploaded export exactly (indentation via literal leading spaces,
// no cell-level indent metadata; "Total X" closing rows; a running-subtotal thread using this
// report's own wording — "Net Operating Revenue"/"Net Revenue" instead of the live API's
// "Net Operating Income"/"Net Income"; a trailing "Accrual Basis" timestamp footer line) but
// with non-zero, internally-consistent dollar amounts (the real uploaded file was all-zero test
// data) so the rollup arithmetic is actually exercised, and a group ("40 Donor Income") that
// carries both its own direct posting AND nested children — the exact case that caused the
// FIN2/v1.26.1 double-counting bug, now covered against the import path too.
function budgetVsActualsFixtureGrid() {
  return [
    ['Timothy Evangelical Lutheran Church', null, null, null, null],
    ['Budget vs. Actuals: Budget_FY27_P&L - FY27 P&L ', null, null, null, null],
    ['January - December 2027', null, null, null, null],
    [null, null, null, null, null],
    [null, 'Total', null, null, null],
    [null, 'Actual', 'Budget', 'over Budget', '% of Budget'],
    ['Revenue', null, null, null, null],
    ['   40 Donor Income', 500, 400, 100, 125],
    ['      40085 Sunday Offering', 1000, 900, 100, 111],
    ['   Total 40 Donor Income', 1500, 1300, 200, 115],
    ['   42 Passive Income', null, null, 0, 0],
    ['      42010 Interest', 200, 150, 50, 133],
    ['   Total 42 Passive Income', 200, 150, 50, 133],
    ['Total Revenue', 1700, 1450, 250, 117],
    ['Gross Profit', 1700, 1450, 250, 117],
    ['Expenditures', null, null, null, null],
    ['   50 Program Expenses', null, null, 0, 0],
    ['      50110 Something', 300, 250, 50, 120],
    ['   Total 50 Program Expenses', 300, 250, 50, 120],
    ['Total Expenditures', 300, 250, 50, 120],
    ['Net Operating Revenue', 1400, 1200, 200, 117],
    ['Net Revenue', 1400, 1200, 200, 117],
    [null, null, null, null, null],
    ['Friday, Jul 17, 2026 09:20:20 PM GMT-7 - Accrual Basis', null, null, null, null],
  ];
}

describe('normalizeChurchClassification', () => {
  it('maps this report style\'s custom top-level labels to the canonical names computeYearSummary expects', () => {
    expect(normalizeChurchClassification('Revenue')).toBe('Income');
    expect(normalizeChurchClassification('Expenditures')).toBe('Expenses');
    expect(normalizeChurchClassification('Income')).toBe('Income');
    expect(normalizeChurchClassification('Expenses')).toBe('Expenses');
    expect(normalizeChurchClassification('Other Income')).toBe('Other Income');
    expect(normalizeChurchClassification('Other Expenditures')).toBe('Other Expenses');
  });
});

describe('parseBudgetVsActualsGrid', () => {
  it('extracts fiscal year from the date-range line above the header row', () => {
    const { fiscalYear } = parseBudgetVsActualsGrid(budgetVsActualsFixtureGrid());
    expect(fiscalYear).toBe(2027);
  });

  it('skips Total-X closing rows, the running-subtotal thread, and the trailing date-stamp footer', () => {
    const { rows, skipped } = parseBudgetVsActualsGrid(budgetVsActualsFixtureGrid());
    expect(skipped).toEqual(['Friday, Jul 17, 2026 09:20:20 PM GMT-7 - Accrual Basis']);
    const labels = rows.map(r => r.account_name);
    expect(labels).not.toContain('Total 40 Donor Income');
    expect(labels).not.toContain('Gross Profit');
    expect(labels).not.toContain('Net Operating Revenue');
    expect(labels).not.toContain('Net Revenue');
    expect(labels).not.toContain('Total Revenue');
    expect(labels).not.toContain('Total Expenditures');
  });

  it('normalizes classification labels and stores the group-with-own-posting-and-children row correctly', () => {
    const { rows } = parseBudgetVsActualsGrid(budgetVsActualsFixtureGrid());
    const donorIncome = rows.find(r => r.account_name === '40 Donor Income');
    expect(donorIncome.classification).toBe('Income');
    expect(donorIncome.category_path).toBe('Income:40 Donor Income');
    expect(donorIncome.has_children).toBe(1);
    expect(donorIncome.own_actual_cents).toBe(50000);
    expect(donorIncome.own_budget_cents).toBe(40000);
    const sundayOffering = rows.find(r => r.account_name === '40085 Sunday Offering');
    expect(sundayOffering.category_path).toBe('Income:40 Donor Income:40085 Sunday Offering');
    expect(sundayOffering.own_actual_cents).toBe(100000);
    expect(sundayOffering.has_children).toBe(0);
    const expensesHeader = rows.find(r => r.depth === 0 && r.classification === 'Expenses');
    expect(expensesHeader).toBeTruthy();
    expect(expensesHeader.category_path).toBe('Expenses');
  });

  it('resolves to the correct classification-level rollups end to end, including via persistChurchEntriesImport + resolveChurchYearPrecedence', async () => {
    const db = makeTestDb();
    const { fiscalYear, rows } = parseBudgetVsActualsGrid(budgetVsActualsFixtureGrid());
    await persistChurchEntriesImport(db, rows, fiscalYear, '2026-07-18T00:00:00Z');
    const stored = allChurchRows(db);
    expect(stored.every(r => r.source === 'import')).toBe(true);
    const resolved = resolveChurchYearPrecedence(stored);
    const summary = computeYearSummary(resolved);
    expect(summary.classificationTotals.Income.actualCents).toBe(170000); // $1,700 = the real "Total Revenue"
    expect(summary.classificationTotals.Income.budgetCents).toBe(145000);
    expect(summary.classificationTotals.Expenses.actualCents).toBe(30000); // $300 = the real "Total Expenditures"
    expect(summary.classificationTotals.Expenses.budgetCents).toBe(25000);
    expect(summary.netOperatingIncome.actualCents).toBe(140000); // $1,400 = the real "Net Operating Revenue"
    expect(summary.netOperatingIncome.budgetCents).toBe(120000);
  });

  it('re-import (a second parse+persist for the same year) replaces rather than duplicates', async () => {
    const db = makeTestDb();
    const parsed = parseBudgetVsActualsGrid(budgetVsActualsFixtureGrid());
    await persistChurchEntriesImport(db, parsed.rows, parsed.fiscalYear, '2026-07-18T00:00:00Z');
    await persistChurchEntriesImport(db, parsed.rows, parsed.fiscalYear, '2026-07-18T01:00:00Z');
    const stored = allChurchRows(db);
    expect(stored.length).toBe(parsed.rows.length);
  });

  it('throws a clear error when the sheet has no Actual/Budget header row (not a Budget vs. Actuals export)', () => {
    expect(() => parseBudgetVsActualsGrid([['not', 'a', 'budget', 'report']])).toThrow(/Actual\/Budget header/);
  });
});
