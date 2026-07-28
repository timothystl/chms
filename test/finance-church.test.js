import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { flattenReportTree, makeCurrentYearExtractor, makeMultiYearExtractor, makeMonthlyExtractor, parseMonthColTitle, mergeProfitAndLossTree, mergeLeafCells, persistChurchEntries, persistChurchEntriesImport, resolveChurchYearPrecedence, computeYearSummary, computeYtdComparison, computeSuppliesMonthlyBreakdown, parseBudgetVsActualsGrid, normalizeChurchClassification, parseBalanceSheetGrid, normalizeBalanceClassification, computeBalanceSummary, persistChurchBalancesImport, classifyMdoAccountCategory, extractMdoDaycareEntries, persistDaycareEntriesFromChurchBudget, finXlsxParseSheetGrid } from '../src/api-finance.js';

// ── Minimal D1-shaped wrapper around node:sqlite, so persistChurchEntries() runs against real
// SQL (real UNIQUE/ON CONFLICT semantics) instead of a hand-rolled re-implementation of what the
// real D1 binding would do. ──
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE IF NOT EXISTS finance_daycare_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period       TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',
    entry_type   TEXT    NOT NULL DEFAULT 'actual',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'manual',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
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

  // 2026-07-28 — reported live: "Net Operating Revenue"/"Net Revenue" showed $0.00 budget in
  // the Budget vs Actual table for this church's real QuickBooks report, which uses "Revenue"
  // wording instead of QuickBooks' internal "Income" wording. mergeProfitAndLossTree's combined-
  // budget special case only ever matched the literal string "Net Income".
  it('computes the combined Net Revenue budget for a report using "Revenue" wording, not just "Net Income"', () => {
    const revenueWordingRows = [
      section('Income', null, [leaf('Design income', 2250.00)], true),
      section('Expenses', null, [leaf('Job Expenses', 155.07)], true),
      leaf('Net Revenue', 2094.93), // this church's real wording, not "Net Income"
    ];
    const budgetByName = new Map([['Design income', 2000], ['Job Expenses', 100]]);
    const budgetIdsByName = new Map([['Design income', new Set(['acct-1'])], ['Job Expenses', new Set(['acct-2'])]]);
    const merged = mergeProfitAndLossTree(revenueWordingRows, { budgetByName, budgetIdsByName, ambiguousNames: new Set() });
    const netRow = merged.find(r => r.ColData && r.ColData[0].value === 'Net Revenue');
    // mainBudget is a running sum across every section's own budget total in document order
    // (2000 + 100 here) — the fix under test is that this combined figure is computed AT ALL
    // for "Net Revenue" (previously always "0.00", since only the literal string "Net Income"
    // triggered the combined-budget branch).
    expect(netRow.ColData[2].value).toBe('2100.00');
    expect(netRow.ColData[2].value).not.toBe('0.00');
  });

  it('flattenReportTree skips "Net Revenue"/"Net Operating Revenue" as running subtotals, same as the "Income"-wording variants', () => {
    const revenueWordingRows = [
      section('Income', null, [leaf('Design income', 2250.00)], true),
      leaf('Net Operating Revenue', 2250.00),
      leaf('Net Revenue', 2250.00),
    ];
    const rows = flattenReportTree(revenueWordingRows, [], null, makeCurrentYearExtractor(2026));
    expect(rows.some(r => r.account_name === 'Net Operating Revenue')).toBe(false);
    expect(rows.some(r => r.account_name === 'Net Revenue')).toBe(false);
  });

  // 2026-07-28 — reported live: the Budget column was always $0 in the reconstructed report,
  // even though Actual populated correctly (since Actual never depends on this lookup at all).
  // Root cause: exact-string name matching between the P&L report's account label and the
  // Budget entity's AccountRef.name silently fails whenever QuickBooks displays the same
  // account slightly differently in each place. Fixed by preferring a match on QuickBooks' own
  // account id (present on a report ColData cell as `.id`) when available.
  it('mergeLeafCells matches by account id even when the P&L label text does not match the Budget entity name at all', () => {
    const ctx = {
      budgetByName: new Map(), // deliberately empty — name matching would find nothing
      budgetIdsByName: new Map(),
      budgetByAccountId: new Map([['acct-42', 500]]),
      ambiguousNames: new Set(),
    };
    const cells = [{ value: '40085 Sunday Offering', id: 'acct-42' }, { value: '750.00' }];
    const result = mergeLeafCells(cells, ctx);
    expect(result.budget).toBe(500);
    expect(result.cells[2].value).toBe('500.00');
  });

  it('mergeLeafCells falls back to name matching when the cell carries no account id', () => {
    const ctx = {
      budgetByName: new Map([['Sunday Offering', 500]]),
      budgetIdsByName: new Map([['Sunday Offering', new Set(['acct-42'])]]),
      budgetByAccountId: new Map([['acct-42', 500]]),
      ambiguousNames: new Set(),
    };
    const cells = [{ value: 'Sunday Offering' }, { value: '750.00' }]; // no .id
    const result = mergeLeafCells(cells, ctx);
    expect(result.budget).toBe(500);
  });

  // 2026-07-28 — follow-up: after the id-matching fix, a residual gap was still reported for one
  // category (real activity, $0 budget). Rather than guess further, mergeLeafCells now records
  // which accounts fail to match at all (distinguishing "had an id, just wasn't in this Budget's
  // BudgetDetail" from "no id present, name didn't match either") so the next sync's warning can
  // show exactly what's unmatched instead of another blind guess.
  it('records an unmatched account (has an id, but that id is not in the Budget) for diagnostics', () => {
    const ctx = {
      budgetByName: new Map(),
      budgetIdsByName: new Map(),
      budgetByAccountId: new Map([['acct-1', 100]]), // some other account, not this one
      ambiguousNames: new Set(),
      unmatched: [],
    };
    const cells = [{ value: '50010 Worship Supplies', id: 'acct-99' }, { value: '531731.78' }];
    mergeLeafCells(cells, ctx);
    expect(ctx.unmatched).toEqual([{ name: '50010 Worship Supplies', actualAmt: 531731.78, hadId: true }]);
  });

  it('does not record a diagnostic when the actual amount is negligible (near-$0 accounts are not "unmatched", just unused)', () => {
    const ctx = { budgetByName: new Map(), budgetIdsByName: new Map(), budgetByAccountId: new Map(), ambiguousNames: new Set(), unmatched: [] };
    const cells = [{ value: 'Unused Account', id: 'acct-1' }, { value: '0.00' }];
    mergeLeafCells(cells, ctx);
    expect(ctx.unmatched).toEqual([]);
  });

  // 2026-07-28 — reported live: a qbo_sync year showed Income re-sorted to the bottom after
  // CHURCH_SOURCE_PRIORITY started preferring qbo_sync over import. Root cause: this church's
  // live QuickBooks report labels its top-level Sections "Revenue"/"Expenditures" (confirmed —
  // same wording as their own Excel export, which normalizeChurchClassification() already
  // handled for the import path), but flattenReportTree() used the raw Section label as
  // classification with no normalization, so it never matched FIN_CHURCH_CLASS_ORDER's keys.
  it('normalizes a top-level Section labeled "Revenue" (this church\'s real QuickBooks wording) to classification "Income"', () => {
    const rows = flattenReportTree([
      { type: 'Section', Header: { ColData: [{ value: 'Revenue' }] }, Rows: { Row: [
        { ColData: [{ value: 'Offerings' }, { value: '500.00' }] },
      ] } },
    ], [], null, makeCurrentYearExtractor(2026));
    const offerings = rows.find(r => r.category_path === 'Revenue:Offerings');
    expect(offerings).toBeDefined();
    expect(offerings.classification).toBe('Income');
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

describe('computeSuppliesMonthlyBreakdown', () => {
  it('returns all-zero months when nothing matches "supplies"', () => {
    const result = computeSuppliesMonthlyBreakdown(
      [{ account_name: '50100 Wages', period_month: 1, own_actual_cents: 500 }],
      []
    );
    expect(result.monthly.length).toBe(12);
    expect(result.monthly.every(m => m.currentCents === 0 && m.priorCents === 0)).toBe(true);
    expect(result.currentYtdCents).toBe(0);
  });

  it('sums matching accounts by month and is case-insensitive, matching real MDO account names', () => {
    const current = [
      { account_name: '50160 MDO Supplies', period_month: 1, own_actual_cents: 1000 },
      { account_name: '57160 MDO - Supplies', period_month: 1, own_actual_cents: 500 },
      { account_name: 'Office supplies', period_month: 2, own_actual_cents: 300 },
      { account_name: '50100 Wages', period_month: 1, own_actual_cents: 99999 },
    ];
    const prior = [
      { account_name: '50160 MDO Supplies', period_month: 1, own_actual_cents: 800 },
    ];
    const result = computeSuppliesMonthlyBreakdown(current, prior);
    expect(result.monthly[0]).toEqual({ month: 1, currentCents: 1500, priorCents: 800 });
    expect(result.monthly[1]).toEqual({ month: 2, currentCents: 300, priorCents: 0 });
    expect(result.currentYtdCents).toBe(1800);
    expect(result.priorYtdCents).toBe(800);
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

  it('uses ONLY qbo_sync rows for a year that has both qbo_sync and import rows, discarding import rows for that year', () => {
    const rows = [
      { fiscal_year: 2026, source: 'qbo_sync', category_path: 'Income:A', own_actual_cents: 100 },
      { fiscal_year: 2026, source: 'import', category_path: 'Income:A', own_actual_cents: 999 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(1);
    expect(resolved[0].source).toBe('qbo_sync');
    expect(resolved[0].own_actual_cents).toBe(100);
  });

  it('falls back to an import row for a year with no qbo_sync row', () => {
    const rows = [{ fiscal_year: 2026, source: 'import', category_path: 'Income:A', own_actual_cents: 999 }];
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

  // FIN12 — Budget Planning can commit a placeholder budget into a future year
  // (source='plan_committed'). It must be the LOWEST priority: a real sync or import for that
  // same year should always win once one exists, so a stale plan never masks real data.
  it('uses a plan_committed row only when no qbo_sync/import row exists for that year', () => {
    const rows = [{ fiscal_year: 2027, source: 'plan_committed', category_path: 'Utilities', own_actual_cents: 0, own_budget_cents: 500000 }];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(1);
    expect(resolved[0].source).toBe('plan_committed');
  });

  it('a qbo_sync row for the same year overrides a plan_committed placeholder', () => {
    const rows = [
      { fiscal_year: 2027, source: 'plan_committed', category_path: 'Utilities', own_budget_cents: 500000 },
      { fiscal_year: 2027, source: 'qbo_sync', category_path: 'Utilities', own_actual_cents: 480000 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(1);
    expect(resolved[0].source).toBe('qbo_sync');
  });

  it('a qbo_sync row still wins over both import and plan_committed for the same year', () => {
    const rows = [
      { fiscal_year: 2027, source: 'plan_committed', category_path: 'Utilities', own_budget_cents: 500000 },
      { fiscal_year: 2027, source: 'qbo_sync', category_path: 'Utilities', own_actual_cents: 480000 },
      { fiscal_year: 2027, source: 'import', category_path: 'Utilities', own_actual_cents: 490000 },
    ];
    const resolved = resolveChurchYearPrecedence(rows);
    expect(resolved.length).toBe(1);
    expect(resolved[0].source).toBe('qbo_sync');
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

// ── Balance Sheet import: two real, genuinely different export conventions from this exact
// church confirmed the two fixtures below (indent-metadata + "Total for X", vs. leading-space +
// "Total X" — the latter matching the Budget report's own convention). Both fixtures mirror the
// real files' structure, including the "Liabilities and Equity" combined wrapper heading (whose
// two real children, Liabilities and Equity, sit one level deeper than Assets) and a trailing
// timestamp footer line confirmed present in both real exports.
function balanceSheetIndentFixture() {
  const grid = [
    ['Timothy Evangelical Lutheran Church', null],
    ['Statement of Financial Position', null],
    ['As of Jul 17, 2026', null],
    [null, null],
    ['', 'Total'],
    ['Assets', null],
    ['Current Assets', null],
    ['Bank Accounts', null],
    ['11025 Petty Cash', 200],
    ['11027 Lindell Checking', 1000],
    ['Total for Bank Accounts', 1200],
    ['Total for Current Assets', 1200],
    ['Total for Assets', 1200],
    ['Liabilities and Equity', null],
    ['Liabilities', null],
    ['Current Liabilities', null],
    ['21000 Accounts Payable', 300],
    ['Total for Current Liabilities', 300],
    ['Total for Liabilities', 300],
    ['Equity', null],
    ['31000 Unrestricted Net Assets', 900],
    ['Total for Equity', 900],
    ['Total for Liabilities and Equity', 1200],
  ];
  const colAIndent = [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3, 2, 1, 1, 2, 1, 0];
  return { grid, colAIndent };
}
function balanceSheetLeadingSpaceFixture() {
  const grid = [
    ['Timothy Evangelical Lutheran Church', null],
    ['Balance Sheet', null],
    ['As of December 31, 2026', null],
    [null, null],
    [null, 'Total'],
    ['ASSETS', null],
    ['   Current Assets', null],
    ['      Bank Accounts', null],
    ['         11025 Petty Cash', 500],
    ['      Total Bank Accounts', 500],
    ['   Total Current Assets', 500],
    ['TOTAL ASSETS', 500],
    ['LIABILITIES AND EQUITY', null],
    ['   Liabilities', null],
    ['      Current Liabilities', null],
    ['         21000 Accounts Payable', 100],
    ['      Total Current Liabilities', 100],
    ['   Total Liabilities', 100],
    ['   Equity', null],
    ['      31000 Unrestricted Net Assets', 400],
    ['   Total Equity', 400],
    ['Total Liabilities and Equity', 500],
    [null, null],
    ['Friday, Jul 17, 2026 09:28:23 PM GMT-7', null],
  ];
  return { grid };
}

describe('normalizeBalanceClassification', () => {
  it('maps Assets/Liabilities/Equity case-insensitively and rejects the combined wrapper heading', () => {
    expect(normalizeBalanceClassification('Assets')).toBe('Assets');
    expect(normalizeBalanceClassification('ASSETS')).toBe('Assets');
    expect(normalizeBalanceClassification('Liabilities')).toBe('Liabilities');
    expect(normalizeBalanceClassification('Equity')).toBe('Equity');
    expect(normalizeBalanceClassification('Liabilities and Equity')).toBe(null);
    expect(normalizeBalanceClassification('LIABILITIES AND EQUITY')).toBe(null);
  });
});

describe('parseBalanceSheetGrid', () => {
  it('reads the indent-metadata convention (Statement of Financial Position) correctly', () => {
    const { grid, colAIndent } = balanceSheetIndentFixture();
    const { fiscalYear, asOfDate, rows, skipped } = parseBalanceSheetGrid(grid, colAIndent);
    expect(fiscalYear).toBe(2026);
    expect(asOfDate).toBe('Jul 17, 2026');
    expect(skipped).toEqual([]);
    const labels = rows.map(r => r.account_name);
    expect(labels).not.toContain('Total for Bank Accounts');
    expect(labels).not.toContain('Liabilities and Equity');
    const pettyCash = rows.find(r => r.account_name === '11025 Petty Cash');
    expect(pettyCash.category_path).toBe('Assets:Current Assets:Bank Accounts:11025 Petty Cash');
    expect(pettyCash.own_balance_cents).toBe(20000);
    const equityHeader = rows.find(r => r.depth === 0 && r.classification === 'Equity');
    expect(equityHeader.category_path).toBe('Equity');
    const summary = computeBalanceSummary(rows);
    expect(summary.assetsCents).toBe(120000);
    expect(summary.liabilitiesCents).toBe(30000);
    expect(summary.equityCents).toBe(90000);
    expect(summary.balancedCents).toBe(0);
  });

  it('reads the leading-space convention (Balance Sheet, matching the Budget report style) and skips the trailing timestamp footer', () => {
    const { grid } = balanceSheetLeadingSpaceFixture();
    const { fiscalYear, asOfDate, rows, skipped } = parseBalanceSheetGrid(grid);
    expect(fiscalYear).toBe(2026);
    expect(asOfDate).toBe('December 31, 2026');
    expect(skipped).toEqual(['Friday, Jul 17, 2026 09:28:23 PM GMT-7']);
    const labels = rows.map(r => r.account_name);
    expect(labels).not.toContain('TOTAL ASSETS');
    expect(labels).not.toContain('Total Liabilities and Equity');
    const summary = computeBalanceSummary(rows);
    expect(summary.assetsCents).toBe(50000);
    expect(summary.liabilitiesCents).toBe(10000);
    expect(summary.equityCents).toBe(40000);
    expect(summary.balancedCents).toBe(0);
  });

  it('persists via persistChurchBalancesImport and round-trips through the DB unchanged', async () => {
    const db = makeTestDb();
    const { grid, colAIndent } = balanceSheetIndentFixture();
    const { fiscalYear, asOfDate, rows } = parseBalanceSheetGrid(grid, colAIndent);
    await persistChurchBalancesImport(db, rows, fiscalYear, asOfDate, '2026-07-18T00:00:00Z');
    const stored = db._raw.prepare('SELECT * FROM finance_church_balances ORDER BY category_path').all();
    expect(stored.length).toBe(rows.length);
    expect(stored.every(r => r.source === 'import' && r.as_of_date === 'Jul 17, 2026')).toBe(true);
    const summary = computeBalanceSummary(stored);
    expect(summary.balancedCents).toBe(0);
  });

  it('re-import for the same year replaces rather than duplicates', async () => {
    const db = makeTestDb();
    const { grid, colAIndent } = balanceSheetIndentFixture();
    const parsed = parseBalanceSheetGrid(grid, colAIndent);
    await persistChurchBalancesImport(db, parsed.rows, parsed.fiscalYear, parsed.asOfDate, '2026-07-18T00:00:00Z');
    await persistChurchBalancesImport(db, parsed.rows, parsed.fiscalYear, parsed.asOfDate, '2026-07-18T01:00:00Z');
    const stored = db._raw.prepare('SELECT * FROM finance_church_balances').all();
    expect(stored.length).toBe(parsed.rows.length);
  });

  it('throws a clear error when the sheet has no balance-sheet header row', () => {
    expect(() => parseBalanceSheetGrid([['not', 'a', 'balance', 'sheet']])).toThrow(/balance sheet header/);
  });

  it('does not mistake a Budget vs. Actuals sheet\'s decorative "Total"-only row for its own header', () => {
    const budgetGrid = budgetVsActualsFixtureGrid();
    expect(() => parseBalanceSheetGrid(budgetGrid)).toThrow(/balance sheet header/);
  });
});

describe('finXlsxParseSheetGrid — literal-number formula cells', () => {
  // Real bug (reported after v1.32.0 shipped): a "Balance Sheet without zero acct" export writes
  // every leaf account's dollar amount as plain text inside the <f> (formula) tag — e.g.
  // <f>115605.47</f><v>0.0</v> — with the cached <v> stuck at a stale 0.0 that was never
  // recalculated before the file was saved. Reading only <v> (as before this fix) silently
  // imported every account as $0. Real subtotal rows use actual cell-reference formulas
  // (<f>(B10)+(B11)</f>) whose <v> is also stale 0.0 — those rows are discarded/re-derived by
  // parseBalanceSheetGrid anyway, so leaving their <v> alone (rather than trying to evaluate the
  // formula) is fine.
  function sheetXmlFrom(rows) {
    const rowsXml = rows.map(([r, cells]) =>
      `<row r="${r}">${cells.map(c => c).join('')}</row>`).join('');
    return `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
  }
  it('prefers a plain-numeric <f> over a stale cached <v>', () => {
    const xml = sheetXmlFrom([
      [1, ['<c r="A1" t="s"><v>0</v></c>', '<c r="B1" t="n"><f>115605.47</f><v>0.0</v></c>']],
      [2, ['<c r="A2" t="s"><v>1</v></c>', '<c r="B2" t="n"><f>-1002.00</f><v>0.0</v></c>']],
      [3, ['<c r="A3" t="s"><v>2</v></c>', '<c r="B3" t="n"><f>0.00</f><v>0.0</v></c>']],
      [4, ['<c r="A4" t="s"><v>3</v></c>', '<c r="B4" t="n"><f>((B10)+(B11))+(B12)</f><v>0.0</v></c>']],
      [5, ['<c r="A5" t="s"><v>4</v></c>', '<c r="B5" t="n"><v>42.5</v></c>']],
    ]);
    const sharedStrings = ['Cash Account', 'Some Other Account', 'Zero Account', 'Total Row', 'Plain Value Row'];
    const grid = finXlsxParseSheetGrid(xml, sharedStrings);
    expect(grid[0]).toEqual(['Cash Account', 115605.47]);
    expect(grid[1]).toEqual(['Some Other Account', -1002]);
    expect(grid[2]).toEqual(['Zero Account', 0]);
    expect(grid[3][1]).toBe(0); // real subtotal formula: stale <v> passed through, unused by callers
    expect(grid[4]).toEqual(['Plain Value Row', 42.5]); // no <f> at all — unaffected by this fix
  });
});

// ── Daycare data from an already-imported Church Budget year ────────────────────────────────
// Account names below are copied verbatim from the real uploaded Budget vs. Actuals export —
// note the real file's own inconsistent numbering/hyphenation ("50160 MDO Supplies" alongside
// "57160 MDO - Supplies", "57161 MDO -  Wages" with a double space) confirms matching must go
// by the "MDO" text itself, not a fixed account-number scheme.
describe('classifyMdoAccountCategory', () => {
  it('maps the real MDO account names from the actual uploaded export to the Daycare Report categories', () => {
    expect(classifyMdoAccountCategory('47020 MDO Tuition')).toBe('Tuition Income');
    expect(classifyMdoAccountCategory('50161 MDO Wages')).toBe('Payroll');
    expect(classifyMdoAccountCategory('57161 MDO -  Wages')).toBe('Payroll');
    expect(classifyMdoAccountCategory('57162 MDO Payroll Taxes')).toBe('Payroll Taxes');
    expect(classifyMdoAccountCategory('57163 Workers Comp')).toBe('Workers Comp');
    expect(classifyMdoAccountCategory('57175 MDO Payroll Processing')).toBe('Other Payroll Expenses');
    expect(classifyMdoAccountCategory('50160 MDO Supplies')).toBe('Other Expenses');
    expect(classifyMdoAccountCategory('57160 MDO - Supplies')).toBe('Other Expenses');
  });
});

describe('extractMdoDaycareEntries', () => {
  // Mirrors the real file's shape: a classification-header row (own amount 0, blank), a group
  // header ("57 MDO Expenses", also 0), and real leaf accounts with non-zero actual/budget — plus
  // a non-MDO account that must NOT be picked up.
  function mdoFixtureRows() {
    return [
      { category_path: 'Income:47 Mother\'s Day Out', account_name: '47 Mother\'s Day Out', classification: 'Income', depth: 1, has_children: 1, own_actual_cents: 0, own_budget_cents: 0 },
      { category_path: 'Income:47 Mother\'s Day Out:47020 MDO Tuition', account_name: '47020 MDO Tuition', classification: 'Income', depth: 2, has_children: 0, own_actual_cents: 500000, own_budget_cents: 450000 },
      { category_path: 'Expenses:57 MDO Expenses', account_name: '57 MDO Expenses', classification: 'Expenses', depth: 1, has_children: 1, own_actual_cents: 0, own_budget_cents: 0 },
      { category_path: 'Expenses:57 MDO Expenses:57161 MDO -  Wages', account_name: '57161 MDO -  Wages', classification: 'Expenses', depth: 2, has_children: 0, own_actual_cents: 300000, own_budget_cents: 280000 },
      { category_path: 'Expenses:57 MDO Expenses:57163 Workers Comp', account_name: '57163 Workers Comp', classification: 'Expenses', depth: 2, has_children: 0, own_actual_cents: 12000, own_budget_cents: null },
      { category_path: 'Income:40 Donor Income (Unrestricted):40085 Sunday Offering', account_name: '40085 Sunday Offering', classification: 'Income', depth: 2, has_children: 0, own_actual_cents: 999999, own_budget_cents: 999999 },
    ];
  }

  it('picks up only MDO-tagged accounts and skips zero/blank amounts', () => {
    const entries = extractMdoDaycareEntries(mdoFixtureRows(), 2026);
    const nonMdo = entries.find(e => e.notes.indexOf('Sunday Offering') !== -1);
    expect(nonMdo).toBeUndefined();
    const groupHeaders = entries.filter(e => e.notes.indexOf('47 Mother\'s Day Out)') !== -1 || e.notes.indexOf('57 MDO Expenses)') !== -1);
    expect(groupHeaders.length).toBe(0); // own amount was 0/blank on both group headers
  });

  it('produces both an actual and a budget entry per account when both are known', () => {
    const entries = extractMdoDaycareEntries(mdoFixtureRows(), 2026);
    const tuition = entries.filter(e => e.category === 'Tuition Income');
    expect(tuition.length).toBe(2);
    expect(tuition.find(e => e.entry_type === 'actual').amount_cents).toBe(500000);
    expect(tuition.find(e => e.entry_type === 'budget').amount_cents).toBe(450000);
  });

  it('omits the budget entry when budget is null (no budget known for that account)', () => {
    const entries = extractMdoDaycareEntries(mdoFixtureRows(), 2026);
    const workersComp = entries.filter(e => e.category === 'Workers Comp');
    expect(workersComp.length).toBe(1);
    expect(workersComp[0].entry_type).toBe('actual');
  });

  it('tags every entry with source church_budget_import and the correct period', () => {
    const entries = extractMdoDaycareEntries(mdoFixtureRows(), 2026);
    expect(entries.every(e => e.source === 'church_budget_import')).toBe(true);
    expect(entries.every(e => e.period === '2026')).toBe(true);
  });

  it('persists via persistDaycareEntriesFromChurchBudget and re-import replaces rather than duplicates', async () => {
    const db = makeTestDb();
    const entries = extractMdoDaycareEntries(mdoFixtureRows(), 2026);
    await persistDaycareEntriesFromChurchBudget(db, entries, 2026);
    let stored = db._raw.prepare("SELECT * FROM finance_daycare_entries WHERE source='church_budget_import'").all();
    expect(stored.length).toBe(entries.length);
    await persistDaycareEntriesFromChurchBudget(db, entries, 2026);
    stored = db._raw.prepare("SELECT * FROM finance_daycare_entries WHERE source='church_budget_import'").all();
    expect(stored.length).toBe(entries.length); // replaced, not doubled

    // A manual entry for the same period must survive an MDO re-import untouched.
    db._raw.prepare("INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source) VALUES ('2026','Other Expenses','actual',1000,'hand-entered','manual')").run();
    await persistDaycareEntriesFromChurchBudget(db, entries, 2026);
    const manualRow = db._raw.prepare("SELECT * FROM finance_daycare_entries WHERE source='manual'").all();
    expect(manualRow.length).toBe(1);
  });
});
