import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  findMonthlyPnLSheet, parseMonthlyPnLGrid, persistChurchEntriesMonthlyImport,
  resolveChurchMonthlyYearPrecedence, parseMonthColTitle,
} from '../src/api-finance.js';

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
  return db._raw.prepare('SELECT * FROM finance_church_entries ORDER BY fiscal_year, period_month, category_path, source').all();
}

function monthlyPnLFixtureGrid() {
  return [
    ['Timothy Evangelical Lutheran Church', null, null, null],
    ['Profit and Loss by Month', null, null, null],
    ['January - February 2027', null, null, null],
    [null, null, null, null],
    [null, 'Jan 2027', 'Feb 2027', 'Total'],
    ['Revenue', null, null, null],
    ['   40 Donor Income', 500, 600, 1100],
    ['      40085 Sunday Offering', 300, 350, 650],
    ['   Total 40 Donor Income', 800, 950, 1750],
    ['Total Revenue', 800, 950, 1750],
    ['Expenditures', null, null, null],
    ['   50 Program Expenses', 100, 120, 220],
    ['   Total 50 Program Expenses', 100, 120, 220],
    ['Total Expenditures', 100, 120, 220],
    ['Net Operating Revenue', 700, 830, 1530],
    ['Net Revenue', 700, 830, 1530],
    [null, null, null, null],
    ['Friday, Jul 17, 2026 09:20:20 PM GMT-7 - Accrual Basis', null, null, null],
  ];
}

const otherSheet = { name: 'Cover', grid: [['not', 'a', 'monthly', 'sheet']] };
const monthlySheet = { name: 'Sheet1', grid: monthlyPnLFixtureGrid() };

describe('findMonthlyPnLSheet', () => {
  it('finds the sheet whose header row has two adjacent month-titled columns', () => {
    const found = findMonthlyPnLSheet([otherSheet, monthlySheet]);
    expect(found).toBe(monthlySheet);
  });
  it('returns null when no sheet matches', () => {
    expect(findMonthlyPnLSheet([otherSheet])).toBeNull();
  });
  it('skips sheets with no grid', () => {
    expect(findMonthlyPnLSheet([{ name: 'x' }, monthlySheet])).toBe(monthlySheet);
  });
});

describe('parseMonthColTitle', () => {
  it('parses "Jan 2027" style month headers', () => {
    expect(parseMonthColTitle('Jan 2027')).toEqual({ year: 2027, month: 1 });
    expect(parseMonthColTitle('February 2026')).toEqual({ year: 2026, month: 2 });
  });
  it('returns null for non-month text', () => {
    expect(parseMonthColTitle('Total')).toBeNull();
    expect(parseMonthColTitle('')).toBeNull();
  });
});

// A real 2019-2026 export from this church carries NO leading-space indentation at all — the
// hierarchy lives only in the workbook's cell-style indent metadata, surfaced as colAIndent. This
// fixture reproduces that exact shape (flush-left labels + a parallel indent array) AND spans two
// years, which is the combination that silently imported zero rows before.
function multiYearStyleIndentFixture() {
  const grid = [
    ['Timothy Evangelical Lutheran Church', null, null, null, null, null],
    ['Statement of Activity', null, null, null, null, null],
    ['January, 2026-February, 2027', null, null, null, null, null],
    [null, 'Jan 2026', 'Feb 2026', 'Jan 2027', 'Feb 2027', 'Total'],
    ['Revenue', null, null, null, null, null],
    ['40 Donor Income', null, null, null, null, null],
    ['40085 Sunday Offering', 100, 200, 300, 400, 1000],
    ['Total for 40 Donor Income', 100, 200, 300, 400, 1000],
    ['Expenditures', null, null, null, null, null],
    ['50 Program Expenses', 10, 20, 30, 40, 100],
    ['Total for 50 Program Expenses', 10, 20, 30, 40, 100],
    ['Net Revenue', 90, 180, 270, 360, 900],
  ];
  //            0  1  2  3     4  5  6     7  8  9     10 11
  const colAIndent = [0, 0, 0, null, 0, 1, 2, 1, 0, 1, 1, 0];
  return { grid, colAIndent };
}

