import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';
import givingFixture from '../../contracts/examples/giving-summary-v1.synthetic.json';
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';
import { buildSummaryV1, FINANCE_SUMMARY_CONTRACT, readSyntheticSummary } from './summary-service.js';
import { isFinanceMethodAllowed, resolveFinanceRoute } from './route-manifest.js';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection } from './parity-manifest.js';
import { buildFinancialHealthView } from './health-view-model.js';
import { buildChurchReportView, readSyntheticChurchReport } from './church-report-service.js';
import { buildBalanceSheetView, readSyntheticBalanceSheet } from './balance-sheet-service.js';
import { buildDaycareReportView, readSyntheticDaycareReport } from './daycare-report-service.js';

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

function renderBalanceRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_balance_cents)}</td></tr>`).join('');
}

function renderDaycareRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.entry_type)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

function renderSectionBody(section, summary, giving, churchReport, balanceSheet, daycareReport) {
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
  return `<section class="parity" aria-label="${section.label} staging scaffold">
    <h2>${section.label}</h2>
    <p>This familiar workspace is retained in the parity plan. Its production workflow and data are not connected to staging.</p>
    <ul>${section.capabilities.map((capability) => `<li>${capability}</li>`).join('')}</ul>
  </section>`;
}

function renderShell(metadata, summary, giving, section, churchReport, balanceSheet, daycareReport) {
  const release = `${metadata.version} · ${metadata.releaseChannel}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Timothy Finance — Staging</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #08131f; color: #e8f0f7; }
    main { width: min(72rem, calc(100% - 2rem)); padding: 2.5rem; border: 1px solid #27425a; border-radius: 1rem; background: #0e1e2d; }
    .eyebrow { color: #80c7ff; font-size: .78rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: .65rem 0 1rem; font-size: clamp(2rem, 7vw, 3.5rem); line-height: 1; }
    p { color: #b8c8d6; line-height: 1.6; }
    .status { margin-top: 1.75rem; padding: 1rem; border-radius: .65rem; background: #102a3d; color: #d9efff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(9rem,1fr)); gap: .75rem; margin-top: 1.25rem; }
    .card { padding: 1rem; border: 1px solid #27425a; border-radius: .65rem; }
    .card small { display: block; color: #80c7ff; margin-bottom: .35rem; }
    .card strong { font-size: 1.3rem; }
    .card span, .decision span { display:block; margin-top:.4rem; color:#9db0c1; font-size:.78rem; line-height:1.45; }
    .section-heading { display:flex; justify-content:space-between; gap:1rem; align-items:end; margin-top:1.4rem; }
    .section-heading h2 { margin:.3rem 0 0; font-size:1.55rem; }
    .badge { padding:.35rem .6rem; border:1px solid #3c6688; border-radius:999px; color:#80c7ff; font-size:.72rem; }
    .decision-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.75rem; margin-top:.75rem; }
    .decision { padding:1rem; border-left:3px solid #80c7ff; background:#102536; border-radius:.35rem; }
    .decision small, .decision b { display:block; }
    .table-wrap { overflow-x:auto; margin-top:1rem; border:1px solid #27425a; border-radius:.65rem; }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th, td { padding:.7rem .8rem; border-bottom:1px solid #27425a; text-align:left; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
    th { color:#80c7ff; background:#102536; }
    nav { display:flex; gap:.45rem; overflow-x:auto; padding:.4rem 0 1rem; margin-top:1.25rem; border-bottom:1px solid #27425a; }
    nav a { flex:0 0 auto; padding:.55rem .75rem; border-radius:.45rem; color:#b8c8d6; text-decoration:none; font-size:.82rem; }
    nav a[aria-current="page"] { background:#17486a; color:#fff; }
    .parity { margin-top:1.25rem; padding:1.25rem; border:1px solid #27425a; border-radius:.65rem; }
    .parity h2 { margin:0 0 .5rem; }
    .parity ul { columns:2; color:#b8c8d6; line-height:1.8; }
    footer { margin-top: 2rem; color: #7890a4; font-size: .8rem; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Isolated staging environment</div>
    <h1>Timothy Finance</h1>
    <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
    <div class="status">Environment ready · no production writers attached</div>
    <nav aria-label="Finance workspace">${renderSectionNav(section)}</nav>
    ${renderSectionBody(section, summary, giving, churchReport, balanceSheet, daycareReport)}
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
        const balanceSheet = section.id === 'balance'
          ? await readSyntheticBalanceSheet(env.FINANCE_DB) : null;
        const daycareReport = section.id === 'daycare'
          ? await readSyntheticDaycareReport(env.FINANCE_DB) : null;
        return response(renderShell(metadata, summary, SYNTHETIC_GIVING, section, churchReport, balanceSheet, daycareReport), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch {
        return response('Synthetic staging data unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }

    return response('Route manifest mismatch', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
