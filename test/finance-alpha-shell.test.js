import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../apps/finance/shell.js';
import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from '../apps/finance/version.js';
import { FINANCE_QUERY_BUDGETS, runBudgetedReadBatch } from '../apps/finance/query-budget.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wrangler.finance.staging.jsonc'), 'utf8'));
const summarySchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/finance/contracts/summary-v1.schema.json'), 'utf8'));
const statements = [];
const env = {
  ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha',
  FINANCE_DB: {
    prepare(sql) { statements.push(sql); return { sql }; },
    async batch(batchStatements) {
      if (batchStatements.length === 2 && batchStatements[0].sql.includes('operating_cash_cents')) return [
        { results: [{ fiscal_year: 2026, as_of_date: '2026-12-31', account_name: 'Synthetic Cash', operating_cash_cents: 30000000 }] },
        { results: [{ fiscal_year: 2026, annual_expense_cents: 8000000 }] },
      ];
      if (batchStatements.length === 3 && batchStatements[0].sql.includes('finance_property_valuation_assumptions')) return [
        { results: [{ property_key: 'synthetic-property', utility_reimbursement_cents: 600000, vacancy_rate_pct: 0.05, management_fee_pct: 0.06, cap_rate: 0.08 }] },
        { results: [
          { unit_key: 'unit-a', tenant_label: 'Synthetic Unit A', square_feet: 1200, annual_rent_cents: 2400000 },
          { unit_key: 'unit-b', tenant_label: 'Synthetic Unit B', square_feet: 1800, annual_rent_cents: 3600000 },
        ] },
        { results: [
          { cost_key: 'insurance', cost_label: 'Insurance', annual_cost_cents: 400000 },
          { cost_key: 'maintenance_repairs', cost_label: 'Maintenance and repairs', annual_cost_cents: 600000 },
          { cost_key: 'taxes', cost_label: 'Property taxes', annual_cost_cents: 800000 },
          { cost_key: 'utilities', cost_label: 'Utilities', annual_cost_cents: 1200000 },
        ] },
      ];
      if (batchStatements.length === 2 && batchStatements[0].sql.includes('finance_property_capital_ledger')) return [
        { results: [{ entry_date: '2026-01-15', amount_cents: 100000, payee: 'Synthetic Vendor', description: 'Synthetic capital project', project: 'Synthetic Project' }] },
        { results: [{ entry_date: '2026-01-20', category: 'Synthetic repair', description: 'Synthetic repair item', amount_cents: 25000, payee: 'Synthetic Vendor', capitalized: 0 }] },
      ];
      if (batchStatements.length === 2 && batchStatements[0].sql.includes('daycare_utility_pct')) return [
        { results: [{ key: 'daycare_insurance_pct', value: '0.5' }, { key: 'daycare_utility_pct', value: '0.5' }] },
        { results: [{ account_name: 'Synthetic Insurance', own_actual_cents: 500000 }, { account_name: 'Synthetic Utilities', own_actual_cents: 1200000 }] },
      ];
      if (batchStatements.length === 1) {
        if (batchStatements[0].sql.includes('finance_property_reserves')) return [{ results: [
          { reserve_key: 'property_tax', report_month: '2026-01', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2000000, contribution_cents: 500000, reserve_after_cents: 2500000, note: 'Synthetic fixture' },
          { reserve_key: 'property_tax', report_month: '2026-02', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 2500000, contribution_cents: 500000, reserve_after_cents: 3000000, note: 'Synthetic monthly contribution' },
          { reserve_key: 'property_tax', report_month: '2026-03', tax_year: 2026, target_estimate_cents: 6000000, reserve_before_cents: 3000000, contribution_cents: 500000, reserve_after_cents: 3500000, note: 'Synthetic monthly contribution' },
        ] }];
        if (batchStatements[0].sql.includes('finance_church_balances') && batchStatements[0].sql.includes('GROUP BY fiscal_year')) return [{ results: [
          { fiscal_year: 2025, as_of_date: '2025-12-31', assets_cents: 27000000, liabilities_cents: 11000000, equity_cents: 16000000 },
          { fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
        ] }];
        if (batchStatements[0].sql.includes('finance_church_entries') && batchStatements[0].sql.includes('GROUP BY fiscal_year')) return [{ results: [
          { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000 },
          { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000 },
        ] }];
        if (batchStatements[0].sql.includes('finance_compensation_plan')) return [{ results: [
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', salary_cents: 6000000, benefits_cents: 1200000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', salary_cents: 4500000, benefits_cents: 900000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
        ] }];
        if (batchStatements[0].sql.includes('finance_import_log')) return [{ results: [
          { importer_key: 'synthetic_fixture', last_imported_at: '2026-01-01T00:00:00Z', note: 'Synthetic fixture only' },
        ] }];
        if (batchStatements[0].sql.includes('category_path')) return [{ results: [
          { classification: 'Expenses', category_path: 'Expenses:Synthetic Programs', account_name: 'Synthetic Programs', board_category_key: 'programs', board_category_label: 'Programs', purpose_tag_id: 'ministry', purpose_tag_label: 'Ministry' },
          { classification: 'Income', category_path: 'Income:Synthetic Contributions', account_name: 'Synthetic Contributions', board_category_key: 'donor', board_category_label: 'Unrestricted Gifts', purpose_tag_id: 'ministry', purpose_tag_label: 'Ministry' },
        ] }];
        if (batchStatements[0].sql.includes('finance_budget_plan')) return [{ results: [
          { category: 'Synthetic Contributions', classification: 'Income', fiscal_year: 2027, base_amount_cents: 12000000, growth_pct: 0.10, planned_amount_cents: 13200000, basis: 'synthetic_fixture', notes: '10% synthetic growth assumption' },
          { category: 'Synthetic Programs', classification: 'Expenses', fiscal_year: 2027, base_amount_cents: 8000000, growth_pct: 0.125, planned_amount_cents: 9000000, basis: 'synthetic_fixture', notes: '12.5% synthetic growth assumption' },
        ] }];
        if (batchStatements[0].sql.includes('finance_property_monthly')) return [{ results: [
          { property_key: 'synthetic-property', period: '2026-01', occupancy_pct: 90, total_revenue_cents: 2000000, total_expenses_cents: 1200000, net_income_cents: 800000, net_operating_income_cents: 900000, available_for_distribution_cents: 500000, reserve_balance_cents: 2500000 },
        ] }];
        if (batchStatements[0].sql.includes('finance_daycare_entries')) return [{ results: [
          { period: '2026-01', category: 'Synthetic Tuition', entry_type: 'actual', amount_cents: 4000000 },
          { period: '2026-01', category: 'Synthetic Tuition', entry_type: 'budget', amount_cents: 4200000 },
          { period: '2026-01', category: 'Synthetic Labor', entry_type: 'actual', amount_cents: 2500000 },
          { period: '2026-01', category: 'Synthetic Labor', entry_type: 'budget', amount_cents: 2600000 },
        ] }];
        if (batchStatements[0].sql.includes('finance_church_balances')) return [{ results: [
          { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Assets', account_name: 'Synthetic Cash', own_balance_cents: 30000000 },
          { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Liabilities', account_name: 'Synthetic Note', own_balance_cents: 10000000 },
          { fiscal_year: 2026, as_of_date: '2026-12-31', classification: 'Equity', account_name: 'Synthetic Net Assets', own_balance_cents: 20000000 },
        ] }];
        return [{ results: [
          { fiscal_year: 2026, classification: 'Expenses', account_name: 'Synthetic Programs', own_actual_cents: 8000000, own_budget_cents: 8500000 },
          { fiscal_year: 2026, classification: 'Income', account_name: 'Synthetic Contributions', own_actual_cents: 12000000, own_budget_cents: 12500000 },
        ] }];
      }
      return [
        { results: [{ value: 'SYNTHETIC-NO-PRODUCTION-DATA' }] },
        { results: [{ actual_cents: 20000000, budget_cents: 21000000, income_actual_cents: 12000000, expense_actual_cents: 8000000, income_budget_cents: 12500000, expense_budget_cents: 8500000 }] },
        { results: [{ balance_cents: 60000000, assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 }] },
        { results: [{ room_count: 1, billed_cents: 4000000 }] },
      ];
    },
  },
};

describe('Finance 1.0.0 alpha staging shell', () => {
  it('uses intentional prerelease versioning', () => {
    expect(FINANCE_VERSION).toBe('1.0.0-alpha.34');
    expect(FINANCE_RELEASE_CHANNEL).toBe('alpha');
  });

  it('has a staging-only Worker name and no stateful or outbound bindings', () => {
    expect(config.name).toBe('timothy-finance-app-staging');
    expect(config.vars.ENVIRONMENT).toBe('staging');
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toEqual([
      { pattern: 'finance-staging.timothystl.org', custom_domain: true },
    ]);
    expect(config.d1_databases).toEqual([expect.objectContaining({
      binding: 'FINANCE_DB',
      database_name: 'timothy-finance-db-staging',
      migrations_dir: 'apps/finance/migrations',
    })]);
    const shell = fs.readFileSync(path.join(repoRoot, 'apps/finance/shell.js'), 'utf8');
    expect(shell).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i);
    expect(shell).not.toMatch(/\.run\(|\.exec\(/);
    for (const forbidden of ['kv_namespaces', 'r2_buckets', 'queues', 'services', 'triggers']) {
      expect(config[forbidden], `${forbidden} must not exist in the alpha shell`).toBeUndefined();
    }
  });

  it('reports non-sensitive release identity from health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/health'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      product: 'finance',
      environment: 'staging',
      version: '1.0.0-alpha.34',
      releaseChannel: 'alpha',
      releaseSha: 'test-sha',
    });
  });

  it('renders a clearly labeled shell with no production connection claim', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Timothy Finance');
    expect(html).toContain('no production writers attached');
    expect(html).toContain('1.0.0-alpha.34 · alpha');
    expect(html).toContain('Timothy Lutheran Church');
    expect(html).toContain('Finance workspace');
    expect(html).toContain('class="appbar"');
    expect(html).toContain('color-scheme: light');
    expect(html).toContain('--warm-meta');
    expect(html).toContain('How are we doing, and what should we decide?');
    expect(html).toContain('Operating result');
    expect(html).toContain('$40,000');
    expect(html).toContain('Assets $300,000 · liabilities $100,000');
    expect(html).toContain('$1,450');
    expect(html).toContain('6 aggregate records · totals match');
    expect(html).toContain('Full control');
    expect(html).toContain('Reported, not managed');
    expect(html).toContain('Timing decision');
    expect(html).toContain('Operating cash runway');
    expect(html).toContain('Average monthly expense');
    expect(html).toContain('$6,667');
    expect(html).toContain('45.0 months');
    expect(html).toContain('Where money comes from and goes');
    expect(html).toContain('Revenue mix');
    expect(html).toContain('Expense mix');
    expect(html).toContain('FY2026 · reconciled');
    expect(html).toContain('100.0%');
    expect(html).toContain('Entity overview');
    expect(html).toContain('Separate operating views');
    expect(html).toContain('Not consolidated');
    expect(html).toContain('Church · FY2026');
    expect(html).toContain('Daycare · 2026-01');
    expect(html).toContain('Commercial Property · 2026-01');
    expect(html).toContain('their results are not added together');
    expect(html).toContain('Money flow');
    expect(html).toContain('FY2026 Church operating bridge');
    expect(html).toContain('1 · Income');
    expect(html).toContain('2 · Expenses');
    expect(html).toContain('3 · Surplus');
    expect(html).toContain('not donor-to-expense tracing');
    expect(html).toContain('validated locally with no network call');
    expect(html).toContain('deterministic synthetic staging fixtures');
    expect(statements).toHaveLength(9);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders the familiar Finance navigation and safely falls back to Financial Health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=missing'), env);
    const html = await res.text();
    for (const label of [
      'Financial Health', 'Church Report', 'Balance Sheet', 'Daycare Report',
      'Commercial Property', 'Budget', 'Chart of Accounts', 'Compensation', 'Data & Imports',
    ]) expect(html).toContain(label);
    expect(html).toContain('href="/?section=health" aria-current="page"');
    expect(html).toContain('Synthetic financial health');
  });

  it('renders a synthetic Church Report with account detail and a separate read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=church'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Church Report');
    expect(html).toContain('Fiscal year 2026');
    expect(html).toContain('Synthetic Contributions');
    expect(html).toContain('Synthetic Programs');
    expect(html).toContain('Favorable variance');
    expect(html).toContain('$120,000');
    expect(html).toContain('$80,000');
    expect(html).toContain('Multi-year operating trend');
    expect(html).toContain('$110,000');
    expect(html).toContain('Board packet snapshot');
    expect(html).toContain('Decision-ready FY2026 summary');
    expect(html).toContain('Reconciled');
    expect(html).toContain('FY2025 to FY2026');
    expect(html).toContain('Prepared from the same bounded synthetic reads shown above');
    expect(html).toContain('$78,000');
    expect(html).toContain('$32,000');
    expect(statements).toHaveLength(6);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders a synthetic Balance Sheet with equation reconciliation and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=balance'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Balance Sheet');
    expect(html).toContain('Financial position as of 2026-12-31');
    expect(html).toContain('Synthetic Cash');
    expect(html).toContain('Synthetic Note');
    expect(html).toContain('Synthetic Net Assets');
    expect(html).toContain('$300,000');
    expect(html).toContain('$100,000');
    expect(html).toContain('$200,000');
    expect(html).toContain('Equation difference $0');
    expect(html).toContain('Multi-year financial position');
    expect(html).toContain('$270,000');
    expect(html).toContain('$110,000');
    expect(html).toContain('$160,000');
    expect(statements).toHaveLength(2);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders a synthetic Daycare Report with operating result and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Daycare Report');
    expect(html).toContain('Operating report for 2026-01');
    expect(html).toContain('Synthetic Tuition');
    expect(html).toContain('Synthetic Labor');
    expect(html).toContain('$40,000');
    expect(html).toContain('$33,500');
    expect(html).toContain('$6,500');
    expect(html).toContain('Budget $16,000 · variance −$9,500');
    expect(html).toContain('Utilities and insurance allocation');
    expect(html).toContain('50% utilities · 50% insurance');
    expect(html).toContain('Daycare share $6,000');
    expect(html).toContain('Daycare share $2,500');
    expect(statements).toHaveLength(3);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders a synthetic Commercial Property report with monthly performance and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=property'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Commercial Property Report');
    expect(html).toContain('Property performance through 2026-01');
    expect(html).toContain('Average occupancy 90%');
    expect(html).toContain('$20,000');
    expect(html).toContain('$12,000');
    expect(html).toContain('$8,000');
    expect(html).toContain('Available for distribution $5,000');
    expect(html).toContain('Reserve balance $25,000');
    expect(html).toContain('Monthly reserve schedule');
    expect(html).toContain('58.3% funded');
    expect(html).toContain('$60,000');
    expect(html).toContain('$35,000');
    expect(html).toContain('Capital and repairs ledgers');
    expect(html).toContain('Synthetic Project');
    expect(html).toContain('Synthetic repair item');
    expect(html).toContain('$1,000');
    expect(html).toContain('$250');
    expect(html).toContain('Income approach');
    expect(html).toContain('8.0% cap rate');
    expect(html).toContain('Synthetic Unit A');
    expect(html).toContain('$62,700');
    expect(html).toContain('$28,938');
    expect(html).toContain('$361,725');
    expect(html).toContain('Income and cost walk reconciles · read-only');
    expect(statements).toHaveLength(7);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders a reconciled synthetic Budget outlook with base and growth assumptions', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=planning'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Budget Report');
    expect(html).toContain('Budget outlook');
    expect(html).toContain('Plan for fiscal year 2027');
    expect(html).toContain('Synthetic Contributions');
    expect(html).toContain('Synthetic Programs');
    expect(html).toContain('Base result');
    expect(html).toContain('$40,000');
    expect(html).toContain('Planned result');
    expect(html).toContain('$42,000');
    expect(html).toContain('Outlook change');
    expect(html).toContain('$2,000');
    expect(html).toContain('10.0%');
    expect(html).toContain('12.5%');
    expect(html).toContain('$132,000');
    expect(html).toContain('$90,000');
    expect(html).toContain('Planned totals reconcile · read-only preview');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('renders Finance-owned board-category and purpose-tag presentation with its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Chart of Accounts');
    expect(html).toContain('Account presentation');
    expect(html).toContain('Total accounts');
    expect(html).toContain('Synthetic Contributions');
    expect(html).toContain('Income:Synthetic Contributions');
    expect(html).toContain('Synthetic Programs');
    expect(html).toContain('Board categories');
    expect(html).toContain('Unrestricted Gifts');
    expect(html).toContain('Purpose tags');
    expect(html).toContain('Ministry');
    expect(html).toContain('Presentation only; ledger paths unchanged');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('renders synthetic Data and Imports provenance with its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=data'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Data and Imports Status');
    expect(html).toContain('Source and isolation status');
    expect(html).toContain('synthetic_fixture');
    expect(html).toContain('Synthetic fixture only');
    expect(html).toContain('Production connection');
    expect(html.match(/Disconnected/g)).toHaveLength(2);
    expect(html).toContain('2026-01-01T00:00:00Z');
    expect(html).toContain('Review before relying on this fixture');
    expect(html).toContain('>stale<');
    expect(html).toContain('Policy window 30 days');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('renders a synthetic role-level Compensation report with its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=compensation'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Compensation Report');
    expect(html).toContain('Role-level plan for fiscal year 2027');
    expect(html).toContain('Synthetic Ministry Role');
    expect(html).toContain('Synthetic Operations Role');
    expect(html).toContain('$105,000');
    expect(html).toContain('$21,000');
    expect(html).toContain('$126,000');
    expect(html).toContain('No personal identities');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('serves only synthetic read-only summary data', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/summary'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dataClassification).toBe('synthetic');
    expect(body.summary.church.actual_cents).toBe(20000000);
    expect(statements).toHaveLength(4);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('enforces the named summary query budget and read-only statements', async () => {
    expect(FINANCE_QUERY_BUDGETS).toEqual({ summary: 4, churchReport: 1, churchTrends: 1, balanceSheet: 1, balanceTrends: 1, daycareReport: 1, daycareAllocation: 2, propertyReport: 1, propertyReserves: 1, propertyLedgers: 2, propertyValuation: 3, budgetReport: 1, accountsReport: 1, dataStatus: 1, compensationReport: 1, cashRunway: 2 });
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'summary', [
      'SELECT 1', 'SELECT 2', 'SELECT 3', 'SELECT 4', 'SELECT 5',
    ])).rejects.toThrow('Finance query budget exceeded: summary');
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'summary', [
      'UPDATE finance_settings SET value=value',
    ])).rejects.toThrow('Finance query budget permits SELECT statements only: summary');
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'missing', [])).rejects.toThrow(
      'Unknown Finance query budget: missing',
    );
  });

  it('publishes a stable versioned summary contract', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/summary'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('finance.summary.v1');
    expect(await res.json()).toEqual({
      contract: 'finance.summary.v1',
      dataClassification: 'synthetic',
      release: {
        product: 'finance', environment: 'staging', version: '1.0.0-alpha.34',
        releaseChannel: 'alpha', releaseSha: 'test-sha',
      },
      summary: {
        church: { actualCents: 20000000, budgetCents: 21000000 },
        balanceSheet: { balanceCents: 60000000 },
        childcare: { roomCount: 1, billedCents: 4000000 },
      },
    });
    expect(statements).toHaveLength(4);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
    expect(summarySchema.$id).toBe('urn:timothy:finance:summary:v1');
    expect(summarySchema.properties.contract.const).toBe('finance.summary.v1');
    expect(summarySchema.additionalProperties).toBe(false);
  });

  it('keeps the alpha compatibility alias visibly deprecated', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/summary'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('link')).toBe('</api/v1/summary>; rel="successor-version"');
  });

  it('serves the validated static Connect Giving fixture without querying D1 or calling outbound', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('connect.giving-summary.v1');
    const body = await res.json();
    expect(body.contract).toBe('connect.giving-summary.v1');
    expect(body.dataClassification).toBe('aggregate');
    expect(body.totals).toEqual({ grossCents: 150000, refundCents: 5000, netCents: 145000 });
    expect(body.reconciliation).toEqual({ sourceRecordCount: 6, fundCount: 2, totalsMatch: true });
    expect(statements).toHaveLength(0);

    const shell = fs.readFileSync(path.join(repoRoot, 'apps/finance/shell.js'), 'utf8');
    expect(shell).not.toMatch(/await\s+fetch\s*\(|globalThis\.fetch|env\.[A-Za-z0-9_]+\.fetch\s*\(/);
  });

  it('serves read-only synthetic transport and reconciliation evidence without querying D1', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-transport-evidence'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('finance.connect-giving-transport-evidence.v1');
    const body = await res.json();
    expect(body).toMatchObject({
      contract: 'finance.connect-giving-transport-evidence.v1',
      dataClassification: 'synthetic',
      scenario: { status: 'accepted', attemptsUsed: 2, maxAttempts: 3, receiptAction: 'record_once' },
      duplicateReplay: { status: 'duplicate_ignored', attemptsUsed: 0, receiptAction: 'retain_existing' },
      release: { version: '1.0.0-alpha.34', releaseSha: 'test-sha' },
    });
    expect(body.scenario.totals.netCents).toBe(145000);
    expect(body.scenario.reconciliation.totalsMatch).toBe(true);
    expect(statements).toHaveLength(0);
  });

  it('ships restrictive response headers and rejects writes', async () => {
    const get = await worker.fetch(new Request('https://finance.test/'), env);
    expect(get.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(get.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const post = await worker.fetch(new Request('https://finance.test/', { method: 'POST' }), env);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
