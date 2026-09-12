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
        if (batchStatements[0].sql.includes('finance_property_budget_monthly')) return [{ results: Array.from({ length: 12 }, (_, index) => ({
          property_key: 'synthetic-property', period: `2027-${String(index + 1).padStart(2, '0')}`,
          revenue_cents: 2200000, expenses_cents: 1300000, net_income_cents: 900000, source: 'synthetic_fixture',
        })) }];
        if (batchStatements[0].sql.includes('finance_property_distributions')) return [{ results: [
          { period: '2026-01', amount_cents: 500000 },
        ] }];
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
        if (batchStatements[0].sql.includes('finance_compensation_benefit_components')) return [{ results: [
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', component_key: 'pension', component_label: 'Pension', amount_cents: 400000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', component_key: 'health', component_label: 'Group health plan', amount_cents: 600000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', component_key: 'disability', component_label: 'Disability', amount_cents: 100000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', component_key: 'employer_taxes', component_label: 'Employer taxes', amount_cents: 100000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', component_key: 'pension', component_label: 'Pension', amount_cents: 300000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', component_key: 'health', component_label: 'Group health plan', amount_cents: 400000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', component_key: 'disability', component_label: 'Disability', amount_cents: 50000, source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', component_key: 'employer_taxes', component_label: 'Employer taxes', amount_cents: 150000, source_kind: 'synthetic_fixture' },
        ] }];
        if (batchStatements[0].sql.includes('finance_compensation_benchmarks')) return [{ results: [
          { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', benchmark_salary_cents: 6250000, source_label: 'Synthetic district-style benchmark', source_kind: 'synthetic_fixture' },
          { fiscal_year: 2027, role_label: 'Synthetic Operations Role', benchmark_salary_cents: 4750000, source_label: 'Synthetic district-style benchmark', source_kind: 'synthetic_fixture' },
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
    expect(FINANCE_VERSION).toBe('1.0.0-alpha.41');
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
    for (const forbidden of ['kv_namespaces', 'r2_buckets', 'queues', 'triggers']) {
      expect(config[forbidden], `${forbidden} must not exist in the alpha shell`).toBeUndefined();
    }
    // 'services' is deliberately no longer in the forbidden list above: the two bindings this
    // config carries are each an intentional, narrow real connection -- CONNECT_SERVICE for
    // connect.giving-summary.v1 (see connect-giving-client.js), PAYROLL_SERVICE for Website's
    // existing payroll proxy (see payroll-proxy-client.js). Pin exactly these two, at exactly
    // these two Workers -- CONNECT_SERVICE at Connect's STAGING Worker, PAYROLL_SERVICE at
    // Website's PRODUCTION admin Worker (tlc-newsletter-admin has no staging counterpart) --
    // so a future addition of some other outbound service still fails this test.
    expect(config.services).toEqual([
      { binding: 'CONNECT_SERVICE', service: 'timothy-connect-staging' },
      { binding: 'PAYROLL_SERVICE', service: 'tlc-newsletter-admin' },
    ]);
  });

  it('reports non-sensitive release identity from health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/health'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      product: 'finance',
      environment: 'staging',
      version: '1.0.0-alpha.41',
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
    expect(html).toContain('1.0.0-alpha.41 · alpha');
    expect(html).toContain('Timothy Lutheran Church');
    expect(html).toContain('Finance workspace');
    expect(html).toContain('class="sidebar-brand"');
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
    expect(html).toContain('class="sidebar-brand"');
    expect(html).toContain('Are we okay?');
    expect(html).toContain("Source data hasn't been reviewed in over 30 days");
    expect(statements).toHaveLength(10);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders the familiar Finance navigation grouped by sidebar section and safely falls back to Financial Health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=missing'), env);
    const html = await res.text();
    // Financial Health kept its flat single-page link (only Dashboard/Payroll/Board packet do);
    // every other former flat-tab section is now a page picker under its own group label.
    expect(html).toContain('Financial Health');
    expect(html).toContain('Data & Imports');
    for (const group of [
      'Dashboard', 'Gift Entry', 'Giving', 'Charts', 'Church', 'Balance Sheet', 'Daycare',
      'Commercial Property', 'Planning', 'Compensation', 'Payroll', 'QuickBooks', 'Board packet',
      'Accounts &amp; Data',
    ]) {
      expect(html).toContain(`class="nav-group-label">${group}<`);
    }
    // A representative page link from each of those groups actually renders under it.
    for (const pageLabel of [
      'Overview', 'Income &amp; expense detail', 'Position', 'Actuals detail', 'Rent roll',
      'Budget builder', 'Plan', 'Sync status', 'Chart of accounts',
    ]) expect(html).toContain(pageLabel);
    expect(html).toContain('href="/?section=health" aria-current="page"');
    expect(html).toContain('Synthetic financial health');
  });

  it('offers a clearly-labeled, non-authoritative council-view preview that hides write forms', async () => {
    const off = await (await worker.fetch(new Request('https://finance.test/?section=giving'), env)).text();
    expect(off).not.toContain('class="council-preview"');
    expect(off).toContain('Not a real access boundary yet');
    expect(off).toContain('href="/?section=giving&amp;page=quick-entry&amp;council=1"');
    expect(off).toContain('<form method="POST" action="/api/v1/connect-giving-quick-entry">');

    const on = await (await worker.fetch(new Request('https://finance.test/?section=giving&council=1'), env)).text();
    expect(on).toContain('<body class="council-preview">');
    expect(on).toContain('Previewing what a view-only council/auditor login would see');
    expect(on).toContain('Editing controls are hidden');
    expect(on).toContain('Exit preview');
    // The form itself still renders (its fields are real content); council-preview.css hides it.
    expect(on).toContain('body.council-preview form[method="POST"] { display:none; }');
  });

  it('discloses that role verification is unconfigured/unreachable rather than pretending to enforce it', async () => {
    const html = await (await worker.fetch(new Request('https://finance.test/?section=health'), env)).text();
    expect(html).toContain('Role verification unavailable in this environment (reason: not_configured)');
  });

  function envWithRoleService(fetchImpl) {
    return { ...env, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
  }

  it('restricts a verified compensation-role identity to the Compensation section, denying everything else', async () => {
    const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role: 'compensation' }), { status: 200 }));
    const req = (url) => new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } });

    const denied = await worker.fetch(req('https://finance.test/?section=health'), roleEnv);
    expect(denied.status).toBe(403);
    const deniedHtml = await denied.text();
    expect(deniedHtml).toContain('Access denied');
    // Bounced toward a section it CAN see, not back into another denial.
    expect(deniedHtml).toContain('href="/?section=compensation"');

    const allowed = await worker.fetch(req('https://finance.test/?section=compensation'), roleEnv);
    expect(allowed.status).toBe(200);
    const allowedHtml = await allowed.text();
    expect(allowedHtml).toContain('Verified via Connect as role “compensation” -- restricted to the Compensation Planner section only.');
  });

  it('denies member and volunteer roles every Finance section', async () => {
    for (const role of ['member', 'volunteer']) {
      const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role }), { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status, role).toBe(403);
    }
  });

  it('leaves admin/finance/staff/council unrestricted and discloses the verified role', async () => {
    for (const role of ['admin', 'finance', 'staff', 'council']) {
      const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role }), { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status, role).toBe(200);
      const html = await res.text();
      expect(html, role).toContain(`Verified via Connect as role “${role}”.`);
    }
  });

  it('renders a synthetic Church Report overview, its sub-pages, and a separate read budget', async () => {
    statements.length = 0;
    const overview = await worker.fetch(new Request('https://finance.test/?section=church'), env);
    const overviewHtml = await overview.text();
    expect(overview.status).toBe(200);
    expect(overviewHtml).toContain('Synthetic Church Report');
    expect(overviewHtml).toContain('Fiscal year 2026');
    expect(overviewHtml).toContain('$120,000');
    expect(overviewHtml).toContain('$80,000');
    expect(statements).toHaveLength(6);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);

    statements.length = 0;
    const detailHtml = await (await worker.fetch(new Request('https://finance.test/?section=church&page=income-expense'), env)).text();
    expect(detailHtml).toContain('Income &amp; expense detail');
    expect(detailHtml).toContain('Synthetic Contributions');
    expect(detailHtml).toContain('Synthetic Programs');
    expect(detailHtml).toContain('Favorable variance');
    expect(statements).toHaveLength(6);

    const trendHtml = await (await worker.fetch(new Request('https://finance.test/?section=church&page=trend'), env)).text();
    expect(trendHtml).toContain('Multi-year operating trend');
    expect(trendHtml).toContain('$110,000');

    const budgetActualHtml = await (await worker.fetch(new Request('https://finance.test/?section=church&page=budget-actual'), env)).text();
    expect(budgetActualHtml).toContain('Budget vs actual');
    expect(budgetActualHtml).toContain('Favorable');
  });

  it('renders the board packet from the same real inputs as Church Report', async () => {
    const html = await (await worker.fetch(new Request('https://finance.test/?section=packet'), env)).text();
    expect(html).toContain('Board packet');
    expect(html).toContain('Decision-ready FY2026 summary');
    expect(html).toContain('Reconciled');
    expect(html).toContain('FY2025 to FY2026');
    expect(html).toContain('Prepared from the same bounded synthetic reads shown across Church Report, Balance Sheet, and Giving Entry');
    expect(html).toContain('$40,000');
    expect(html).toContain('$200,000');
    expect(html).toContain('$1,450');
    expect(html).toContain('Not saved');
  });

  it('renders a synthetic Balance Sheet position, its sub-pages, and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=balance'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Balance Sheet');
    expect(html).toContain('Financial position as of 2026-12-31');
    expect(html).toContain('$300,000');
    expect(html).toContain('$100,000');
    expect(html).toContain('$200,000');
    expect(html).toContain('Equation difference $0');
    expect(statements).toHaveLength(2);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);

    const detailHtml = await (await worker.fetch(new Request('https://finance.test/?section=balance&page=account-detail'), env)).text();
    expect(detailHtml).toContain('Account detail');
    expect(detailHtml).toContain('Synthetic Cash');
    expect(detailHtml).toContain('Synthetic Note');
    expect(detailHtml).toContain('Synthetic Net Assets');

    const trendHtml = await (await worker.fetch(new Request('https://finance.test/?section=balance&page=multi-year'), env)).text();
    expect(trendHtml).toContain('Multi-year financial position');
    expect(trendHtml).toContain('$270,000');
    expect(trendHtml).toContain('$110,000');
    expect(trendHtml).toContain('$160,000');
  });

  it('renders a synthetic Daycare Report overview, its sub-pages, and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Daycare Report');
    expect(html).toContain('Operating report for 2026-01');
    expect(html).toContain('$40,000');
    expect(html).toContain('$33,500');
    expect(html).toContain('$6,500');
    expect(html).toContain('Budget $16,000 · variance −$9,500');
    expect(statements).toHaveLength(3);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);

    const actualsHtml = await (await worker.fetch(new Request('https://finance.test/?section=daycare&page=actuals'), env)).text();
    expect(actualsHtml).toContain('Actuals detail');
    expect(actualsHtml).toContain('Synthetic Tuition');
    expect(actualsHtml).toContain('Synthetic Labor');

    const comparisonHtml = await (await worker.fetch(new Request('https://finance.test/?section=daycare&page=budget-comparison'), env)).text();
    expect(comparisonHtml).toContain('Budget comparison');

    const sharedCostsHtml = await (await worker.fetch(new Request('https://finance.test/?section=daycare&page=shared-costs'), env)).text();
    expect(sharedCostsHtml).toContain('Utilities and insurance allocation');
    expect(sharedCostsHtml).toContain('50% utilities · 50% insurance');
    expect(sharedCostsHtml).toContain('Daycare share $6,000');
    expect(sharedCostsHtml).toContain('Daycare share $2,500');
  });

  it('renders a synthetic Commercial Property overview, its live sub-pages, and its own read budget', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=property'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Commercial Property overview');
    expect(html).toContain('Property performance through 2026-01');
    expect(html).toContain('Average occupancy 90%');
    expect(html).toContain('$20,000');
    expect(html).toContain('$12,000');
    expect(html).toContain('$8,000');
    expect(html).toContain('Available for distribution $5,000');
    expect(html).toContain('Reserve balance $25,000');
    expect(statements).toHaveLength(9);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);

    const operatingHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=operating-results'), env)).text();
    expect(operatingHtml).toContain('Operating results');

    const rentRollHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=rent-roll'), env)).text();
    expect(rentRollHtml).toContain('Rent roll');
    expect(rentRollHtml).toContain('Synthetic Unit A');
    expect(rentRollHtml).toContain('$24,000');
    expect(rentRollHtml).toContain('$36,000');

    const workOrdersHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=work-orders'), env)).text();
    expect(workOrdersHtml).toContain('Repairs & maintenance ledger');
    expect(workOrdersHtml).toContain('Synthetic repair item');
    expect(workOrdersHtml).toContain('$250');
    expect(workOrdersHtml).toContain('no work-order number or open/closed status');

    const reserveHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=reserve-distribution'), env)).text();
    expect(reserveHtml).toContain('Monthly reserve schedule');
    expect(reserveHtml).toContain('58.3% funded');
    expect(reserveHtml).toContain('$60,000');
    expect(reserveHtml).toContain('$35,000');
    expect(reserveHtml).toContain('Distribution history');
    expect(reserveHtml).toContain('$5,000');

    const capitalHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=capital'), env)).text();
    expect(capitalHtml).toContain('Capital improvements');
    expect(capitalHtml).toContain('Synthetic Project');
    expect(capitalHtml).toContain('$1,000');

    const valuationHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=valuation'), env)).text();
    expect(valuationHtml).toContain('Income approach');
    expect(valuationHtml).toContain('8.0% cap rate');
    expect(valuationHtml).toContain('$28,938');
    expect(valuationHtml).toContain('$361,725');
    expect(valuationHtml).toContain('Income and cost walk reconciles');

    const forecastHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=forecast'), env)).text();
    expect(forecastHtml).toContain('Run-rate forecast');
    expect(forecastHtml).toContain('Fiscal year 2027 monthly plan');
    expect(forecastHtml).toContain('12 months · reconciled');
    expect(forecastHtml).toContain('$264,000');
    expect(forecastHtml).toContain('$156,000');
    expect(forecastHtml).toContain('$108,000');
    expect(forecastHtml).toContain('2027-01');
    expect(forecastHtml).toContain('2027-12');
    expect(forecastHtml).toContain('Read-only synthetic plan');

    const distributionsHtml = await (await worker.fetch(new Request('https://finance.test/?section=property&page=distributions'), env)).text();
    expect(distributionsHtml).toContain('Distributions');
    expect(distributionsHtml).toContain('$5,000');
    expect(distributionsHtml).toContain('2026-01');
  });

  it('renders honestly-labeled "not yet available" pages for the Commercial Property gaps', async () => {
    for (const [pageId, phrase] of [
      ['receivables', 'no tenant-receivable'],
      ['bank-rec', 'no balance sheet or bank account'],
      ['debt', 'loan-payment and interest-expense columns'],
      ['acquisition', 'no purchase-price or pro-forma'],
    ]) {
      const html = await (await worker.fetch(new Request(`https://finance.test/?section=property&page=${pageId}`), env)).text();
      expect(html).toContain('Not yet available');
      expect(html).toContain(phrase);
    }
  });

  it('renders a reconciled synthetic Budget outlook with base and growth assumptions', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=planning'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic Budget Report');
    expect(html).toContain('Budget builder');
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
    expect(html).toContain('Ledger hierarchy');
    expect(html).toContain('Account tree');
    expect(html).toContain('Paths preserved');
    expect(html).toContain('padding-left:1.95rem');
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

  it('renders a synthetic role-level Compensation plan, its sub-pages, and its own read budget', async () => {
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
    expect(statements).toHaveLength(3);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);

    const councilHtml = await (await worker.fetch(new Request('https://finance.test/?section=compensation&page=council'), env)).text();
    expect(councilHtml).toContain('Council review snapshot');
    expect(councilHtml).toContain('Plan-level decision context');
    expect(councilHtml).toContain('Role-only · review-only · not approved');
    expect(councilHtml).toContain('Benefits share');
    expect(councilHtml).toContain('16.7%');
    expect(councilHtml).toContain('Weighted adjustment');
    expect(councilHtml).toContain('3.0%');

    const benchmarkHtml = await (await worker.fetch(new Request('https://finance.test/?section=compensation&page=benchmarks'), env)).text();
    expect(benchmarkHtml).toContain('Benchmark comparison');
    expect(benchmarkHtml).toContain('Synthetic · not published guidance');
    expect(benchmarkHtml).toContain('$110,000');
    expect(benchmarkHtml).toContain('95.5% of benchmark');
    expect(benchmarkHtml).toContain('$5,000');
    expect(benchmarkHtml).toContain('Salary only · alternative, not the plan');

    const benefitsHtml = await (await worker.fetch(new Request('https://finance.test/?section=compensation&page=benefits'), env)).text();
    expect(benefitsHtml).toContain('Benefits &amp; taxes');
    expect(benefitsHtml).toContain('What the benefits plan contains');
    expect(benefitsHtml).toContain('Group health plan');
    expect(benefitsHtml).toContain('$10,000');
    expect(benefitsHtml).toContain('47.6%');
    expect(benefitsHtml).toContain('must exactly match the benefits plan');
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
    expect(FINANCE_QUERY_BUDGETS).toEqual({ summary: 4, churchReport: 1, churchTrends: 1, balanceSheet: 1, balanceTrends: 1, daycareReport: 1, daycareAllocation: 2, propertyReport: 1, propertyReserves: 1, propertyLedgers: 2, propertyValuation: 3, propertyForecast: 1, budgetReport: 1, accountsReport: 1, dataStatus: 1, compensationReport: 1, compensationBenchmark: 1, compensationBenefits: 1, cashRunway: 2, propertyDistributions: 1 });
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
        product: 'finance', environment: 'staging', version: '1.0.0-alpha.41',
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

  it('falls back to the validated static Connect Giving fixture when the live endpoint is not configured', async () => {
    // This env (see the top of the file) has no CONNECT_SERVICE binding and no
    // FINANCE_CONTRACT_API_KEY -- the real, intended state until both are deliberately
    // provisioned -- so the live attempt short-circuits to not_configured and this falls back,
    // exactly as it did before the live connect-giving-client.js existed.
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('connect.giving-summary.v1');
    expect(res.headers.get('x-giving-source')).toBe('synthetic-fallback');
    const body = await res.json();
    expect(body.contract).toBe('connect.giving-summary.v1');
    expect(body.dataClassification).toBe('aggregate');
    expect(body.totals).toEqual({ grossCents: 150000, refundCents: 5000, netCents: 145000 });
    expect(body.reconciliation).toEqual({ sourceRecordCount: 6, fundCount: 2, totalsMatch: true });
    expect(statements).toHaveLength(0);
  });

  it('serves the real live summary instead once the service binding and shared secret are configured', async () => {
    const liveEnv = {
      ...env,
      CONNECT_SERVICE: {
        async fetch() {
          return new Response(JSON.stringify({
            contract: 'connect.giving-summary.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            period: { startDate: '2026-06-01', endDate: '2026-06-14' },
            generatedAt: '2026-06-15T00:00:00Z', sourceThrough: '2026-06-14T23:59:59Z',
            funds: [{ fundRef: '9', fundLabel: 'Live Test Fund', giftCount: 1, householdCount: 1,
              amounts: { grossCents: 500000, refundCents: 0, netCents: 500000 } }],
            totals: { grossCents: 500000, refundCents: 0, netCents: 500000 },
            reconciliation: { sourceRecordCount: 1, fundCount: 1, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), liveEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-giving-source')).toBe('live');
    const body = await res.json();
    expect(body.totals).toEqual({ grossCents: 500000, refundCents: 0, netCents: 500000 });
    expect(body.funds[0].fundLabel).toBe('Live Test Fund');

    // The Financial Health section renders from the same resolver and says so.
    const shellRes = await worker.fetch(new Request('https://finance.test/?section=health'), liveEnv);
    const html = await shellRes.text();
    expect(html).toContain('live from Connect');
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
      release: { version: '1.0.0-alpha.41', releaseSha: 'test-sha' },
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
