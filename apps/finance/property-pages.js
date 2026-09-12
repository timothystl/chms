import { buildPropertyReportView, buildPropertyValuationView } from './property-report-service.js';
import { buildPropertyForecastView } from './property-forecast-service.js';
import { buildPropertyDistributionsView } from './property-distributions-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable, renderUnavailablePage } from './render-helpers.js';

export function renderPropertyRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${row.occupancy_pct.toFixed(0)}%</td><td>${formatCents(row.total_revenue_cents)}</td><td>${formatCents(row.total_expenses_cents)}</td><td>${formatSignedCents(row.net_income_cents)}</td></tr>`).join('');
}

export function renderPropertyReserveRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.report_month)}</td><td>${row.tax_year}</td><td>${formatCents(row.target_estimate_cents)}</td><td>${formatCents(row.reserve_before_cents)}</td><td>${formatCents(row.contribution_cents)}</td><td>${formatCents(row.reserve_after_cents)}</td><td>${row.funded_pct.toFixed(1)}%</td></tr>`).join('');
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

export function renderPropertyPage(pageId, { propertyReport, propertyReserves, propertyLedgers, propertyValuation, propertyForecast, propertyDistributions }) {
  const report = buildPropertyReportView(propertyReport);

  if (pageId === 'operating-results') {
    return `<section class="report" aria-label="Synthetic Commercial Property operating results">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: `Operating results through ${escapeHtml(report.periodEnd)}`, badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Period', 'Occupancy', 'Revenue', 'Expenses', 'Net income'], rows: renderPropertyRows(report.rows) })}
    </section>`;
  }
  if (pageId === 'rent-roll') {
    const valuation = buildPropertyValuationView(propertyValuation);
    return `<section class="report" aria-label="Synthetic Commercial Property rent roll">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Rent roll', badge: `${valuation.rentRoll.length} unit${valuation.rentRoll.length === 1 ? '' : 's'}` })}
      ${renderTable({ head: ['Tenant', 'Square feet', 'Annual contract rent'], rows: renderPropertyRentRows(valuation.rentRoll) })}
    </section>`;
  }
  if (pageId === 'work-orders') {
    return `<section class="report" aria-label="Synthetic Commercial Property work orders and repairs">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Repairs & maintenance ledger', badge: `${propertyLedgers.repairs.length} synthetic ledger item${propertyLedgers.repairs.length === 1 ? '' : 's'}` })}
      <p>This is the repairs ledger only -- there is no work-order number or open/closed status tracked yet, so this page shows completed ledger entries rather than a work-order queue.</p>
      ${renderKpiCards([{ label: 'Repairs & maintenance', value: formatCents(propertyLedgers.totals.repairs_cents) }])}
      ${renderTable({ head: ['Date', 'Repair category', 'Description', 'Payee', 'Amount'], rows: renderPropertyRepairRows(propertyLedgers.repairs) })}
    </section>`;
  }
  if (pageId === 'reserve-distribution') {
    const latestReserve = propertyReserves.at(-1);
    const distributions = buildPropertyDistributionsView(propertyDistributions);
    return `<section class="report" aria-label="Synthetic Commercial Property reserve and distribution">
      ${renderSectionHeading({ eyebrow: 'Property tax reserve', heading: 'Monthly reserve schedule', badge: `${latestReserve.funded_pct.toFixed(1)}% funded` })}
      ${renderTable({ head: ['Report month', 'Tax year', 'Target', 'Before', 'Contribution', 'After', 'Funded'], rows: renderPropertyReserveRows(propertyReserves) })}
      ${renderSectionHeading({ eyebrow: 'Distribution history', heading: 'Amounts distributed', badge: `${distributions.totals.distributionCount} period${distributions.totals.distributionCount === 1 ? '' : 's'}`, trend: true })}
      ${renderKpiCards([
        { label: 'Total distributed', value: formatCents(distributions.totals.distributionCents) },
        { label: 'Average per period', value: formatCents(distributions.totals.averageCents) },
      ])}
      ${renderTable({ head: ['Period', 'Amount distributed'], rows: renderPropertyDistributionRows(distributions.rows) })}
    </section>`;
  }
  if (pageId === 'capital') {
    return `<section class="report" aria-label="Synthetic Commercial Property capital improvements">
      ${renderSectionHeading({ eyebrow: 'Commercial Property', heading: 'Capital improvements', badge: `${propertyLedgers.capital.length} synthetic ledger item${propertyLedgers.capital.length === 1 ? '' : 's'}` })}
      ${renderKpiCards([{ label: 'Capital projects', value: formatCents(propertyLedgers.totals.capital_cents) }])}
      ${renderTable({ head: ['Date', 'Project', 'Description', 'Payee', 'Amount'], rows: renderPropertyCapitalRows(propertyLedgers.capital) })}
    </section>`;
  }
  if (pageId === 'valuation') {
    const valuation = buildPropertyValuationView(propertyValuation);
    return `<section class="report" aria-label="Synthetic Commercial Property valuation">
      ${renderSectionHeading({ eyebrow: 'Valuation', heading: 'Income approach', badge: `${(valuation.assumptions.cap_rate * 100).toFixed(1)}% cap rate` })}
      ${renderKpiCards([
        { label: 'Effective rental income', value: formatCents(valuation.totals.effectiveRentalIncomeCents), hint: `Gross ${formatCents(valuation.totals.grossRentalIncomeCents)} · vacancy ${formatCents(valuation.totals.vacancyCents)}` },
        { label: 'Net operating income', value: formatSignedCents(valuation.totals.noiCents), hint: `Operating costs ${formatCents(valuation.totals.totalOperatingCostsCents)}` },
        { label: 'Capitalized value', value: formatCents(valuation.totals.capitalizedValueCents), hint: `${valuation.totals.reconciled ? 'Income and cost walk reconciles' : 'Review required'} · read-only` },
      ])}
      ${renderTable({ head: ['Operating cost', 'Annual amount'], rows: renderPropertyCostRows(valuation.operatingCosts) })}
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
