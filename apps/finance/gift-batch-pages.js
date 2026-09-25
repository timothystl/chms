// Gift Entry, v3 design: Enter a batch, Reconciliation to bank, and Batch reports. Every figure is
// read live from Connect (giving-batch-*-v1); every change posts to /api/v1/gift-batch-write,
// which relays it to Connect. Finance keeps no copy of any gift.
import { escapeHtml as e } from './render-helpers.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CASH_DENOMINATIONS = Object.freeze([['c1', 1], ['c5', 5], ['c10', 10], ['c20', 20], ['c50', 50], ['c100', 100]]);
const METHOD_LABELS = { check: 'Check', cash: 'Cash', online: 'Online', card: 'Card', ach: 'ACH', stock: 'Stock', other: 'Other' };

function href(page, params = {}) {
  const search = new URLSearchParams({ section: 'giving', page, ...params });
  return `/?${search.toString().replace(/&/g, '&amp;')}`;
}

function shortDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y ? `${MONTHS[m - 1]} ${d}` : '—';
}

function longDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y) return '—';
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

// Gift entry works to the cent: a rounded dollar figure would hide a count or deposit mismatch.
const EXACT_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(cents) {
  return EXACT_USD.format((Number(cents) || 0) / 100);
}

function statusBanner(status) {
  return status ? `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>` : '';
}

