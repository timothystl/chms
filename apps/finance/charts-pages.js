import { buildChurchReportView } from './church-report-service.js';
import { buildFinancialMixView } from './financial-mix-service.js';
import { buildCashRunwayView } from './cash-runway-service.js';
import { formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderFinancialMixRows(rows) {
  return rows.map((row) => `<tr><td>${row.accountName}</td><td>${formatCents(row.amountCents)}</td><td>${row.sharePct.toFixed(1)}%</td></tr>`).join('');
}

export function renderChartsPage(pageId, { churchReport, cashRunway, propertyReserves, giving, givingSource }) {
  const mix = buildFinancialMixView(churchReport);

  if (pageId === 'expense-mix') {
    return `<section class="report" aria-label="Synthetic expense mix chart">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Expense mix', badge: `FY${mix.fiscalYear} · reconciled` })}
      ${renderTable({ head: ['Account', 'Amount', 'Share'], rows: renderFinancialMixRows(mix.expenses.items) })}
    </section>`;
  }
  if (pageId === 'cash-reserve') {
    const runway = buildCashRunwayView(cashRunway);
    const latestReserve = propertyReserves.at(-1);
    return `<section class="report" aria-label="Synthetic cash and reserve chart">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Cash & reserve', badge: `As of ${runway.asOfDate}` })}
      ${renderKpiCards([
        { label: 'Operating cash', value: formatCents(runway.operatingCashCents), hint: `${runway.accountName} · synthetic fixture` },
        { label: 'Expense coverage', value: `${runway.runwayMonths.toFixed(1)} months`, hint: 'Cash divided by average monthly expense' },
        { label: 'Property tax reserve', value: formatCents(latestReserve.reserve_after_cents), hint: `${latestReserve.funded_pct.toFixed(1)}% funded, ${latestReserve.report_month}` },
      ])}
    </section>`;
  }
  if (pageId === 'giving-pace') {
    const church = buildChurchReportView(churchReport);
    const monthlyPace = Math.round(church.totals.incomeActualCents / 12);
    return `<section class="report" aria-label="Synthetic giving vs pace chart">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Giving vs. pace', badge: givingSource === 'live' ? 'Live from Connect' : 'Synthetic fixture' })}
      ${renderKpiCards([
        { label: 'Giving this period', value: formatCents(giving?.totals?.netCents ?? 0) },
        { label: 'Naive monthly pace', value: formatCents(monthlyPace), hint: `1/12 of FY${church.fiscalYear} church income budget` },
      ])}
      <p>"Pace" here is a naive 1/12-of-annual-budget average, not an official pacing model -- there is no stored giving-target or seasonality curve to compare against yet.</p>
    </section>`;
  }
  // 'revenue-mix' (default)
  return `<section class="report" aria-label="Synthetic revenue mix chart">
    ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Revenue mix', badge: `FY${mix.fiscalYear} · reconciled` })}
    ${renderTable({ head: ['Account', 'Amount', 'Share'], rows: renderFinancialMixRows(mix.income.items) })}
  </section>`;
}
