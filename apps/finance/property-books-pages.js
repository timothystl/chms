// Commercial Property → Receivables & deposits, Position & bank rec, and Debt payoff & future
// (v3 design). Data and rules live in property-books-service.js.
import { escapeHtml as e, formatCents } from './render-helpers.js';
import {
  AGING, byYear, loanProjection, receivableMonths, reconcile, rowBalance, summarizeReceivables,
} from './property-books-service.js';

const money = (c) => (c < 0 ? `−${formatCents(-c)}` : formatCents(c));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : String(ym || '');
}
const dayLabel = (d) => {
  const [y, m, day] = String(d || '').split('-').map(Number);
  return y && m && day ? `${MONTHS[m - 1].slice(0, 3)} ${day}, ${y}` : String(d || '');
};
const href = (page, params = {}) => `/?${new URLSearchParams({ section: 'property', page, ...params }).toString().replace(/&/g, '&amp;')}`;
const dollars = (c) => (c ? (c / 100).toFixed(2) : '');

function kpis(items) {
  return `<div class="grid">${items.map(([label, value, note, tone]) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong>${note ? `<span class="${tone ? `tone-${tone}` : ''}">${note}</span>` : ''}</div>`).join('')}</div>`;
}

function statusBanner(status) {
  return status ? `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>` : '';
}

function unavailable(message) {
  return `<p class="status status-error">${e(message)}</p>`;
}

// ── Receivables & deposits ────────────────────────────────────────────────────────────────────

export function renderReceivablesPage({ books, params, canEdit, status }) {
  if (!books) return unavailable('The receivables records could not be read. Please try again.');
  const months = receivableMonths(books.receivables);
  const wanted = String(params?.get?.('month') || '');
  const current = months.includes(wanted) ? wanted : months[0] || null;
  const rows = current ? books.receivables.filter((r) => r.report_month === current) : [];
  const sum = summarizeReceivables(rows);
  const defaultMonth = current || new Date().toISOString().slice(0, 7);

  const picker = months.length > 1 ? `<form method="GET" action="/" class="inline-form rb-picker"><input type="hidden" name="section" value="property"><input type="hidden" name="page" value="receivables">
      <label>Report <select name="month">${months.map((m) => `<option value="${m}"${m === current ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label><button type="submit" class="button-outline">Show</button></form>` : '';

  const body = rows.length ? `${kpis([
    ['Owed by tenants', money(sum.owedCents), `${sum.withBalance} of ${sum.lines} tenant${sum.lines === 1 ? '' : 's'} with a balance`],
    ['Past 30 days', money(sum.pastDueCents), sum.pastDueCents > 0 ? 'Follow up with the manager' : 'Nothing past due', sum.pastDueCents > 0 ? 'warn' : 'good'],
    ['Over 90 days', money(sum.totals.over_90_cents), sum.totals.over_90_cents > 0 ? 'Ask whether it is collectible' : ''],
    ['Security deposits held', money(sum.depositsCents), 'Owed back to tenants when they leave'],
  ])}
    <div class="panel panel-spaced list-panel"><h2>Aged receivables · ${monthLabel(current)}</h2><div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Tenant</th><th>Unit</th>${AGING.map((a) => `<th>${a.label}</th>`).join('')}<th>Balance</th><th>Deposit held</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${e(r.tenant)}${r.note ? `<small>${e(r.note)}</small>` : ''}</td><td>${e(r.unit)}</td>${AGING.map((a) => `<td>${r[a.key] ? money(r[a.key]) : '—'}</td>`).join('')}<td><b>${money(rowBalance(r))}</b></td><td>${r.deposit_held_cents ? money(r.deposit_held_cents) : '—'}</td>${canEdit ? `<td class="actions"><form method="POST" action="/api/v1/property/receivable-remove" class="inline-form"><input type="hidden" name="id" value="${r.id}"><button type="submit" class="link-button">Remove</button></form></td>` : ''}</tr>`).join('')}
      <tr class="total-row"><td>Total</td><td></td>${AGING.map((a) => `<td>${money(sum.totals[a.key])}</td>`).join('')}<td>${money(sum.owedCents)}</td><td>${money(sum.depositsCents)}</td>${canEdit ? '<td></td>' : ''}</tr>
    </tbody></table></div>
    <p class="muted-line">From the manager’s aged receivables and security deposit reports. A negative balance is a tenant credit, such as prepaid rent.</p></div>`
    : `<div class="panel"><h2>No receivables recorded yet</h2><p class="muted-line">Enter the aged receivables and security deposits from the manager’s monthly report${canEdit ? ' below' : ''}. An admin records them.</p></div>`;

  const trend = months.length > 1 ? `<div class="panel panel-spaced list-panel"><h2>Month by month</h2><div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Report</th><th>Owed</th><th>Past 30 days</th><th>Over 90</th><th>Deposits held</th></tr></thead><tbody>
      ${months.slice(0, 12).map((m) => { const s = summarizeReceivables(books.receivables.filter((r) => r.report_month === m)); return `<tr><td><a href="${href('receivables', { month: m })}">${monthLabel(m)}</a></td><td>${money(s.owedCents)}</td><td>${money(s.pastDueCents)}</td><td>${money(s.totals.over_90_cents)}</td><td>${money(s.depositsCents)}</td></tr>`; }).join('')}
    </tbody></table></div></div>` : '';

  const forms = canEdit ? `<details class="panel panel-spaced edit-panel"${rows.length ? '' : ' open'}><summary>Paste a month from the manager’s report</summary>
      <form method="POST" action="/api/v1/property/receivable-import">
        <label class="field"><span>Report month</span><input type="month" name="report_month" value="${defaultMonth}" required></label>
        <label class="field"><span>One tenant per line: tenant, unit, 0–30, 31–60, 61–90, over 90, deposit held, note</span><textarea name="lines" rows="6" required placeholder="Tenant A, Suite 1, 1200.00, 0, 0, 0, 1200.00"></textarea></label>
        <p class="muted-line">Commas or tabs both work, so rows copied from the report’s spreadsheet paste as they are. A header line and a Total line are skipped. Pasting a month replaces the lines already recorded for that month.</p>
        <div class="form-actions"><button type="submit">Save this month</button></div>
      </form></details>
    <details class="panel panel-spaced edit-panel"><summary>Add one tenant line</summary>
      <form method="POST" action="/api/v1/property/receivable-save" class="form-grid rb-form">
        <label class="field"><span>Report month</span><input type="month" name="report_month" value="${defaultMonth}" required></label>
        <label class="field"><span>Tenant</span><input name="tenant" maxlength="80" required></label>
        <label class="field"><span>Unit</span><input name="unit" maxlength="40"></label>
        ${[['current', '0–30 days ($)'], ['days_31_60', '31–60 days ($)'], ['days_61_90', '61–90 days ($)'], ['over_90', 'Over 90 days ($)'], ['deposit_held', 'Deposit held ($)']].map(([n, l]) => `<label class="field"><span>${l}</span><input name="${n}" inputmode="decimal"></label>`).join('')}
        <label class="field"><span>Note</span><input name="note" maxlength="200"></label>
        <div class="form-actions"><button type="submit">Add line</button></div>
      </form></details>` : '';

  return `${statusBanner(status)}<div class="rb-head"><p class="lede">What tenants owe, by how long it has been owed, and the security deposits the property holds, from the manager’s monthly reports.</p>${picker}</div>${body}${trend}${forms}`;
}

// ── Position & bank rec ───────────────────────────────────────────────────────────────────────

export function renderBankRecPage({ books, reserveAfterCents = null, reserveMonth = null, baseMinimumCents = null, canEdit, status, params }) {
  if (!books) return unavailable('The bank reconciliation records could not be read. Please try again.');
  const recs = books.bankRecs;
  const latest = recs[0] || null;
  const recMonths = receivableMonths(books.receivables);
  const receivables = recMonths.length ? summarizeReceivables(books.receivables.filter((r) => r.report_month === recMonths[0])) : null;
  const editMonth = String(params?.get?.('edit') || '');
  const editing = recs.find((r) => r.statement_month === editMonth) || null;

  let position = '';
  if (latest) {
    const r = reconcile(latest);
    const reserves = (reserveAfterCents ?? 0) + (baseMinimumCents ?? 0);
    const rows = [
      [`Cash in the property account, ${monthLabel(latest.statement_month)}`, r.adjustedCents, 'Bank statement adjusted for deposits in transit and outstanding checks'],
      ...(receivables ? [[`Rent owed by tenants (${monthLabel(recMonths[0])} report)`, receivables.owedCents, 'Not yet collected']] : []),
      ...(receivables ? [['Security deposits owed back to tenants', -receivables.depositsCents, 'Held for tenants, not the property’s to spend']] : []),
      ...(reserveAfterCents !== null ? [[`Property tax reserve${reserveMonth ? ` (${monthLabel(reserveMonth)})` : ''}`, -reserveAfterCents, 'Set aside for the tax bill']] : []),
      ...(baseMinimumCents ? [['Base minimum reserve', -baseMinimumCents, 'The manager’s standing cash cushion']] : []),
    ];
    const available = rows.reduce((s, [, c]) => s + c, 0);
    position = `${kpis([
      ['Cash in the account', money(r.adjustedCents), `As of ${monthLabel(latest.statement_month)}`],
      ['Reconciliation', r.reconciled ? 'Balanced' : money(r.differenceCents), r.reconciled ? 'Bank agrees with the manager’s report' : 'Difference still to explain', r.reconciled ? 'good' : 'warn'],
      ['Reserves set aside', reserveAfterCents === null && !baseMinimumCents ? '—' : money(reserves), reserveAfterCents === null ? 'Reserve schedule not available' : 'Tax reserve and base minimum'],
      ['Available after obligations', money(available), 'Cash plus rent owed, less deposits and reserves', available >= 0 ? '' : 'warn'],
    ])}
    <div class="panel panel-spaced list-panel"><h2>Property position</h2><div class="table-scroll"><table class="pm-table rb-num"><tbody>
      ${rows.map(([label, c, note]) => `<tr><td>${e(label)}<small>${e(note)}</small></td><td>${money(c)}</td></tr>`).join('')}
      <tr class="total-row"><td>Available after obligations</td><td>${money(available)}</td></tr>
    </tbody></table></div>
    <p class="muted-line">Reserves come from the Reserve &amp; distribution page; receivables and deposits from the latest report on Receivables &amp; deposits.</p></div>`;
  } else {
    position = `<div class="panel"><h2>No reconciliation recorded yet</h2><p class="muted-line">Each month, compare the property account’s bank statement with the cash on the manager’s report${canEdit ? ' and record it below' : ''}.</p></div>`;
  }

  const history = recs.length ? `<div class="panel panel-spaced list-panel"><h2>Monthly reconciliations</h2><div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Month</th><th>Bank</th><th>+ In transit</th><th>− Checks out</th><th>Adjusted</th><th>Manager</th><th>Difference</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
      ${recs.map((rec) => { const r = reconcile(rec); return `<tr${r.reconciled ? '' : ' class="row-alert"'}><td>${monthLabel(rec.statement_month)}${rec.note ? `<small>${e(rec.note)}</small>` : ''}</td><td>${money(rec.statement_balance_cents)}</td><td>${money(rec.deposits_in_transit_cents)}</td><td>${money(rec.outstanding_checks_cents)}</td><td>${money(r.adjustedCents)}</td><td>${money(rec.book_balance_cents)}</td><td>${r.reconciled ? '<span class="tone-good">Balanced</span>' : `<b class="tone-warn">${money(r.differenceCents)}</b>`}</td>${canEdit ? `<td class="actions"><a class="edit-link" href="${href('bank-rec', { edit: rec.statement_month })}">Edit</a> <form method="POST" action="/api/v1/property/bank-rec-remove" class="inline-form"><input type="hidden" name="statement_month" value="${rec.statement_month}"><button type="submit" class="link-button">Remove</button></form></td>` : ''}</tr>`; }).join('')}
    </tbody></table></div>
    <p class="muted-line">Adjusted = bank statement balance, plus deposits in transit, less outstanding checks. It should equal the cash on the manager’s report.</p></div>` : '';

  const f = editing || {};
  const form = canEdit ? `<details class="panel panel-spaced edit-panel"${editing || !recs.length ? ' open' : ''}><summary>${editing ? `Edit ${monthLabel(editing.statement_month)}` : 'Record a month'}</summary>
      <form method="POST" action="/api/v1/property/bank-rec-save" class="form-grid rb-form">
        <label class="field"><span>Statement month</span><input type="month" name="statement_month" value="${e(f.statement_month || new Date().toISOString().slice(0, 7))}" required></label>
        <label class="field"><span>Bank statement ending balance ($)</span><input name="statement_balance" inputmode="decimal" value="${editing ? (f.statement_balance_cents / 100).toFixed(2) : ''}" required></label>
        <label class="field"><span>Deposits in transit ($)</span><input name="deposits_in_transit" inputmode="decimal" value="${dollars(f.deposits_in_transit_cents)}"></label>
        <label class="field"><span>Outstanding checks ($)</span><input name="outstanding_checks" inputmode="decimal" value="${dollars(f.outstanding_checks_cents)}"></label>
        <label class="field"><span>Cash on the manager’s report ($)</span><input name="book_balance" inputmode="decimal" value="${editing ? (f.book_balance_cents / 100).toFixed(2) : ''}" required></label>
        <label class="field"><span>Note</span><input name="note" maxlength="200" value="${e(f.note || '')}"></label>
        <div class="form-actions"><button type="submit">Save reconciliation</button></div>
      </form></details>` : '';

  return `${statusBanner(status)}<p class="lede">The property’s own bank account, reconciled each month against the cash on the manager’s report, and what that cash has to cover.</p>${position}${history}${form}`;
}

// ── Debt payoff & future ──────────────────────────────────────────────────────────────────────

export function renderDebtPage({ loanResult, params, canEdit, status, today = new Date() }) {
  if (!loanResult?.ok) return `${statusBanner(status)}${unavailable('The loan record could not be read from Connect. Please try again.')}`;
  const loanContract = loanResult.loan;
  const { loan } = loanContract;
  const extraRaw = Number(String(params?.get?.('extra') || '').replace(/[$,\s]/g, ''));
  const extraCents = Number.isFinite(extraRaw) && extraRaw > 0 && extraRaw <= 100000 ? Math.round(extraRaw * 100) : 0;
  const p = loanProjection(loanContract, { extraCents, today });
  const lender = loan.lender || 'the lender';

  const statementForm = canEdit ? `<details class="panel panel-spaced edit-panel"${loan.balanceCents === null ? ' open' : ''}><summary>Record a loan statement</summary>
      <form method="POST" action="/api/v1/connect-property-meta-write" class="form-grid rb-form">
        <input type="hidden" name="loan_statement_form" value="1">
        <label class="field"><span>Statement date</span><input type="date" name="statement_date" required></label>
        <label class="field"><span>Principal balance ($)</span><input name="balance" inputmode="decimal" required></label>
        <label class="field"><span>Interest rate (%)</span><input name="rate_percent" inputmode="decimal" value="${loan.interestRate !== null ? +(loan.interestRate * 100).toFixed(4) : ''}"></label>
        <label class="field"><span>Monthly payment ($)</span><input name="monthly_payment" inputmode="decimal" value="${dollars(loan.monthlyPaymentCents)}"></label>
        <div class="form-actions"><button type="submit">Save statement</button></div>
      </form>
      <p class="muted-line">Saved to the property’s loan record in Connect. The newest statement becomes the confirmed balance; later months’ payments roll it forward from there.</p></details>` : '';

  if (!p.ok) {
    return `${statusBanner(status)}<div class="panel"><h2>The payoff cannot be projected yet</h2><p class="muted-line">The loan record needs a confirmed balance, an interest rate, and a monthly payment${canEdit ? '. Record the latest statement below' : ''}.</p></div>${statementForm}`;
  }

  const { rolled } = p;
  const years = byYear(p.base.months);
  const recordPayment = loan.monthlyPaymentCents;
  const paymentNote = rolled.lastReportedPaymentCents !== null && recordPayment !== null && rolled.lastReportedPaymentCents !== recordPayment
    ? `<p class="status status-pending">The loan record lists a ${money(recordPayment)} monthly payment, but the ${monthLabel(rolled.lastReportedPeriod)} report shows ${money(rolled.lastReportedPaymentCents)}. The projection uses the reported payment; record the next statement to settle which is right.</p>` : '';

  const cards = kpis([
    ['Balance now', money(rolled.balanceCents), rolled.applied.length ? `Through ${monthLabel(rolled.throughMonth)} payments` : `Confirmed ${dayLabel(loan.balanceAsOfDate)}`],
    ['Monthly payment', money(p.paymentCents), `${lender} at ${(p.rate * 100).toFixed(3).replace(/0+$/, '')}%`],
    ['Paid off', p.payoffMonth ? monthLabel(p.payoffMonth) : 'Not at this payment', p.payoffMonth ? `${p.base.months.length} more payments` : 'The payment does not cover the interest', p.payoffMonth ? '' : 'warn'],
    ['Interest still to pay', money(p.interestRemainingCents), 'At today’s rate and payment'],
  ]);

  const since = `<div class="panel panel-spaced list-panel"><h2>How the balance got here</h2>
      <p class="muted-line">${e(lender)} confirmed ${money(loan.balanceCents)} on ${dayLabel(loan.balanceAsOfDate)}.${rolled.applied.length ? ' Each later month’s principal (payment less interest) comes off that balance.' : ' No payments have been reported since.'}</p>
      ${rolled.applied.length ? `<div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance after</th></tr></thead><tbody>
        ${rolled.applied.map((m) => `<tr><td>${monthLabel(m.period)}</td><td>${money(m.paymentCents)}</td><td>${money(m.interestCents)}</td><td>${money(m.principalCents)}</td><td>${money(m.balanceCents)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${rolled.missingInterest.length ? `<p class="muted-line">Not applied: ${rolled.missingInterest.map(monthLabel).join(', ')} — the report gives the payment but not its interest.</p>` : ''}</div>`;

  const schedule = years.length ? `<div class="panel panel-spaced list-panel"><h2>Payoff by year</h2><div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Year</th><th>Payments</th><th>Interest</th><th>Principal</th><th>Balance at year end</th></tr></thead><tbody>
      ${years.map((y) => `<tr><td>${y.year}${y.count < 12 ? `<small>${y.count} payment${y.count === 1 ? '' : 's'}</small>` : ''}</td><td>${money(y.paymentCents)}</td><td>${money(y.interestCents)}</td><td>${money(y.principalCents)}</td><td>${money(y.balanceCents)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted-line">Starts ${monthLabel(p.startMonth)} and assumes the rate stays at ${(p.rate * 100).toFixed(3).replace(/0+$/, '')}% with ${money(p.paymentCents)} paid each month.</p></div>` : '';

  const extra = `<div class="panel panel-spaced list-panel"><h2>Paying extra principal</h2>
      <form method="GET" action="/" class="inline-form rb-picker"><input type="hidden" name="section" value="property"><input type="hidden" name="page" value="debt">
        <label>Extra each month ($) <input name="extra" inputmode="decimal" value="${extraCents ? (extraCents / 100).toFixed(0) : ''}" placeholder="500"></label><button type="submit" class="button-outline">Show</button></form>
      ${p.extra ? `<p>${money(extraCents)} more each month pays the loan off in <b>${p.extra.payoffMonth ? monthLabel(p.extra.payoffMonth) : '—'}</b>, ${p.extra.monthsSaved} month${p.extra.monthsSaved === 1 ? '' : 's'} sooner, and saves <b>${money(p.extra.interestSavedCents)}</b> in interest.</p>` : '<p class="muted-line">Enter an amount to see how much sooner the loan is paid off and the interest it saves. Nothing is saved.</p>'}
      ${p.payoffMonth ? `<p class="muted-line">When the loan is paid off, the ${money(p.paymentCents)} monthly payment (${money(p.paymentCents * 12)} a year) stays with the property.</p>` : ''}</div>`;

  const statements = loanContract.balanceHistory.length ? `<div class="panel panel-spaced list-panel"><h2>Loan statements on record</h2><div class="table-scroll"><table class="pm-table rb-num"><thead><tr><th>Date</th><th>Principal balance</th><th>Rate</th></tr></thead><tbody>
      ${[...loanContract.balanceHistory].reverse().map((h) => `<tr><td>${dayLabel(h.asOfDate)}</td><td>${money(h.balanceCents)}</td><td>${h.interestRate !== null ? `${(h.interestRate * 100).toFixed(3).replace(/0+$/, '')}%` : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';

  return `${statusBanner(status)}<p class="lede">The property’s ${e(lender)} loan, from the last balance the lender confirmed, rolled forward with the monthly payments on the manager’s reports, and projected to payoff.</p>${paymentNote}${cards}${since}${schedule}${extra}${statements}${statementForm}`;
}

export const PROPERTY_BOOKS_STYLES = `
    .rb-num td:not(:first-child), .rb-num th:not(:first-child) { text-align:right !important; white-space:nowrap; }
    .rb-num td:nth-child(2) { white-space:normal; }
    .rb-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; }
    .rb-picker { margin:10px 0; flex-wrap:wrap; }
    .rb-picker label { display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; }
    .rb-picker input { width:110px; }
    .rb-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px 18px; }
    .edit-panel textarea { width:100%; font-family:ui-monospace,Menlo,monospace; font-size:13px; }
    .tone-good { color:#1F6F43; }
    .tone-warn { color:#9A3412; }
`;
