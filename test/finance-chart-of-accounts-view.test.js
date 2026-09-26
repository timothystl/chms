import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  buildChartOfAccountsView, buildPurposeTotals, chartLeafRows, layoutFromChartRows, resolveAccountsReport,
} from '../apps/finance/accounts-report-service.js';
import { renderAccountsPage } from '../apps/finance/accounts-pages.js';
import { normalizeBoardLayout } from '../apps/finance/board-layout.js';
import { withLocalContractReads } from '../apps/finance/local-contract-reads.js';
import { fetchLiveFinanceChartOfAccounts } from '../apps/finance/finance-chart-of-accounts-client.js';

// Finance's Chart of Accounts against legacy Connect's tab (finRenderChartOfAccounts and
// finPurposeTagTotals in src/frontend/js-finance.js). All names and amounts are synthetic.
function row(classification, path, name, actual, budget = null, extra = {}) {
  return {
    classification, category_path: path, account_name: name, display_name: name,
    actual_cents: actual, budget_cents: budget, board_category_key: 'unassigned', board_category_label: 'Unassigned',
    purpose_tag_id: null, purpose_tag_label: null, ...extra,
  };
}

const ROWS = [
  row('Income', 'Income:40 Giving', 'Giving', 0),
  row('Income', 'Income:40 Giving:40085 Sunday Offering', '40085 Sunday Offering', 500000, 550000),
  row('Income', 'Income:40 Giving:40090 Easter Offering', '40090 Easter Offering', 0, null), // pruned: no actual, no budget
  row('Other Income', 'Other Income:48 Other:48010 Interest', '48010 Interest', 1200),
  row('Income', 'Income:43 Facility Rental', 'Facility Rental', 25000, 24000),
  row('Expenses', 'Expenses:60 Staff', 'Staff', 700), // posted directly to a group with a surviving child
  row('Expenses', 'Expenses:60 Staff:60010 Pastor Salary', '60010 Pastor Salary', 300000, 310000),
  row('Expenses', 'Expenses:70 Old Group', 'Old Group', 450), // every child pruned: becomes a leaf
  row('Expenses', 'Expenses:70 Old Group:70010 Retired Line', '70010 Retired Line', 0, 0),
  row('Other Expenses', 'Other Expenses:Bank Fees', 'Bank Fees', 300),
  row('Cost of Goods Sold', 'Cost of Goods Sold:Resale Books', 'Resale Books', 900),
  row('Expenses', 'Expenses:Unapplied Cash Bill Payment Expense', 'Unapplied Cash Bill Payment Expense', 0), // top-level: never pruned
];

describe('Chart of Accounts leaves (legacy finReorganizeChurchTree + finFlattenLeaves)', () => {
  it('lists the same leaves as legacy: empty lines pruned below each root, emptied groups becoming leaves', () => {
    expect(chartLeafRows(ROWS).map((r) => r.category_path)).toEqual([
      'Income:40 Giving:40085 Sunday Offering', 'Income:43 Facility Rental', 'Other Income:48 Other:48010 Interest',
      'Cost of Goods Sold:Resale Books', 'Expenses:60 Staff:60010 Pastor Salary', 'Expenses:70 Old Group',
      'Expenses:Unapplied Cash Bill Payment Expense', 'Other Expenses:Bank Fees',
    ]);
  });

  it('falls back to path leaves when rows carry no figures (synthetic fixture or an older Connect)', () => {
    const rows = ROWS.map((r) => ({ ...r, actual_cents: null, budget_cents: null }));
    expect(chartLeafRows(rows)).toHaveLength(9);
  });
});

