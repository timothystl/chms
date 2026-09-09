import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';
import givingFixture from '../../contracts/examples/giving-summary-v1.synthetic.json';
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';
import { buildSummaryV1, FINANCE_SUMMARY_CONTRACT, readSyntheticSummary } from './summary-service.js';
import { isFinanceMethodAllowed, resolveFinanceRoute } from './route-manifest.js';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection } from './parity-manifest.js';
import { buildFinancialHealthView } from './health-view-model.js';
import { buildChurchReportView, readSyntheticChurchReport, readSyntheticChurchTrends } from './church-report-service.js';
import { buildBalanceSheetView, readSyntheticBalanceSheet } from './balance-sheet-service.js';
import { buildDaycareReportView, readSyntheticDaycareReport } from './daycare-report-service.js';
import { buildPropertyReportView, readSyntheticPropertyReport } from './property-report-service.js';
import { buildBudgetReportView, readSyntheticBudgetReport } from './budget-report-service.js';
import { buildAccountsReportView, readSyntheticAccountsReport } from './accounts-report-service.js';
import { buildDataStatusView, readSyntheticDataStatus } from './data-status-service.js';
import { buildCompensationReportView, readSyntheticCompensationReport } from './compensation-report-service.js';

const PRODUCT = 'finance';
const SUMMARY_CONTRACT = FINANCE_SUMMARY_CONTRACT;
const GIVING_CONTRACT = 'connect.giving-summary.v1';
const SYNTHETIC_GIVING = acceptConnectGivingSummaryV1(givingFixture);

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
});

function response(body, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(body, { ...init, headers });
}

function releaseMetadata(env) {
  return {
    product: PRODUCT,
    environment: env.ENVIRONMENT || 'unknown',
    version: FINANCE_VERSION,
    releaseChannel: FINANCE_RELEASE_CHANNEL,
    releaseSha: env.RELEASE_SHA || 'local',
  };
}

function formatCents(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

function formatSignedCents(value) {
  const amount = formatCents(Math.abs(value));
  return value < 0 ? `−${amount}` : amount;
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return [...String(value)].map((character) => entities[character] || character).join('');
}

function renderSectionNav(activeSection) {
  return FINANCE_PARITY_SECTIONS.map((section) =>
    `<a href="/?section=${section.id}"${section.id === activeSection.id ? ' aria-current="page"' : ''}>${section.label}</a>`
  ).join('');
}

function renderChurchRows(rows) {
  return rows.map((row) => {
    const variance = row.classification === 'Income'
      ? row.own_actual_cents - row.own_budget_cents
      : row.own_budget_cents - row.own_actual_cents;
    return `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_actual_cents)}</td><td>${formatCents(row.own_budget_cents)}</td><td>${formatSignedCents(variance)}</td></tr>`;
  }).join('');
}

function renderChurchTrendRows(rows) {
  return rows.map((row) => `<tr><td>${row.fiscal_year}</td><td>${formatCents(row.income_cents)}</td><td>${formatCents(row.expense_cents)}</td><td>${formatSignedCents(row.net_cents)}</td></tr>`).join('');
}

function renderBalanceRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_balance_cents)}</td></tr>`).join('');
}

function renderDaycareRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.entry_type)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

function renderPropertyRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${row.occupancy_pct.toFixed(0)}%</td><td>${formatCents(row.total_revenue_cents)}</td><td>${formatCents(row.total_expenses_cents)}</td><td>${formatSignedCents(row.net_income_cents)}</td></tr>`).join('');
}

function renderBudgetRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${formatCents(row.planned_amount_cents)}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
}

function renderAccountRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category_path)}</td><td>${escapeHtml(row.account_name)}</td></tr>`).join('');
}

function renderCompensationRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.role_label)}</td><td>${formatCents(row.salary_cents)}</td><td>${formatCents(row.benefits_cents)}</td><td>${row.adjustment_pct.toFixed(1)}%</td></tr>`).join('');
}

