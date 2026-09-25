import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
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

describe('Finance alpha staging shell', () => {
  it('uses intentional prerelease versioning', () => {
    expect(FINANCE_VERSION).toBe('0.1.0-alpha.1');
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
      version: FINANCE_VERSION,
      releaseChannel: 'alpha',
      releaseSha: 'test-sha',
    });
  });

  it('labels an authenticated production workspace accurately', async () => {
    const productionEnv={...env,ENVIRONMENT:'production',FINANCE_CONTRACT_API_KEY:'test',CONNECT_SERVICE:{fetch:async request=>new URL(request.url).pathname==='/api/contracts/staff-role-v1'?new Response(JSON.stringify({role:'admin',identity:'office@example.com'})):new Response('{}',{status:503})}};
    const res=await worker.fetch(new Request('https://finance.test/',{headers:{'Cf-Access-Jwt-Assertion':'test'}}),productionEnv);
    const html=await res.text();expect(res.status).toBe(200);
    expect(html).toContain('<title>Timothy Finance</title>');expect(html).toContain('Production · Timothy Lutheran');expect(html).not.toContain('Staging workspace');
    expect(html).toContain('<span class="avatar" title="office@example.com">OF</span>');
    expect(html).not.toContain('No production writers attached');expect(html).not.toContain('Every value besides Giving');
    expect(html).toContain('Advanced accounting tools');
  });

  it('renders a clearly labeled shell with no production connection claim', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?view=detail'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Timothy Finance');
    expect(html).toContain('Staging workspace');
    expect(html).toContain(`${FINANCE_VERSION} · alpha`);
    expect(html).toContain('Timothy Lutheran Church');
    expect(html).toContain('Finance workspace');
    expect(html).toContain('class="sidebar-brand"');
    expect(html).toContain('color-scheme: light');
    expect(html).toContain('--warm-meta');
    expect(html).toContain('How are we doing, and what should we decide?');
    expect(html).toContain('Operating result');
    expect(html).toContain('$40,000');
    // No CONNECT_SERVICE is configured in this env, so Operating result and Financial position
    // (like Church Report/Balance Sheet themselves elsewhere in this file) fall back to the
    // synthetic fixture and say so per-card now, instead of the old single page-wide badge.
    expect(html).toContain('variance $0 · synthetic fixture');
    expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
    expect(html).toContain('$1,150');
    expect(html).toContain('4 aggregate records · totals match');
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
    // No CONNECT_SERVICE is configured in this env, so Operating mix (like Operating result/
    // Financial position above) falls back to the synthetic fixture and now says so in its badge.
    expect(html).toContain('FY2026 · reconciled · Synthetic staging');
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
    // Same synthetic-fallback labeling as Operating mix just above -- no CONNECT_SERVICE configured.
    expect(html).toContain('Reconciled · Synthetic staging');
    expect(html).toContain('1 · Income');
    expect(html).toContain('2 · Expenses');
    expect(html).toContain('3 · Surplus');
    expect(html).toContain('not donor-to-expense tracing');
    expect(html).toContain('Unavailable data is never a zero balance');
    expect(html).toContain('Report labels identify live data');
    expect(html).toContain('class="sidebar-brand"');
    expect(html).toContain('Are we okay?');
    expect(html).toContain("Source data hasn't been reviewed in over 30 days");
    // 10 before Operating result/Financial position gained their own live-first resolvers (see
    // health-view-model.js): +1 for churchReportLive's own synthetic-fallback read (a second,
    // independent read of the same fixture `churchReport` above already reads, since `churchReport`
    // still feeds Health's own Revenue/expense mix and Church operating bridge panels unchanged)
    // and +1 for balanceSheet's (the 'balance' section's live-first resolver, now also used here).
    // The Daycare entity now uses its live-first resolver too; on this deliberately unconfigured
    // test environment its fallback adds the two allocation-input reads that the old flat entity
    // card did not include. Property reuses the already-fetched fallback rows without another read.
    expect(statements).toHaveLength(14);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('renders the v3 sidebar, one entry per design group, and safely falls back to Financial Health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=missing'), env);
    const html = await res.text();
    for (const group of [
      'Gift Entry', 'Giving', 'Charts', 'Church', 'Balance Sheet', 'Daycare', 'Commercial Property',
      'Facilities', 'Planning', 'Compensation', 'HR &amp; Staff', 'QuickBooks', 'Accounts &amp; Data',
    ]) expect(html).toMatch(new RegExp(`class="nav-item" href="[^"]+">${group}<span class="nav-count">\\d+</span>`));
    // Single-page groups are plain links; the active one is marked current.
    expect(html).toContain('<a class="nav-item is-active" href="/?section=health" aria-current="page">Financial Health</a>');
    expect(html).toContain('<a class="nav-item" href="/?section=payroll">Payroll</a>');
    expect(html).toContain('<a class="nav-item" href="/?section=packet">Board packet</a>');
    // Only the active group is expanded.
    expect(html).not.toContain('Income &amp; expense detail');
    expect(html).toContain('<div class="eyebrow">Financial Health</div><h1 class="page-title">Financial Health</h1>');
    expect(html).toContain('aria-label="Financial health summary"');

    const church = await (await worker.fetch(new Request('https://finance.test/?section=church&page=trend'), env)).text();
    expect(church).toContain('<div class="nav-group is-open"><a class="nav-item is-active" href="/?section=church&amp;page=overview">Church<span class="nav-count">4</span></a>');
    expect(church).toContain('<a href="/?section=church&amp;page=trend" aria-current="page">Multi-year trend</a>');
    expect(church).toContain('<h1 class="page-title">Multi-year trend</h1>');

    // Accounts & Data folds two sections under one entry, listing both.
    const data = await (await worker.fetch(new Request('https://finance.test/?section=data'), env)).text();
    expect(data).toContain('<a href="/?section=accounts&amp;page=chart">Chart of accounts</a>');
    expect(data).toContain('<a href="/?section=data" aria-current="page">Data &amp; Imports</a>');

    // HR & Staff renders honest unavailable pages until its storage ships.
    const hr = await (await worker.fetch(new Request('https://finance.test/?section=hr&page=reviews'), env)).text();
    expect(hr).toContain('No personnel-record table exists');
  });

  it('offers the v3 Financial Health layouts: Summary by default, By entity, and Full detail', async () => {
    const summary = await (await worker.fetch(new Request('https://finance.test/'), env)).text();
    expect(summary).toContain('<span class="is-on" aria-current="true"><i>1a</i>Summary</span>');
    expect(summary).toContain('<a href="/?section=health&amp;view=entity"><i>1b</i>By entity</a>');
    expect(summary).toContain('Church surplus, year to date');
    expect(summary).toMatch(/Church surplus, year to date<\/small><strong>\+\$[\d,]+<\/strong>/);
    expect(summary).toContain('Operating cash runway');
    expect(summary).toContain('45.0 mo');
    expect(summary).toContain('Income vs. budget');
    expect(summary).toContain('Net assets');
    expect(summary).toContain('Where church income comes from');
    expect(summary).toContain('Where church money goes');
    expect(summary).toContain('href="/?section=daycare"');
    expect(summary).toContain("Source data hasn't been reviewed in over 30 days");
    expect(summary).not.toContain('Synthetic financial health');

    const entity = await (await worker.fetch(new Request('https://finance.test/?section=health&view=entity'), env)).text();
    expect(entity).toContain('aria-label="Financial health by entity"');
    expect(entity).toContain('they sit side by side instead of being added together');
    expect(entity).toContain('<div class="entity-band"><h2>Church</h2><span>FY2026 · synthetic fixture</span></div>');
    expect(entity).toContain('Open Commercial Property overview');
    expect(entity).toContain('Total liabilities');

    const detail = await (await worker.fetch(new Request('https://finance.test/?section=health&view=detail&council=1'), env)).text();
    expect(detail).toContain('aria-label="Synthetic financial health"');
    expect(detail).toContain('<a href="/?section=health&amp;view=summary&amp;council=1"><i>1a</i>Summary</a>');

    const unknown = await (await worker.fetch(new Request('https://finance.test/?view=bogus'), env)).text();
    expect(unknown).toContain('aria-label="Financial health summary"');
  });

  it('serves the self-hosted logo and fonts with a same-origin-only CSP', async () => {
    const page = await worker.fetch(new Request('https://finance.test/'), env);
    expect(page.headers.get('Content-Security-Policy')).toContain("img-src 'self'; font-src 'self'");
    expect(page.headers.get('Content-Security-Policy')).not.toMatch(/script-src|https?:/);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    for (const [path, type] of [['/assets/tlc-logo.png', 'image/png'], ['/assets/fonts/outfit.woff2', 'font/woff2'], ['/assets/fonts/figtree.woff2', 'font/woff2']]) {
      const res = await worker.fetch(new Request(`https://finance.test${path}`), env);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type')).toBe(type);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
    expect((await worker.fetch(new Request('https://finance.test/assets/other.png'), env)).status).toBe(404);
  });

  it('hides sections a verified role cannot open from the sidebar', async () => {
    const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 }));
    const html = await (await worker.fetch(new Request('https://finance.test/?section=church', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), roleEnv)).text();
    expect(html).toContain('>Church<span class="nav-count">');
    expect(html).not.toContain('>HR &amp; Staff<');
    expect(html).not.toContain('href="/?section=payroll"');
  });

  it('offers a clearly-labeled, non-authoritative council-view preview that hides write forms', async () => {
    const off = await (await worker.fetch(new Request('https://finance.test/?section=giving'), env)).text();
    expect(off).not.toContain('class="council-preview"');
    expect(off).toContain('title="Preview council view: hides editing controls without changing permissions">Council</a>');
    expect(off).toContain('href="/?section=giving&amp;page=quick-entry&amp;council=1"');
    expect(off).toContain('<form method="POST" action="/api/v1/connect-giving-quick-entry">');

    const on = await (await worker.fetch(new Request('https://finance.test/?section=giving&council=1'), env)).text();
    expect(on).toContain('<body class="council-preview">');
    expect(on).toContain('Your actual verified permissions still apply');
    expect(on).toContain('Editing controls are hidden');
    expect(on).toContain('Exit preview');
    // Navigating while previewing keeps the preview on.
    expect(on).toContain('href="/?section=church&amp;page=overview&amp;council=1"');
    // The form itself still renders (its fields are real content); council-preview.css hides it.
    expect(on).toContain('body.council-preview form[method="POST"] { display:none; }');
  });

  it('discloses that role verification is unconfigured/unreachable rather than pretending to enforce it', async () => {
    const html = await (await worker.fetch(new Request('https://finance.test/?section=health&view=detail'), env)).text();
    expect(html).toContain('Role verification unavailable in this environment (reason: not_configured)');
  });

  function envWithRoleService(fetchImpl) {
    return { ...env, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
  }

  it('restricts a verified compensation-role identity to the Compensation section, denying everything else', async () => {
    const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role: 'compensation' }), { status: 200 }));
    const req = (url) => new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } });

    const denied = await worker.fetch(req('https://finance.test/?section=health&view=detail'), roleEnv);
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
      const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role] }), { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status, role).toBe(403);
    }
  });

  it('permits the dashboard only with both accounting and giving access', async () => {
    for (const role of ['admin', 'finance', 'staff', 'council']) {
      const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role] }), { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      if (['staff', 'council'].includes(role)) { expect(res.status, role).toBe(403); continue; }
      expect(res.status, role).toBe(200);
      const html = await res.text();
      expect(html, role).toContain(`<span class="viewing-label">Viewing as</span><div class="segmented"><span class="is-on" aria-current="true">${role === 'admin' ? 'Admin' : 'Finance'}</span>`);
      expect(html, role).not.toContain('Role verification unavailable');
    }
  });

  // Bug fix: previously, ANY role-verification failure (not just the disclosed, intentional
  // 'not_configured' staging state) fell through to fully unrestricted access -- see the
  // 'discloses that role verification is unconfigured/unreachable...' test above for the one case
  // that must keep failing open. Every other failure reason must now fail CLOSED with a 403,
  // because each one is a real runtime failure in an environment where CONNECT_SERVICE genuinely
  // is configured (i.e. production), under which a member/volunteer/compensation-only identity
  // could otherwise see every section simply because the verification call happened to fail.
  describe('fails closed (403) on every role-verification failure except not_configured', () => {
    it('no_access_identity: CONNECT_SERVICE is configured but no Cf-Access-Jwt-Assertion header reached this deep', async () => {
      const roleEnv = envWithRoleService(async () => new Response(JSON.stringify({ role: 'admin' }), { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail'), roleEnv);
      expect(res.status).toBe(403);
      const html = await res.text();
      expect(html).toContain('Access denied');
      expect(html).toContain('Role verification failed and access cannot be safely confirmed');
      // Distinct wording from the "your verified role does not have access" denial -- these are
      // different failure modes a future reader should be able to tell apart.
      expect(html).not.toContain('Your verified Connect role does not have access');
    });

    it('network_error: the CONNECT_SERVICE fetch throws', async () => {
      const roleEnv = envWithRoleService(async () => { throw new Error('simulated network failure'); });
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Role verification failed and access cannot be safely confirmed');
    });

    it('http_error: Connect answers with a non-200 status', async () => {
      const roleEnv = envWithRoleService(async () => new Response('server error', { status: 500 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Role verification failed and access cannot be safely confirmed');
    });

    it('invalid_json: Connect answers 200 with a body that is not valid JSON', async () => {
      const roleEnv = envWithRoleService(async () => new Response('not json at all', { status: 200 }));
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), roleEnv);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Role verification failed and access cannot be safely confirmed');
    });

    it('invalid_role: Connect answers 200 with JSON that has no usable role string', async () => {
      for (const payload of [{ role: 123 }, {}, { role: '' }]) {
        const roleEnv = envWithRoleService(async () => new Response(JSON.stringify(payload), { status: 200 }));
        const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
          headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
        }), roleEnv);
        expect(res.status, JSON.stringify(payload)).toBe(403);
        expect(await res.text(), JSON.stringify(payload)).toContain('Role verification failed and access cannot be safely confirmed');
      }
    });

    it('denies production when role verification is not configured', async () => {
      const res=await worker.fetch(new Request('https://finance.test/?section=church'), {ENVIRONMENT:'production'});
      expect(res.status).toBe(403);
    });

    it('still leaves not_configured (no CONNECT_SERVICE binding/key at all) failing open, unchanged', async () => {
      // Same request shape as the 'discloses that role verification is unconfigured/unreachable'
      // test above, confirmed again here so the two behaviors are visibly contrasted in one place.
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail'), env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Role verification unavailable in this environment (reason: not_configured)');
    });
  });

  it('renders a synthetic Church Report overview, its sub-pages, and a separate read budget', async () => {
    // No CONNECT_SERVICE binding/key is configured in this test env, so the live
    // connect.finance-church-report.v1 attempt fails closed with 'not_configured' and Church
    // Report falls back to the same synthetic fixture as before, labeled as such.
    statements.length = 0;
    const overview = await worker.fetch(new Request('https://finance.test/?section=church'), env);
    const overviewHtml = await overview.text();
    expect(overview.status).toBe(200);
    expect(overviewHtml).toContain('aria-label="Church Report overview"');
    expect(overviewHtml).toContain('Synthetic staging');
    expect(overviewHtml).toContain('the live endpoint is not configured or did not answer: not_configured');
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

    // No CONNECT_SERVICE binding/key is configured in this test env, so the live
    // connect.finance-church-report-trend.v1 attempt also fails closed with 'not_configured' and
    // the 'trend' page falls back to the same synthetic fixture as before, labeled as such.
    const trendHtml = await (await worker.fetch(new Request('https://finance.test/?section=church&page=trend'), env)).text();
    expect(trendHtml).toContain('Multi-year operating trend');
    expect(trendHtml).toContain('Synthetic staging');
    expect(trendHtml).toContain('the live endpoint is not configured or did not answer: not_configured');
    expect(trendHtml).toContain('$110,000');

    const budgetActualHtml = await (await worker.fetch(new Request('https://finance.test/?section=church&page=budget-actual'), env)).text();
    expect(budgetActualHtml).toContain('Budget vs actual');
    expect(budgetActualHtml).toContain('Favorable');
  });

  it('renders a live multi-year Church Report trend from the real contract, using the full net-income bottom line rather than a naive income-minus-expense figure', async () => {
    // FY2025 deliberately carries a nonzero otherExpenseActualCents and FY2026 a nonzero
    // otherIncomeActualCents -- the exact real-production shape found 2026-09-15 (see
    // src/api-contracts.js's buildFinanceChurchReportTrendV1) where a naive income-minus-expense
    // trend would silently disagree with the true bottom line. FY2025's naive figure would be
    // $10,000 - $9,000 = $1,000; the real net (with the $500 Other Expense folded in) is $500.
    const VALID_LIVE_TREND = {
      contract: 'connect.finance-church-report-trend.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      generatedAt: '2026-09-15T12:00:00Z',
      years: [
        {
          fiscalYear: 2025, incomeActualCents: 1000000, expenseActualCents: 900000,
          otherIncomeActualCents: 0, otherExpenseActualCents: 50000, costOfGoodsSoldActualCents: 0,
          netIncomeActualCents: 50000, accountCount: 118,
        },
        {
          fiscalYear: 2026, incomeActualCents: 1200000, expenseActualCents: 950000,
          otherIncomeActualCents: 20000, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
          netIncomeActualCents: 270000, accountCount: 98,
        },
      ],
      reconciliation: { yearCount: 2, totalsMatch: true },
    };
    const liveEnv = envWithRoleService(async (request) => {
      const url = new URL(request instanceof Request ? request.url : request);
      if (url.pathname === '/api/contracts/staff-role-v1') {
        return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
      }
      if (url.pathname === '/api/contracts/finance-church-report-trend-v1') {
        return new Response(JSON.stringify(VALID_LIVE_TREND), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=trend', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Multi-year operating trend');
    expect(html).toContain('Live from Connect');
    expect(html).toContain('$10,000');
    expect(html).toContain('$9,000');
    expect(html).toContain('$500');
    expect(html).toContain('$12,000');
    expect(html).toContain('$2,700');
    // The naive income-minus-expense figure for FY2025 ($1,000) must NOT be what's shown as its
    // net result -- this is the exact regression this contract exists to avoid.
    expect(html).not.toMatch(/2025[\s\S]{0,200}\$1,000/);
  });

  it('renders the board packet from the same real inputs as Church Report, synthetic-fallback and labeled per card when no CONNECT_SERVICE is configured', async () => {
    // Same staging state as the rest of this file's default `env` (no CONNECT_SERVICE binding) --
    // every card below falls back to the same synthetic fixture Church Report/Balance Sheet/Giving
    // already use, labeled per card, rather than the old direct-synthetic-only read this replaced.
    const html = await (await worker.fetch(new Request('https://finance.test/?section=packet'), env)).text();
    expect(html).toContain('Board packet');
    expect(html).toContain('Decision-ready FY2026 summary');
    expect(html).toContain('Reconciled');
    expect(html).toContain('FY2025 to FY2026');
    expect(html).toContain('Prepared from the same bounded reads shown across Church Report, Balance Sheet, and Giving Entry');
    expect(html).toContain('$40,000');
    expect(html).toContain('$200,000');
    expect(html).toContain('$1,450');
    expect(html).toContain('Not saved');
    // All four cards are on the synthetic fallback (no CONNECT_SERVICE configured in this env).
    expect(html).toContain('Budget $40,000 · on budget $0 · synthetic fixture');
    expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
    expect(html).toContain('FY2025 to FY2026 · synthetic fixture');
    expect(html).toContain('6 aggregate records · totals reconcile · synthetic fixture');
    expect(html).not.toContain('live from Connect');
  });

  it('shows the board packet live-first, per card, once CONNECT_SERVICE resolvers succeed -- and degrades only the one card whose live resolver fails', async () => {
    const LIVE_PACKET_CHURCH_REPORT = {
      contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-15T12:00:00Z',
      accounts: [
        { classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', depth: 0, hasChildren: false, actualCents: 17500000, budgetCents: 16000000, source: 'import' },
        { classification: 'Expenses', categoryPath: 'Expenses:60000 Programs', accountName: '60000 Programs', depth: 0, hasChildren: false, actualCents: 9500000, budgetCents: 9000000, source: 'import' },
      ],
      totals: {
        incomeActualCents: 17500000, incomeBudgetCents: 16000000, expenseActualCents: 9500000, expenseBudgetCents: 9000000,
        netIncomeActualCents: 8000000, netIncomeBudgetCents: 7000000, hasBudgetData: true,
      },
      reconciliation: {
        accountCount: 2, incomeCount: 1, expenseCount: 1, otherIncomeCount: 0, otherExpenseCount: 0,
        costOfGoodsSoldCount: 0, accountsWithBudgetCount: 2, totalsMatch: true,
      },
    };
    const LIVE_PACKET_TREND = {
      contract: 'connect.finance-church-report-trend.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      generatedAt: '2026-09-15T12:00:00Z',
      years: [
        {
          fiscalYear: 2025, incomeActualCents: 1000000, expenseActualCents: 900000,
          otherIncomeActualCents: 0, otherExpenseActualCents: 50000, costOfGoodsSoldActualCents: 0,
          netIncomeActualCents: 50000, accountCount: 118,
        },
        {
          fiscalYear: 2026, incomeActualCents: 1200000, expenseActualCents: 950000,
          otherIncomeActualCents: 20000, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
          netIncomeActualCents: 270000, accountCount: 98,
        },
      ],
      reconciliation: { yearCount: 2, totalsMatch: true },
    };
    // Balance Sheet's own live attempt 404s below, so Financial position stays on the synthetic
    // fallback -- this is the "partial availability" case: two cards live, one card synthetic, none
    // of them crashing the others or the rest of the page.
    const liveEnv = {
      ...env,
      FINANCE_CONTRACT_API_KEY: 'test-secret',
      CONNECT_SERVICE: {
        async fetch(request) {
          const url = new URL(request instanceof Request ? request.url : request);
          if (url.pathname === '/api/contracts/staff-role-v1') {
            return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
          }
          if (url.pathname === '/api/contracts/finance-church-report-v1') {
            return new Response(JSON.stringify(LIVE_PACKET_CHURCH_REPORT), { status: 200 });
          }
          if (url.pathname === '/api/contracts/finance-church-report-trend-v1') {
            return new Response(JSON.stringify(LIVE_PACKET_TREND), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        },
      },
    };
    const html = await (await worker.fetch(new Request('https://finance.test/?section=packet', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv)).text();
    expect(html).toContain('Board packet');
    // Operating result: $175,000 - $95,000 = $80,000 actual net; budget $70,000; +$10,000 variance.
    expect(html).toContain('$80,000');
    expect(html).toContain('Budget $70,000 · favorable $10,000 · live from Connect');
    // Operating trend: the reconciled netIncomeActualCents bottom line ($500 to $2,700), NOT the
    // naive income-minus-expense figure ($1,000 for FY2025) -- see board-packet-service.js's
    // resolveBoardPacketTrend comment for why.
    expect(html).toContain('$2,200'); // change: $2,700 - $500
    expect(html).toContain('FY2025 to FY2026 · live from Connect');
    expect(html).not.toMatch(/Operating trend[\s\S]{0,400}\$1,500/); // the naive ($12,000-$9,500) - ($10,000-$9,000) = $1,500 change would be wrong here too
    // Financial position stayed synthetic (its own live attempt 404s in this env) -- still renders,
    // still labeled, never crashes the two live cards next to it.
    expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
    expect(html).not.toContain('Data unavailable');
  });

  it('shows an honest per-card "unavailable" placeholder, never a crash of the rest of the page, when the synthetic fallback data underneath board packet is entirely missing', async () => {
    // Same empty-database shape used elsewhere in this file to exercise safeSyntheticRead's
    // degrade-to-SYNTHETIC_UNAVAILABLE path (see synthetic-read-guard.js) -- no CONNECT_SERVICE, and
    // the underlying synthetic tables are empty, so every one of Board packet's four live-first
    // resolvers falls all the way through to nothing.
    const emptyEnv = {
      ...env,
      FINANCE_DB: {
        prepare(sql) { return { sql }; },
        async batch(batchStatements) { return batchStatements.map(() => ({ results: [] })); },
      },
    };
    const res = await worker.fetch(new Request('https://finance.test/?section=packet'), emptyEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Board packet');
    expect(html).toContain('Partial data');
    expect(html).toContain('Data temporarily unavailable.');
    expect(html).not.toContain('Reconciled');
  });

  it('renders a synthetic Balance Sheet position, its sub-pages, and its own read budget', async () => {
    // No CONNECT_SERVICE binding/key is configured in this test env, so the live
    // connect.finance-balance-sheet.v1 attempt fails closed with 'not_configured' and Balance
    // Sheet falls back to the same synthetic fixture as before, labeled as such.
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=balance'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Synthetic staging');
    expect(html).toContain('the live endpoint is not configured or did not answer: not_configured');
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

    // No CONNECT_SERVICE binding/key is configured in this test env, so the live
    // connect.finance-balance-sheet-trend.v1 attempt also fails closed with 'not_configured' and
    // the 'multi-year' page falls back to the same synthetic trend fixture as before, now via
    // resolveBalanceSheetTrend rather than a direct synthetic read -- labeled the same way the
    // 'position' page above already is.
    const trendHtml = await (await worker.fetch(new Request('https://finance.test/?section=balance&page=multi-year'), env)).text();
    expect(trendHtml).toContain('Multi-year financial position');
    expect(trendHtml).toContain('Synthetic staging');
    expect(trendHtml).toContain('the live endpoint is not configured or did not answer: not_configured');
    expect(trendHtml).toContain('$270,000');
    expect(trendHtml).toContain('$110,000');
    expect(trendHtml).toContain('$160,000');
  });

  describe('Financial Health: Operating result / Financial position live-first (reuses Church Report/Balance Sheet)', () => {
    // Distinct from both the committed synthetic fixture's figures ($120,000/$80,000 income/expense,
    // $300,000/$100,000/$200,000 assets/liabilities/equity) and from each other, so a passing
    // assertion can only mean the live values actually rendered.
    const LIVE_CHURCH_REPORT = {
      contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-15T12:00:00Z',
      accounts: [
        { classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', depth: 0, hasChildren: false, actualCents: 17500000, budgetCents: 16000000, source: 'import' },
        { classification: 'Expenses', categoryPath: 'Expenses:60000 Programs', accountName: '60000 Programs', depth: 0, hasChildren: false, actualCents: 9500000, budgetCents: 9000000, source: 'import' },
      ],
      totals: {
        incomeActualCents: 17500000, incomeBudgetCents: 16000000, expenseActualCents: 9500000, expenseBudgetCents: 9000000,
        netIncomeActualCents: 8000000, netIncomeBudgetCents: 7000000, hasBudgetData: true,
      },
      reconciliation: {
        accountCount: 2, incomeCount: 1, expenseCount: 1, otherIncomeCount: 0, otherExpenseCount: 0,
        costOfGoodsSoldCount: 0, accountsWithBudgetCount: 2, totalsMatch: true,
      },
    };
    // equityCents (45,000,000 assets minus 15,000,000 liabilities) is the whole reclassified
    // Equity total -- see health-view-model.js's resolvePosition comment on why that field, not a
    // piece of equityReclass, is "net assets" here. donorRestricted+unrestricted still sums to it.
    const LIVE_BALANCE_SHEET = {
      contract: 'connect.finance-balance-sheet.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      fiscalYear: new Date().getUTCFullYear(), asOfDate: '2026-09-15', generatedAt: '2026-09-15T12:00:00Z',
      accounts: [
        { classification: 'Assets', categoryPath: 'Assets:Current Assets:11000 Cash', accountName: '11000 Cash', depth: 1, hasChildren: false, ownBalanceCents: 45000000 },
        { classification: 'Liabilities', categoryPath: 'Liabilities:21000 Note Payable', accountName: '21000 Note Payable', depth: 0, hasChildren: false, ownBalanceCents: 15000000 },
        { classification: 'Equity', categoryPath: 'Equity:30000 Net Assets', accountName: '30000 Net Assets', depth: 0, hasChildren: false, ownBalanceCents: 30000000 },
      ],
      totals: {
        assetsCents: 45000000, liabilitiesCents: 15000000, equityCents: 30000000,
        currentAssetsCents: 45000000, fixedAssetsCents: 0, otherAssetsCents: 0,
        liabilitiesPlusEquityCents: 45000000, balancedCents: 0,
      }, // currentAssetsCents matches because categoryPath's "Current Assets" segment groups here (see assetGroupOf in finance-balance-sheet-consumer.js)
      equityReclass: {
        donorRestrictedCents: 10000000, unrestrictedCents: 20000000, totalEquityCents: 30000000,
        breakdown: {
          perpetual: { label: 'Perpetual endowments', cents: 0 },
          purpose_time: { label: 'Purpose/time restricted', cents: 10000000 },
          designated: { label: 'Designated ministry/purpose funds', cents: 0 },
        },
        unclassified: [],
      },
      reconciliation: { accountCount: 3, assetsCount: 1, liabilitiesCount: 1, equityCount: 1, unclassifiedEquityCount: 0, totalsMatch: true },
    };

    const LIVE_DAYCARE_REPORT = {
      contract: 'connect.finance-daycare-report.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-15T12:00:00Z',
      categories: [
        { category: 'Tuition Income', classification: 'Income', actualCents: 5000000, budgetCents: 4800000 },
        { category: 'Payroll', classification: 'Expenses', actualCents: 3000000, budgetCents: 2900000 },
      ],
      allocation: { utilityPct: 0.1, insurancePct: 0.05, churchUtilityActualCents: 1000000, churchInsuranceActualCents: 2000000, mdoUtilityCents: 100000, mdoInsuranceCents: 100000 },
      totals: { incomeActualCents: 5000000, incomeBudgetCents: 4800000, expenseActualCents: 3000000, expenseBudgetCents: 2900000, netActualCents: 2000000, netBudgetCents: 1900000 },
      reconciliation: { categoryCount: 2, incomeCategoryCount: 1, expenseCategoryCount: 1, totalsMatch: true },
    };

    const LIVE_PROPERTY_OPERATING = {
      contract: 'connect.finance-property-operating.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD', propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
      periods: [{ period: '2026-01', occupancyPct: 0.9, totalRevenueCents: 1000000, totalExpensesCents: null, netIncomeCents: 600000, netOperatingIncomeCents: null, availableForDistributionCents: null, reserveBalanceCents: null, loanPaymentCents: null, interestExpenseCents: null, sourceReport: 'finance-app' }],
      annualSummary: [{ year: 2026, totalRevenueCents: 9000000, totalExpensesCents: 4000000, netIncomeCents: 5000000, avgOccupancyPct: 0.9, confirmedDistributionsCents: 0, expenseMonthsDerived: 1, notes: '' }],
    };

    function connectServiceEnv({ church = null, balance = null, daycare = null, property = null } = {}) {
      return {
        ...env,
        FINANCE_CONTRACT_API_KEY: 'test-secret',
        CONNECT_SERVICE: {
          async fetch(request) {
            const url = new URL(request instanceof Request ? request.url : request);
            if (url.pathname === '/api/contracts/staff-role-v1') {
              return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
            }
            if (url.pathname === '/api/contracts/finance-church-report-v1') {
              return church ? new Response(JSON.stringify(church), { status: 200 }) : new Response('not found', { status: 404 });
            }
            if (url.pathname === '/api/contracts/finance-balance-sheet-v1') {
              return balance ? new Response(JSON.stringify(balance), { status: 200 }) : new Response('not found', { status: 404 });
            }
            if (url.pathname === '/api/contracts/finance-daycare-report-v1') {
              return daycare ? new Response(JSON.stringify(daycare), { status: 200 }) : new Response('not found', { status: 404 });
            }
            if (url.pathname === '/api/contracts/finance-property-operating-v1') {
              return property ? new Response(JSON.stringify(property), { status: 200 }) : new Response('not found', { status: 404 });
            }
            // Giving deliberately answers 404 here in every case below so its card stays on the
            // synthetic fixture -- out of scope for this contract, and it keeps the assertions
            // below unambiguous about which card's source label they are reading.
            return new Response('not found', { status: 404 });
          },
        },
      };
    }

    async function fetchHealth(testEnv) {
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), testEnv);
      return { res, html: await res.text() };
    }

    it('shows real live figures with a "live from Connect" indicator on both cards when both live resolvers succeed', async () => {
      const { res, html } = await fetchHealth(connectServiceEnv({ church: LIVE_CHURCH_REPORT, balance: LIVE_BALANCE_SHEET }));
      expect(res.status).toBe(200);
      expect(html).toContain('Live from Connect'); // the Financial Health section-heading badge
      // Operating result: income $175,000 - expense $95,000 = $80,000 actual net; budget $70,000;
      // variance +$10,000. None of these figures exist in the synthetic fixture.
      expect(html).toContain('$80,000');
      expect(html).toContain('Budget $70,000 · variance $10,000 · live from Connect');
      // Financial position: assets $450,000, liabilities $150,000, net assets (equityCents) $300,000.
      expect(html).toContain('$450,000');
      expect(html).toContain('Assets $450,000 · liabilities $150,000 · live from Connect');
      // Giving stayed synthetic (404 above) -- its own existing per-card label, unchanged, and
      // still prints its own always-present synthetic-fallback footer note regardless of what
      // Operating result/Financial position are doing (out of scope, untouched).
      expect(html).toContain('synthetic fixture');
      // Neither of the two now-live-capable cards fell back to the old synthetic totals -- this
      // checks the Operating result/Financial position cards specifically (not the still-synthetic
      // Entity overview/Church operating bridge panels a few sections down, which legitimately still
      // show the old $40,000/$300,000 figures from the untouched, always-synthetic `churchReport` --
      // out of scope for this contract, see shell.js's own comment on why it can't simply be reused).
      expect(html).not.toContain('Budget $40,000 · variance $0');
      expect(html).not.toContain('Assets $300,000 · liabilities $100,000');
    });

    it('shows each card independently in its own correct state when only one live resolver succeeds', async () => {
      // Church Report live, Balance Sheet not (its own live attempt 404s and it falls back to the
      // same synthetic fixture Balance Sheet's own section uses, labeled as such).
      const { res, html } = await fetchHealth(connectServiceEnv({ church: LIVE_CHURCH_REPORT }));
      expect(res.status).toBe(200);
      expect(html).toContain('Budget $70,000 · variance $10,000 · live from Connect');
      expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
      expect(html).not.toContain('Budget $40,000 · variance $0');
      // Mixed sources -- the section-heading badge no longer claims a single blanket state.
      expect(html).toContain('Partially live');
      expect(html).not.toContain('<span class="badge">Live from Connect</span>');
    });

    it('shows the reverse independently: Balance Sheet live, Church Report not', async () => {
      const { res, html } = await fetchHealth(connectServiceEnv({ balance: LIVE_BALANCE_SHEET }));
      expect(res.status).toBe(200);
      expect(html).toContain('Assets $450,000 · liabilities $150,000 · live from Connect');
      expect(html).toContain('variance $0 · synthetic fixture');
      expect(html).not.toContain('Assets $300,000 · liabilities $100,000');
      expect(html).toContain('Partially live');
    });

    it('falls back to the synthetic fixture, labeled per-card, when neither live resolver is configured (unconfigured/staging)', async () => {
      // Same request shape as the two tests above, but with no CONNECT_SERVICE at all -- the exact
      // staging state this repository runs in today (see the top-of-file `env`).
      const { res, html } = await fetchHealth(env);
      expect(res.status).toBe(200);
      expect(html).toContain('variance $0 · synthetic fixture');
      expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
      expect(html).toContain('Synthetic staging');
      expect(html).not.toContain('Partially live');
      expect(html).not.toContain('<span class="badge">Live from Connect</span>');
    });

    it('uses live annual Daycare and Property totals in the entity comparison and labels every source', async () => {
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=entity', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), connectServiceEnv({ church: LIVE_CHURCH_REPORT, balance: LIVE_BALANCE_SHEET, daycare: LIVE_DAYCARE_REPORT, property: LIVE_PROPERTY_OPERATING }));
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(`<h2>Church</h2><span>FY${LIVE_CHURCH_REPORT.fiscalYear} · live from Connect</span>`);
      expect(html).toContain(`<h2>Daycare</h2><span>${LIVE_DAYCARE_REPORT.fiscalYear} · live from Connect</span>`);
      expect(html).toContain('<h2>Commercial Property</h2><span>2026 · live from Connect</span>');
      expect(html).toContain('$50,000');
      expect(html).not.toContain('Commercial Property</h2><span>2026-01 · synthetic fixture');
    });

    describe('Operating mix / Church operating bridge live-first (reuses churchReportLive directly, independent of Entity overview)', () => {
      // Same LIVE_CHURCH_REPORT fixture as the describe block above: Income $175,000/Expenses
      // $95,000 (40000 Contributions/60000 Programs), distinct from the synthetic fixture's
      // $120,000/$80,000 Income/Expenses and its "Synthetic ..." account names.
      it('shows the real live revenue/expense mix and operating bridge, badged "Live from Connect", when churchReportLive is live', async () => {
        const { res, html } = await fetchHealth(connectServiceEnv({ church: LIVE_CHURCH_REPORT }));
        expect(res.status).toBe(200);
        // Operating mix: live account names/amounts render, badge says so, and the old synthetic
        // account names/fiscal-year-2026-reconciled-with-no-source badge text are both gone.
        expect(html).toContain('40000 Contributions');
        expect(html).toContain('60000 Programs');
        expect(html).toContain('$175,000');
        expect(html).toContain('$95,000');
        expect(html).toContain(`FY${LIVE_CHURCH_REPORT.fiscalYear} · reconciled · Live from Connect`);
        expect(html).not.toContain('FY2026 · reconciled · Synthetic staging');
        // Church operating bridge: income $175,000 - expenses $95,000 = $80,000 surplus, badged live.
        expect(html).toContain(`FY${LIVE_CHURCH_REPORT.fiscalYear} Church operating bridge`);
        expect(html).toContain('Reconciled · Live from Connect');
        expect(html).toContain('3 · Surplus');
        // Full detail keeps its compact card markup, but Church's entity amount now follows the
        // same live result and every card discloses its source.
        expect(html).toContain(`Church · FY${LIVE_CHURCH_REPORT.fiscalYear}`);
        expect(html).toContain('expenses $95,000 · live from Connect');
        expect(html).toContain('expenses $33,500 · synthetic fixture');
      });

      it('stays synthetic, badged "Synthetic staging", when churchReportLive is not live (Balance Sheet live but Church Report not)', async () => {
        const { res, html } = await fetchHealth(connectServiceEnv({ balance: LIVE_BALANCE_SHEET }));
        expect(res.status).toBe(200);
        // Financial position went live (proves this env really did configure CONNECT_SERVICE), but
        // Operating mix/Church operating bridge -- which depend only on churchReportLive, not
        // balanceSheet -- correctly did not follow it live.
        expect(html).toContain('Assets $450,000 · liabilities $150,000 · live from Connect');
        expect(html).toContain('FY2026 · reconciled · Synthetic staging');
        expect(html).toContain('Reconciled · Synthetic staging');
        expect(html).not.toContain('40000 Contributions');
      });

      it('goes live independently of Financial position (Church Report live but Balance Sheet not)', async () => {
        const { res, html } = await fetchHealth(connectServiceEnv({ church: LIVE_CHURCH_REPORT }));
        expect(res.status).toBe(200);
        // Financial position stayed synthetic (proves the mix/bridge result below isn't just
        // "everything on the page went live together").
        expect(html).toContain('Assets $300,000 · liabilities $100,000 · synthetic fixture');
        expect(html).toContain(`FY${LIVE_CHURCH_REPORT.fiscalYear} · reconciled · Live from Connect`);
        expect(html).toContain('Reconciled · Live from Connect');
      });
    });
  });

  it('renders a synthetic Daycare Report overview, its sub-pages, and its own read budget', async () => {
    // No CONNECT_SERVICE binding/key is configured in this test env, so the live
    // connect.finance-daycare-report.v1 attempt fails closed with 'not_configured' and Daycare
    // Report falls back to the same synthetic fixture as before, labeled as such.
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('aria-label="Daycare Report overview"');
    expect(html).toContain('Synthetic staging');
    expect(html).toContain('the live endpoint is not configured or did not answer: not_configured');
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
    expect(distributionsHtml).toContain('Synthetic staging');
  });

  it('prefers live connect.finance-property-reserves.v1 distributions over the synthetic fixture on the standalone Distributions page', async () => {
    // Reuses the exact same live payload shape as resolvePropertyReserves's own test
    // (test/finance-property-reserves-service.test.js), but with distribution periods/amounts that
    // differ from the committed synthetic fixture's $5,000/2026-01, so a passing assertion can only
    // mean the live values actually rendered, not a coincidental match with the fixture.
    const livePayload = {
      contract: 'connect.finance-property-reserves.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
      reserves: [
        { reserveKey: 'property_tax', reportMonth: '2026-05', taxYear: 2026, targetEstimateCents: 1140000, reserveBeforeCents: 380000, contributionCents: 95000, reserveAfterCents: 475000, fundedPct: (475000 / 1140000) * 100, note: '' },
      ],
      reserveDisbursements: [],
      distributions: [
        { period: '2026-06', amountCents: 750000 },
        { period: '2026-07', amountCents: 825000 },
      ],
    };
    const liveEnv = {
      ...env,
      FINANCE_CONTRACT_API_KEY: 'test-secret',
      CONNECT_SERVICE: {
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === '/api/contracts/staff-role-v1') {
            return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
          }
          if (url.pathname === '/api/contracts/finance-property-reserves-v1') {
            return new Response(JSON.stringify(livePayload), { status: 200 });
          }
          // Every other property contract (operating, ledgers, valuation) intentionally answers
          // with an error here so those unrelated resolvers fall back to their own synthetic
          // fixtures, unaffected -- only the reserves/distributions contract is under test.
          return new Response('not found', { status: 404 });
        },
      },
    };
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=distributions', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Distributions');
    expect(html).toContain('Live from Connect');
    expect(html).toContain('2026-06');
    expect(html).toContain('2026-07');
    expect(html).toContain('$7,500');
    expect(html).toContain('$8,250');
    expect(html).toContain('$15,750');
    expect(html).toContain('$7,875');
    expect(html).not.toContain('$5,000');
    expect(html).not.toContain('2026-01');
  });

  describe('Charts section reuses the Church Report and Property Reserves live resolvers', () => {
    // Deliberately different figures than both the committed synthetic fixture (Income
    // $120,000/$40,000 contributions+program, Expenses $80,000 programs+operations -- see the top
    // of this file) and the property-reserves fixture ($35,000 reserve after / 58.3% funded as of
    // 2026-03), so a passing assertion can only mean the live values actually rendered.
    const liveFiscalYear = new Date().getUTCFullYear();
    const VALID_LIVE_CHURCH_REPORT = {
      contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      fiscalYear: liveFiscalYear, generatedAt: '2026-09-16T12:00:00Z',
      accounts: [
        { classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: 'Live Contributions', depth: 0, hasChildren: false, actualCents: 18000000, budgetCents: 17500000, source: 'import' },
        { classification: 'Income', categoryPath: 'Income:40100 Program Income', accountName: 'Live Program Income', depth: 0, hasChildren: false, actualCents: 6000000, budgetCents: 5800000, source: 'import' },
        { classification: 'Expenses', categoryPath: 'Expenses:50000 Programs', accountName: 'Live Programs', depth: 0, hasChildren: false, actualCents: 10000000, budgetCents: 9800000, source: 'import' },
        { classification: 'Expenses', categoryPath: 'Expenses:50100 Operations', accountName: 'Live Operations', depth: 0, hasChildren: false, actualCents: 6000000, budgetCents: 5800000, source: 'import' },
      ],
      totals: {
        incomeActualCents: 24000000, incomeBudgetCents: 23300000, expenseActualCents: 16000000, expenseBudgetCents: 15600000,
        netIncomeActualCents: 8000000, netIncomeBudgetCents: 7700000, hasBudgetData: true,
      },
      reconciliation: {
        accountCount: 4, incomeCount: 2, expenseCount: 2, otherIncomeCount: 0, otherExpenseCount: 0,
        costOfGoodsSoldCount: 0, accountsWithBudgetCount: 4, totalsMatch: true,
      },
    };
    const VALID_LIVE_PROPERTY_RESERVES = {
      contract: 'connect.finance-property-reserves.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
      reserves: [
        { reserveKey: 'property_tax', reportMonth: '2026-05', taxYear: 2026, targetEstimateCents: 1140000, reserveBeforeCents: 380000, contributionCents: 95000, reserveAfterCents: 475000, fundedPct: (475000 / 1140000) * 100, note: '' },
      ],
      reserveDisbursements: [],
      distributions: [],
    };
    const chartsRequest = (page) => new Request(`https://finance.test/?section=charts&page=${page}`, {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    });

    it('prefers both live resolvers when each is configured and answers, labeling every KPI by its own source', async () => {
      const liveEnv = envWithRoleService(async (request) => {
        const url = new URL(request instanceof Request ? request.url : request);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
        if (url.pathname === '/api/contracts/finance-church-report-v1') return new Response(JSON.stringify(VALID_LIVE_CHURCH_REPORT), { status: 200 });
        if (url.pathname === '/api/contracts/finance-property-reserves-v1') return new Response(JSON.stringify(VALID_LIVE_PROPERTY_RESERVES), { status: 200 });
        return new Response('not found', { status: 404 });
      });

      const revenueHtml = await (await worker.fetch(chartsRequest('revenue-mix'), liveEnv)).text();
      expect(revenueHtml).toContain(`FY${liveFiscalYear} · reconciled · Live from Connect`);
      expect(revenueHtml).toContain('Live Contributions');
      expect(revenueHtml).toContain('$180,000');
      expect(revenueHtml).toContain('75.0%');
      expect(revenueHtml).toContain('Live Program Income');
      expect(revenueHtml).toContain('$60,000');
      expect(revenueHtml).toContain('25.0%');
      expect(revenueHtml).not.toContain('Synthetic Contributions');

      const expenseHtml = await (await worker.fetch(chartsRequest('expense-mix'), liveEnv)).text();
      expect(expenseHtml).toContain(`FY${liveFiscalYear} · reconciled · Live from Connect`);
      expect(expenseHtml).toContain('Live Programs');
      expect(expenseHtml).toContain('$100,000');
      expect(expenseHtml).toContain('62.5%');
      expect(expenseHtml).toContain('Live Operations');
      expect(expenseHtml).toContain('$60,000');
      expect(expenseHtml).toContain('37.5%');
      expect(expenseHtml).not.toContain('Synthetic Programs');

      const cashReserveHtml = await (await worker.fetch(chartsRequest('cash-reserve'), liveEnv)).text();
      expect(cashReserveHtml).toContain('Property tax reserve');
      expect(cashReserveHtml).toContain('$4,750');
      expect(cashReserveHtml).toContain('41.7% funded, 2026-05 · live from Connect');
      // Operating cash / expense coverage have no live equivalent and must keep saying so.
      expect(cashReserveHtml).toContain('Operating cash');
      expect(cashReserveHtml).toContain('$300,000');
      expect(cashReserveHtml).toContain('Synthetic Cash · synthetic fixture');
      expect(cashReserveHtml).toContain('45.0 months');
      expect(cashReserveHtml).toContain('synthetic fixture');
      expect(cashReserveHtml).not.toContain('$35,000');

      const pacingHtml = await (await worker.fetch(chartsRequest('giving-pace'), liveEnv)).text();
      expect(pacingHtml).toContain('Naive monthly pace');
      expect(pacingHtml).toContain('$20,000');
      expect(pacingHtml).toContain(`1/12 of FY${liveFiscalYear} church income budget · live from Connect`);
      expect(pacingHtml).not.toContain('$10,000');
    });

    it('renders each Charts page from the synthetic fixtures alone when no CONNECT_SERVICE is configured (unchanged regression baseline)', async () => {
      const revenueHtml = await (await worker.fetch(new Request('https://finance.test/?section=charts&page=revenue-mix'), env)).text();
      expect(revenueHtml).toContain('FY2026 · reconciled · Synthetic staging');
      expect(revenueHtml).toContain('Synthetic Contributions');
      expect(revenueHtml).toContain('100.0%');
      expect(revenueHtml).not.toContain('Live from Connect');

      const cashReserveHtml = await (await worker.fetch(new Request('https://finance.test/?section=charts&page=cash-reserve'), env)).text();
      expect(cashReserveHtml).toContain('$35,000');
      expect(cashReserveHtml).toContain('58.3% funded, 2026-03 · synthetic fixture');
      expect(cashReserveHtml).not.toContain('live from Connect');

      const pacingHtml = await (await worker.fetch(new Request('https://finance.test/?section=charts&page=giving-pace'), env)).text();
      expect(pacingHtml).toContain('$10,000');
      expect(pacingHtml).toContain('church income budget · synthetic fixture');
    });

    it('labels each KPI by its own independent source when only one live resolver answers (partial availability)', async () => {
      const churchOnlyEnv = envWithRoleService(async (request) => {
        const url = new URL(request instanceof Request ? request.url : request);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
        if (url.pathname === '/api/contracts/finance-church-report-v1') return new Response(JSON.stringify(VALID_LIVE_CHURCH_REPORT), { status: 200 });
        // Property Reserves contract answers with an error here, so only the church-report-derived
        // figures go live while the reserve KPI independently falls back to its own synthetic fixture.
        return new Response('not found', { status: 404 });
      });

      const revenueHtml = await (await worker.fetch(chartsRequest('revenue-mix'), churchOnlyEnv)).text();
      expect(revenueHtml).toContain('Live from Connect');
      expect(revenueHtml).toContain('Live Contributions');

      const cashReserveHtml = await (await worker.fetch(chartsRequest('cash-reserve'), churchOnlyEnv)).text();
      expect(cashReserveHtml).toContain('$35,000');
      expect(cashReserveHtml).toContain('58.3% funded, 2026-03 · synthetic fixture');
      expect(cashReserveHtml).not.toContain('$4,750');

      const reserveOnlyEnv = envWithRoleService(async (request) => {
        const url = new URL(request instanceof Request ? request.url : request);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
        if (url.pathname === '/api/contracts/finance-property-reserves-v1') return new Response(JSON.stringify(VALID_LIVE_PROPERTY_RESERVES), { status: 200 });
        // Church Report contract answers with an error here, so the reserve KPI goes live while
        // revenue mix independently falls back to its own synthetic fixture.
        return new Response('not found', { status: 404 });
      });

      const expenseHtml = await (await worker.fetch(chartsRequest('expense-mix'), reserveOnlyEnv)).text();
      expect(expenseHtml).toContain('Synthetic Programs');
      expect(expenseHtml).not.toContain('Live from Connect');

      const cashReserveHtml2 = await (await worker.fetch(chartsRequest('cash-reserve'), reserveOnlyEnv)).text();
      expect(cashReserveHtml2).toContain('$4,750');
      expect(cashReserveHtml2).toContain('41.7% funded, 2026-05 · live from Connect');
    });
  });

  it('renders the Run-rate forecast page live from Connect when connect.finance-property-forecast.v1 answers, real-data-shaped (a current-year plan, not a future one)', async () => {
    const VALID_LIVE_FORECAST = {
      contract: 'connect.finance-property-forecast.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      propertyKey: 'ivanhoe', generatedAt: '2026-09-16T12:00:00Z', forecastYear: 2026,
      periods: [
        { period: '2026-01', revenueCents: 1000000, expensesCents: 400000, netIncomeCents: 600000, reconciled: true, source: 'ahra_import' },
        // Real finding: real December has a large annual expense landing in one month, making net
        // income genuinely negative even though revenue/expenses are each nonnegative.
        { period: '2026-12', revenueCents: 1000000, expensesCents: 1600000, netIncomeCents: -600000, reconciled: true, source: 'ahra_import' },
      ],
      totals: { revenueCents: 2000000, expensesCents: 2000000, netIncomeCents: 0, reconciled: true },
    };
    const liveEnv = envWithRoleService(async (request) => {
      const url = new URL(request instanceof Request ? request.url : request);
      if (url.pathname === '/api/contracts/staff-role-v1') {
        return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
      }
      if (url.pathname === '/api/contracts/finance-property-forecast-v1') {
        return new Response(JSON.stringify(VALID_LIVE_FORECAST), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=forecast', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Run-rate forecast');
    expect(html).toContain('Fiscal year 2026 monthly plan');
    expect(html).toContain('Live from Connect');
    expect(html).toContain('$20,000');
    expect(html).toContain('Reconciles to the cent');
    // Real finding: real December net income is genuinely negative -- rendered signed, not
    // fabricated as a positive or zeroed figure.
    expect(html).toContain('2026-12');
    expect(html).toContain('−$6,000');
  });

  it('real-data-shaped edge case: renders an honest "no complete forecast year" state, not a 500, when Connect has only a partial year on file', async () => {
    const PARTIAL_YEAR_FORECAST = {
      contract: 'connect.finance-property-forecast.v1', dataClassification: 'aggregate',
      sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
      propertyKey: 'ivanhoe', generatedAt: '2026-09-16T12:00:00Z', forecastYear: null,
      periods: [
        { period: '2027-01', revenueCents: 100000, expensesCents: 40000, netIncomeCents: 60000, reconciled: true, source: 'ahra_import' },
        { period: '2027-02', revenueCents: 100000, expensesCents: 40000, netIncomeCents: 60000, reconciled: true, source: 'ahra_import' },
      ],
      totals: { revenueCents: 0, expensesCents: 0, netIncomeCents: 0, reconciled: false },
    };
    const liveEnv = envWithRoleService(async (request) => {
      const url = new URL(request instanceof Request ? request.url : request);
      if (url.pathname === '/api/contracts/staff-role-v1') {
        return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
      }
      if (url.pathname === '/api/contracts/finance-property-forecast-v1') {
        return new Response(JSON.stringify(PARTIAL_YEAR_FORECAST), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=forecast', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('No complete forecast year on file');
    expect(html).toContain('Live from Connect');
    expect(html).not.toContain('undefined');
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

  describe('live Compensation Council snapshot for admin/council/compensation, Benchmarks/Benefits stay synthetic', () => {
    // Every name/dollar figure below is entirely fabricated for this test -- never a real
    // production value. Mirrors VALID_LIVE_PAYLOAD in finance-compensation-service.test.js.
    function liveCompensationEnv(role) {
      const workers = [
        { name: 'Worker A', position: 'Fictional Director', accountCode: '', role: 'other', trackKey: '', education: 'bachelors', yearsExperience: 3, responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: true, hideFromCouncil: false, currentPayCents: 5000000, currentPaySource: 'entered' },
        { name: 'Worker B (hidden from council)', position: 'Fictional Assistant', accountCode: '', role: 'other', trackKey: '', education: 'bachelors', yearsExperience: 1, responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: false, hideFromCouncil: true, currentPayCents: 9000000, currentPaySource: 'entered' },
      ];
      const payload = {
        contract: 'connect.finance-compensation.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
        generatedAt: '2026-09-15T00:00:00Z', workers,
        totals: { workerCount: 2, enteredCurrentPayCount: 2, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 14000000 },
        reconciliation: { workerCount: 2, totalsMatch: true },
      };
      return envWithRoleService(async (req) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role] }), { status: 200 });
        if (url.pathname === '/api/contracts/finance-compensation-v1') return new Response(JSON.stringify(payload), { status: 200 });
        return new Response('not found', { status: 404 });
      });
    }
    const req = (url) => new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } });

    it('admin sees a real, aggregate Council snapshot including a worker flagged hideFromCouncil', async () => {
      const html = await (await worker.fetch(req('https://finance.test/?section=compensation&page=council'), liveCompensationEnv('admin'))).text();
      expect(html).toContain('Council review snapshot');
      expect(html).toContain('Real roster decision context');
      expect(html).toContain('Live from Connect · review-only · not approved');
      expect(html).toContain('Workers on roster');
      expect(html).toContain('>2<');
      expect(html).toContain('Entered current pay total');
      expect(html).toContain('$140,000');
      expect(html).not.toContain('Weighted adjustment');
      expect(html).not.toContain('Benefits share');
    });

    it('council sees the same real snapshot with the hideFromCouncil worker excluded from the aggregate', async () => {
      const html = await (await worker.fetch(req('https://finance.test/?section=compensation&page=council'), liveCompensationEnv('council'))).text();
      expect(html).toContain('>1<');
      expect(html).toContain('$50,000');
      expect(html).not.toContain('$140,000');
      expect(html).toContain('Excludes any worker not shown to council');
    });

    it('Benchmarks and Benefits stay fully synthetic even for admin with a live compensation roster available', async () => {
      const roleEnv = liveCompensationEnv('admin');
      const benchmarkHtml = await (await worker.fetch(req('https://finance.test/?section=compensation&page=benchmarks'), roleEnv)).text();
      expect(benchmarkHtml).toContain('Synthetic · not published guidance');
      expect(benchmarkHtml).not.toContain('Worker A');
      const benefitsHtml = await (await worker.fetch(req('https://finance.test/?section=compensation&page=benefits'), roleEnv)).text();
      expect(benefitsHtml).toContain('No personal identities are included');
      expect(benefitsHtml).not.toContain('Worker A');
    });

    it('admin sees every worker verbatim on the Plan page, including one flagged hideFromCouncil', async () => {
      const html = await (await worker.fetch(req('https://finance.test/?section=compensation&page=plan'), liveCompensationEnv('admin'))).text();
      expect(html).toContain('Worker A');
      expect(html).toContain('Worker B (hidden from council)');
      expect(html).toContain('>2<');
      expect(html).toContain('$140,000');
    });

    it('a council viewer never sees a worker flagged hideFromCouncil on the Plan page -- same rule the Council page enforces', async () => {
      const html = await (await worker.fetch(req('https://finance.test/?section=compensation&page=plan'), liveCompensationEnv('council'))).text();
      expect(html).toContain('Worker A');
      expect(html).not.toContain('Worker B (hidden from council)');
      // KPI totals are recomputed from the filtered roster too, so the hidden worker's $90,000
      // never leaks into "Entered current pay total" even in aggregate.
      expect(html).toContain('>1<');
      expect(html).toContain('$50,000');
      expect(html).not.toContain('$140,000');
      expect(html).toContain('Excludes any worker not shown to council');
    });
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
    expect(FINANCE_QUERY_BUDGETS).toEqual({ summary: 4, churchReport: 1, churchTrends: 1, balanceSheet: 1, balanceTrends: 1, daycareReport: 1, daycareAllocation: 2, propertyReport: 1, propertyReserves: 1, propertyLedgers: 2, propertyValuation: 3, propertyForecast: 1, budgetReport: 1, accountsReport: 1, dataStatus: 1, compensationReport: 1, compensationBenchmark: 1, compensationBenefits: 1, cashRunway: 2, propertyDistributions: 1, facilities: 4 });
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
        product: 'finance', environment: 'staging', version: FINANCE_VERSION,
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

  it('denies the Giving API when no identity is available, including staging', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), env);
    expect(res.status).toBe(403);
    expect(statements).toHaveLength(0);
  });

  it('serves the real live summary instead once the service binding and shared secret are configured', async () => {
    const liveEnv = {
      ...env,
      CONNECT_SERVICE: {
        // Branches on the request URL because this same binding now also serves shell.js's own
        // connect.staff-role-v1 role check (see connect-role-client.js) -- with CONNECT_SERVICE
        // configured, a request that reaches the shell route with no verified role now fails
        // closed (see the "fails closed" describe block below), so this mock must answer the role
        // check with an allowed role rather than only ever returning the giving-summary shape.
        async fetch(request) {
          const url = new URL(request instanceof Request ? request.url : request);
          if (url.pathname === '/api/contracts/staff-role-v1') {
            return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
          }
          return new Response(JSON.stringify({
            contract: 'connect.giving-summary.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            period: { startDate: '2026-06-01', endDate: '2026-06-14' },
            generatedAt: '2026-06-15T00:00:00Z', sourceThrough: '2026-06-14T23:59:59Z',
            funds: [{ fundRef: '9', fundLabel: 'Live Test Fund', giftCount: 1, householdCount: 1,
              amounts: { grossCents: 500000, refundCents: 0, netCents: 500000 }, isGeneralFund: true }],
            totals: { grossCents: 500000, refundCents: 0, netCents: 500000 },
            reconciliation: { sourceRecordCount: 1, fundCount: 1, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), liveEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-giving-source')).toBe('live');
    const body = await res.json();
    expect(body.totals).toEqual({ grossCents: 500000, refundCents: 0, netCents: 500000 });
    expect(body.funds[0].fundLabel).toBe('Live Test Fund');

    // The Financial Health section renders from the same resolver and says so. A verified,
    // allowed role (Access JWT header + the role mock above) is required now that role
    // verification failing for any reason other than 'not_configured' fails closed.
    const shellRes = await worker.fetch(new Request('https://finance.test/?section=health&view=detail', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), liveEnv);
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
      release: { version: FINANCE_VERSION, releaseSha: 'test-sha' },
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

  // Bug fix: production's real Finance D1 genuinely has zero `source='synthetic_fixture'` rows
  // (fixtures are a staging-only, explicitly applied step, never part of a migration -- see
  // apps/finance/README.md's "Known readiness limitations"). Several readSynthetic*() functions
  // correctly throw when their expected fixture row is entirely absent (a real data-integrity
  // check), but before this fix that throw was caught only by the ONE big try/catch around the
  // whole route handler, which turned "no fixture row exists yet" into a generic full-page 503 --
  // even for a section (like Church Report) whose own independent live-first resolver had already
  // succeeded. This env simulates that empty-but-not-erroring production database: every D1 batch
  // call succeeds and returns zero rows for every statement, rather than throwing itself.
  describe('degrades per-field instead of 503ing the whole page when synthetic fixture rows are empty', () => {
    const emptyFinanceDb = {
      prepare(sql) { return { sql }; },
      async batch(batchStatements) {
        return batchStatements.map(() => ({ results: [] }));
      },
    };

    it('reproduces the bug directly against the unpatched synthetic readers (sanity check)', async () => {
      const { readSyntheticSummary } = await import('../apps/finance/summary-service.js');
      await expect(readSyntheticSummary(emptyFinanceDb)).rejects.toThrow();
      const { readSyntheticChurchTrends } = await import('../apps/finance/church-report-service.js');
      await expect(readSyntheticChurchTrends(emptyFinanceDb)).rejects.toThrow();
    });

    it('still renders a section with its own live resolver (Church Report) with real live data, not a 503', async () => {
      const VALID_LIVE_CHURCH_REPORT = {
        contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
        sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
        fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-14T12:00:00Z',
        accounts: [{
          classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions',
          depth: 0, hasChildren: false, actualCents: 1300000, budgetCents: 1250000, source: 'import',
        }],
        totals: {
          incomeActualCents: 1300000, incomeBudgetCents: 1250000, expenseActualCents: 0, expenseBudgetCents: 0,
          netIncomeActualCents: 1300000, netIncomeBudgetCents: 1250000, hasBudgetData: true,
        },
        reconciliation: {
          accountCount: 1, incomeCount: 1, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0,
          costOfGoodsSoldCount: 0, accountsWithBudgetCount: 1, totalsMatch: true,
        },
      };
      const liveEnv = envWithRoleService(async (request) => {
        const url = new URL(request instanceof Request ? request.url : request);
        if (url.pathname === '/api/contracts/staff-role-v1') {
          return new Response(JSON.stringify({ role: 'finance', permissions: DEFAULT_ROLE_PERMISSIONS.finance }), { status: 200 });
        }
        if (url.pathname === '/api/contracts/finance-church-report-v1') {
          return new Response(JSON.stringify(VALID_LIVE_CHURCH_REPORT), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });
      liveEnv.FINANCE_DB = emptyFinanceDb;

      const res = await worker.fetch(new Request('https://finance.test/?section=church', {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      }), liveEnv);
      // Before the fix: this 503'd because the unconditional, unrelated synthetic `summary` and
      // `churchTrends` reads (eagerly fetched for the 'church' section too) threw against the
      // empty database, even though churchReportLive above already succeeded.
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Church Report overview');
      expect(html).toContain('Live from Connect');
      expect(html).toContain('$13,000');
      expect(html).not.toContain('Synthetic staging data unavailable');
    });

    it('renders a genuinely synthetic-only section (Financial Health) as 200 with honest "unavailable" panels, never a blank/zero or a 503', async () => {
      const emptyEnv = { ...env, FINANCE_DB: emptyFinanceDb };
      const res = await worker.fetch(new Request('https://finance.test/?section=health&view=detail'), emptyEnv);
      // Before the fix: this 503'd with the generic "Synthetic staging data unavailable" -- every
      // one of Financial Health's several unconditional synthetic reads throws against this empty
      // database, and the single outer try/catch turned the first one into a full-page 503.
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('Synthetic staging data unavailable');
      // Every data-backed panel says so honestly -- never a fabricated blank or $0 figure.
      expect(html).toContain('Operating result');
      expect(html).toContain('Data temporarily unavailable');
      expect(html).toContain('Financial position');
      expect(html).toContain('General Fund giving');
      expect(html).not.toContain('<strong>$0</strong>');
      // The purely-static decision framing (not data-derived) still renders even though every
      // data-backed card on the same page is unavailable.
      expect(html).toContain('Full control');
      expect(html).toContain('Reported, not managed');
      expect(html).toContain('Timing decision');
    });
  });
});
