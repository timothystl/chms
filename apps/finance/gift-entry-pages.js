import { escapeHtml, formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function renderGivingFundOptions(giving) {
  const funds = giving?.funds || [];
  if (!funds.length) return '<option value="">No funds available from Connect right now</option>';
  return funds.map((fund) => `<option value="${escapeHtml(fund.fundRef)}">${escapeHtml(fund.fundLabel || fund.fundRef)}</option>`).join('');
}

function renderFundActivityRows(funds) {
  return funds.map((fund) => `<tr><td>${escapeHtml(fund.fundLabel || fund.fundRef)}</td><td>${fund.giftCount}</td><td>${fund.householdCount}</td><td>${formatCents(fund.amounts.grossCents)}</td><td>${formatCents(fund.amounts.refundCents)}</td><td>${formatCents(fund.amounts.netCents)}</td></tr>`).join('');
}

export function renderGiftEntryPage(pageId, { giving, givingSource, givingEntryStatus, givingEntryMessage }) {
  if (pageId === 'funds') {
    const funds = giving?.funds || [];
    return `<section class="report" aria-label="Fund activity this period">
      ${renderSectionHeading({ eyebrow: 'Gift Entry', heading: 'Funds', badge: givingSource === 'live' ? 'Live from Connect' : 'Synthetic fixture' })}
      <p>This shows each fund’s activity for the current period from Connect’s aggregate giving contract -- gift count, household count, and gross/refund/net amounts. It is not a running restricted-vs-undesignated balance; Connect does not share that classification with Finance today.</p>
      ${renderTable({ head: ['Fund', 'Gifts', 'Households', 'Gross', 'Refunds', 'Net'], rows: renderFundActivityRows(funds) })}
    </section>`;
  }
  // 'quick-entry' (default)
  return `<section aria-label="Giving quick entry">
    ${renderSectionHeading({ eyebrow: 'Gift Entry', heading: 'Record a gift', badge: 'Relayed live to Connect' })}
    ${givingEntryStatus === 'ok' ? '<p class="status">Recorded in Connect.</p>' : ''}
    ${givingEntryStatus === 'error' ? `<p class="status status-error">Not recorded: ${escapeHtml(givingEntryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-giving-quick-entry">
      <div class="grid form-grid">
        <div class="field"><label for="ge-date">Date</label><input id="ge-date" type="date" name="date" value="${escapeHtml(todayIsoDate())}" required></div>
        <div class="field"><label for="ge-fund">Fund</label><select id="ge-fund" name="fund_id" required>${renderGivingFundOptions(giving)}</select></div>
        <div class="field"><label for="ge-amount">Amount ($)</label><input id="ge-amount" type="number" name="amount" step="0.01" min="0.01" placeholder="0.00" required></div>
        <div class="field"><label for="ge-method">Method</label><select id="ge-method" name="method"><option value="cash">Cash</option><option value="check" selected>Check</option><option value="card">Card</option><option value="ach">ACH</option><option value="other">Other</option></select></div>
        <div class="field"><label for="ge-check">Check #</label><input id="ge-check" type="text" name="check_number" placeholder="optional"></div>
        <div class="field"><label for="ge-person">Person ID</label><input id="ge-person" type="number" name="person_id" placeholder="optional — Connect's Person ID"></div>
      </div>
      <div class="field"><label for="ge-notes">Notes</label><input id="ge-notes" type="text" name="notes" placeholder="optional"></div>
      <button type="submit">Record gift</button>
    </form>
    <p>This writes directly into Connect's own Giving records — the same recording path the desktop and mobile Giving screens already share. Finance never stores a copy. Fund choices above come from ${givingSource === 'live' ? "Connect's real, current giving activity" : "Connect's committed example fixture (the live connection is not configured or did not answer)"}, so a fund with no recent activity may not be listed yet.</p>
  </section>`;
}