function renderSectionBody(section, summary, giving, churchReport, churchTrends, balanceSheet, daycareReport, propertyReport, budgetReport, accountsReport, dataStatus, compensationReport) {
  if (section.id === 'health') {
    const health = buildFinancialHealthView(summary, giving);
    return `<section aria-label="Synthetic financial health">
      <div class="section-heading"><div><div class="eyebrow">Financial Health</div><h2>How are we doing, and what should we decide?</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid">
        <div class="card"><small>Operating result</small><strong>${formatSignedCents(health.operating.actualNetCents)}</strong><span>Budget ${formatSignedCents(health.operating.budgetNetCents)} · variance ${formatSignedCents(health.operating.varianceCents)}</span></div>
        <div class="card"><small>Financial position</small><strong>${formatCents(health.position.netAssetsCents)}</strong><span>Assets ${formatCents(health.position.assetsCents)} · liabilities ${formatCents(health.position.liabilitiesCents)}</span></div>
        <div class="card"><small>Giving reconciliation</small><strong>${formatCents(health.giving.netCents)}</strong><span>${health.giving.sourceRecordCount} aggregate records · ${health.giving.reconciled ? 'totals match' : 'review required'}</span></div>
      </div>
      <div class="decision-grid">${health.decisions.map((decision) => `<div class="decision"><small>${decision.stream}</small><b>${decision.authority}</b><span>${decision.action}</span></div>`).join('')}</div>
    </section>`;
  }
  if (section.id === 'church') {
    const report = buildChurchReportView(churchReport);
    const variance = report.totals.actualNetCents - report.totals.budgetNetCents;
    return `<section class="report" aria-label="Synthetic Church Report">
      <div class="section-heading"><div><div class="eyebrow">Church Report</div><h2>Fiscal year ${report.fiscalYear}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Income</small><strong>${formatCents(report.totals.incomeActualCents)}</strong></div><div class="card"><small>Expenses</small><strong>${formatCents(report.totals.expenseActualCents)}</strong></div><div class="card"><small>Net result</small><strong>${formatSignedCents(report.totals.actualNetCents)}</strong><span>Budget ${formatSignedCents(report.totals.budgetNetCents)} · variance ${formatSignedCents(variance)}</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Account</th><th>Actual</th><th>Budget</th><th>Favorable variance</th></tr></thead><tbody>${renderChurchRows([...report.income, ...report.expenses])}</tbody></table></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Operating history</div><h2>Multi-year operating trend</h2></div></div>
      <div class="table-wrap"><table><thead><tr><th>Fiscal year</th><th>Income</th><th>Expenses</th><th>Net result</th></tr></thead><tbody>${renderChurchTrendRows(churchTrends)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'balance') {
    const report = buildBalanceSheetView(balanceSheet);
    return `<section class="report" aria-label="Synthetic Balance Sheet">
      <div class="section-heading"><div><div class="eyebrow">Balance Sheet</div><h2>Financial position as of ${escapeHtml(report.asOfDate)}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Assets</small><strong>${formatCents(report.totals.assetsCents)}</strong></div><div class="card"><small>Liabilities</small><strong>${formatCents(report.totals.liabilitiesCents)}</strong></div><div class="card"><small>Net assets</small><strong>${formatCents(report.totals.equityCents)}</strong><span>Equation difference ${formatSignedCents(report.totals.equationDifferenceCents)}</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Account</th><th>Balance</th></tr></thead><tbody>${renderBalanceRows([...report.assets, ...report.liabilities, ...report.equity])}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'daycare') {
    const report = buildDaycareReportView(daycareReport);
    return `<section class="report" aria-label="Synthetic Daycare Report">
      <div class="section-heading"><div><div class="eyebrow">Daycare Report</div><h2>Operating report for ${escapeHtml(report.period)}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Tuition income</small><strong>${formatCents(report.totals.incomeActualCents)}</strong></div><div class="card"><small>Operating expenses</small><strong>${formatCents(report.totals.expenseActualCents)}</strong></div><div class="card"><small>Operating result</small><strong>${formatSignedCents(report.totals.netActualCents)}</strong><span>Budget ${formatSignedCents(report.totals.netBudgetCents)}</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Category</th><th>Type</th><th>Amount</th></tr></thead><tbody>${renderDaycareRows(report.categories)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'property') {
    const report = buildPropertyReportView(propertyReport);
    return `<section class="report" aria-label="Synthetic Commercial Property Report">
      <div class="section-heading"><div><div class="eyebrow">Commercial Property</div><h2>Property performance through ${escapeHtml(report.periodEnd)}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Revenue</small><strong>${formatCents(report.totals.revenueCents)}</strong><span>Average occupancy ${report.averageOccupancyPct.toFixed(0)}%</span></div><div class="card"><small>Expenses</small><strong>${formatCents(report.totals.expenseCents)}</strong><span>Reserve balance ${formatCents(report.totals.latestReserveCents)}</span></div><div class="card"><small>Net income</small><strong>${formatSignedCents(report.totals.netIncomeCents)}</strong><span>Available for distribution ${formatCents(report.totals.distributableCents)}</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Period</th><th>Occupancy</th><th>Revenue</th><th>Expenses</th><th>Net income</th></tr></thead><tbody>${renderPropertyRows(report.rows)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'planning') {
    const report = buildBudgetReportView(budgetReport);
    return `<section class="report" aria-label="Synthetic Budget Report">
      <div class="section-heading"><div><div class="eyebrow">Budget</div><h2>Plan for fiscal year ${report.fiscalYear}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Planned income</small><strong>${formatCents(report.totals.incomeCents)}</strong></div><div class="card"><small>Planned expenses</small><strong>${formatCents(report.totals.expenseCents)}</strong></div><div class="card"><small>Planned result</small><strong>${formatSignedCents(report.totals.netCents)}</strong><span>Read-only planning preview</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Category</th><th>Planned amount</th><th>Notes</th></tr></thead><tbody>${renderBudgetRows(report.rows)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'accounts') {
    const report = buildAccountsReportView(accountsReport);
    return `<section class="report" aria-label="Synthetic Chart of Accounts">
      <div class="section-heading"><div><div class="eyebrow">Chart of Accounts</div><h2>Account inventory</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Total accounts</small><strong>${report.counts.total}</strong></div><div class="card"><small>Income accounts</small><strong>${report.counts.income}</strong></div><div class="card"><small>Expense accounts</small><strong>${report.counts.expenses}</strong><span>Read-only inventory</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Classification</th><th>Account path</th><th>Account</th></tr></thead><tbody>${renderAccountRows(report.rows)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'compensation') {
    const report = buildCompensationReportView(compensationReport);
    return `<section class="report" aria-label="Synthetic Compensation Report">
      <div class="section-heading"><div><div class="eyebrow">Compensation</div><h2>Role-level plan for fiscal year ${report.fiscalYear}</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Salary plan</small><strong>${formatCents(report.totals.salaryCents)}</strong></div><div class="card"><small>Benefits plan</small><strong>${formatCents(report.totals.benefitsCents)}</strong></div><div class="card"><small>Total compensation</small><strong>${formatCents(report.totals.totalCents)}</strong><span>No personal identities</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Role</th><th>Salary</th><th>Benefits</th><th>Adjustment</th></tr></thead><tbody>${renderCompensationRows(report.rows)}</tbody></table></div>
    </section>`;
  }
  if (section.id === 'data') {
    const status = buildDataStatusView(dataStatus);
    return `<section class="report" aria-label="Synthetic Data and Imports Status">
      <div class="section-heading"><div><div class="eyebrow">Data &amp; Imports</div><h2>Source and isolation status</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid"><div class="card"><small>Fixture source</small><strong>${escapeHtml(status.source)}</strong><span>${escapeHtml(status.note)}</span></div><div class="card"><small>Production connection</small><strong>${status.productionConnected ? 'Connected' : 'Disconnected'}</strong></div><div class="card"><small>Application writer</small><strong>${status.writerConnected ? 'Connected' : 'Disconnected'}</strong><span>Last fixture import ${escapeHtml(status.lastImportedAt)}</span></div></div>
    </section>`;
  }
  return `<section class="parity" aria-label="${section.label} staging scaffold">
    <h2>${section.label}</h2>
    <p>This familiar workspace is retained in the parity plan. Its production workflow and data are not connected to staging.</p>
    <ul>${section.capabilities.map((capability) => `<li>${capability}</li>`).join('')}</ul>
  </section>`;
}

function renderShell(metadata, summary, giving, section, churchReport, churchTrends, balanceSheet, daycareReport, propertyReport, budgetReport, accountsReport, dataStatus, compensationReport) {
  const release = `${metadata.version} · ${metadata.releaseChannel}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Timothy Finance — Staging</title>
  <style>
    :root { color-scheme: light; font-family: "DM Sans", "Source Sans 3", Arial, sans-serif; --navy:#1e2d4a; --teal:#2e7ea6; --gold:#c9973a; --charcoal:#1a1a2a; --warm-gray:#8a8377; --warm-meta:#8a7a5c; --warm-label:#5c4b2e; --border:#e5d9be; --divider:#f1e7d2; --page:#fbf8f1; --header:#fbf3e1; --card:#fffdf9; --sage:#6b8f71; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; background: var(--page); color: var(--charcoal); }
    .appbar { min-height:4.5rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.8rem max(1rem,calc((100% - 72rem)/2)); background:var(--navy); color:#fff; box-shadow:0 3px 14px rgba(30,45,74,.18); }
    .brand { display:flex; align-items:center; gap:.75rem; font-family:Georgia,serif; font-size:1.08rem; font-weight:700; }
    .brand small { display:block; color:rgba(255,255,255,.65); font-family:Arial,sans-serif; font-size:.68rem; letter-spacing:.12em; text-transform:uppercase; margin-top:.12rem; }
    .mark { width:2.3rem; height:2.3rem; display:grid; place-items:center; border:1px solid rgba(255,255,255,.45); border-radius:50%; color:#f5e0b0; font-size:1.25rem; }
    .environment { padding:.35rem .7rem; border:1px solid rgba(255,255,255,.25); border-radius:99px; color:#f5e0b0; font-size:.72rem; font-weight:700; }
    main { width:min(72rem,calc(100% - 2rem)); margin:0 auto; padding:2.3rem 0 3rem; }
    .eyebrow { color:var(--warm-meta); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:.35rem 0 .55rem; color:var(--navy); font-family:Georgia,serif; font-size:clamp(2.1rem,6vw,3.2rem); line-height:1; }
    p { color:var(--warm-gray); line-height:1.6; }
    .status { margin-top:1.2rem; padding:.75rem 1rem; border-left:4px solid var(--sage); border-radius:.55rem; background:#edf3ee; color:#4a6e52; font-size:.84rem; font-weight:700; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(12rem,1fr)); gap:1rem; margin-top:1.25rem; }
    .card { padding:1.15rem 1.25rem; border-top:4px solid var(--teal); border-radius:1.1rem; background:var(--card); box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05); }
    .card small { display:block; color:var(--warm-meta); margin-bottom:.4rem; font-size:.7rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .card strong { color:var(--charcoal); font-size:1.65rem; font-variant-numeric:tabular-nums; }
    .card span, .decision span { display:block; margin-top:.45rem; color:var(--warm-gray); font-size:.76rem; line-height:1.45; }
    .section-heading { display:flex; justify-content:space-between; gap:1rem; align-items:end; margin-top:1.4rem; }
    .section-heading h2 { margin:.25rem 0 0; color:var(--navy); font-family:Georgia,serif; font-size:1.75rem; }
    .badge { padding:.35rem .7rem; border-radius:999px; background:#eaf4fa; color:var(--teal); font-size:.72rem; font-weight:700; }
    .decision-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.75rem; margin-top:.75rem; }
    .decision { padding:1rem; border:1px solid var(--border); border-left:4px solid var(--gold); background:var(--card); border-radius:.75rem; }
    .decision small, .decision b { display:block; }
    .decision small { color:var(--warm-meta); text-transform:uppercase; font-size:.68rem; font-weight:700; }
    .decision b { color:var(--navy); margin-top:.25rem; }
    .table-wrap { overflow-x:auto; margin-top:1rem; border:1px solid var(--border); border-radius:.85rem; background:var(--card); }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th, td { padding:.75rem .85rem; border-bottom:1px solid var(--divider); text-align:left; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
    th { color:var(--warm-label); background:var(--header); font-size:.68rem; letter-spacing:.05em; text-transform:uppercase; }
    nav { display:flex; gap:.15rem; overflow-x:auto; padding:.45rem 0 0; margin-top:1.25rem; border-bottom:1px solid var(--border); }
    nav a { flex:0 0 auto; padding:.7rem .82rem; border-bottom:2px solid transparent; color:var(--warm-meta); text-decoration:none; font-size:.8rem; font-weight:700; }
    nav a[aria-current="page"] { border-bottom-color:var(--navy); color:var(--navy); }
    .parity { margin-top:1.25rem; padding:1.25rem; border:1px solid var(--border); border-radius:.85rem; background:var(--card); }
    .parity h2 { margin:0 0 .5rem; }
    .parity ul { columns:2; color:var(--warm-gray); line-height:1.8; }
    footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); color:var(--warm-meta); font-size:.75rem; }
    @media(max-width:767px){.appbar{padding:.75rem 1rem}.brand{font-size:.92rem}.environment{display:none}main{width:min(100% - 1.2rem,72rem);padding-top:1.4rem}.section-heading{align-items:start;flex-direction:column}.grid{grid-template-columns:1fr}.parity ul{columns:1}}
  </style>
</head>
<body>
  <header class="appbar"><div class="brand"><span class="mark" aria-hidden="true">T</span><div>Timothy Lutheran Church<small>Finance workspace</small></div></div><span class="environment">Isolated staging</span></header>
  <main>
    <div class="eyebrow">Isolated staging environment</div>
    <h1>Timothy Finance</h1>
    <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
    <div class="status">Environment ready · no production writers attached</div>
    <nav aria-label="Finance workspace">${renderSectionNav(section)}</nav>
      ${renderSectionBody(section, summary, giving, churchReport, churchTrends, balanceSheet, daycareReport, propertyReport, budgetReport, accountsReport, dataStatus, compensationReport)}
    <p><small>All values shown here are deterministic synthetic staging fixtures. Giving is the committed Connect contract example, validated locally with no network call.</small></p>
    <footer>${release}</footer>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metadata = releaseMetadata(env);

    if (!isFinanceMethodAllowed(request.method)) {
      return response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' },
      });
    }

    const route = resolveFinanceRoute(url.pathname);
    if (!route) {
      return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (route.id === 'health') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', ...metadata });
      return response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (route.id === 'summary-v1') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify(buildSummaryV1(metadata, summary));
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Finance-Contract': SUMMARY_CONTRACT,
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'giving-preview-v1') {
      const body = request.method === 'HEAD' ? null : JSON.stringify(SYNTHETIC_GIVING);
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_CONTRACT,
      } });
    }

    if (route.id === 'summary-legacy') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify({ ...metadata, dataClassification: 'synthetic', summary });
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Deprecation: 'true',
          Link: '</api/v1/summary>; rel="successor-version"',
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'shell') {
      if (request.method === 'HEAD') return response(null, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      try {
        const section = resolveFinanceSection(url.searchParams.get('section'));
        const summary = section.id === 'health' || section.id === 'church'
          ? await readSyntheticSummary(env.FINANCE_DB) : null;
        const churchReport = section.id === 'church'
          ? await readSyntheticChurchReport(env.FINANCE_DB) : null;
        const churchTrends = section.id === 'church'
          ? await readSyntheticChurchTrends(env.FINANCE_DB) : null;
        const balanceSheet = section.id === 'balance'
          ? await readSyntheticBalanceSheet(env.FINANCE_DB) : null;
        const daycareReport = section.id === 'daycare'
          ? await readSyntheticDaycareReport(env.FINANCE_DB) : null;
        const propertyReport = section.id === 'property'
          ? await readSyntheticPropertyReport(env.FINANCE_DB) : null;
        const budgetReport = section.id === 'planning'
          ? await readSyntheticBudgetReport(env.FINANCE_DB) : null;
        const accountsReport = section.id === 'accounts'
          ? await readSyntheticAccountsReport(env.FINANCE_DB) : null;
        const dataStatus = section.id === 'data'
          ? await readSyntheticDataStatus(env.FINANCE_DB) : null;
        const compensationReport = section.id === 'compensation'
          ? await readSyntheticCompensationReport(env.FINANCE_DB) : null;
        return response(renderShell(metadata, summary, SYNTHETIC_GIVING, section, churchReport, churchTrends, balanceSheet, daycareReport, propertyReport, budgetReport, accountsReport, dataStatus, compensationReport), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch {
        return response('Synthetic staging data unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }

    return response('Route manifest mismatch', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