describe('buildChartOfAccountsView', () => {
  const layout = normalizeBoardLayout({
    boardCategories: {
      revenue: { 'Income:43 Facility Rental': 'passive' }, expense: {},
      revenueLabels: { donor: 'General Giving' }, expenseLabels: {},
      accountLabels: { 'Expenses:60 Staff:60010 Pastor Salary': 'Pastor salary' },
    },
    purposeTags: { tags: [{ id: 'youth', label: 'Youth' }], categories: { 'Expenses:60 Staff:60010 Pastor Salary': 'youth' } },
  });
  const view = buildChartOfAccountsView(ROWS, layout);

  it('puts Income and Other Income on the revenue side, every other classification on the expense side', () => {
    expect(view.revenue.count).toBe(3);
    expect(view.expense.count).toBe(5);
    expect(view.revenue.actualCents).toBe(526200);
    expect(view.expense.actualCents).toBe(301650);
  });

  it('lists every category in legacy order, empty ones included, with saved headings and subtotals', () => {
    expect(view.revenue.groups.map((g) => g.key)).toEqual(['donor', 'earned', 'passive', 'restricted']);
    expect(view.expense.groups.map((g) => g.key)).toEqual(['mdo', 'salaries', 'benefits', 'worship', 'property', 'education', 'youth_family', 'district_synod', 'programs']);
    const donor = view.revenue.groups[0];
    expect(donor).toMatchObject({ label: 'General Giving', actualCents: 500000, budgetCents: 550000, hasBudget: true });
    expect(view.revenue.groups[2].items.map((i) => i.path)).toEqual(['Other Income:48 Other:48010 Interest', 'Income:43 Facility Rental']);
    expect(view.revenue.groups[3].items).toEqual([]);
  });

  it('places an unsaved account by its QuickBooks name, never by its display rename', () => {
    const salaries = view.expense.groups.find((g) => g.key === 'salaries');
    expect(salaries.items).toHaveLength(1);
    expect(salaries.items[0]).toMatchObject({ label: 'Pastor salary', qbName: '60010 Pastor Salary', assigned: false, purposeTagLabel: 'Youth' });
    // No rule matches these names, so they land in legacy's catch-all.
    const programs = view.expense.groups.find((g) => g.key === 'programs');
    expect(programs.items.map((i) => i.label)).toEqual(['Bank Fees', 'Old Group', 'Resale Books', 'Unapplied Cash Bill Payment Expense']);
  });

  it('reports what was posted directly to account groups, so the totals reconcile', () => {
    expect(view.unlistedRevenueCents).toBe(0);
    expect(view.unlistedExpenseCents).toBe(700);
  });

  it('without the saved layout, still uses the default category rather than Unassigned', () => {
    const fallback = layoutFromChartRows([
      row('Expenses', 'Expenses:Youth Retreat', 'Youth Retreat', 100),
      row('Expenses', 'Expenses:Snacks', 'Snacks', 50, null, { board_category_key: 'worship', display_name: 'Worship snacks' }),
    ]);
    const v = buildChartOfAccountsView([
      row('Expenses', 'Expenses:Youth Retreat', 'Youth Retreat', 100),
      row('Expenses', 'Expenses:Snacks', 'Snacks', 50),
    ], fallback);
    expect(v.expense.groups.find((g) => g.key === 'youth_family').items[0].label).toBe('Youth Retreat');
    expect(v.expense.groups.find((g) => g.key === 'worship').items[0]).toMatchObject({ label: 'Worship snacks', assigned: true });
  });
});

describe('buildPurposeTotals (legacy finPurposeTagTotals)', () => {
  const layout = normalizeBoardLayout({
    purposeTags: {
      tags: [{ id: 'youth', label: 'Youth' }, { id: 'mission', label: 'Mission' }],
      categories: { 'Expenses:60 Staff:60010 Pastor Salary': 'youth', 'Other Expenses:Bank Fees': 'mission' },
    },
  });
  const view = buildChartOfAccountsView(ROWS, layout);
  const payroll = {
    roster: [
      { name: 'Synthetic Worker A', purposeTag: 'youth', accountCode: '60010' },
      { name: 'Synthetic Worker B', purposeTag: 'mission', externallyFunded: true },
      { name: 'Synthetic Worker C', purposeTag: 'mission', accountCode: '' },
    ],
    computed: [{ churchCostCents: 400000 }, { churchCostCents: 999999 }, { churchCostCents: 50000 }],
    isExternallyFunded: (w) => !!w.externallyFunded,
  };

  it('adds tagged workers\' church cost and tagged accounts\' actuals, skipping an account a tagged worker is paid from', () => {
    const totals = buildPurposeTotals(view, layout, payroll);
    expect(totals.payrollAvailable).toBe(true);
    expect(totals.rows).toEqual([
      { id: 'youth', label: 'Youth', payrollCents: 400000, accountCents: 0, totalCents: 400000, workers: ['Synthetic Worker A'], accounts: [] },
      { id: 'mission', label: 'Mission', payrollCents: 50000, accountCents: 300, totalCents: 50300, workers: ['Synthetic Worker C'], accounts: ['Bank Fees'] },
    ]);
  });

  it('counts accounts only when the Compensation plan is not available', () => {
    const totals = buildPurposeTotals(view, layout, null);
    expect(totals.payrollAvailable).toBe(false);
    expect(totals.rows[0]).toMatchObject({ payrollCents: 0, accountCents: 300000, accounts: ['60010 Pastor Salary'] });
  });
});

