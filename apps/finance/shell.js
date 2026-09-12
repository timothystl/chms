import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';
import givingFixture from '../../contracts/examples/giving-summary-v1.synthetic.json';
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';
import { reconcileSyntheticGivingDelivery } from './connect-giving-transport.js';
import { fetchLiveConnectGivingSummary, defaultLiveGivingPeriod, postConnectGivingQuickEntry } from './connect-giving-client.js';
import { callPayrollProxy } from './payroll-proxy-client.js';
import {
  buildPayrollSectionBundle, renderPayrollSection, saveAllHours, approvePeriod,
  saveStaffFromForm, deactivateStaffFromForm, buildCsvForPeriod, resolvePayrollPeriod, loadPayrollWorkspace,
  approverEmailFromJwt, emailReport,
} from './payroll-section.js';
import { missingHours as payrollMissingHours } from './payroll-calc.js';
import { decodeJwtClaimsUnsafe } from './jwt-decode-unsafe.js';
import { buildSummaryV1, FINANCE_SUMMARY_CONTRACT, readSyntheticSummary } from './summary-service.js';
import { isMethodAllowedForRoute, resolveFinanceRoute } from './route-manifest.js';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection, resolveFinancePage, groupFinanceSections } from './parity-manifest.js';
import { buildFinancialHealthView } from './health-view-model.js';
import { buildChurchReportView, readSyntheticChurchReport, readSyntheticChurchTrends } from './church-report-service.js';
import { readSyntheticBalanceSheet, readSyntheticBalanceTrends } from './balance-sheet-service.js';
import { buildDaycareReportView, readSyntheticDaycareReport, readSyntheticDaycareAllocation } from './daycare-report-service.js';
import { buildPropertyReportView, readSyntheticPropertyReport, readSyntheticPropertyReserves, readSyntheticPropertyLedgers, readSyntheticPropertyValuation } from './property-report-service.js';
import { readSyntheticBudgetReport } from './budget-report-service.js';
import { readSyntheticAccountsReport } from './accounts-report-service.js';
import { buildDataStatusView, resolveDataStatus } from './data-status-service.js';
import { readSyntheticCompensationReport } from './compensation-report-service.js';
import { buildCashRunwayView, readSyntheticCashRunway } from './cash-runway-service.js';
import { buildFinancialMixView } from './financial-mix-service.js';
import { buildEntityOverview } from './entity-overview-service.js';
import { buildOperatingBridge } from './operating-bridge-service.js';
import { readSyntheticPropertyForecast } from './property-forecast-service.js';
import { readSyntheticCompensationBenchmarks } from './compensation-benchmark-service.js';
import { readSyntheticCompensationBenefits } from './compensation-benefits-service.js';
import { readSyntheticPropertyDistributions } from './property-distributions-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderUnavailablePage } from './render-helpers.js';
import { renderChurchPage } from './church-pages.js';
import { renderBalancePage } from './balance-pages.js';
import { renderDaycarePage } from './daycare-pages.js';
import { renderPropertyPage } from './property-pages.js';
import { renderCompensationPage } from './compensation-pages.js';
import { renderPlanningPage } from './planning-pages.js';
import { renderAccountsPage } from './accounts-pages.js';
import { renderChartsPage, renderFinancialMixRows } from './charts-pages.js';
import { renderGiftEntryPage } from './gift-entry-pages.js';
import { renderQuickbooksPage } from './quickbooks-pages.js';
import { renderPacketPage } from './packet-pages.js';

const PRODUCT = 'finance';
const SUMMARY_CONTRACT = FINANCE_SUMMARY_CONTRACT;
const GIVING_CONTRACT = 'connect.giving-summary.v1';
const GIVING_TRANSPORT_EVIDENCE_CONTRACT = 'finance.connect-giving-transport-evidence.v1';
const SYNTHETIC_GIVING = acceptConnectGivingSummaryV1(givingFixture);

// Tries the real connect.giving-summary.v1 endpoint (see connect-giving-client.js); falls back
// to the committed synthetic fixture whenever the live call isn't configured yet or fails for
// any reason. Never throws, and the caller always gets a valid, already-accepted contract object
// either way — only `source` tells the two apart.
async function resolveGivingSummary(env) {
  const result = await fetchLiveConnectGivingSummary(env, defaultLiveGivingPeriod());
  if (result.ok) return { giving: result.summary, source: 'live' };
  return { giving: SYNTHETIC_GIVING, source: 'synthetic-fallback', fallbackReason: result.reason };
}
const SYNTHETIC_DELIVERY_ID = 'synthetic-giving-2026-01-v1';
const SYNTHETIC_GIVING_TRANSPORT = Object.freeze({
  contract: GIVING_TRANSPORT_EVIDENCE_CONTRACT,
  dataClassification: 'synthetic',
  scenario: reconcileSyntheticGivingDelivery({
    deliveryId: SYNTHETIC_DELIVERY_ID,
    payload: givingFixture,
    attemptedOutcomes: ['temporary_failure', 'delivered'],
  }),
  duplicateReplay: reconcileSyntheticGivingDelivery({
    deliveryId: SYNTHETIC_DELIVERY_ID,
    payload: givingFixture,
    attemptedOutcomes: ['delivered'],
    processedDeliveryIds: [SYNTHETIC_DELIVERY_ID],
  }),
});

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  // form-action is 'self', not 'none', for exactly one reason: the Giving quick-entry form
  // (see the 'giving' section below) has to submit somewhere. It still can't target any other
  // origin. Nothing else here changed -- still no script-src of any kind, so no inline or
  // external JS can run on this page regardless.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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