function kpis(items) {
  return `<div class="grid">${items.map(([label, value, note, tone]) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong>${note ? `<span class="${tone ? `tone-${tone}` : ''}">${note}</span>` : ''}</div>`).join('')}</div>`;
}

function fundSelect(name, funds, selected) {
  return `<select name="${name}"><option value="">Fund</option>${funds.map((f) => `<option value="${f.id}"${String(f.id) === String(selected ?? '') ? ' selected' : ''}>${e(f.name)}</option>`).join('')}</select>`;
}

function unavailable(what, message) {
  return `<p class="status status-error">${e(what)} could not be read from Connect: ${e(message)} Nothing here is a real $0.</p>`;
}

const DEPOSIT_TONE = { needs_deposit: 'warn', split: 'warn', unreconciled: 'warn', deposited: 'good' };

// ── Enter a batch ─────────────────────────────────────────────────────────────────────────────

export function cashCount(params) {
  let cents = 0;
  let bills = 0;
  const counts = {};
  for (const [key, value] of CASH_DENOMINATIONS) {
    const n = Math.max(0, Math.min(100000, parseInt(params.get(key) || '0', 10) || 0));
    counts[key] = n;
    bills += n;
    cents += n * value * 100;
  }
  const coinsCents = Math.max(0, Math.round((parseFloat(params.get('coins') || '0') || 0) * 100));
  return { counts, bills, coinsCents, cents: cents + coinsCents, entered: params.has('coins') || CASH_DENOMINATIONS.some(([key]) => params.has(key)) };
}

function newBatchForm(today) {
  return `<form method="POST" action="/api/v1/gift-batch-write" class="form-grid facility-form">
    <input type="hidden" name="op" value="create_batch">
    <label class="field"><span>Batch date</span><input type="date" name="batch_date" required value="${today}"></label>
    <label class="field"><span>Description</span><input name="description" maxlength="120" value="Sunday · plate &amp; envelopes"></label>
    <div class="form-actions"><button type="submit">Start batch</button></div>
  </form>`;
}

function giverPicker(ws, batch, params) {
  const personId = params.get('person') || '';
  const chosen = ws.people.find((p) => String(p.id) === personId);
  const chosenName = chosen ? `${chosen.first_name} ${chosen.last_name}` : (params.get('person_name') || '');
  const results = ws.people.length && params.get('q')
    ? `<ul class="giver-results">${ws.people.map((p) => `<li><a href="${href('batch', { batch_id: String(batch.id), person: String(p.id), person_name: `${p.first_name} ${p.last_name}` })}">${e(p.first_name)} ${e(p.last_name)}</a>${p.envelope_number ? `<small>Env. #${e(p.envelope_number)}</small>` : ''}</li>`).join('')}</ul>`
    : params.get('q') ? '<p class="muted-line">No one matches that name or envelope. Leave the giver blank to record it anonymously.</p>' : '';
  return {
    personId: chosen || params.get('person_name') ? personId : '',
    chosenName,
    html: `<form method="GET" action="/" class="giver-search">
        <input type="hidden" name="section" value="giving"><input type="hidden" name="page" value="batch"><input type="hidden" name="batch_id" value="${batch.id}">
        <label class="field"><span>Giver</span><span class="giver-row"><input name="q" value="${e(params.get('q') || '')}" placeholder="Name or envelope #"><button type="submit" class="button-outline">Find</button></span></label>
      </form>
      ${results}
      ${chosenName ? `<p class="giver-chosen">Giving as <b>${e(chosenName)}</b> · <a href="${href('batch', { batch_id: String(batch.id) })}">clear</a></p>` : '<p class="muted-line">No giver chosen — the gift is recorded anonymously.</p>'}`,
  };
}

function renderBatchDetail(ws, batch, params, today) {
  const funds = ws.funds;
  const open = !batch.closed;
  const cash = batch.method_totals.find((m) => m.method === 'cash')?.cents || 0;
  const checks = batch.method_totals.find((m) => m.method === 'check')?.cents || 0;
  const cashGifts = batch.entries.filter((x) => x.method === 'cash').length;
  const giver = giverPicker(ws, batch, params);
  const count = cashCount(params);
  const general = funds.find((f) => /general/i.test(f.name)) || funds[0];

  const giftForm = open ? `<div class="panel">
      <div class="panel-head"><h2>Enter a gift</h2><span class="muted">Adds to batch #${batch.id}</span></div>
      ${giver.html}
      <form method="POST" action="/api/v1/gift-batch-write" class="form-grid facility-form">
        <input type="hidden" name="op" value="add_gift"><input type="hidden" name="batch_id" value="${batch.id}">
        <input type="hidden" name="person_id" value="${e(giver.personId)}">
        <label class="field"><span>Fund</span>${fundSelect('fund_1', funds, general?.id)}</label>
        <label class="field"><span>Amount ($)</span><input name="amount_1" inputmode="decimal" placeholder="0.00" required></label>
        <label class="field"><span>Method</span><select name="method">${Object.entries(METHOD_LABELS).filter(([k]) => ['check', 'cash', 'card', 'ach', 'other'].includes(k)).map(([k, v]) => `<option value="${k}"${k === 'check' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Gift date</span><input type="date" name="gift_date" value="${e(batch.batch_date || today)}"></label>
        <label class="field"><span>Check #</span><input name="check_number" maxlength="40" placeholder="Optional"></label>
        <label class="field"><span>Memo</span><input name="notes" maxlength="300" placeholder="Optional · shows on statement"></label>
        <details class="field-wide split-funds"><summary>Split this gift across funds</summary>
          <div class="split-grid">${[2, 3, 4].map((n) => `<label class="field"><span>Fund ${n}</span>${fundSelect(`fund_${n}`, funds, '')}</label><label class="field"><span>Amount ${n} ($)</span><input name="amount_${n}" inputmode="decimal" placeholder="0.00"></label>`).join('')}</div>
        </details>
        <div class="form-actions"><button type="submit">Add to batch</button></div>
      </form>
    </div>
    <div class="panel panel-spaced">
      <div class="panel-head"><h2>Loose cash</h2><span class="muted">Plate cash with no envelope · recorded as an anonymous gift</span></div>
      <form method="POST" action="/api/v1/gift-batch-write" class="inline-form loose-cash">
        <input type="hidden" name="op" value="add_gift"><input type="hidden" name="batch_id" value="${batch.id}"><input type="hidden" name="method" value="cash"><input type="hidden" name="notes" value="Loose cash">
        <input name="amount_1" inputmode="decimal" placeholder="0.00" aria-label="Loose cash amount" required>${fundSelect('fund_1', funds, general?.id)}
        <button type="submit">Add loose cash</button>
      </form>
    </div>
    <div class="panel panel-spaced">
      <div class="panel-head"><h2>Cash count · all cash</h2><span class="muted">Every bill going in the deposit</span></div>
      <form method="GET" action="/" class="cash-count">
        <input type="hidden" name="section" value="giving"><input type="hidden" name="page" value="batch"><input type="hidden" name="batch_id" value="${batch.id}">
        <div class="bill-grid">${CASH_DENOMINATIONS.map(([key, value]) => `<label class="bill"><span>$${value} bills</span><input type="number" min="0" name="${key}" value="${count.counts[key] || ''}" placeholder="0"><small>${count.entered ? money(count.counts[key] * value * 100) : ''}</small></label>`).join('')}
          <label class="bill"><span>Coins ($)</span><input name="coins" inputmode="decimal" value="${count.coinsCents ? (count.coinsCents / 100).toFixed(2) : ''}" placeholder="0.00"></label></div>
        <button type="submit" class="button-outline">Check the count</button>
      </form>
      ${count.entered ? `<div class="count-result ${count.cents === cash ? 'is-match' : 'is-off'}">
        <div><span>Cash counted · ${count.bills} bills</span><b>${money(count.cents)}</b></div>
        <div><span>Cash gifts recorded · ${cashGifts} gift${cashGifts === 1 ? '' : 's'}</span><b>${money(cash)}</b></div>
        <p>${count.cents === cash ? 'Cash matches ✓' : `Off by ${money(Math.abs(count.cents - cash))} — ${count.cents > cash ? 'more cash counted than recorded' : 'less cash counted than recorded'}.`}</p>
      </div><p class="muted-line">The count is only checked here, not saved — write the total on the deposit slip.</p>` : ''}
    </div>` : `<div class="panel">
      <h2>Batch closed</h2>
      <p class="muted-line">Closing locked this batch. ${batch.deposit_status ? `Deposit status: ${e(batch.deposit_status.label)}.` : ''} Reopen it to change a gift.</p>
      <form method="POST" action="/api/v1/gift-batch-write" class="inline-form"><input type="hidden" name="op" value="reopen_batch"><input type="hidden" name="batch_id" value="${batch.id}"><button type="submit" class="button-outline">Reopen batch</button></form>
      ${batch.deposit_status?.key === 'needs_deposit' ? depositForm(batch, today, 'batch') : ''}
    </div>`;

  const giftRows = batch.entries.map((x, i) => `<li>
      <span class="gift-num">${i + 1}</span>
      <div class="grow"><b>${e(x.person_name || (x.notes === 'Loose cash' ? 'Loose cash' : 'Anonymous'))}</b><small>${e([x.fund_name, METHOD_LABELS[x.method] || x.method, x.check_number ? `Check #${x.check_number}` : '', x.envelope_number ? `Env. #${x.envelope_number}` : ''].filter(Boolean).join(' · '))}</small></div>
      <div class="right"><b>${money(x.amount)}</b>${x.notes && x.notes !== 'Loose cash' ? '<small>Memo</small>' : ''}
      ${open ? `<form method="POST" action="/api/v1/gift-batch-write" class="inline-form"><input type="hidden" name="op" value="remove_gift"><input type="hidden" name="entry_id" value="${x.id}"><input type="hidden" name="batch_id" value="${batch.id}"><button type="submit" class="link-button">Remove</button></form>` : ''}</div>
    </li>`).join('');

  return `<div class="batch-hero">
      <div><small>BATCH #${batch.id}</small><b>${e(longDate(batch.batch_date))}${batch.description ? ` · ${e(batch.description)}` : ''}</b></div>
      <div><small>Batch total</small><b>${money(batch.total_cents)}</b></div>
      <div><small>Checks</small><b>${money(checks)}</b></div>
      <div><small>Cash</small><b>${money(cash)}</b></div>
      <span class="pay-hero-pill ${open ? '' : 'is-approved'}">${open ? 'Open' : 'Closed'}</span>
    </div>
    <div class="panel-grid batch-grid">
      <div>${giftForm}</div>
      <div class="panel">
        <div class="panel-head"><h2>Gifts in this batch</h2><span class="muted">${batch.entries.length} gift${batch.entries.length === 1 ? '' : 's'}</span></div>
        ${batch.entries.length ? `<ul class="row-list gift-list">${giftRows}</ul>` : '<p class="muted-line">No gifts entered yet.</p>'}
        ${batch.fund_totals.length ? `<ul class="fund-totals">${batch.fund_totals.map((f) => `<li><span>${e(f.fund_name)}</span><span>${money(f.cents)}</span></li>`).join('')}<li class="total"><span>Batch total</span><span>${money(batch.total_cents)}</span></li></ul>` : ''}
        ${open ? `<form method="POST" action="/api/v1/gift-batch-write"><input type="hidden" name="op" value="close_batch"><input type="hidden" name="batch_id" value="${batch.id}"><button type="submit" class="close-batch"${batch.entries.length ? '' : ' disabled'}>Close batch #${batch.id}</button></form>
          <p class="muted-line center">${count.entered ? (count.cents === cash ? 'Cash count matches. ' : 'Cash count does not match yet. ') : ''}Closing locks the batch for deposit.</p>` : ''}
        <p class="muted-line">To print the batch report, use Print at the top of the page.</p>
      </div>
    </div>`;
}

function depositForm(batch, today, returnPage) {
  const remaining = batch.deposit_status?.remaining_cents ?? batch.total_cents;
  return `<form method="POST" action="/api/v1/gift-batch-write" class="inline-form deposit-form">
    <input type="hidden" name="op" value="deposit_batch"><input type="hidden" name="batch_id" value="${batch.id}"><input type="hidden" name="return" value="${returnPage}">
    <input type="date" name="deposit_date" value="${today}" aria-label="Deposit date" required>
    <input name="external_ref" maxlength="80" placeholder="Bank reference (optional)" aria-label="Bank reference">
    <select name="source" aria-label="Deposit type"><option value="mixed">Checks &amp; cash</option><option value="check">Checks</option><option value="cash">Cash</option><option value="online">Online</option></select>
    <button type="submit" class="button-outline">Deposit ${money(remaining)}</button>
  </form>`;
}

export function renderBatchPage({ result, params, status, today }) {
  if (!result.ok) return `${statusBanner(status)}${unavailable('Gift batches', result.message)}`;
  const ws = result.data;
  const batch = ws.batch;
  const openCount = ws.open_batches.length;
  const top = kpis([
    ['Entered this week', money(ws.week?.total_cents || 0), `${ws.week?.gift_count || 0} gifts`],
    [batch ? (batch.closed ? 'Closed batch' : 'Open batch') : 'Open batch', batch ? `#${batch.id}` : '—', batch ? (batch.closed ? e(batch.deposit_status?.label || 'Closed') : 'Not yet deposited') : 'Start one below', batch && !batch.closed ? 'warn' : ''],
    ['Open batches', String(openCount), openCount > 1 ? 'Close each before depositing' : 'Counted but not yet closed'],
  ]);
  const picker = openCount > 1 || (batch && batch.closed && openCount)
    ? `<div class="chip-row">${ws.open_batches.map((b) => (batch && b.id === batch.id) ? `<span class="chip is-on">#${b.id} · ${e(shortDate(b.batch_date))}</span>` : `<a class="chip" href="${href('batch', { batch_id: String(b.id) })}">#${b.id} · ${e(shortDate(b.batch_date))} · ${money(b.total_cents)}</a>`).join('')}</div>` : '';
  return `${statusBanner(status)}
    ${top}
    ${picker}
    ${batch ? renderBatchDetail(ws, batch, params, today) : `<div class="panel panel-spaced"><h2>Start a batch</h2><p class="muted-line">A batch is one count — usually Sunday’s plate and envelopes.</p>${newBatchForm(today)}</div>`}
    ${batch ? `<details class="panel panel-spaced edit-panel"><summary>Start another batch</summary>${newBatchForm(today)}</details>` : ''}`;
}