describe('parseMonthlyPnLGrid', () => {
  it('extracts the year list and per-year months from the header row', () => {
    const { years, monthsByYear } = parseMonthlyPnLGrid(monthlyPnLFixtureGrid());
    expect(years).toEqual([2027]);
    expect(monthsByYear).toEqual({ 2027: [1, 2] });
  });

  it('reads hierarchy from cell-style indent metadata when the sheet has no leading spaces', () => {
    const { grid, colAIndent } = multiYearStyleIndentFixture();
    const { rows, skipped } = parseMonthlyPnLGrid(grid, colAIndent);
    // Without the colAIndent fallback every row reads as depth 0 with no children and lands in
    // `skipped`, producing a successful-looking import of nothing.
    expect(rows.length).toBeGreaterThan(0);
    expect(skipped).toEqual([]);
    const paths = [...new Set(rows.map(r => r.category_path))].sort();
    expect(paths).toEqual([
      'Expenses',
      'Expenses:50 Program Expenses',
      'Income',
      'Income:40 Donor Income',
      'Income:40 Donor Income:40085 Sunday Offering',
    ]);
    const offering = rows.find(r => r.category_path === 'Income:40 Donor Income:40085 Sunday Offering'
      && r.fiscal_year === 2027 && r.period_month === 2);
    expect(offering.own_actual_cents).toBe(40000);
    expect(offering.depth).toBe(2);
  });

  it('carries each column own year onto its rows for a file spanning multiple years', () => {
    const { grid, colAIndent } = multiYearStyleIndentFixture();
    const { years, monthsByYear, rows } = parseMonthlyPnLGrid(grid, colAIndent);
    expect(years).toEqual([2026, 2027]);
    expect(monthsByYear).toEqual({ 2026: [1, 2], 2027: [1, 2] });
    const offering = p => rows.find(r =>
      r.category_path === 'Income:40 Donor Income:40085 Sunday Offering'
      && r.fiscal_year === p.year && r.period_month === p.month).own_actual_cents;
    // The four Sunday Offering cells must land on four distinct (year, month) slots — not all
    // four collapsed onto the first year, which is what the old first-column-wins code did.
    expect(offering({ year: 2026, month: 1 })).toBe(10000);
    expect(offering({ year: 2026, month: 2 })).toBe(20000);
    expect(offering({ year: 2027, month: 1 })).toBe(30000);
    expect(offering({ year: 2027, month: 2 })).toBe(40000);
  });

  it('emits one flat row per (account, month) with the correct depth/path/amount, skipping Total/running-subtotal rows', () => {
    const { rows, skipped } = parseMonthlyPnLGrid(monthlyPnLFixtureGrid());
    // 4 real accounts (Revenue, 40 Donor Income, 40085 Sunday Offering, Expenditures, 50 Program
    // Expenses) x 2 months = 10 rows; "Total ..." / "Net Operating Revenue" / "Net Revenue" rows
    // are never stored (always re-derivable from their children).
    const paths = [...new Set(rows.map(r => r.category_path))];
    expect(paths.sort()).toEqual([
      'Expenses',
      'Expenses:50 Program Expenses',
      'Income',
      'Income:40 Donor Income',
      'Income:40 Donor Income:40085 Sunday Offering',
    ].sort());
    expect(rows.every(r => r.period_month === 1 || r.period_month === 2)).toBe(true);

    const donorJan = rows.find(r => r.category_path === 'Income:40 Donor Income' && r.period_month === 1);
    expect(donorJan.own_actual_cents).toBe(50000);
    expect(donorJan.classification).toBe('Income');
    expect(donorJan.depth).toBe(1);
    expect(donorJan.has_children).toBe(1);

    const offeringFeb = rows.find(r => r.category_path === 'Income:40 Donor Income:40085 Sunday Offering' && r.period_month === 2);
    expect(offeringFeb.own_actual_cents).toBe(35000);
    expect(offeringFeb.depth).toBe(2);
    expect(offeringFeb.has_children).toBe(0);

    const expClassification = rows.find(r => r.category_path === 'Expenses').classification;
    expect(expClassification).toBe('Expenses'); // normalized from "Expenditures"

    expect(skipped).toContain('Friday, Jul 17, 2026 09:20:20 PM GMT-7 - Accrual Basis');
  });

  it('throws a helpful error when no month header row is found', () => {
    expect(() => parseMonthlyPnLGrid([['not', 'a', 'monthly', 'report']])).toThrow(/month-by-month header row/);
  });
});