// Maps a postConnectGivingQuickEntry() failure (or Connect's own refusal message) to something
// a bookkeeper can act on, without leaking wire-level detail (network error text, status codes).
function describeGivingEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Giving entry is not connected yet. Nothing was recorded.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was recorded — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as recorded.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The gift was not recorded.';
  }
}

// Confirms the payroll relay actually reached Website's proxy and got real data back, without
// ever putting a staff name, ID, or wage figure in the response -- a count and the real result's
// field names are enough to prove the round trip is genuine, and this is deliberately reachable
// by anyone who can already view it (see the route-manifest.js comment on why this is temporary).
function summarizePayrollRelayDiagnostic(result) {
  if (!result.ok) {
    return {
      ok: false, reason: result.reason, message: result.message || null,
      status: result.status ?? null, bodyPreview: result.bodyPreview ?? null,
    };
  }
  const rows = Array.isArray(result.result) ? result.result : [];
  return { ok: true, staffCount: rows.length, sampleFields: rows[0] ? Object.keys(rows[0]) : [] };
}

// Shows what the incoming Access JWT *claims* (unverified -- see jwt-decode-unsafe.js) so a
// verification failure on Website's side, which deliberately never says which check failed, can
// be narrowed down without any change to Website's auth code. Never used for the actual relay call.
function describeIncomingAccessJwt(accessJwt) {
  if (!accessJwt) return { present: false };
  const claims = decodeJwtClaimsUnsafe(accessJwt);
  return claims ? { present: true, ...claims } : { present: true, malformed: true };
}