describe('renderAccountsPage', () => {
  const layout = normalizeBoardLayout({
    boardCategories: { accountLabels: { 'Expenses:60 Staff:60010 Pastor Salary': 'Pastor salary' } },
    purposeTags: { tags: [{ id: 'youth', label: 'Youth' }], categories: { 'Expenses:60 Staff:60010 Pastor Salary': 'youth' } },
  });
  const accountsReport = { rows: ROWS, source: 'live', fiscalYear: 2026, availableFiscalYears: [2026, 2025] };

  it('shows a year selector, display names, figures by board category and Resources by Purpose', () => {
    const html = renderAccountsPage('chart', {
      accountsReport, boardLayout: layout, canManageBoardCategories: false, canManagePurposeTags: false,
      compensationProjection: {
        ok: true,
        model: { roster: [{ name: 'Synthetic Worker A', purposeTag: 'youth', accountCode: '60010' }], isExternallyFunded: () => false },
        computed: [{ churchCostCents: 400000 }],
      },
      canReadCompensation: true,
    });
    expect(html).toContain('<form method="GET" action="/" class="inline-form" aria-label="Fiscal year">');
    expect(html).toContain('<option value="2026" selected>FY2026</option><option value="2025">FY2025</option>');
    expect(html).toContain('Pastor salary');
    expect(html).toContain('QuickBooks: 60010 Pastor Salary');
    expect(html).toContain('Unrestricted Gifts');
    expect(html).toContain('$5,000');
    expect(html).toContain('No accounts read under this category yet.');
    expect(html).toContain('Resources by Purpose');
    expect(html).toContain('Payroll (FY2027 plan)');
    expect(html).toContain('1 worker: Synthetic Worker A');
    // The pruned line stays in the ledger hierarchy but not in the chart itself.
    expect(html.split('aria-label="Ledger hierarchy"')[0]).not.toContain('Easter Offering');
    // The renamed salary line is still matched to the worker by its QuickBooks number: counted once.
    expect(html).toContain('<td class="num">$4,000</td><td class="num">$0</td><td class="num"><strong>$4,000</strong></td>');
    expect(html).not.toMatch(/<script/i);
  });

  it('leaves out the payroll column, and says why, for a role that cannot read Compensation', () => {
    const html = renderAccountsPage('chart', {
      accountsReport, boardLayout: layout, canManageBoardCategories: false, canManagePurposeTags: false,
      compensationProjection: null, canReadCompensation: false,
    });
    expect(html).toContain('Resources by Purpose');
    expect(html).not.toContain('Payroll (FY');
    expect(html).toContain('shown only to roles that can open Compensation');
  });

  it('offers the most recent year on file when the chosen year has no ledger rows', () => {
    const html = renderAccountsPage('chart', {
      accountsReport: { rows: [], source: 'live', fiscalYear: 2027, availableFiscalYears: [2026, 2025] },
      boardLayout: layout, canManageBoardCategories: false, canManagePurposeTags: false,
    });
    expect(html).toContain('No ledger rows are on file for FY2027 yet.');
    expect(html).toContain('href="/?section=accounts&amp;page=chart&amp;fiscal_year=2026"');
  });

  it('gives the admin layout editor the same year\'s leaves, with Other Income on the revenue side', () => {
    const html = renderAccountsPage('chart', {
      accountsReport, boardLayout: layout, canManageBoardCategories: true, canManagePurposeTags: true,
    });
    expect(html).toContain('Budget layout');
    expect(html).toMatch(/name="path_\d+" value="Other Income:48 Other:48010 Interest"><input type="hidden" name="side_\d+" value="revenue">/);
    expect(html).not.toContain('value="Income:40 Giving:40090 Easter Offering"');
  });
});

// The same finance_church_entries/finance_settings tables Connect's contract reads.
function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE finance_church_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fiscal_year INTEGER NOT NULL, period_month INTEGER NOT NULL DEFAULT 0,
    classification TEXT NOT NULL, category_path TEXT NOT NULL, account_name TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0, has_children INTEGER NOT NULL DEFAULT 0,
    own_actual_cents INTEGER NOT NULL DEFAULT 0, own_budget_cents INTEGER, account_qbo_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'qbo_sync', notes TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(fiscal_year, period_month, category_path, source));
    CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  sqlite.prepare(`INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, own_budget_cents)
    VALUES (2026, 'Income', 'Income:Offerings', 'Offerings', 5000000, 4800000),
           (2025, 'Income', 'Income:Offerings', 'Offerings', 4000000, NULL),
           (2025, 'Other Income', 'Other Income:Interest', 'Interest', 7000, NULL)`).run();
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql) };
}

describe('Chart of Accounts read from Finance\'s own database', () => {
  it('passes ?fiscal_year= through the local read and the resolver', async () => {
    const calls = [];
    const env = withLocalContractReads({
      FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: makeFinanceDb(), FINANCE_CONTRACT_API_KEY: 'key',
      CONNECT_SERVICE: { async fetch(request) { calls.push(request.url); return new Response('{}', { status: 503 }); } },
    });
    const result = await fetchLiveFinanceChartOfAccounts(env, 2025);
    expect(result.ok).toBe(true);
    expect(result.chartOfAccounts.fiscalYear).toBe(2025);
    expect(result.chartOfAccounts.accounts.map((a) => [a.categoryPath, a.actualCents])).toEqual([
      ['Income:Offerings', 4000000], ['Other Income:Interest', 7000],
    ]);
    const report = await resolveAccountsReport(env, null, { fiscalYear: 2026 });
    expect(report).toMatchObject({ source: 'live', fiscalYear: 2026, availableFiscalYears: [2026, 2025] });
    expect(report.rows).toEqual([expect.objectContaining({ category_path: 'Income:Offerings', actual_cents: 5000000, budget_cents: 4800000 })]);
    expect(calls).toEqual([]);
  });
});
