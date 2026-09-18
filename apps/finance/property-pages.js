import { buildPropertyReportView, buildPropertyValuationView } from './property-report-service.js';
import { buildPropertyForecastView, buildLivePropertyForecastView } from './property-forecast-service.js';
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

// Live rows are camelCase (period/revenueCents/expensesCents/netIncomeCents), matching the
// connect.finance-property-forecast.v1 contract shape directly -- unlike the operating/reserves/
// ledgers live resolvers, this one is not reshaped into the synthetic fixture's snake_case
// convention, the same way church-pages.js's renderLiveChurchRows stays camelCase alongside
// renderChurchRows.
export function renderLivePropertyForecastRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatCents(row.revenueCents)}</td><td>${formatCents(row.expensesCents)}</td><td>${formatSignedCents(row.netIncomeCents)}</td></tr>`).join('');
}

export function renderPropertyDistributionRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

// Admin-only monthly financials entry/upsert -- relayed live to Connect's real
// finance_property_monthly table (see finance-property-monthly-write-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. One period at a time,
// matching Budget/Church's own single-row edit forms; re-submitting the same period upserts that
// row rather than adding a second one, same as the legacy in-Connect Property Operating Results.
function renderPropertyMonthlyForm(entryStatus, entryMessage) {
  return `<section aria-label="Record a Commercial Property month">
    ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Record a month', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-property-monthly-write">
      <div class="grid form-grid">
        <div class="field"><label for="pm-period">Period (YYYY-MM)</label><input id="pm-period" type="text" name="period" pattern="\\d{4}-\\d{2}" placeholder="2027-01" required></div>
        <div class="field"><label for="pm-occ">Occupancy (%)</label><input id="pm-occ" type="number" name="occupancy_pct" step="0.1" min="0" max="100"></div>
        <div class="field"><label for="pm-revenue">Total revenue ($)</label><input id="pm-revenue" type="number" name="total_revenue" step="0.01"></div>
        <div class="field"><label for="pm-expenses">Total expenses ($)</label><input id="pm-expenses" type="number" name="total_expenses" step="0.01"></div>
        <div class="field"><label for="pm-net">Net income ($)</label><input id="pm-net" type="number" name="net_income" step="0.01"></div>
        <div class="field"><label for="pm-noi">Net operating income ($)</label><input id="pm-noi" type="number" name="net_operating_income" step="0.01"></div>
        <div class="field"><label for="pm-afd">Available for distribution ($)</label><input id="pm-afd" type="number" name="available_for_distribution" step="0.01"></div>
        <div class="field"><label for="pm-reserve">Reserve balance ($)</label><input id="pm-reserve" type="number" name="reserve_balance" step="0.01"></div>
        <div class="field"><label for="pm-loan">Loan payment ($)</label><input id="pm-loan" type="number" name="loan_payment" step="0.01"></div>
        <div class="field"><label for="pm-interest">Interest expense ($)</label><input id="pm-interest" type="number" name="interest_expense" step="0.01"></div>
      </div>
      <button type="submit">Save month</button>
    </form>
    <p><small>This writes directly into Connect's own <code>finance_property_monthly</code> table -- the same table the legacy in-Connect Property Operating Results edits. Every field except period is optional; leaving one blank keeps it null (not a fabricated $0). Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

