import { buildPropertyReportView, buildPropertyValuationView } from './property-report-service.js';
import { buildPropertyForecastView } from './property-forecast-service.js';
import { buildPropertyDistributionsView } from './property-distributions-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable, renderUnavailablePage } from './render-helpers.js';

export function renderPropertyRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${row.occupancy_pct.toFixed(0)}%</td><td>${formatCents(row.total_revenue_cents)}</td><td>${formatCents(row.total_expenses_cents)}</td><td>${formatSignedCents(row.net_income_cents)}</td></tr>`).join('');
}

export function renderPropertyReserveRows(rows) {
  // tax_year is null for a reserve bucket other than 'property_tax' (see migrations/0023's own
  // comment) -- never null in the committed synthetic fixture, but the live real-data path can
  // carry it, so this falls back to the same em-dash production's own finRenderPropertyTaxReserve
  // (src/frontend/js-finance.js) uses for a missing tax_year.
  return rows.map((row) => `<tr><td>${escapeHtml(row.report_month)}</td><td>${row.tax_year != null ? row.tax_year : '—'}</td><td>${formatCents(row.target_estimate_cents)}</td><td>${formatCents(row.reserve_before_cents)}</td><td>${formatCents(row.contribution_cents)}</td><td>${formatCents(row.reserve_after_cents)}</td><td>${row.funded_pct.toFixed(1)}%</td></tr>`).join('');
}

export function renderPropertyCapitalRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.entry_date)}</td><td>${escapeHtml(row.project)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.payee)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

export function renderPropertyRepairRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.entry_date)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.payee)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

export function renderPropertyRentRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.tenant_label)}</td><td>${row.square_feet.toLocaleString('en-US')}</td><td>${formatCents(row.annual_rent_cents)}</td></tr>`).join('');
}

export function renderPropertyCostRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.cost_label)}</td><td>${formatCents(row.annual_cost_cents)}</td></tr>`).join('');
}

export function renderPropertyForecastRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatCents(row.revenue_cents)}</td><td>${formatCents(row.expenses_cents)}</td><td>${formatSignedCents(row.net_income_cents)}</td></tr>`).join('');
}

export function renderPropertyDistributionRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