function renderSectionNav(activeSection, activePage) {
  const renderPages = (section, isActiveSection) => `<div class="nav-pages">${section.pages.map((page) =>
    `<a href="/?section=${section.id}&amp;page=${page.id}"${isActiveSection && page.id === activePage.id ? ' aria-current="page"' : ''}>${escapeHtml(page.label)}</a>`
  ).join('')}</div>`;

  return groupFinanceSections(FINANCE_PARITY_SECTIONS).map(({ group, sections }) => {
    // Most groups wrap exactly one section, so labeling both the group ("Church") and the
    // section ("Church Report") would just repeat the same idea -- only Accounts & Data
    // actually bundles more than one distinct section under one label, so only there does the
    // section get its own sub-label beneath the group's.
    if (sections.length === 1) {
      const [section] = sections;
      const isActiveSection = section.id === activeSection.id;
      const body = section.pages.length <= 1
        ? `<a href="/?section=${section.id}"${isActiveSection ? ' aria-current="page"' : ''}>${section.label}</a>`
        : renderPages(section, isActiveSection);
      return `<div class="nav-group">
        <div class="nav-group-label">${escapeHtml(group)}</div>
        ${body}
      </div>`;
    }
    return `<div class="nav-group">
      <div class="nav-group-label">${escapeHtml(group)}</div>
      ${sections.map((section) => {
        const isActiveSection = section.id === activeSection.id;
        if (section.pages.length <= 1) {
          return `<a href="/?section=${section.id}"${isActiveSection ? ' aria-current="page"' : ''}>${section.label}</a>`;
        }
        return `<div class="nav-section">
          <div class="nav-section-label${isActiveSection ? ' is-active' : ''}">${section.label}</div>
          ${renderPages(section, isActiveSection)}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function renderEntityCards(entities) {
  return entities.map((entity) => `<div class="card"><small>${escapeHtml(entity.label)} · ${escapeHtml(entity.periodLabel)}</small><strong>${formatSignedCents(entity.resultCents)}</strong><span>Income ${formatCents(entity.incomeCents)} · expenses ${formatCents(entity.expenseCents)}</span></div>`).join('');
}

function renderSectionBody(ctx) {
  const {
    section, pageId, summary, giving, givingSource, churchReport, churchTrends, balanceSheet, balanceTrends,
    daycareReport, daycareAllocation, propertyReport, propertyReserves, propertyLedgers, propertyValuation,
    propertyForecast, propertyDistributions, budgetReport, accountsReport, dataStatus, compensationReport,
    compensationBenchmarks, compensationBenefits, cashRunway, givingEntryStatus, givingEntryMessage, payrollBundle,
  } = ctx;
  if (section.id === 'health') {
    const health = buildFinancialHealthView(summary, giving);
    const runway = buildCashRunwayView(cashRunway);
    const mix = buildFinancialMixView(churchReport);
    const church = buildChurchReportView(churchReport);
    const entities = buildEntityOverview({
      church,
      daycare: buildDaycareReportView(daycareReport),
      property: buildPropertyReportView(propertyReport),
    });
    const bridge = buildOperatingBridge(church);
    const status = dataStatus ? buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    }) : null;
    const attentionItems = [];
    if (status?.freshness === 'stale') attentionItems.push(`Source data hasn't been reviewed in over ${status.freshnessWindowDays} days (${status.ageDays} days old) — see Data &amp; Imports.`);
    if (!health.giving.reconciled) attentionItems.push('Giving totals do not reconcile yet — review before relying on them.');
    if (health.operating.varianceCents < 0) attentionItems.push(`Operating result is ${formatSignedCents(health.operating.varianceCents)} behind budget.`);
    return `<section aria-label="Synthetic financial health">
      <div class="dashboard-intro"><div class="eyebrow">Dashboard</div><h2 class="dashboard-title">Are we okay?</h2><p>Four questions the council asks first — each one links to the report it came from.</p></div>
      <div class="section-heading"><div><div class="eyebrow">Needs your attention</div><h2>${attentionItems.length ? `${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'} flagged` : 'Nothing flagged right now'}</h2></div><span class="badge">${attentionItems.length ? 'Review' : 'Clear'}</span></div>
      ${attentionItems.length
        ? `<ul class="attention-list">${attentionItems.map((item) => `<li>${item}</li>`).join('')}</ul>`
        : '<p class="status">Nothing needs your attention right now.</p>'}
      <div class="section-heading"><div><div class="eyebrow">Financial Health</div><h2>How are we doing, and what should we decide?</h2></div><span class="badge">Synthetic staging</span></div>
      <div class="grid">
        <div class="card"><small>Operating result</small><strong>${formatSignedCents(health.operating.actualNetCents)}</strong><span>Budget ${formatSignedCents(health.operating.budgetNetCents)} · variance ${formatSignedCents(health.operating.varianceCents)}</span></div>
        <div class="card"><small>Financial position</small><strong>${formatCents(health.position.netAssetsCents)}</strong><span>Assets ${formatCents(health.position.assetsCents)} · liabilities ${formatCents(health.position.liabilitiesCents)}</span></div>
        <div class="card"><small>Giving reconciliation</small><strong>${formatCents(health.giving.netCents)}</strong><span>${health.giving.sourceRecordCount} aggregate records · ${health.giving.reconciled ? 'totals match' : 'review required'} · ${givingSource === 'live' ? 'live from Connect' : 'synthetic fixture'}</span></div>
      </div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Liquidity</div><h2>Operating cash runway</h2></div><span class="badge">As of ${escapeHtml(runway.asOfDate)}</span></div>
      <div class="grid"><div class="card"><small>Operating cash</small><strong>${formatCents(runway.operatingCashCents)}</strong><span>${escapeHtml(runway.accountName)} · synthetic fixture</span></div><div class="card"><small>Average monthly expense</small><strong>${formatCents(runway.monthlyExpenseCents)}</strong><span>FY${runway.fiscalYear} annual expense ${formatCents(runway.annualExpenseCents)}</span></div><div class="card"><small>Expense coverage</small><strong>${runway.runwayMonths.toFixed(1)} months</strong><span>Cash divided by average monthly expense · read-only</span></div></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Operating mix</div><h2>Where money comes from and goes</h2></div><span class="badge">FY${mix.fiscalYear} · reconciled</span></div>
      <div class="grid"><div><h3>Revenue mix</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Share</th></tr></thead><tbody>${renderFinancialMixRows(mix.income.items)}</tbody></table></div></div><div><h3>Expense mix</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Share</th></tr></thead><tbody>${renderFinancialMixRows(mix.expenses.items)}</tbody></table></div></div></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Entity overview</div><h2>Separate operating views</h2></div><span class="badge">Not consolidated</span></div>
      <div class="grid">${renderEntityCards(entities.entities)}</div>
      <p>Periods are shown separately because these synthetic sources do not share one reporting window; their results are not added together.</p>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Money flow</div><h2>FY${bridge.fiscalYear} Church operating bridge</h2></div><span class="badge">Reconciled</span></div>
      <div class="grid"><div class="card"><small>1 · Income</small><strong>${formatCents(bridge.incomeCents)}</strong></div><div class="card"><small>2 · Expenses</small><strong>−${formatCents(bridge.expenseCents)}</strong></div><div class="card"><small>3 · ${bridge.resultLabel}</small><strong>${formatSignedCents(bridge.resultCents)}</strong><span>Income minus expenses</span></div></div>
      <p>This is an arithmetic operating bridge, not donor-to-expense tracing or a claim that particular revenue funded particular costs.</p>
      <div class="decision-grid">${health.decisions.map((decision) => `<div class="decision"><small>${decision.stream}</small><b>${decision.authority}</b><span>${decision.action}</span></div>`).join('')}</div>
    </section>`;
  }
  const page = resolveFinancePage(section, pageId);
  if (page.status === 'unavailable') {
    return renderUnavailablePage({ eyebrow: section.label, heading: page.label, reason: page.reason });
  }
  if (section.id === 'giving') {
    return renderGiftEntryPage(page.id, { giving, givingSource, givingEntryStatus, givingEntryMessage });
  }
  if (section.id === 'giving-analytics') {
    return renderUnavailablePage({ eyebrow: section.label, heading: page.label, reason: 'Not yet available.' });
  }
  if (section.id === 'charts') {
    return renderChartsPage(page.id, { churchReport, cashRunway, propertyReserves, giving, givingSource });
  }
  if (section.id === 'church') {
    return renderChurchPage(page.id, { churchReport, churchTrends });
  }
  if (section.id === 'balance') {
    return renderBalancePage(page.id, { balanceSheet, balanceTrends });
  }
  if (section.id === 'daycare') {
    return renderDaycarePage(page.id, { daycareReport, daycareAllocation });
  }
  if (section.id === 'property') {
    return renderPropertyPage(page.id, { propertyReport, propertyReserves, propertyLedgers, propertyValuation, propertyForecast, propertyDistributions });
  }
  if (section.id === 'planning') {
    return renderPlanningPage(page.id, { budgetReport });
  }
  if (section.id === 'accounts') {
    return renderAccountsPage(page.id, { accountsReport });
  }
  if (section.id === 'compensation') {
    return renderCompensationPage(page.id, { compensationReport, compensationBenchmarks, compensationBenefits });
  }
  if (section.id === 'quickbooks') {
    return renderQuickbooksPage(page.id, { dataStatus, accountsReport });
  }
  if (section.id === 'packet') {
    return renderPacketPage({ summary, churchReport, churchTrends, giving });
  }
  if (section.id === 'data') {
    const isLive = dataStatus.source === 'live';
    const status = buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    });
    return `<section class="report" aria-label="${isLive ? 'Data and Imports Status' : 'Synthetic Data and Imports Status'}">
      <div class="section-heading"><div><div class="eyebrow">Data &amp; Imports</div><h2>Source and isolation status</h2></div><span class="badge">${isLive ? 'Live from Connect' : 'Synthetic staging'}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Import activity' : 'Fixture source'}</small><strong>${escapeHtml(status.source)}</strong><span>${escapeHtml(status.note)}</span></div><div class="card"><small>Production connection</small><strong>${status.productionConnected ? 'Connected' : 'Disconnected'}</strong></div><div class="card"><small>QuickBooks writer</small><strong>${status.writerConnected ? 'Connected' : 'Disconnected'}</strong><span>${isLive ? "Connect's real finance_qb_connection state" : 'No competing staging writer'}</span></div></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Source freshness</div><h2>${status.freshness === 'stale' ? `Review before relying on this ${isLive ? 'data' : 'fixture'}` : `${isLive ? 'Data' : 'Fixture'} is within the review window`}</h2></div><span class="badge">${status.freshness}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Most recent import' : 'Last fixture import'}</small><strong>${escapeHtml(status.lastImportedAt)}</strong></div><div class="card"><small>Age at request</small><strong>${status.ageDays} days</strong><span>Policy window ${status.freshnessWindowDays} days</span></div></div>
      <p><small>${isLive ? "Fetched live from Connect's real, aggregate-only finance-data-status contract endpoint." : `The committed synthetic fixture (the live endpoint is not configured or did not answer${dataStatus.fallbackReason ? `: ${escapeHtml(dataStatus.fallbackReason)}` : ''}).`}</small></p>
    </section>`;
  }
  if (section.id === 'payroll') {
    return renderPayrollSection(payrollBundle);
  }
  return `<section class="parity" aria-label="${section.label} staging scaffold">
    <h2>${section.label}</h2>
    <p>This familiar workspace is retained in the parity plan. Its production workflow and data are not connected to staging.</p>
    <ul>${section.capabilities.map((capability) => `<li>${capability}</li>`).join('')}</ul>
  </section>`;
}

function renderShell(ctx) {
  const { metadata, section, pageId, givingSource, councilPreview } = ctx;
  const page = resolveFinancePage(section, pageId);
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
    .app-shell { display:grid; grid-template-columns:15.5rem minmax(0,1fr); min-height:100vh; }
    .app-sidebar { background:var(--navy); color:#fff; display:flex; flex-direction:column; position:sticky; top:0; height:100vh; overflow-y:auto; }
    .sidebar-brand { min-height:4.5rem; display:flex; align-items:center; gap:.75rem; padding:.9rem 1.1rem; border-bottom:1px solid rgba(255,255,255,.12); font-family:Georgia,serif; font-size:1.02rem; font-weight:700; }
    .sidebar-brand small { display:block; color:rgba(255,255,255,.65); font-family:Arial,sans-serif; font-size:.66rem; letter-spacing:.12em; text-transform:uppercase; margin-top:.12rem; }
    .mark { width:2.2rem; height:2.2rem; flex:0 0 auto; display:grid; place-items:center; border:1px solid rgba(255,255,255,.45); border-radius:50%; color:#f5e0b0; font-size:1.2rem; }
    .sidebar-foot { margin-top:auto; padding:.85rem 1.1rem; border-top:1px solid rgba(255,255,255,.12); color:rgba(255,255,255,.55); font-size:.68rem; line-height:1.5; }
    main { width:min(72rem,calc(100% - 2rem)); margin:0 auto; padding:2.3rem 0 3rem; }
    .eyebrow { color:var(--warm-meta); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:.35rem 0 .55rem; color:var(--navy); font-family:Georgia,serif; font-size:clamp(2.1rem,6vw,3.2rem); line-height:1; }
    p { color:var(--warm-gray); line-height:1.6; }
    .status { margin-top:1.2rem; padding:.75rem 1rem; border-left:4px solid var(--sage); border-radius:.55rem; background:#edf3ee; color:#4a6e52; font-size:.84rem; font-weight:700; }
    .status-error { border-left-color:#b23b3b; background:#fbeceb; color:#8a2f2f; }
    form { margin-top:1.25rem; }
    .form-grid { margin-top:0; }
    .field { display:flex; flex-direction:column; gap:.3rem; margin-top:1rem; }
    .field:first-child { margin-top:0; }
    label { color:var(--warm-label); font-size:.72rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    input, select { padding:.6rem .75rem; border:1px solid var(--border); border-radius:.55rem; background:var(--card); color:var(--charcoal); font-size:.9rem; font-family:inherit; }
    button { margin-top:1.4rem; padding:.75rem 1.4rem; border:none; border-radius:.6rem; background:var(--navy); color:#fff; font-size:.85rem; font-weight:700; cursor:pointer; }
    button:hover { background:#16233b; }
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
    nav { flex:1; overflow-y:auto; padding:.6rem .55rem 1rem; }
    .nav-group { margin-bottom:.35rem; }
    .nav-group-label { padding:.5rem .65rem .3rem; color:rgba(255,255,255,.5); font-size:.66rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
    .nav-section { margin-top:.15rem; }
    .nav-section-label { padding:.3rem .65rem; color:rgba(255,255,255,.65); font-size:.76rem; font-weight:700; }
    .nav-section-label.is-active { color:#fff; }
    .nav-pages { display:flex; flex-direction:column; }
    nav a { display:block; padding:.55rem .65rem; margin:1px 0; border-radius:.5rem; color:rgba(255,255,255,.78); text-decoration:none; font-size:.82rem; font-weight:600; }
    .nav-pages a { padding:.4rem .65rem .4rem 1.2rem; font-size:.78rem; font-weight:500; }
    nav a[aria-current="page"] { background:rgba(255,255,255,.14); color:#fff; }
    .dashboard-intro { margin-bottom:.25rem; }
    .dashboard-title { margin:.25rem 0 0; color:var(--navy); font-family:Georgia,serif; font-size:clamp(1.8rem,5vw,2.6rem); line-height:1.1; }
    .attention-list { margin:.75rem 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:.5rem; }
    .attention-list li { padding:.75rem 1rem; border:1px solid var(--border); border-left:4px solid var(--gold); border-radius:.55rem; background:var(--card); color:var(--warm-label); font-size:.84rem; }
    .status-pending { border-left-color:var(--warm-gray); background:var(--header); color:var(--warm-label); }
    .council-banner { display:flex; align-items:center; gap:.6rem; margin-top:1.1rem; padding:.75rem 1rem; border:1px solid var(--gold); border-radius:.6rem; background:#fdf8ec; color:#5c4b2e; font-size:.82rem; }
    .council-pill { padding:.2rem .55rem; border-radius:99px; background:var(--gold); color:#241a05; font-size:.66rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
    .council-toggle { margin-left:auto; padding:.4rem .7rem; border:1px solid var(--border); border-radius:.5rem; background:var(--card); color:var(--navy); font-size:.76rem; font-weight:700; text-decoration:none; }
    body.council-preview form[method="POST"] { display:none; }
    .parity { margin-top:1.25rem; padding:1.25rem; border:1px solid var(--border); border-radius:.85rem; background:var(--card); }
    .parity h2 { margin:0 0 .5rem; }
    .parity ul { columns:2; color:var(--warm-gray); line-height:1.8; }
    footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); color:var(--warm-meta); font-size:.75rem; }
    @media(max-width:767px){.app-shell{grid-template-columns:1fr}.app-sidebar{position:static;height:auto}nav{display:flex;flex-wrap:wrap;gap:.25rem;padding:.6rem}.nav-group,.nav-section,.nav-pages{display:contents}.nav-group-label,.nav-section-label{display:none}main{width:min(100% - 1.2rem,72rem);padding-top:1.4rem}.section-heading{align-items:start;flex-direction:column}.grid{grid-template-columns:1fr}.parity ul{columns:1}}
    /* ── Payroll ── */
    .pay-toolbar { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; }
    .pay-toolbar select { min-width:14rem; }
    .pay-tab { padding:.55rem .9rem; border:1px solid var(--border); border-radius:.6rem; background:var(--card); color:var(--warm-label); font-size:.78rem; font-weight:700; text-decoration:none; }
    .pay-tab.is-on { border-color:var(--teal); background:#e4eef4; color:var(--navy); }
    .pay-note { display:block; color:var(--warm-meta); font-size:.76rem; margin-top:.2rem; }
    .pay-pill { display:inline-block; padding:.2rem .6rem; border-radius:999px; font-size:.68rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
    .pay-pill-good { background:#eaf1e5; color:#3b4c2e; }
    .pay-pill-warn { background:#fbf1dc; color:#7a5b18; }
    .pay-pill-plain { background:#f1efea; color:#6a6858; }
    .pay-in { width:5.5rem; padding:.4rem .5rem; text-align:right; font-size:.85rem; }
    .pay-in[readonly] { background:var(--header); }
    .pay-group { margin:1.4rem 0 .6rem; color:var(--warm-meta); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .pay-card { border:1px solid var(--border); border-radius:.85rem; overflow:hidden; background:var(--card); margin-top:.85rem; }
    .pay-card-bar { padding:.65rem 1rem; background:var(--header); color:var(--warm-label); font-size:.7rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; caption-side:top; text-align:left; }
    .pay-li { display:flex; justify-content:space-between; gap:1rem; padding:.55rem 1rem; border-bottom:1px solid var(--divider); font-size:.85rem; }
    .pay-li:last-child { border-bottom:0; }
    .pay-li.muted { color:var(--warm-meta); }
    .pay-li.neg { color:#8a4a4a; }
    .pay-li.total { background:var(--header); font-weight:700; }
    .pay-combined { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding:1rem 1.2rem; border:1px solid var(--gold); border-radius:.85rem; background:#fdf8ec; }
    .pay-combined b { margin-left:auto; font-size:1.5rem; color:var(--navy); }
    .pay-warn { margin-top:1rem; padding:.85rem 1rem; border:1px solid #e4c8c8; border-radius:.6rem; background:#faefef; color:#8a4a4a; font-size:.85rem; }
    .pay-foot { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border); }
    .pay-approve { background:var(--gold); color:#1b1608; }
    .pay-approve.is-done { background:var(--card); color:var(--navy); border:1px solid var(--border); }
    #pay-print { display:none; }
    .pt-header h2 { margin:0; font-size:1.05rem; color:var(--navy); }
    .pt-period { color:var(--warm-meta); font-size:.75rem; }
    .pt-section { margin:.85rem 0; }
    .pt-section-label { font-size:.68rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--warm-meta); border-bottom:1.5px solid var(--border); padding-bottom:.15rem; margin-bottom:.25rem; }
    .pt-table { width:100%; border-collapse:collapse; font-size:.78rem; }
    .pt-table th { text-align:left; padding:.2rem .5rem; background:var(--header); font-size:.65rem; text-transform:uppercase; }
    .pt-table td { padding:.2rem .5rem; }
    .pt-table .pt-num { text-align:right; font-variant-numeric:tabular-nums; }
    .pt-table .pt-sub td { font-weight:700; background:var(--header); }
    .pt-total { display:flex; justify-content:space-between; margin-top:.6rem; padding:.55rem .75rem; border-radius:.5rem; background:var(--navy); color:#fff; font-weight:700; }
    .pt-warn { margin:0 0 .75rem; padding:.55rem .75rem; border:1px solid #e4c8c8; border-radius:.5rem; background:#faefef; color:#8a4a4a; font-size:.78rem; }
    @media print {
      .app-sidebar, nav, .pay-toolbar, form, .status, footer, h1, .eyebrow, main > p:first-of-type { display:none !important; }
      .app-shell { display:block; }
      #pay-print { display:block !important; }
    }
  </style>
</head>
<body${councilPreview ? ' class="council-preview"' : ''}>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="sidebar-brand"><span class="mark" aria-hidden="true">T</span><div>Timothy Finance<small>Standalone · alpha</small></div></div>
      <nav aria-label="Finance workspace">${renderSectionNav(section, page)}</nav>
      <div class="sidebar-foot">Synthetic staging data<br>No production writers attached</div>
    </aside>
    <main>
      <div class="eyebrow">Isolated staging environment</div>
      <h1>Timothy Finance</h1>
      <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
      <div class="status">Environment ready · no production writers attached</div>
      <div class="council-banner">
        <span class="council-pill">Council view</span>
        ${councilPreview
          ? `<span>Previewing what a view-only council/auditor login would see. Editing controls are hidden. Everything shown is already aggregate/role-only synthetic data, so there is nothing further to redact here.</span><a class="council-toggle" href="/?section=${section.id}&amp;page=${page.id}">Exit preview</a>`
          : `<span>Not a real access boundary yet -- Finance has no verified staff-identity/role check of its own (that is the still-unbuilt shared-login piece of the overhaul). This only previews what a future council view’s chrome would hide.</span><a class="council-toggle" href="/?section=${section.id}&amp;page=${page.id}&amp;council=1">Preview council view</a>`}
      </div>
      ${renderSectionBody(ctx)}
      <p><small>Every value besides Giving shown here comes from deterministic synthetic staging fixtures. Giving is ${givingSource === 'live' ? 'fetched live from Connect’s real, aggregate-only contract endpoint' : 'the committed Connect contract example (the live endpoint is not configured or did not answer), validated locally with no network call'}.</small></p>
      <footer>Timothy Lutheran Church · ${release}</footer>
    </main>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metadata = releaseMetadata(env);

    const route = resolveFinanceRoute(url.pathname);
    if (!route) {
      return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (!isMethodAllowedForRoute(route, request.method)) {
      return response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: route.methods.join(', ') },
      });
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
      const { giving, source } = await resolveGivingSummary(env);
      const body = request.method === 'HEAD' ? null : JSON.stringify(giving);
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_CONTRACT,
        'X-Giving-Source': source,
      } });
    }

    if (route.id === 'giving-transport-evidence-v1') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({
        ...SYNTHETIC_GIVING_TRANSPORT,
        release: metadata,
      });
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_TRANSPORT_EVIDENCE_CONTRACT,
      } });
    }

    if (route.id === 'giving-quick-entry-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=giving&status=error&reason=invalid_json' } });
      }
      const entry = {
        date: form.get('date') || '',
        fund_id: form.get('fund_id') || '',
        amount: form.get('amount') || '',
        method: form.get('method') || '',
        check_number: form.get('check_number') || '',
        person_id: form.get('person_id') || '',
        notes: form.get('notes') || '',
      };
      const result = await postConnectGivingQuickEntry(env, accessJwt, entry);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=giving&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'giving', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-relay-diagnostic-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const result = await callPayrollProxy(env, accessJwt, 'payroll_get_staff', {});
      const body = request.method === 'HEAD' ? null : JSON.stringify({
        ...summarizePayrollRelayDiagnostic(result),
        incomingAccessJwt: describeIncomingAccessJwt(accessJwt),
      });
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': 'finance.payroll-relay-diagnostic.v1',
      } });
    }

    // ── PAYROLL WRITES ── every one relays to Website's payroll_* RPCs, and Website's own
    // proxy is the real, authoritative gate (payroll_manage on the resolved contract-relay
    // identity, plus the period-lock check on payroll_save_hours) -- these handlers only
    // orchestrate the calls and redirect back to the page with a status message, the same
    // 303-redirect-after-POST shape giving-quick-entry-v1 above already uses.
    if (route.id === 'payroll-hours-save-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const periodStart = String(form.get('period') || '');
      const { period } = resolvePayrollPeriod(periodStart);
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const result = await saveAllHours(env, accessJwt, period.start, workspace.churchStaff, workspace.periodEntries, form);
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      params.set('status', result.ok ? 'saved' : 'error');
      if (!result.ok && result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-period-approve-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const periodStart = String(form.get('period') || '');
      const { period } = resolvePayrollPeriod(periodStart);
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const wantsApprove = form.get('action') !== 'unapprove';

      if (wantsApprove && !workspace.periodApproval) {
        const missing = payrollMissingHours(workspace.churchStaff, workspace.periodEntries);
        if (missing.length && form.get('confirm_missing') !== '1') {
          return response(null, { status: 303, headers: { Location: `/?section=payroll&period=${encodeURIComponent(period.start)}&view=entry&needs_confirm=1` } });
        }
      }
      if (!wantsApprove && form.get('confirm_unapprove') !== '1') {
        return response(null, { status: 303, headers: { Location: `/?section=payroll&period=${encodeURIComponent(period.start)}&view=entry` } });
      }

      const approvedBy = approverEmailFromJwt(accessJwt) || 'Finance';
      const result = await approvePeriod(env, accessJwt, period.start, approvedBy, workspace);
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      params.set('status', result.ok ? (wantsApprove ? 'approved' : 'unapproved') : 'error');
      if (!result.ok && result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-staff-save-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=staff-form&status=error&message=Could+not+read+the+form' } });
      }
      const result = await saveStaffFromForm(env, accessJwt, form);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=staff_saved' } });
      }
      const params = new URLSearchParams({ section: 'payroll', view: 'staff-form', status: 'error' });
      if (form.get('id')) params.set('id', String(form.get('id')));
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-staff-deactivate-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=error&message=Could+not+read+the+form' } });
      }
      const result = await deactivateStaffFromForm(env, accessJwt, form);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=staff_removed' } });
      }
      const params = new URLSearchParams({ section: 'payroll', view: 'staff-form', status: 'error', id: String(form.get('id') || '') });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-csv-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const { period } = resolvePayrollPeriod(url.searchParams.get('period'));
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const csv = buildCsvForPeriod(period, workspace);
      if (request.method === 'HEAD') {
        return response(null, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
      }
      return response(csv, { headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll-${period.start}.csv"`,
      } });
    }

    if (route.id === 'payroll-email-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const { period } = resolvePayrollPeriod(String(form.get('period') || ''));
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const result = await emailReport(env, accessJwt, period, workspace, form.get('force') === '1');
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      if (result.ok) {
        params.set('status', 'emailed');
        if (result.to) params.set('to', result.to);
      } else if (result.reason === 'already_sent') {
        params.set('status', 'already_sent');
        if (result.alreadySentTo) params.set('to', result.alreadySentTo);
        if (result.alreadySentAt) params.set('at', result.alreadySentAt);
      } else {
        params.set('status', 'error');
        params.set('message', String(result.message || result.reason || 'unknown error').slice(0, 200));
      }
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
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
        const pageId = url.searchParams.get('page');
        const councilPreview = url.searchParams.get('council') === '1';
        const summary = ['health', 'church', 'packet'].includes(section.id)
          ? await readSyntheticSummary(env.FINANCE_DB) : null;
        const churchReport = ['church', 'health', 'charts', 'packet'].includes(section.id)
          ? await readSyntheticChurchReport(env.FINANCE_DB) : null;
        const churchTrends = ['church', 'packet'].includes(section.id)
          ? await readSyntheticChurchTrends(env.FINANCE_DB) : null;
        const balanceSheet = section.id === 'balance'
          ? await readSyntheticBalanceSheet(env.FINANCE_DB) : null;
        const balanceTrends = section.id === 'balance'
          ? await readSyntheticBalanceTrends(env.FINANCE_DB) : null;
        const daycareReport = section.id === 'daycare' || section.id === 'health'
          ? await readSyntheticDaycareReport(env.FINANCE_DB) : null;
        const daycareAllocation = section.id === 'daycare'
          ? await readSyntheticDaycareAllocation(env.FINANCE_DB) : null;
        const propertyReport = section.id === 'property' || section.id === 'health'
          ? await readSyntheticPropertyReport(env.FINANCE_DB) : null;
        const propertyReserves = ['property', 'charts'].includes(section.id)
          ? await readSyntheticPropertyReserves(env.FINANCE_DB) : null;
        const propertyLedgers = section.id === 'property'
          ? await readSyntheticPropertyLedgers(env.FINANCE_DB) : null;
        const propertyValuation = section.id === 'property'
          ? await readSyntheticPropertyValuation(env.FINANCE_DB) : null;
        const propertyForecast = section.id === 'property'
          ? await readSyntheticPropertyForecast(env.FINANCE_DB) : null;
        const propertyDistributions = section.id === 'property'
          ? await readSyntheticPropertyDistributions(env.FINANCE_DB) : null;
        const budgetReport = section.id === 'planning'
          ? await readSyntheticBudgetReport(env.FINANCE_DB) : null;
        const accountsReport = ['accounts', 'quickbooks'].includes(section.id)
          ? await readSyntheticAccountsReport(env.FINANCE_DB) : null;
        const dataStatus = ['data', 'health', 'quickbooks'].includes(section.id)
          ? await resolveDataStatus(env, env.FINANCE_DB) : null;
        const compensationReport = section.id === 'compensation'
          ? await readSyntheticCompensationReport(env.FINANCE_DB) : null;
        const compensationBenchmarks = section.id === 'compensation'
          ? await readSyntheticCompensationBenchmarks(env.FINANCE_DB) : null;
        const compensationBenefits = section.id === 'compensation'
          ? await readSyntheticCompensationBenefits(env.FINANCE_DB) : null;
        const cashRunway = ['health', 'charts'].includes(section.id)
          ? await readSyntheticCashRunway(env.FINANCE_DB) : null;
        const { giving, source: givingSource } = ['health', 'giving', 'charts', 'packet'].includes(section.id)
          ? await resolveGivingSummary(env) : { giving: SYNTHETIC_GIVING, source: 'synthetic-fallback' };
        const givingEntryStatus = section.id === 'giving' ? url.searchParams.get('status') : null;
        const givingEntryMessage = givingEntryStatus === 'error'
          ? describeGivingEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const payrollBundle = section.id === 'payroll'
          ? await buildPayrollSectionBundle(env, request.headers.get('Cf-Access-Jwt-Assertion') || '', url.searchParams)
          : null;
        return response(renderShell({
          metadata, summary, giving, givingSource, section, pageId, councilPreview, churchReport, churchTrends,
          balanceSheet, balanceTrends, daycareReport, daycareAllocation, propertyReport, propertyReserves,
          propertyLedgers, propertyValuation, propertyForecast, propertyDistributions, budgetReport, accountsReport,
          dataStatus, compensationReport, compensationBenchmarks, compensationBenefits, cashRunway,
          givingEntryStatus, givingEntryMessage, payrollBundle,
        }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch {
        return response('Synthetic staging data unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }

    return response('Route manifest mismatch', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