describe('persistChurchEntriesMonthlyImport + resolveChurchMonthlyYearPrecedence', () => {
  it('persists monthly_import rows and resolves them when no qbo_sync rows exist for that year/month', async () => {
    const db = makeTestDb();
    const { rows } = parseMonthlyPnLGrid(monthlyPnLFixtureGrid());
    await persistChurchEntriesMonthlyImport(db, rows, '2026-07-23T00:00:00Z');
    const stored = allChurchRows(db);
    expect(stored.length).toBe(rows.length);
    expect(stored.every(r => r.source === 'monthly_import')).toBe(true);

    const resolved = resolveChurchMonthlyYearPrecedence(stored);
    expect(resolved.length).toBe(rows.length);
  });

  it('re-importing the same fiscal year wholesale-replaces the prior monthly_import rows instead of duplicating', async () => {
    const db = makeTestDb();
    const { rows } = parseMonthlyPnLGrid(monthlyPnLFixtureGrid());
    await persistChurchEntriesMonthlyImport(db, rows, '2026-07-23T00:00:00Z');
    await persistChurchEntriesMonthlyImport(db, rows, '2026-07-23T01:00:00Z');
    const stored = allChurchRows(db);
    expect(stored.length).toBe(rows.length);
  });

  it('stores each row under its own fiscal year, so a multi-year file does not collapse into one', async () => {
    const db = makeTestDb();
    const { grid, colAIndent } = multiYearStyleIndentFixture();
    const { rows } = parseMonthlyPnLGrid(grid, colAIndent);
    await persistChurchEntriesMonthlyImport(db, rows, '2026-07-23T00:00:00Z');
    const stored = allChurchRows(db);
    expect(stored.length).toBe(rows.length);
    expect([...new Set(stored.map(r => r.fiscal_year))].sort()).toEqual([2026, 2027]);
    const jan2027 = stored.find(r => r.fiscal_year === 2027 && r.period_month === 1
      && r.category_path === 'Income:40 Donor Income:40085 Sunday Offering');
    expect(jan2027.own_actual_cents).toBe(30000);
  });

  it('committing one year at a time (as the UI does) leaves the other years untouched', async () => {
    const db = makeTestDb();
    const { grid, colAIndent } = multiYearStyleIndentFixture();
    const { rows } = parseMonthlyPnLGrid(grid, colAIndent);
    await persistChurchEntriesMonthlyImport(db, rows.filter(r => r.fiscal_year === 2026), '2026-07-23T00:00:00Z');
    await persistChurchEntriesMonthlyImport(db, rows.filter(r => r.fiscal_year === 2027), '2026-07-23T00:01:00Z');
    const stored = allChurchRows(db);
    expect(stored.length).toBe(rows.length);
    // Re-committing just 2027 must not wipe 2026 — the DELETE is scoped to the years present.
    await persistChurchEntriesMonthlyImport(db, rows.filter(r => r.fiscal_year === 2027), '2026-07-23T00:02:00Z');
    const after = allChurchRows(db);
    expect(after.length).toBe(rows.length);
    expect(after.filter(r => r.fiscal_year === 2026).length).toBe(rows.filter(r => r.fiscal_year === 2026).length);
  });

  it('gives qbo_sync priority over monthly_import for the same year, but still resolves other years from monthly_import', () => {
    const rows = [
      { fiscal_year: 2027, period_month: 1, category_path: 'Revenue', source: 'qbo_sync', own_actual_cents: 100 },
      { fiscal_year: 2027, period_month: 1, category_path: 'Revenue', source: 'monthly_import', own_actual_cents: 999 },
      { fiscal_year: 2026, period_month: 1, category_path: 'Revenue', source: 'monthly_import', own_actual_cents: 50 },
    ];
    const resolved = resolveChurchMonthlyYearPrecedence(rows);
    const y2027 = resolved.filter(r => r.fiscal_year === 2027);
    const y2026 = resolved.filter(r => r.fiscal_year === 2026);
    expect(y2027).toHaveLength(1);
    expect(y2027[0].source).toBe('qbo_sync');
    expect(y2026).toHaveLength(1);
    expect(y2026[0].source).toBe('monthly_import');
  });
});