// ── Reconciliation to bank ────────────────────────────────────────────────────────────────────

export function renderReconciliationPage({ result, status, today }) {
  if (!result.ok) return `${statusBanner(status)}${unavailable('Deposits', result.message)}`;
  const { batches, deposits, lines } = result.data;
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const waiting = batches.filter((b) => b.closed && b.deposit_status?.key === 'needs_deposit' && b.total_cents > 0);
  const openDeposits = deposits.filter((d) => d.status !== 'reconciled');
  const lastMatched = deposits.filter((d) => d.status === 'reconciled').map((d) => d.deposit_date).sort().at(-1);
  const top = kpis([
    ['Matched through', lastMatched ? e(shortDate(lastMatched)) : '—', 'Latest deposit reconciled to the bank'],
    ['Deposits to match', String(openDeposits.length), openDeposits.length ? 'Waiting on the bank statement' : 'All matched', openDeposits.length ? 'warn' : 'good'],
    ['Batches waiting for a deposit', String(waiting.length), waiting.length ? money(waiting.reduce((s, b) => s + b.total_cents, 0)) : 'Nothing waiting', waiting.length ? 'warn' : ''],
  ]);
  const rows = deposits.slice(0, 40).map((d) => {
    const names = lines.filter((l) => l.deposit_id === d.id).map((l) => batchById.get(l.batch_id)).filter(Boolean)
      .map((b) => `${shortDate(b.batch_date)}${b.description ? ` · ${b.description}` : ''}`);
    const given = d.batch_count > 0 ? d.line_cents : 0;
    const diff = d.bank_cents === null || d.bank_cents === undefined ? null : d.bank_cents - given;
    const action = d.status === 'reconciled'
      ? `<span class="tone-good">Matched</span> <form method="POST" action="/api/v1/gift-batch-write" class="inline-form matched-reopen"><input type="hidden" name="op" value="reopen_deposit"><input type="hidden" name="deposit_id" value="${d.id}"><button type="submit" class="link-button">Reopen</button></form>`
      : `<form method="POST" action="/api/v1/gift-batch-write" class="inline-form"><input type="hidden" name="op" value="reconcile_deposit"><input type="hidden" name="deposit_id" value="${d.id}"><input name="bank_amount" inputmode="decimal" value="${(given / 100).toFixed(2)}" aria-label="Amount on the bank statement" class="bank-in"><button type="submit" class="button-outline">Match</button></form>`;
    return `<tr><td>${e(shortDate(d.deposit_date))}</td><td>${e(names.join('; ') || '—')}<small>${e(d.external_ref || '')}</small></td><td>${money(given)}</td>
      <td>${d.bank_cents === null || d.bank_cents === undefined ? '—' : money(d.bank_cents)}</td>
      <td class="${diff ? 'tone-bad' : 'tone-muted'}">${diff === null ? '—' : `${diff < 0 ? '−' : ''}${money(Math.abs(diff))}`}</td><td class="actions">${action}</td></tr>`;
  }).join('');
  return `${statusBanner(status)}
    <p class="lede">Closed batches go on a bank deposit; each deposit is matched against the amount on the operating checking statement.</p>
    ${top}
    ${waiting.length ? `<div class="panel panel-spaced"><h2>Closed batches waiting for a deposit</h2><ul class="row-list">${waiting.map((b) => `<li><div><b>${e(shortDate(b.batch_date))} · ${e(b.description || `Batch #${b.id}`)}</b><small>${b.entry_count} gifts · ${money(b.total_cents)}</small></div><div class="right">${depositForm(b, today, 'reconciliation')}</div></li>`).join('')}</ul></div>` : ''}
    <div class="panel panel-spaced list-panel">${rows ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Date</th><th>Batches</th><th>Deposit total</th><th>Bank amount</th><th>Diff.</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-note">No deposits yet.</div>'}</div>
    <p class="muted-line">Online giving deposited net of processor fees is matched in Connect’s Giving tab, where fees are recorded per gift.</p>`;
}

// ── Batch reports ─────────────────────────────────────────────────────────────────────────────

export function renderBatchReportsPage({ result, today }) {
  if (!result.ok) return unavailable('Batch reports', result.message);
  const { batches } = result.data;
  const month = today.slice(0, 7);
  const thisMonth = batches.filter((b) => String(b.batch_date).startsWith(month));
  const deposited = thisMonth.filter((b) => b.deposit_status?.key === 'deposited');
  const pending = thisMonth.filter((b) => b.deposit_status?.key !== 'deposited');
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1];
  const top = kpis([
    [`Batches in ${monthName}`, String(thisMonth.length), `${thisMonth.filter((b) => !b.closed).length} still open`],
    ['Gifts entered', String(thisMonth.reduce((s, b) => s + b.entry_count, 0)), money(thisMonth.reduce((s, b) => s + b.total_cents, 0))],
    ['Deposited', money(deposited.reduce((s, b) => s + b.total_cents, 0)), `${pending.length} batch${pending.length === 1 ? '' : 'es'} pending`, pending.length ? 'warn' : 'good'],
  ]);
  const rows = batches.slice(0, 60).map((b) => `<tr><td>${e(shortDate(b.batch_date))}</td><td><a href="${href('batch', { batch_id: String(b.id) })}">${e(b.description || `Batch #${b.id}`)}</a><small>#${b.id}${b.closed ? '' : ' · open'}</small></td><td>${b.entry_count}</td><td>${money(b.total_cents)}</td><td class="tone-${DEPOSIT_TONE[b.deposit_status?.key] || 'muted'}">${e(b.closed ? (b.deposit_status?.label || '—') : 'Open')}</td></tr>`).join('');
  return `${top}
    <div class="panel panel-spaced list-panel">${rows ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Date</th><th>Batch</th><th>Gifts</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-note">No batches yet.</div>'}</div>
    <p class="muted-line">Open a batch to review or print its gifts.</p>`;
}

export const GIFT_BATCH_STYLES = `
    .matched-reopen { display:inline-flex; margin-left:10px; }
    .batch-hero { display:flex; flex-wrap:wrap; align-items:flex-end; gap:18px 36px; margin-top:16px; padding:20px 22px; border-radius:10px; background:var(--navy); color:#fff; position:relative; }
    .batch-hero small { display:block; color:#C9D2E2; font-size:12px; letter-spacing:.08em; }
    .batch-hero b { display:block; font-family:"Outfit",sans-serif; font-weight:500; font-size:24px; }
    .batch-grid { grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); }
    @media(max-width:1000px){ .batch-grid{grid-template-columns:1fr} }
    .giver-search { margin-top:10px; }
    .giver-row { display:flex; gap:8px; }
    .giver-row input { flex:1; }
    .giver-row button { margin:0; }
    .giver-results { list-style:none; margin:6px 0 0; padding:0; border:1px solid var(--line); border-radius:8px; }
    .giver-results li { display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--line-soft); font-size:14px; }
    .giver-results li:last-child { border-bottom:0; }
    .giver-results small { color:var(--muted); }
    .giver-chosen { margin:8px 0 0; font-size:14px; }
    .split-funds summary { cursor:pointer; color:var(--gold-ink); font-size:13.5px; text-decoration:underline; }
    .split-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; margin-top:10px; }
    .loose-cash { display:flex; gap:8px; margin-top:10px; }
    .loose-cash input { width:8rem; }
    .loose-cash button { margin:0; }
    .bill-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-top:10px; }
    .bill { display:flex; flex-direction:column; gap:4px; padding:10px; border:1px solid var(--line); border-radius:8px; }
    .bill span { font-size:13px; font-weight:600; color:var(--ink); }
    .bill small { text-align:right; color:var(--muted); font-size:12px; min-height:1em; }
    .cash-count button { margin-top:10px; }
    .count-result { margin-top:12px; padding:14px 16px; border-radius:8px; }
    .count-result.is-match { background:#EFF7F2; }
    .count-result.is-off { background:#FBEFEC; }
    .count-result div { display:flex; justify-content:space-between; font-size:14px; margin-bottom:4px; }
    .count-result p { margin:6px 0 0; font-weight:600; }
    .count-result.is-match p { color:var(--green); }
    .count-result.is-off p { color:var(--red); }
    .gift-list li { align-items:flex-start; }
    .gift-num { width:1.5rem; color:var(--faint); font-size:12px; padding-top:2px; }
    .gift-list .grow { flex:1; min-width:0; }
    .fund-totals { list-style:none; margin:12px 0 0; padding:0; }
    .fund-totals li { display:flex; justify-content:space-between; padding:4px 8px; font-size:14px; color:var(--muted); }
    .fund-totals li.total { margin-top:4px; padding-top:8px; border-top:1px solid var(--navy); color:var(--ink); font-weight:600; }
    .close-batch { width:100%; margin-top:16px; }
    .center { text-align:center; }
    .deposit-form { flex-wrap:wrap; justify-content:flex-end; }
    .deposit-form input, .deposit-form select { padding:5px 8px; font-size:13px; }
    .bank-in { width:7rem; padding:5px 8px; text-align:right; }
    @media print {
      .batch-grid form, .chip-row, .grid, details, .giver-search { display:none !important; }
      .batch-grid { grid-template-columns:1fr !important; }
      .batch-hero { color:#000; background:#fff; border:1px solid #000; }
    }
`;