export function renderPropertyPage(pageId, {
  propertyReport, propertyReportLive, propertyReserves, propertyReservesLive,
  propertyLedgers, propertyLedgersLive, propertyValuation, propertyForecast, propertyDistributions,
}) {
  const report = buildPropertyReportView(propertyReport);

  if (pageId === 'operating-results') {
    // Live-first: tries connect.finance-property-operating.v1 (property-report-service.js's
    // resolvePropertyReport), falls back to the committed synthetic fixture -- same
    // isLive/fallbackNote convention as the 'rent-roll'/'valuation' pages below.
    const isLive = propertyReportLive && propertyReportLive.source === 'live';
    const rows = isLive ? propertyReportLive.rows : report.rows;
    const periodEnd = rows.length ? rows[rows.length - 1].period : report.periodEnd;
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyReportLive && propertyReportLive.fallbackReason ? `: ${escapeHtml(propertyReportLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property operating results' : 'Synthetic Commercial Property operating results'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: `Operating results through ${escapeHtml(periodEnd)}`, badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      ${renderTable({ head: ['Period', 'Occupancy', 'Revenue', 'Expenses', 'Net income'], rows: renderPropertyRows(rows) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'rent-roll') {
    const isLive = propertyValuation.source === 'live';
    const valuation = buildPropertyValuationView(propertyValuation);
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyValuation.fallbackReason ? `: ${escapeHtml(propertyValuation.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property rent roll' : 'Synthetic Commercial Property rent roll'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Rent roll', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      <p><small>${valuation.rentRoll.length} unit${valuation.rentRoll.length === 1 ? '' : 's'}${isLive && propertyValuation.asOfDate ? ` · as of ${escapeHtml(propertyValuation.asOfDate)}` : ''}</small></p>
      ${renderTable({ head: ['Tenant', 'Square feet', 'Annual contract rent'], rows: renderPropertyRentRows(valuation.rentRoll) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'work-orders') {
    // Live-first: tries connect.finance-property-ledgers.v1 (property-report-service.js's
    // resolvePropertyLedgers), falls back to the committed synthetic fixture.
    const isLive = propertyLedgersLive && propertyLedgersLive.source === 'live';
    const ledgers = isLive ? propertyLedgersLive : propertyLedgers;
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyLedgersLive && propertyLedgersLive.fallbackReason ? `: ${escapeHtml(propertyLedgersLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property work orders and repairs' : 'Synthetic Commercial Property work orders and repairs'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Repairs & maintenance ledger', badge: isLive ? 'Live from Connect' : `${ledgers.repairs.length} synthetic ledger item${ledgers.repairs.length === 1 ? '' : 's'}` })}
      <p>This is the repairs ledger only -- there is no work-order number or open/closed status tracked yet, so this page shows completed ledger entries rather than a work-order queue.</p>
      ${renderKpiCards([{ label: 'Repairs & maintenance', value: formatCents(ledgers.totals.repairs_cents) }])}
      ${renderTable({ head: ['Date', 'Repair category', 'Description', 'Payee', 'Amount'], rows: renderPropertyRepairRows(ledgers.repairs) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'reserve-distribution') {
    // Live-first: tries connect.finance-property-reserves.v1 (property-report-service.js's
    // resolvePropertyReserves), falls back to the committed synthetic fixtures (the reserve
    // schedule and the distribution history are two independently-resolved synthetic reads today,
    // so both fall back independently -- the page can legitimately show one live and one
    // synthetic-fallback half if only the reserve schedule half of the real endpoint answered).
    const isLive = propertyReservesLive && propertyReservesLive.source === 'live';
    const reserveRows = isLive ? propertyReservesLive.rows : propertyReserves;
    const distributionRows = isLive ? propertyReservesLive.distributions : propertyDistributions;
    const latestReserve = reserveRows.at(-1);
    const distributions = buildPropertyDistributionsView(distributionRows);
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyReservesLive && propertyReservesLive.fallbackReason ? `: ${escapeHtml(propertyReservesLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property reserve and distribution' : 'Synthetic Commercial Property reserve and distribution'}">
      ${renderSectionHeading({ eyebrow: 'Property tax reserve', heading: 'Monthly reserve schedule', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      <p><small>${latestReserve.funded_pct.toFixed(1)}% funded${isLive ? ` as of ${escapeHtml(latestReserve.report_month)}` : ''}</small></p>
      ${renderTable({ head: ['Report month', 'Tax year', 'Target', 'Before', 'Contribution', 'After', 'Funded'], rows: renderPropertyReserveRows(reserveRows) })}
      ${renderSectionHeading({ eyebrow: 'Distribution history', heading: 'Amounts distributed', badge: `${distributions.totals.distributionCount} period${distributions.totals.distributionCount === 1 ? '' : 's'}`, trend: true })}
      ${renderKpiCards([
        { label: 'Total distributed', value: formatCents(distributions.totals.distributionCents) },
        { label: 'Average per period', value: formatCents(distributions.totals.averageCents) },
      ])}
      ${renderTable({ head: ['Period', 'Amount distributed'], rows: renderPropertyDistributionRows(distributions.rows) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'capital') {
    // Live-first: tries connect.finance-property-ledgers.v1 (property-report-service.js's
    // resolvePropertyLedgers), falls back to the committed synthetic fixture.
    const isLive = propertyLedgersLive && propertyLedgersLive.source === 'live';
    const ledgers = isLive ? propertyLedgersLive : propertyLedgers;
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyLedgersLive && propertyLedgersLive.fallbackReason ? `: ${escapeHtml(propertyLedgersLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property capital improvements' : 'Synthetic Commercial Property capital improvements'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Capital improvements', badge: isLive ? 'Live from Connect' : `${ledgers.capital.length} synthetic ledger item${ledgers.capital.length === 1 ? '' : 's'}` })}
      ${renderKpiCards([{ label: 'Capital projects', value: formatCents(ledgers.totals.capital_cents) }])}
      ${renderTable({ head: ['Date', 'Project', 'Description', 'Payee', 'Amount'], rows: renderPropertyCapitalRows(ledgers.capital) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'valuation') {
    const isLive = propertyValuation.source === 'live';
    const valuation = buildPropertyValuationView(propertyValuation);
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyValuation.fallbackReason ? `: ${escapeHtml(propertyValuation.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property valuation' : 'Synthetic Commercial Property valuation'}">
      ${renderSectionHeading({ eyebrow: 'Valuation', heading: 'Income approach', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      <p><small>${(valuation.assumptions.cap_rate * 100).toFixed(1)}% cap rate${isLive && propertyValuation.asOfDate ? ` · as of ${escapeHtml(propertyValuation.asOfDate)}` : ''}</small></p>
      ${renderKpiCards([
        { label: 'Effective rental income', value: formatCents(valuation.totals.effectiveRentalIncomeCents), hint: `Gross ${formatCents(valuation.totals.grossRentalIncomeCents)} · vacancy ${formatCents(valuation.totals.vacancyCents)}` },
        { label: 'Net operating income', value: formatSignedCents(valuation.totals.noiCents), hint: `Operating costs ${formatCents(valuation.totals.totalOperatingCostsCents)}` },
        { label: 'Capitalized value', value: formatCents(valuation.totals.capitalizedValueCents), hint: `${valuation.totals.reconciled ? 'Income and cost walk reconciles' : 'Review required'} · read-only` },
      ])}
      ${renderTable({ head: ['Operating cost', 'Annual amount'], rows: renderPropertyCostRows(valuation.operatingCosts) })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'forecast') {
    const forecast = buildPropertyForecastView(propertyForecast);
    return `<section class="report" aria-label="Synthetic Commercial Property run-rate forecast">
      ${renderSectionHeading({ eyebrow: 'Run-rate forecast', heading: `Fiscal year ${forecast.fiscalYear} monthly plan`, badge: forecast.reconciled ? '12 months · reconciled' : 'Review required' })}
      ${renderKpiCards([
        { label: 'Forecast revenue', value: formatCents(forecast.totals.revenueCents) },
        { label: 'Forecast expenses', value: formatCents(forecast.totals.expenseCents) },
        { label: 'Forecast net income', value: formatSignedCents(forecast.totals.netIncomeCents), hint: 'Read-only synthetic plan' },
      ])}
      ${renderTable({ head: ['Month', 'Revenue', 'Expenses', 'Net income'], rows: renderPropertyForecastRows(forecast.rows) })}
    </section>`;
  }
  if (pageId === 'distributions') {
    const distributions = buildPropertyDistributionsView(propertyDistributions);
    return `<section class="report" aria-label="Synthetic Commercial Property distributions">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Distributions', badge: `${distributions.totals.distributionCount} period${distributions.totals.distributionCount === 1 ? '' : 's'}` })}
      ${renderKpiCards([
        { label: 'Total distributed', value: formatCents(distributions.totals.distributionCents) },
        { label: 'Average per period', value: formatCents(distributions.totals.averageCents) },
        { label: 'Periods recorded', value: String(distributions.totals.distributionCount) },
      ])}
      ${renderTable({ head: ['Period', 'Amount distributed'], rows: renderPropertyDistributionRows(distributions.rows) })}
    </section>`;
  }
  const unavailable = {
    receivables: { heading: 'Receivables & deposits', reason: 'There is no tenant-receivable or security-deposit table -- the property model tracks monthly totals and ledgers, not per-tenant balances.' },
    'bank-rec': { heading: 'Position & bank rec', reason: 'The property has no balance sheet or bank account of its own to reconcile -- only income/expense and reserve tables exist.' },
    debt: { heading: 'Debt payoff & future', reason: 'The monthly property table has loan-payment and interest-expense columns, but the synthetic fixture leaves them empty and nothing populates them yet -- there is no loan schedule to project.' },
    acquisition: { heading: 'Acquisition model', reason: 'There is no purchase-price or pro-forma data structure for a hypothetical acquisition -- this is a new modeling feature, not a missing report.' },
  };
  if (unavailable[pageId]) return renderUnavailablePage({ eyebrow: 'Commercial Property', ...unavailable[pageId] });

  // 'overview' (default)
  return `<section class="report" aria-label="Synthetic Commercial Property overview">
    ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: `Property performance through ${escapeHtml(report.periodEnd)}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Revenue', value: formatCents(report.totals.revenueCents), hint: `Average occupancy ${report.averageOccupancyPct.toFixed(0)}%` },
      { label: 'Expenses', value: formatCents(report.totals.expenseCents), hint: `Reserve balance ${formatCents(report.totals.latestReserveCents)}` },
      { label: 'Net income', value: formatSignedCents(report.totals.netIncomeCents), hint: `Available for distribution ${formatCents(report.totals.distributableCents)}` },
    ])}
    <p>See Operating results, Rent roll, Reserve &amp; distribution, Capital improvements, Valuation, Run-rate forecast, and Distributions for the full picture.</p>
  </section>`;
}
