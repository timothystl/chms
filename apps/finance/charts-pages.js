import { buildChurchReportView, buildLiveChurchReportView } from './church-report-service.js';
import { buildFinancialMixView, buildLiveFinancialMixView } from './financial-mix-service.js';
import { buildCashRunwayView } from './cash-runway-service.js';
import { escapeHtml, formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderFinancialMixRows(rows) {
  return rows.map((row) => `<tr><td>${row.accountName}</td><td>${formatCents(row.amountCents)}</td><td>${row.sharePct.toFixed(1)}%</td></tr>`).join('');
}

// Live-first for the church-report-derived figures (revenue mix, expense mix, and giving-pace's
// naive pace calculation) and for cash-reserve's property-tax-reserve KPI -- each independently,
// matching the isLive/fallbackNote convention property-pages.js already uses for the 'property'
// section. `churchReportLive` is resolveChurchReport()'s own result (shell.js now computes it for
// 'charts' too, alongside 'church') and `propertyReservesLive` is resolvePropertyReserves()'s
// (likewise now computed for 'charts' alongside 'property'); `churchReport`/`propertyReserves`
// remain the plain synthetic reads other sections (Financial Health, Board packet, Commercial
// Property) still depend on, so this page reads them only as its own synthetic fallback, never
// re-fetching. `cashRunway`/buildCashRunwayView has no live equivalent anywhere in this codebase
// and stays entirely synthetic -- its two KPI cards keep saying so explicitly rather than sharing
// a page-wide badge with the one live-capable reserve KPI on the same card row.
export function renderChartsPage(pageId, { churchReport, churchReportLive, cashRunway, propertyReserves, propertyReservesLive, giving, givingSource }) {
  const isChurchLive = churchReportLive?.source === 'live';
  const mix = isChurchLive
    ? buildLiveFinancialMixView(churchReportLive.accounts, churchReportLive.fiscalYear, churchReportLive.totals)
    : buildFinancialMixView(churchReport);
  const churchFallbackNote = isChurchLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${churchReportLive?.fallbackReason ? `: ${escapeHtml(churchReportLive.fallbackReason)}` : ''}).</small></p>`;

  if (pageId === 'expense-mix') {
    return `<section class="report" aria-label="${isChurchLive ? 'Expense mix chart' : 'Synthetic expense mix chart'}">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Expense mix', badge: `FY${mix.fiscalYear} · reconciled · ${isChurchLive ? 'Live from Connect' : 'Synthetic staging'}` })}
      ${renderTable({ head: ['Account', 'Amount', 'Share'], rows: renderFinancialMixRows(mix.expenses.items) })}
      ${churchFallbackNote}
    </section>`;
  }
  if (pageId === 'cash-reserve') {
    const runway = buildCashRunwayView(cashRunway);
    const isReserveLive = propertyReservesLive?.source === 'live';
    const latestReserve = isReserveLive ? propertyReservesLive.rows.at(-1) : propertyReserves.at(-1);
    const reserveFallbackNote = isReserveLive ? '' : `<p><small>Property tax reserve: the committed synthetic fixture (the live endpoint is not configured or did not answer${propertyReservesLive?.fallbackReason ? `: ${escapeHtml(propertyReservesLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="${isReserveLive ? 'Cash and reserve chart' : 'Synthetic cash and reserve chart'}">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Cash & reserve', badge: `As of ${runway.asOfDate}` })}
      ${renderKpiCards([
        { label: 'Operating cash', value: formatCents(runway.operatingCashCents), hint: `${runway.accountName} · synthetic fixture` },
        { label: 'Expense coverage', value: `${runway.runwayMonths.toFixed(1)} months`, hint: 'Cash divided by average monthly expense · synthetic fixture' },
        { label: 'Property tax reserve', value: formatCents(latestReserve.reserve_after_cents), hint: `${latestReserve.funded_pct.toFixed(1)}% funded, ${latestReserve.report_month} · ${isReserveLive ? 'live from Connect' : 'synthetic fixture'}` },
      ])}
      ${reserveFallbackNote}
    </section>`;
  }
  if (pageId === 'giving-pace') {
    const church = isChurchLive
      ? buildLiveChurchReportView(churchReportLive.accounts, churchReportLive.fiscalYear, churchReportLive.totals)
      : buildChurchReportView(churchReport);
    const monthlyPace = Math.round(church.totals.incomeActualCents / 12);
    return `<section class="report" aria-label="${givingSource === 'live' ? 'Giving vs pace chart' : 'Synthetic giving vs pace chart'}">
      ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Giving vs. pace', badge: givingSource === 'live' ? 'Live from Connect' : 'Synthetic fixture' })}
      ${renderKpiCards([
        { label: 'Giving this period', value: formatCents(giving?.totals?.netCents ?? 0) },
        { label: 'Naive monthly pace', value: formatCents(monthlyPace), hint: `1/12 of FY${church.fiscalYear} church income budget · ${isChurchLive ? 'live from Connect' : 'synthetic fixture'}` },
      ])}
      <p>"Pace" here is a naive 1/12-of-annual-budget average, not an official pacing model -- there is no stored giving-target or seasonality curve to compare against yet.</p>
      ${churchFallbackNote}
    </section>`;
  }
  // 'revenue-mix' (default)
  return `<section class="report" aria-label="${isChurchLive ? 'Revenue mix chart' : 'Synthetic revenue mix chart'}">
    ${renderSectionHeading({ eyebrow: 'Charts', heading: 'Revenue mix', badge: `FY${mix.fiscalYear} · reconciled · ${isChurchLive ? 'Live from Connect' : 'Synthetic staging'}` })}
    ${renderTable({ head: ['Account', 'Amount', 'Share'], rows: renderFinancialMixRows(mix.income.items) })}
    ${churchFallbackNote}
  </section>`;
}