// Admin-only repairs & maintenance log entry -- relayed live to Connect's real
// finance_property_repairs table (see finance-property-repair-write-v1 in
// src/api-contracts-service.js), never stored in Finance's own database.
function renderPropertyRepairForm(entryStatus, entryMessage) {
  return `<section aria-label="Record a repair or maintenance entry">
    ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Record a repair or maintenance entry', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-property-repair-write">
      <div class="grid form-grid">
        <div class="field"><label for="pr-date">Date (YYYY, YYYY-MM, or YYYY-MM-DD)</label><input id="pr-date" type="text" name="entry_date" placeholder="2027-01-15"></div>
        <div class="field"><label for="pr-category">Repair category</label><input id="pr-category" type="text" name="category" placeholder="e.g. HVAC"></div>
        <div class="field"><label for="pr-payee">Payee</label><input id="pr-payee" type="text" name="payee"></div>
        <div class="field"><label for="pr-amount">Amount ($)</label><input id="pr-amount" type="number" name="amount" step="0.01"></div>
      </div>
      <div class="field"><label for="pr-description">Description</label><input id="pr-description" type="text" name="description"></div>
      <div class="field"><label><input type="checkbox" name="capitalized"> Capitalized (goes toward the capital improvements ledger, not an operating expense)</label></div>
      <button type="submit">Save entry</button>
    </form>
    <p><small>This writes directly into Connect's own <code>finance_property_repairs</code> table -- the same table the legacy in-Connect Work orders page edits. Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

export function renderPropertyPage(pageId, {
  propertyReport, propertyReportLive, propertyReserves, propertyReservesLive,
  propertyLedgers, propertyLedgersLive, propertyValuation, propertyForecast, propertyForecastLive, propertyDistributions,
  canManagePropertyMonthly, propertyMonthlyEntryStatus, propertyMonthlyEntryMessage,
  canManagePropertyRepairs, propertyRepairEntryStatus, propertyRepairEntryMessage,
}) {
  if (pageId === 'operating-results') {
    // Live-first: tries connect.finance-property-operating.v1 (property-report-service.js's
    // resolvePropertyReport), falls back to the committed synthetic fixture -- same
    // isLive/fallbackNote convention as the 'rent-roll'/'valuation' pages below. buildPropertyReportView
    // is only called on the synthetic-fallback path -- never unconditionally -- so a live-configured
    // request never depends on propertyReport also having resolved successfully (it may be
    // SYNTHETIC_UNAVAILABLE here and that's fine, since it's never touched when isLive).
    const isLive = propertyReportLive && propertyReportLive.source === 'live';
    const syntheticReport = isLive ? null : buildPropertyReportView(propertyReport);
    const rows = isLive ? propertyReportLive.rows : syntheticReport.rows;
    const periodEnd = rows.length ? rows[rows.length - 1].period : syntheticReport.periodEnd;
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyReportLive && propertyReportLive.fallbackReason ? `: ${escapeHtml(propertyReportLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property operating results' : 'Synthetic Commercial Property operating results'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: `Operating results through ${escapeHtml(periodEnd)}`, badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      ${renderTable({ head: ['Period', 'Occupancy', 'Revenue', 'Expenses', 'Net income'], rows: renderPropertyRows(rows) })}
      ${fallbackNote}
    </section>${canManagePropertyMonthly ? renderPropertyMonthlyForm(propertyMonthlyEntryStatus, propertyMonthlyEntryMessage) : ''}`;
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
    </section>${canManagePropertyRepairs ? renderPropertyRepairForm(propertyRepairEntryStatus, propertyRepairEntryMessage) : ''}`;
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
    // Live-first: tries connect.finance-property-forecast.v1 (property-forecast-service.js's
    // resolvePropertyForecast), falls back to the committed synthetic fixture -- same
    // isLive/fallbackNote convention as the other Property pages above. This is a straight port of
    // finance_property_budget_monthly (AHRA-imported budget/plan rows), not a computed run-rate
    // projection -- see the contract producer's own header comment.
    const isLive = propertyForecastLive && propertyForecastLive.source === 'live';
    if (!isLive) {
      const forecast = buildPropertyForecastView(propertyForecast);
      const fallbackNote = `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyForecastLive && propertyForecastLive.fallbackReason ? `: ${escapeHtml(propertyForecastLive.fallbackReason)}` : ''}).</small></p>`;
      return `<section class="report" aria-label="Synthetic Commercial Property run-rate forecast">
        ${renderSectionHeading({ eyebrow: 'Run-rate forecast', heading: `Fiscal year ${forecast.fiscalYear} monthly plan`, badge: forecast.reconciled ? '12 months · reconciled' : 'Review required' })}
        ${renderKpiCards([
          { label: 'Forecast revenue', value: formatCents(forecast.totals.revenueCents) },
          { label: 'Forecast expenses', value: formatCents(forecast.totals.expenseCents) },
          { label: 'Forecast net income', value: formatSignedCents(forecast.totals.netIncomeCents), hint: 'Read-only synthetic plan' },
        ])}
        ${renderTable({ head: ['Month', 'Revenue', 'Expenses', 'Net income'], rows: renderPropertyForecastRows(forecast.rows) })}
        ${fallbackNote}
      </section>`;
    }
    const forecast = buildLivePropertyForecastView(propertyForecastLive.periods, propertyForecastLive.forecastYear, propertyForecastLive.totals);
    if (!forecast.hasForecastYear) {
      return `<section class="report" aria-label="Commercial Property run-rate forecast">
        ${renderSectionHeading({ eyebrow: 'Run-rate forecast', heading: 'No complete forecast year on file', badge: 'Live from Connect' })}
        <p>Connect has budget-plan rows for ${escapeHtml(propertyForecastLive.propertyKey || 'this property')}, but no single fiscal year with all 12 months on file yet.</p>
      </section>`;
    }
    return `<section class="report" aria-label="Commercial Property run-rate forecast">
      ${renderSectionHeading({ eyebrow: 'Run-rate forecast', heading: `Fiscal year ${forecast.fiscalYear} monthly plan`, badge: 'Live from Connect' })}
      ${renderKpiCards([
        { label: 'Forecast revenue', value: formatCents(forecast.totals.revenueCents) },
        { label: 'Forecast expenses', value: formatCents(forecast.totals.expensesCents) },
        { label: 'Forecast net income', value: formatSignedCents(forecast.totals.netIncomeCents), hint: forecast.totals.reconciled ? 'Reconciles to the cent' : 'Does not reconcile exactly -- review the source import' },
      ])}
      ${renderTable({ head: ['Month', 'Revenue', 'Expenses', 'Net income'], rows: renderLivePropertyForecastRows(forecast.rows) })}
    </section>`;
  }
  if (pageId === 'distributions') {
    // Live-first: reuses propertyReservesLive (property-report-service.js's resolvePropertyReserves,
    // already fetched unconditionally for every 'property'-section request in shell.js) rather than
    // adding a second resolver for the same data -- 'reserve-distribution' above already reads this
    // exact same live/synthetic distributions half side by side with its reserve schedule; this
    // standalone page applies the identical live-first pattern to it, same isLive/fallbackNote
    // convention as 'operating-results'/'work-orders'/'capital'/'valuation' above.
    const isLive = propertyReservesLive && propertyReservesLive.source === 'live';
    const distributionRows = isLive ? propertyReservesLive.distributions : propertyDistributions;
    const distributions = buildPropertyDistributionsView(distributionRows);
    const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${propertyReservesLive && propertyReservesLive.fallbackReason ? `: ${escapeHtml(propertyReservesLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isLive ? 'Commercial Property distributions' : 'Synthetic Commercial Property distributions'}">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Distributions', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
      ${renderKpiCards([
        { label: 'Total distributed', value: formatCents(distributions.totals.distributionCents) },
        { label: 'Average per period', value: formatCents(distributions.totals.averageCents) },
        { label: 'Periods recorded', value: String(distributions.totals.distributionCount) },
      ])}
      ${renderTable({ head: ['Period', 'Amount distributed'], rows: renderPropertyDistributionRows(distributions.rows) })}
      ${fallbackNote}
    </section>`;
  }
  const unavailable = {
    receivables: { heading: 'Receivables & deposits', reason: 'There is no tenant-receivable or security-deposit table -- the property model tracks monthly totals and ledgers, not per-tenant balances.' },
    'bank-rec': { heading: 'Position & bank rec', reason: 'The property has no balance sheet or bank account of its own to reconcile -- only income/expense and reserve tables exist.' },
    debt: { heading: 'Debt payoff & future', reason: 'The monthly property table has loan-payment and interest-expense columns, but the synthetic fixture leaves them empty and nothing populates them yet -- there is no loan schedule to project.' },
    acquisition: { heading: 'Acquisition model', reason: 'There is no purchase-price or pro-forma data structure for a hypothetical acquisition -- this is a new modeling feature, not a missing report.' },
  };
  if (unavailable[pageId]) return renderUnavailablePage({ eyebrow: 'Commercial Property', ...unavailable[pageId] });

  // 'overview' (default) -- entirely synthetic, no live variant. Computed here, not at the top
  // of this function, so a SYNTHETIC_UNAVAILABLE propertyReport only ever breaks this one
  // fallback page, never a page (like 'operating-results' above) with its own live path that
  // doesn't need it.
  const report = buildPropertyReportView(propertyReport);
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
