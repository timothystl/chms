// ── Stax Giving MOCKUP ──────────────────────────────────────────────────────
// See docs/STAX_GIVING_MOCKUP.md for the full walkthrough. This is a prototype, not a shipped
// feature: it runs entirely alongside the existing Tithe.ly → give.timothystl.org path (which
// this file never touches), uses Stax SANDBOX credentials only, and every page it serves is
// visibly labeled "MOCKUP". No production data or production Stax merchant account is read or
// written by anything in this file.
//
// Webhook rigor deliberately mirrors childcare-portal's supabase/functions/stax-webhook — the
// one piece of this scope that's "copy a working pattern, not new design": authenticate the
// webhook (shared secret in the registered URL, since Stax does not sign payloads), re-fetch the
// transaction from Stax's Core API rather than trust the POST body, and stay idempotent on
// Stax's transaction id (via the idx_giving_external_txn unique index — see migration 0053).
//
// Gifts land in the EXISTING giving_entries ledger (see migration 0053's header comment) so a
// donor who gives through both Tithe.ly and this mockup reads as one giving history, not two.
import { json, html, timingSafeEqual, esc } from './auth.js';
import { normalizePhone } from './api-utils.js';
import { sendBrevoTransactionalEmail } from './api-emails.js';

// Same single Core API host for sandbox and production; only the API key differs. Verified live
// against this host by childcare-portal's Stax integration (see its create-stax-charge and
// charge-stax-payment functions) — mirrored here, not re-derived from scratch.
const STAX_API_URL = 'https://apiprod.fattlabs.com';

export function staxMockupConfigured(env) {
  return !!(env.STAX_SANDBOX_API_KEY && env.STAX_SANDBOX_WEB_PAYMENTS_TOKEN);
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n * 100);
  return Math.abs(n * 100 - rounded) <= 0.000001 ? rounded : null;
}
function amountStr(centsValue) { return (Math.round(centsValue) / 100).toFixed(2); }
function todayIso() { return new Date().toISOString().slice(0, 10); }

// ── Recurring schedule rule builder ─────────────────────────────────────────
// The FIRST occurrence of a recurring signup is already charged immediately (see the /recurring
// handler), so the standing Stax schedule below must start on the NEXT occurrence, not today —
// otherwise the donor would be double-charged on day one.
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonthsIso(iso, months) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
// Next 1st-or-15th strictly after the given date.
function nextMonthlyDayIso(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (d.getUTCDate() < 15) { d.setUTCDate(15); } else { d.setUTCMonth(d.getUTCMonth() + 1, 1); }
  return d.toISOString().slice(0, 10);
}
// iCalendar RRULE string per docs.staxpayments.com/reference/create-a-scheduled-invoice
// (e.g. "DTSTART=20261101T120000Z;FREQ=MONTHLY"). Noon UTC avoids the DTSTART falling on the
// wrong calendar day for a merchant west of UTC.
export function buildScheduleRule(interval, fromIso) {
  let nextIso, freqPart;
  if (interval === 'weekly') { nextIso = addDaysIso(fromIso, 7); freqPart = 'FREQ=WEEKLY'; }
  else if (interval === 'biweekly') { nextIso = addDaysIso(fromIso, 14); freqPart = 'FREQ=WEEKLY;INTERVAL=2'; }
  else if (interval === 'twice_monthly') { nextIso = nextMonthlyDayIso(fromIso); freqPart = 'FREQ=MONTHLY;BYMONTHDAY=1,15'; }
  else { nextIso = addMonthsIso(fromIso, 1); freqPart = 'FREQ=MONTHLY'; }
  return `DTSTART=${nextIso.replace(/-/g, '')}T120000Z;${freqPart}`;
}

// ── Charge outcome helpers ───────────────────────────────────────────────────
// Confirmed against docs.staxpayments.com/docs/payment-status: a "Gateway Unreachable" charge
// response means Stax itself never got an answer back from the card network — the transaction
// sits at status PENDING, and Stax's own guidance is NOT to prompt an immediate retry, since the
// original attempt may still resolve to success on its own (within roughly 3 hours) — retrying
// right away risks charging the donor twice for one gift. Every other decline (card declined,
// velocity limit, bad expiration, etc.) is a real, final answer and safe to retry.
function chargeOutcomeUnknown(chargeData) {
  const status = String(chargeData?.status || '').toUpperCase();
  const msg = String(chargeData?.message || '').toLowerCase();
  return status === 'PENDING' || msg.includes('gateway unreachable');
}
function chargeFailureMessage(chargeData) {
  if (chargeOutcomeUnknown(chargeData)) {
    return "We couldn't confirm this payment — Stax's payment gateway didn't respond in time, so the outcome of this specific attempt is unknown (it may still complete on its own). Please don't submit this card again right now; wait a few minutes, or contact the church office to confirm before trying again.";
  }
  return chargeData?.message || 'The charge was not approved.';
}

export async function staxRequest(apiKey, path, init) {
  const res = await fetch(`${STAX_API_URL}${path}`, {
    ...init,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Donor matching (email first, then phone) ────────────────────────────────
// Same shape as api-intake.js's findPersonByEmail (best-effort link to an existing ACTIVE
// person, never creates one) — extended with a phone fallback per the mockup's ask, since a
// Stax payer often types the card's billing email, which may not be the email on file.
export async function matchPersonForPayer(db, { email, phone } = {}) {
  const cleanEmail = String(email || '').trim();
  if (cleanEmail) {
    const p = await db.prepare(
      "SELECT id, first_name, last_name, email, phone FROM people WHERE LOWER(email)=LOWER(?) AND status='active' LIMIT 1"
    ).bind(cleanEmail).first();
    if (p) return p;
  }
  const normPhone = normalizePhone(String(phone || '').trim());
  if (normPhone) {
    const p = await db.prepare(
      "SELECT id, first_name, last_name, email, phone FROM people WHERE phone=? AND status='active' LIMIT 1"
    ).bind(normPhone).first();
    if (p) return p;
  }
  return null;
}

// ── Stax customer lookup/creation — also the exemption from Stax's own AVS/address requirement ──
// Confirmed against Stax's own tokenize() field reference
// (docs.staxpayments.com/docs/tokenize-a-card-on-your-website): address_1/address_city/
// address_state are each documented as "Required if customer_id is not passed into details" —
// supplying customer_id makes Stax.js skip that requirement entirely, which is the confirmed
// (not guessed) reason childcare-portal's own Stax integration never needs address fields: every
// family gets one persistent Stax Customer, reused on every charge. This mirrors that: reuse a
// matched donor's existing stax_customer_id (giving_stax_customers) if one exists, otherwise
// create a new Stax customer (no address needed for that call either) and link it once a donor
// matches a known Connect person. An unmatched donor still gets a fresh, unlinked Stax customer
// so their tokenize() call gets the same AVS exemption — recordStaxGift already carries
// stax_customer_id through to giving_stax_unmatched for staff to link retroactively.
async function getOrCreateStaxCustomerId(db, apiKey, contact) {
  const person = await matchPersonForPayer(db, { email: contact.payerEmail, phone: contact.payerPhone });
  if (person) {
    const link = await db.prepare(
      `SELECT stax_customer_id FROM giving_stax_customers WHERE person_id=?`
    ).bind(person.id).first();
    if (link && link.stax_customer_id) return { customerId: link.stax_customer_id, personId: person.id };
  }
  const created = await staxRequest(apiKey, '/customer', {
    method: 'POST',
    body: JSON.stringify({
      firstname: contact.payerFirstName, lastname: contact.payerLastName,
      email: contact.payerEmail || undefined,
      reference: `chms-mockup-${Date.now()}`,
    }),
  });
  if (!created.ok || !created.data?.id) return { error: 'Could not start payment with Stax.' };
  const customerId = created.data.id;
  if (person) {
    await db.prepare(
      `INSERT INTO giving_stax_customers (person_id, stax_customer_id) VALUES (?,?)
       ON CONFLICT(person_id) DO UPDATE SET stax_customer_id=excluded.stax_customer_id`
    ).bind(person.id, customerId).run().catch(() => {
      // A concurrent request already linked this person to a different customer id — leave that
      // link alone; the customer just created above is still perfectly usable for this one gift.
    });
  }
  return { customerId, personId: person ? person.id : null };
}

// ── Shared insert path: a verified Stax gift → giving_entries ──────────────
// Idempotent on (processor, external_txn_id) via idx_giving_external_txn — calling this twice
// for the same Stax transaction id (a webhook redelivery, or a synchronous-success path followed
// by the same event arriving over the webhook) is a no-op the second time, matching
// childcare-portal stax-webhook's "recover a synchronous charge whose response was lost, without
// ever double-recording one that wasn't" contract.
//
// g.splits: [{fundId, amountCents}, ...] — a single Stax charge can be split across several
// funds (the "multiple gifts" row in the form). Each split becomes its own giving_entries row
// (a fund designation is a property of the LEDGER row, not something giving_entries can hold
// twice on one row) sharing the same batch/person/payer info. A single-fund gift (by far the
// common case) is just a one-element splits array, and keeps its external_txn_id exactly as
// Stax gave it — idx_giving_external_txn's uniqueness is still one row per Stax transaction id
// in that case. A multi-fund gift suffixes each row's id with `-f<fundId>` (distinct per fund
// within one transaction, so still globally unique) — same shape childcare-portal's
// billing_payments uses for a split payment (`<transId>-inv<n>`), not a new pattern.
export async function recordStaxGift(db, g) {
  const externalTxnId = String(g.externalTxnId || '');
  if (!externalTxnId) return { error: 'external_txn_id required' };
  const splits = (Array.isArray(g.splits) ? g.splits : [{ fundId: g.fundId, amountCents: g.amountCents }])
    .map(s => ({ fundId: parseInt(s.fundId), amountCents: Math.round(Number(s.amountCents)) }));
  if (!splits.length || splits.some(s => !Number.isInteger(s.fundId) || !Number.isFinite(s.amountCents) || s.amountCents <= 0)) {
    return { error: 'each gift needs a fund_id and a positive amount' };
  }
  if (new Set(splits.map(s => s.fundId)).size !== splits.length) {
    return { error: 'the same fund cannot appear twice in one gift' };
  }

  const existing = await db.prepare(
    `SELECT id, person_id FROM giving_entries WHERE processor='stax' AND (external_txn_id=? OR external_txn_id LIKE ?) LIMIT 1`
  ).bind(externalTxnId, externalTxnId + '-f%').first();
  if (existing) return { entryId: existing.id, entryIds: [existing.id], alreadyRecorded: true, matched: existing.person_id != null, personId: existing.person_id || null };

  // Prefer a known returning-donor link (giving_stax_customers) over a fresh email/phone
  // lookup — a donor may give from a new device/browser (so no local cookie) or use a
  // household member's email on the card, but the Stax customer id is stable once linked.
  let person = null;
  if (g.staxCustomerId) {
    const link = await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone
         FROM giving_stax_customers c JOIN people p ON p.id=c.person_id
        WHERE c.stax_customer_id=?`
    ).bind(g.staxCustomerId).first();
    if (link) person = link;
  }
  if (!person) person = await matchPersonForPayer(db, { email: g.payerEmail, phone: g.payerPhone });

  const contributionDate = g.contributionDate || todayIso();
  const monthKey = contributionDate.slice(0, 7);
  const batchDesc = 'Stax Giving (mockup) ' + monthKey;
  let batch = await db.prepare(
    `SELECT id FROM giving_batches WHERE description=? AND closed=0 LIMIT 1`
  ).bind(batchDesc).first();
  let batchId;
  if (batch) {
    batchId = batch.id;
  } else {
    const br = await db.prepare(
      `INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,0)`
    ).bind(contributionDate, batchDesc).run();
    batchId = br.meta?.last_row_id;
  }

  const payerFirstName = g.payerFirstName || '';
  const payerLastName = g.payerLastName || '';
  const payerFullName = g.payerName || [payerFirstName, payerLastName].filter(Boolean).join(' ');

  const entryIds = [];
  // Fee coverage (if any) is a property of the WHOLE gift, not any one fund — attributed to the
  // first split's ledger row only, so it is counted once, not once per fund.
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    const rowTxnId = splits.length === 1 ? externalTxnId : `${externalTxnId}-f${split.fundId}`;
    const er = await db.prepare(
      `INSERT INTO giving_entries
         (batch_id, person_id, fund_id, amount, method, notes, contribution_date,
          fee_cents, source, processor, external_txn_id, reconcile_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      batchId, person ? person.id : null, split.fundId, split.amountCents,
      g.method || 'card', g.note || '', contributionDate,
      i === 0 ? Math.max(0, Math.round(Number(g.feeCents) || 0)) : 0,
      'stax_mockup', 'stax', rowTxnId, 'recorded'
    ).run();
    const entryId = er.meta?.last_row_id;
    entryIds.push(entryId);

    if (!person) {
      await db.prepare(
        `INSERT INTO giving_stax_unmatched
           (giving_entry_id, payer_name, payer_first_name, payer_last_name, payer_email, payer_phone,
            payer_address_line1, payer_city, payer_state, payer_zip, card_brand, card_last4, stax_customer_id, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open')`
      ).bind(
        entryId, payerFullName, payerFirstName, payerLastName, g.payerEmail || '', g.payerPhone || '',
        g.payerAddressLine1 || '', g.payerCity || '', g.payerState || '', g.payerZip || '',
        g.cardBrand || '', g.cardLast4 || '', g.staxCustomerId || ''
      ).run();
    }
  }

  if (person && g.staxCustomerId) {
    await db.prepare(
      `INSERT INTO giving_stax_customers (person_id, stax_customer_id) VALUES (?,?)
       ON CONFLICT(person_id) DO UPDATE SET stax_customer_id=excluded.stax_customer_id`
    ).bind(person.id, g.staxCustomerId).run().catch(() => {
      // A different person already claimed this stax_customer_id (idx_stax_customers_stax_id) —
      // leave the existing link alone rather than fail the whole gift over a linkage conflict;
      // the gift itself is still recorded correctly above.
    });
  }

  return { entryId: entryIds[0], entryIds, matched: !!person, personId: person ? person.id : null, alreadyRecorded: false };
}

// ── Gift receipt email ──────────────────────────────────────────────────────
// Callers only invoke this from the two paths where a Stax charge is actually confirmed — the
// synchronous checkout success branch and the webhook's charge-success branch — never from demo
// mode's simulated-gift branch (mailing a real "thank you" for a fake transaction would be
// actively misleading) or from the recurring-signup endpoint (which only schedules a future
// charge and hasn't taken any money yet). Reuses the SAME Brevo transactional-email path the
// giving-letter/thank-you-receipt features already use in production
// (sendBrevoTransactionalEmail in api-emails.js) — not a new email vendor or template engine. A
// failure here never fails the gift itself: the ledger write already succeeded, and a missed
// receipt email is a much smaller problem than losing a recorded gift over it.
async function sendGiftReceiptEmail(db, env, g) {
  if (!g.payerEmail) return;
  if (!env.BREVO_API_KEY) return;

  const fundIds = g.splits.map(s => s.fundId);
  const placeholders = fundIds.map(() => '?').join(',');
  const fundRows = (await db.prepare(
    `SELECT id, name FROM funds WHERE id IN (${placeholders})`
  ).bind(...fundIds).all()).results || [];
  const fundName = id => (fundRows.find(f => f.id === id) || {}).name || 'General Fund';

  const totalCents = g.splits.reduce((sum, s) => sum + s.amountCents, 0);
  const money = c => '$' + (Math.round(c) / 100).toFixed(2);
  const dateStr = new Date((g.contributionDate || '') + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const fromNameRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_from_name'").first();
  const fromEmailRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_from_email'").first();
  const einRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_ein'").first();
  const fromName = fromNameRow?.value || 'Timothy Lutheran Church';
  const fromEmail = fromEmailRow?.value || '';
  if (!fromEmail) return; // sendBrevoTransactionalEmail would just reject this anyway — see its own guard.
  const ein = einRow?.value || '';
  // Same wording js-reports.js's giving-letter template already uses for this exact disclaimer —
  // not a new form of words for the same legal requirement.
  const einLine = ein
    ? `Our EIN/Tax ID is ${esc(ein)}. No goods or services were provided in exchange for this contribution. Please retain this receipt for your tax records.`
    : 'No goods or services were provided in exchange for this contribution. Please retain this receipt for your tax records.';

  const fundRowsHtml = g.splits.map(s =>
    `<tr><td style="padding:6px 0;color:#3D3530;">${esc(fundName(s.fundId))}</td><td style="padding:6px 0;text-align:right;color:#3D3530;">${money(s.amountCents)}</td></tr>`
  ).join('');
  const memoHtml = g.note
    ? `<p style="color:#3D3530;line-height:1.6;margin-top:16px;"><strong>Memo:</strong> ${esc(g.note)}</p>`
    : '';
  const donorName = [g.payerFirstName, g.payerLastName].filter(Boolean).join(' ');
  const bodyHtml = `
    <p style="font-size:1.15rem;color:#0A3C5C;font-weight:600;margin-bottom:16px;">Thank you for your gift${donorName ? ', ' + esc(donorName) : ''}!</p>
    <p style="color:#3D3530;line-height:1.6;">We received your gift to Timothy Lutheran Church on ${esc(dateStr)}.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">${fundRowsHtml}
      <tr><td style="padding:10px 0 0;border-top:1px solid #E8E0D0;font-weight:600;color:#0A3C5C;">Total</td><td style="padding:10px 0 0;border-top:1px solid #E8E0D0;text-align:right;font-weight:600;color:#0A3C5C;">${money(totalCents)}</td></tr>
    </table>
    ${memoHtml}
    <p style="color:#7A6E60;font-size:.85rem;line-height:1.6;margin-top:24px;">${einLine}</p>`;
  const html = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#FAF7F0;margin:0;padding:32px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;border:1px solid #E8E0D0;">
    ${bodyHtml}
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E8E0D0;font-size:.8rem;color:#7A6E60;text-align:center;">
      Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139
    </div>
  </div></body></html>`;

  try {
    await sendBrevoTransactionalEmail(env, {
      toEmail: g.payerEmail, toName: donorName || undefined,
      subject: 'Thank you for your gift to Timothy Lutheran Church',
      html, fromName, fromEmail,
    });
  } catch { /* a missed receipt email is never worth failing an already-recorded gift over */ }
}

// Reversal (refund/void): recorded as a negative entry against the same fund/person as the
// original charge, carrying its OWN external_txn_id (the refund/void event's id, not the
// original charge's) so it can never collide with — or be mistaken for a re-run of — the
// original gift under the same idempotency index.
//
// This is a deliberately simplified mockup of childcare-portal's stax_record_reversal, which
// does the equivalent bookkeeping as one atomic Postgres RPC against a richer ledger. A
// production build of this feature should give giving_entries reversals the same care (a single
// transaction, explicit handling of a partial refund, etc.) rather than this straight-line
// insert. A multi-fund original (see recordStaxGift's splits) is only handled for a FULL
// refund/void of every split — a partial refund against a multi-fund gift has no obvious single
// right answer (which fund absorbs it?) and is refused rather than guessed at.
async function recordStaxReversal(db, { kind, eventTxnId, parentTxnId, amountCents }) {
  const existing = await db.prepare(
    `SELECT id FROM giving_entries WHERE processor='stax' AND external_txn_id=?`
  ).bind(eventTxnId).first();
  if (existing) return { entryId: existing.id, alreadyRecorded: true };

  const originals = (await db.prepare(
    `SELECT id, person_id, fund_id, batch_id, amount FROM giving_entries
      WHERE processor='stax' AND (external_txn_id=? OR external_txn_id LIKE ?)`
  ).bind(parentTxnId, parentTxnId + '-f%').all()).results || [];
  if (!originals.length) return { error: 'Original gift not found for this ' + kind };

  const originalTotal = originals.reduce((sum, o) => sum + o.amount, 0);
  if (originals.length > 1 && Math.abs(originalTotal) !== Math.abs(amountCents)) {
    return { error: `Partial ${kind} of a multi-fund gift (#${originals.map(o => o.id).join(', #')}) needs manual handling — not supported in this mockup.` };
  }

  const entryIds = [];
  for (const original of originals) {
    const rowTxnId = originals.length === 1 ? eventTxnId : `${eventTxnId}-f${original.fund_id}`;
    const er = await db.prepare(
      `INSERT INTO giving_entries
         (batch_id, person_id, fund_id, amount, method, notes, contribution_date,
          source, processor, external_txn_id, reconcile_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      original.batch_id, original.person_id, original.fund_id, -Math.abs(original.amount),
      kind, `Stax ${kind} of gift #${original.id} (mockup)`, todayIso(),
      'stax_mockup', 'stax', rowTxnId, 'recorded'
    ).run();
    entryIds.push(er.meta?.last_row_id);
  }
  return { entryId: entryIds[0], entryIds, alreadyRecorded: false, reversalOf: originals.map(o => o.id) };
}

// ── Verified webhook (sandbox) ──────────────────────────────────────────────
export async function handleStaxGivingWebhook(req, env, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = env.STAX_GIVING_WEBHOOK_SECRET;
  const apiKey = env.STAX_SANDBOX_API_KEY;
  if (!secret || !apiKey) return json({ error: 'Stax giving mockup is not configured yet.' }, 503);

  const suppliedSecret = url.searchParams.get('secret') || '';
  if (!(await timingSafeEqual(suppliedSecret, secret))) return json({ error: 'Unauthorized' }, 401);

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 65536) return json({ error: 'Payload too large' }, 413);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad payload' }, 400); }
  const eventTransactionId = String(body?.id || '');
  if (!eventTransactionId || eventTransactionId.length > 200) return json({ error: 'Missing transaction id' }, 400);

  // The webhook body is only a notification — re-fetch the authoritative transaction with a
  // server-held credential before trusting any field, exactly like childcare-portal's
  // stax-webhook. Stax does not sign webhook payloads; the URL secret above is the delivery
  // check, this is the content check.
  let verifyRes, verifyBody = {};
  try {
    const r = await staxRequest(apiKey, `/transaction/${encodeURIComponent(eventTransactionId)}`, { method: 'GET' });
    verifyRes = r; verifyBody = r.data;
  } catch { return json({ error: 'Could not verify transaction' }, 502); }
  if (!verifyRes.ok) return json({ error: 'Could not verify transaction' }, 502);

  const transaction = verifyBody?.data && typeof verifyBody.data === 'object' ? verifyBody.data : verifyBody;
  if (String(transaction?.id || '') !== eventTransactionId) return json({ error: 'Verified transaction id mismatch' }, 409);

  const kind = String(transaction?.type || '').toLowerCase();
  const status = String(transaction?.status || '').toUpperCase();
  const verifiedSuccess = transaction?.success === true && (!status || status === 'SUCCESS');
  const amountCents = cents(transaction?.total);
  const db = env.DB;

  if (kind === 'charge') {
    if (!verifiedSuccess || amountCents === null) return json({ received: true, ignored: 'charge not successful' }, 200);
    const meta = transaction?.meta || {};
    // meta.splits is a JSON-stringified [{f: fundId, a: amountCents}, ...] set at charge-creation
    // time (see handleStaxGivingMockupPublicApi's checkout route) — Stax meta values are flat
    // strings, so a multi-fund gift's fund/amount breakdown has to travel through as one encoded
    // field rather than nested meta keys.
    let splits;
    try {
      const parsed = meta.splits ? JSON.parse(meta.splits) : null;
      splits = Array.isArray(parsed) && parsed.length ? parsed.map(s => ({ fundId: s.f, amountCents: s.a })) : null;
    } catch { splits = null; }
    if (!splits) splits = [{ fundId: meta.fund_id, amountCents }];
    const result = await recordStaxGift(db, {
      externalTxnId: eventTransactionId,
      splits,
      feeCents: cents(transaction?.total_fees) || 0,
      method: transaction?.payment_method?.method_type === 'ach' ? 'ach' : 'card',
      payerFirstName: meta.payer_first_name || '', payerLastName: meta.payer_last_name || '',
      payerEmail: meta.payer_email || '', payerPhone: meta.payer_phone || '',
      payerAddressLine1: meta.payer_address_line1 || '', payerCity: meta.payer_city || '',
      payerState: meta.payer_state || '', payerZip: meta.payer_zip || '',
      note: meta.memo || '',
      cardBrand: transaction?.payment_method?.card_type || '', cardLast4: transaction?.payment_method?.card_last_four || '',
      staxCustomerId: String(transaction?.customer_id || ''),
    });
    if (result.error) return json({ error: result.error }, 422);
    if (!result.alreadyRecorded) {
      await sendGiftReceiptEmail(db, env, {
        splits, payerFirstName: meta.payer_first_name || '', payerLastName: meta.payer_last_name || '',
        payerEmail: meta.payer_email || '', note: meta.memo || '', contributionDate: todayIso(),
      });
    }
    return json({ received: true, ...result }, 200);
  }

  if (kind !== 'refund' && kind !== 'void') return json({ received: true, ignored: kind || 'unsupported transaction type' }, 200);
  if (!verifiedSuccess) return json({ received: true, ignored: `${kind} not successful` }, 200);
  const parentTransactionId = String(transaction?.reference_id || '');
  if (!parentTransactionId || amountCents === null) return json({ error: 'Verified reversal is incomplete' }, 409);
  const result = await recordStaxReversal(db, { kind, eventTxnId: eventTransactionId, parentTxnId: parentTransactionId, amountCents });
  if (result.error) return json({ error: result.error }, 409);
  return json({ received: true, ...result }, 200);
}

// The public form is served from the Website repo's own domain (give.timothystl.org — see
// site-worker.js's /stax-mockup route), not from this Worker's host, so the browser calls these
// routes cross-origin. Allowlisted rather than '*': this API can move money (checkout) and write
// donor-identifying data (recurring, checkout payer fields), so it should only answer origins
// this church actually controls, not any page on the internet.
const CORS_ALLOWED_ORIGINS = new Set([
  'https://give.timothystl.org',
  'https://timothystl.org',
]);
function corsHeadersFor(req) {
  const origin = req.headers.get('Origin') || '';
  if (!CORS_ALLOWED_ORIGINS.has(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
}

// ⚠ ESTIMATE ONLY. Andrew's own flat-rate approximation of what Stax actually charges (real
// interchange + $0.12 per transaction, which he estimates nets out to roughly 2% of the gift) —
// used only to show a "cover the fees" amount on the form before any real charge exists.
// Deliberately a single flat percentage, not interchange-plus-fixed-cents: interchange itself
// varies by card network/type and can't be known before a real charge, so a second guessed
// constant on top of it would be false precision, not more accuracy. Re-derive per payment
// method if ACH is ever added here (it's typically much cheaper than card). The AUTHORITATIVE
// fee, once a card is actually charged, is whatever Stax's own `total_fees` on the transaction
// says — recordStaxGift always stores that, never this estimate.
const ESTIMATED_FEE_RATE = 0.02;
function estimateFeeCents(subtotalCents) {
  return Math.round(subtotalCents * ESTIMATED_FEE_RATE);
}

// Validates a `gifts: [{fund_id, amount}, ...]` submission (the "multiple gifts" rows) against
// funds that are both active AND opted into public_giving (see migration 0054) — a donor must
// never be able to give to a fund staff hasn't curated for the public form, even by guessing an
// id. Returns { error } or { splits, subtotalCents }.
async function loadOpenGifts(db, giftsRaw) {
  const gifts = Array.isArray(giftsRaw) ? giftsRaw : [];
  if (!gifts.length) return { error: 'At least one gift is required.' };
  if (gifts.length > 10) return { error: 'Too many gift lines.' };
  const splits = [];
  for (const g of gifts) {
    const fundId = parseInt(g.fund_id);
    const amountCents = cents(g.amount);
    if (!Number.isInteger(fundId) || amountCents === null) return { error: 'Each gift needs a fund and a valid amount.' };
    splits.push({ fundId, amountCents });
  }
  if (new Set(splits.map(s => s.fundId)).size !== splits.length) return { error: 'The same fund cannot appear twice in one gift.' };
  const ids = splits.map(s => s.fundId);
  const placeholders = ids.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT id FROM funds WHERE active=1 AND public_giving=1 AND id IN (${placeholders})`
  ).bind(...ids).all()).results || [];
  const openIds = new Set(rows.map(r => r.id));
  if (splits.some(s => !openIds.has(s.fundId))) return { error: 'One of those funds is not open for giving.' };
  return { splits, subtotalCents: splits.reduce((sum, s) => sum + s.amountCents, 0) };
}

function contactFieldsFrom(b) {
  return {
    payerFirstName: String(b.payer_first_name || '').trim().slice(0, 100),
    payerLastName: String(b.payer_last_name || '').trim().slice(0, 100),
    payerEmail: String(b.payer_email || '').trim().slice(0, 200),
    payerPhone: String(b.payer_phone || '').trim().slice(0, 40),
    payerAddressLine1: String(b.payer_address_line1 || '').trim().slice(0, 200),
    payerCity: String(b.payer_city || '').trim().slice(0, 100),
    payerState: String(b.payer_state || '').trim().slice(0, 60),
    payerZip: String(b.payer_zip || '').trim().slice(0, 20),
  };
}
function requireContact(contact) {
  // First/last/email only — phone and address are collected (they help matching and, for
  // address, nothing else yet) but NOT required. Every extra required field measurably loses
  // donors (see docs/STAX_GIVING_MOCKUP.md's completion-rate research); this is the line Andrew
  // drew between "needed to identify who gave" and "nice to have."
  return contact.payerFirstName && contact.payerLastName && contact.payerEmail;
}

// ── Public API: funds list, checkout, recurring signup ──────────────────────
export async function handleStaxGivingMockupPublicApi(req, env, url, method, path) {
  const db = env.DB;
  const cors = corsHeadersFor(req);
  const j = (data, status = 200) => json(data, status, cors);

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
    });
  }

  if (path === 'funds' && method === 'GET') {
    const rows = (await db.prepare(
      "SELECT id, name FROM funds WHERE active=1 AND public_giving=1 ORDER BY sort_order, name"
    ).all()).results || [];
    return j({ funds: rows, configured: staxMockupConfigured(env), estimatedFeeRate: ESTIMATED_FEE_RATE });
  }

  // The web payments token is a merchant-level, publishable-style token (not a secret) that
  // Stax.js needs client-side to mount its hosted card fields — same role as childcare-portal's
  // STAX_WEB_PAYMENTS_TOKEN. It cannot move money by itself; STAX_SANDBOX_API_KEY (server-only)
  // is what authorizes the actual /customer and /charge calls above.
  if (path === 'webpayments-token' && method === 'GET') {
    if (!staxMockupConfigured(env)) return j({ token: null });
    return j({ token: env.STAX_SANDBOX_WEB_PAYMENTS_TOKEN });
  }

  // Called by the browser BEFORE Stax.js tokenize() — hands back a Stax customer_id (reused for
  // a returning donor, or freshly created) so tokenize() can pass customer_id + match_customer
  // and skip Stax's own address/AVS requirement (see getOrCreateStaxCustomerId's own comment).
  // The same customerId then rides through to /checkout or /recurring's stax_customer_id so only
  // ONE Stax customer is created per gift, not two.
  if (path === 'stax-customer' && method === 'POST') {
    if (!staxMockupConfigured(env)) return j({ customerId: null });
    let b; try { b = await req.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
    const contact = contactFieldsFrom(b);
    if (!requireContact(contact)) return j({ error: 'First name, last name, and email are required.' }, 400);
    const result = await getOrCreateStaxCustomerId(db, env.STAX_SANDBOX_API_KEY, contact);
    if (result.error) return j({ error: result.error }, 502);
    return j({ customerId: result.customerId });
  }

  if (path === 'checkout' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
    const giftResult = await loadOpenGifts(db, b.gifts);
    if (giftResult.error) return j({ error: giftResult.error }, 400);
    const contact = contactFieldsFrom(b);
    if (!requireContact(contact)) return j({ error: 'First name, last name, and email are required.' }, 400);
    const memo = String(b.memo || '').trim().slice(0, 500);
    const feeCents = b.cover_fees ? estimateFeeCents(giftResult.subtotalCents) : 0;
    const totalCents = giftResult.subtotalCents + feeCents;
    // Fee coverage (if any) rides on the first split — see recordStaxGift's own note on why.
    const splits = giftResult.splits.map((s, i) => i === 0 ? { ...s, amountCents: s.amountCents + feeCents } : s);

    if (!staxMockupConfigured(env)) {
      // DEMO MODE — no Stax sandbox credentials wired into this environment yet. Records the
      // gift through the exact same recordStaxGift() path a verified webhook would use, so the
      // rest of the mockup (matching, review queue, statements) is fully clickable without live
      // sandbox keys. A synthetic transaction id keeps it distinguishable in the ledger.
      const result = await recordStaxGift(db, {
        externalTxnId: `demo-${crypto.randomUUID()}`,
        splits, method: 'card', note: memo, ...contact,
      });
      if (result.error) return j({ error: result.error }, 422);
      return j({ ok: true, demo: true, totalCents, ...result });
    }

    const paymentMethodId = String(b.payment_method_id || '');
    if (!paymentMethodId) return j({ error: 'payment_method_id required (from Stax.js tokenize)' }, 400);
    const apiKey = env.STAX_SANDBOX_API_KEY;
    // The browser normally already has a customer_id from /stax-customer (called before
    // tokenize() so Stax.js gets its AVS exemption) and sends it back here — reusing it instead
    // of creating a second Stax customer for the same gift. A missing one (an older client, or a
    // demo/test caller that skipped that step) still works: fall back to creating one inline.
    let staxCustomerId = String(b.stax_customer_id || '').trim();
    if (!staxCustomerId) {
      const result = await getOrCreateStaxCustomerId(db, apiKey, contact);
      if (result.error) return j({ error: result.error }, 502);
      staxCustomerId = result.customerId;
    }

    const idempotencyId = crypto.randomUUID();
    const charge = await staxRequest(apiKey, '/charge', {
      method: 'POST',
      body: JSON.stringify({
        payment_method_id: paymentMethodId,
        customer_id: staxCustomerId,
        total: amountStr(totalCents),
        pre_auth: false,
        idempotency_id: idempotencyId,
        meta: {
          memo: memo || 'Timothy Lutheran Church — Giving (mockup)',
          splits: JSON.stringify(splits.map(s => ({ f: s.fundId, a: s.amountCents }))),
          payer_first_name: contact.payerFirstName, payer_last_name: contact.payerLastName,
          payer_email: contact.payerEmail, payer_phone: contact.payerPhone,
          payer_address_line1: contact.payerAddressLine1, payer_city: contact.payerCity,
          payer_state: contact.payerState, payer_zip: contact.payerZip,
        },
      }),
    });
    const chargeSuccess = charge.data?.success === true;
    if (!charge.ok || !chargeSuccess || !charge.data?.id) {
      return j({ error: chargeFailureMessage(charge.data), pending: chargeOutcomeUnknown(charge.data) }, 402);
    }
    // Record synchronously when Stax answers directly — recordStaxGift is idempotent on
    // external_txn_id, so if the webhook ALSO fires for this same transaction id later
    // (Stax's normal behavior), that second call is a confirmed no-op, not a double gift.
    const result = await recordStaxGift(db, {
      externalTxnId: String(charge.data.id),
      splits,
      feeCents: cents(charge.data?.total_fees) || 0,
      method: charge.data?.payment_method?.method_type === 'ach' ? 'ach' : 'card',
      note: memo, ...contact,
      cardBrand: charge.data?.payment_method?.card_type || '',
      cardLast4: charge.data?.payment_method?.card_last_four || '',
      staxCustomerId,
    });
    if (result.error) return j({ error: result.error }, 422);
    if (!result.alreadyRecorded) {
      await sendGiftReceiptEmail(db, env, {
        splits, payerFirstName: contact.payerFirstName, payerLastName: contact.payerLastName,
        payerEmail: contact.payerEmail, note: memo, contributionDate: todayIso(),
      });
    }
    return j({ ok: true, demo: false, totalCents, ...result });
  }

  if (path === 'recurring' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
    const giftResult = await loadOpenGifts(db, b.gifts);
    if (giftResult.error) return j({ error: giftResult.error }, 400);
    const contact = contactFieldsFrom(b);
    if (!requireContact(contact)) return j({ error: 'First name, last name, and email are required.' }, 400);
    // "1st & 15th" (Tithe.ly's own term for it) maps to 'twice_monthly'. All four, plus
    // 'monthly', are Andrew's requested frequency set — 'biweekly'/'twice_monthly' are new;
    // 'weekly'/'monthly' already existed.
    const VALID_INTERVALS = ['weekly', 'biweekly', 'twice_monthly', 'monthly'];
    const interval = VALID_INTERVALS.includes(b.interval) ? b.interval : 'monthly';
    const memo = String(b.memo || '').trim().slice(0, 500);
    const feeCents = b.cover_fees ? estimateFeeCents(giftResult.subtotalCents) : 0;
    const totalCents = giftResult.subtotalCents + feeCents;
    // Fee coverage (if any) rides on the first split — matches /checkout's own convention.
    const splits = giftResult.splits.map((s, i) => i === 0 ? { ...s, amountCents: s.amountCents + feeCents } : s);
    // Only set when a submission actually has more than one fund, so every pre-existing
    // single-fund schedule (and every one this mockup already wrote) keeps reading as ''.
    const scheduleGroup = splits.length > 1 ? crypto.randomUUID() : '';
    const payerName = `${contact.payerFirstName} ${contact.payerLastName}`.trim();

    if (!staxMockupConfigured(env)) {
      // DEMO MODE — no live Stax credentials. Records the schedule locally (status
      // pending_manual_setup, the same status a real Stax scheduling failure would leave) without
      // attempting any Stax call, and does not record a first gift — demo mode's /checkout branch
      // doesn't charge real money either, and simulating one here would need its own synthetic
      // transaction id machinery /checkout's demo branch already owns, not duplicated here.
      const ids = [];
      for (const split of splits) {
        const r = await db.prepare(
          `INSERT INTO giving_stax_recurring_schedules
             (person_id, fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email, schedule_group, stax_error)
           VALUES (NULL,?,?,?,?,?,?,?,?,?,?)`
        ).bind(split.fundId, split.amountCents, interval, '', '', 'pending_manual_setup', payerName, contact.payerEmail, scheduleGroup, 'Demo mode — STAX_SANDBOX_API_KEY/STAX_SANDBOX_WEB_PAYMENTS_TOKEN not configured, no Stax call attempted').run();
        ids.push(r.meta?.last_row_id);
      }
      return j({ ok: true, demo: true, ids, id: ids[0] });
    }

    const paymentMethodId = String(b.payment_method_id || '');
    if (!paymentMethodId) return j({ error: 'payment_method_id required (from Stax.js tokenize)' }, 400);
    const apiKey = env.STAX_SANDBOX_API_KEY;
    // Same reuse-over-recreate pattern as /checkout: the browser already has a customer_id from
    // /stax-customer (called before tokenize()), so reuse it here rather than minting a second
    // Stax customer for the same donor. Falls back to creating one inline if it's missing.
    let staxCustomerId = String(b.stax_customer_id || '').trim();
    if (!staxCustomerId) {
      const result = await getOrCreateStaxCustomerId(db, apiKey, contact);
      if (result.error) return j({ error: result.error }, 502);
      staxCustomerId = result.customerId;
    }

    // The first gift of a recurring series is charged immediately, exactly like a one-time
    // /checkout gift — Andrew's own ask: "if someone sets up a recurring gift there should be a
    // gift made." Before this, the endpoint only ever created a *schedule* record and asked Stax
    // to bill the FUTURE occurrences — a donor could see "Thank you" with no money moved, no
    // ledger entry, and no receipt if that scheduling call silently failed (which it's allowed
    // to; see the pending_manual_setup fallback below). Charging the first occurrence the same
    // way /checkout does means a recurring signup is never worse than a one-time gift: there's
    // always a real charge, ledger entry, and receipt for what the donor just did, independent
    // of whether Stax's own recurring-schedule API call (further down) succeeds.
    const idempotencyId = crypto.randomUUID();
    const charge = await staxRequest(apiKey, '/charge', {
      method: 'POST',
      body: JSON.stringify({
        payment_method_id: paymentMethodId,
        customer_id: staxCustomerId,
        total: amountStr(totalCents),
        pre_auth: false,
        idempotency_id: idempotencyId,
        meta: {
          memo: memo || 'Timothy Lutheran Church — Giving (mockup, recurring)',
          splits: JSON.stringify(splits.map(s => ({ f: s.fundId, a: s.amountCents }))),
          payer_first_name: contact.payerFirstName, payer_last_name: contact.payerLastName,
          payer_email: contact.payerEmail, payer_phone: contact.payerPhone,
          payer_address_line1: contact.payerAddressLine1, payer_city: contact.payerCity,
          payer_state: contact.payerState, payer_zip: contact.payerZip,
        },
      }),
    });
    const chargeSuccess = charge.data?.success === true;
    if (!charge.ok || !chargeSuccess || !charge.data?.id) {
      return j({ error: chargeFailureMessage(charge.data), pending: chargeOutcomeUnknown(charge.data) }, 402);
    }
    const chargeResult = await recordStaxGift(db, {
      externalTxnId: String(charge.data.id),
      splits,
      feeCents: cents(charge.data?.total_fees) || 0,
      method: charge.data?.payment_method?.method_type === 'ach' ? 'ach' : 'card',
      note: memo, ...contact,
      cardBrand: charge.data?.payment_method?.card_type || '',
      cardLast4: charge.data?.payment_method?.card_last_four || '',
      staxCustomerId,
    });
    if (chargeResult.error) return j({ error: chargeResult.error }, 422);
    if (!chargeResult.alreadyRecorded) {
      await sendGiftReceiptEmail(db, env, {
        splits, payerFirstName: contact.payerFirstName, payerLastName: contact.payerLastName,
        payerEmail: contact.payerEmail, note: memo, contributionDate: todayIso(),
      });
    }

    // With the first gift charged and recorded, set up the STANDING schedule for future
    // occurrences. Links each schedule row to the person the charge above just matched (was
    // always NULL before — that match happens earlier in this flow now, so there's no reason
    // not to carry it over).
    //
    // Endpoint confirmed against docs.staxpayments.com/reference/create-a-scheduled-invoice:
    // POST /invoice/schedule/ (the earlier guess, POST /scheduled-invoices, was live-tested and
    // came back "HTTP 404: route_not_found" — that ruled it out, not a guess). `url` is a fixed
    // literal the docs say to pass verbatim (it's Stax's own hosted-invoice base URL, not
    // anything specific to this donor); `rule` is an iCalendar RRULE starting on the NEXT
    // occurrence after today, since today's gift was already charged directly above and the
    // schedule must not also bill it. Still genuinely unexercised against a live call — the
    // request shape is sourced from Stax's documented schema, not a working prior request/
    // response the way /customer and /charge were — so the pending_manual_setup fallback and
    // captured stax_error stay in place either way.
    const scheduleRule = buildScheduleRule(interval, todayIso());
    const ids = [];
    for (const split of splits) {
      let staxScheduleId = '', status = 'pending_manual_setup', staxError = '';
      try {
        const sched = await staxRequest(apiKey, '/invoice/schedule/', {
          method: 'POST',
          body: JSON.stringify({
            url: 'https://app.staxpayments.com/#/bill/',
            total: amountStr(split.amountCents),
            rule: scheduleRule,
            customer_id: staxCustomerId,
            payment_method_id: paymentMethodId,
          }),
        });
        if (sched.ok && sched.data?.id) {
          staxScheduleId = String(sched.data.id);
          status = 'active';
        } else {
          staxError = `HTTP ${sched.status}: ${String(sched.data?.message || sched.data?.error || JSON.stringify(sched.data) || 'no response body').slice(0, 500)}`;
        }
      } catch (e) {
        staxError = `Request failed: ${String(e?.message || e).slice(0, 500)}`;
      }
      const r = await db.prepare(
        `INSERT INTO giving_stax_recurring_schedules
           (person_id, fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email, schedule_group, stax_error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(chargeResult.personId || null, split.fundId, split.amountCents, interval, staxCustomerId, staxScheduleId, status, payerName, contact.payerEmail, scheduleGroup, staxError).run();
      ids.push(r.meta?.last_row_id);
    }
    return j({ ok: true, demo: false, totalCents, giftEntryIds: chargeResult.entryIds, ids, id: ids[0] });
  }

  return j({ error: 'Not found' }, 404);
}

// ── Staff review queue (MOCKUP) ─────────────────────────────────────────────
// Data comes from the authenticated /admin/api/giving/stax-mockup/* endpoints added to
// src/api-giving.js (same isFinance gate the rest of Giving already uses) — this function only
// renders the page shell.
export function renderStaxGivingMockupReviewHtml() {
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Stax Giving Review (mockup) — Connect</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);padding:1.5rem;color:var(--navy);}
  .mockup-banner{max-width:920px;margin:0 auto 1rem;background:#3D2B00;color:#F5D98A;border-radius:10px;
    padding:.7rem 1rem;font-size:.82rem;text-align:center;font-weight:600;}
  h1{max-width:920px;margin:0 auto .25rem;font-size:1.3rem;}
  .sub{max-width:920px;margin:0 auto 1.25rem;color:var(--muted);font-size:.85rem;}
  .wrap{max-width:920px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(30,45,74,.08);overflow:hidden;}
  table{width:100%;border-collapse:collapse;font-size:.88rem;}
  th{text-align:left;padding:.7rem .9rem;background:#F5F0E4;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;}
  td{padding:.7rem .9rem;border-top:1px solid #F0EADA;vertical-align:top;}
  .empty{padding:2rem;text-align:center;color:var(--muted);}
  .amt{font-weight:700;}
  select,button{font-family:inherit;font-size:.85rem;padding:.4rem .6rem;border-radius:6px;border:1.5px solid rgba(30,45,74,.2);}
  button{background:var(--navy);color:#fff;border:none;cursor:pointer;margin-left:.4rem;}
  button:hover{background:var(--teal);}
  button.ghost{background:#fff;color:var(--navy);border:1.5px solid rgba(30,45,74,.2);}
  .row-actions{display:flex;align-items:center;gap:.3rem;}
  .status-msg{font-size:.75rem;color:var(--muted);margin-top:.3rem;}
</style></head><body>
  <div class="mockup-banner">MOCKUP — Stax sandbox only. These gifts never touch the Tithe.ly sync.</div>
  <h1>Unmatched Stax gifts</h1>
  <div class="sub">A Stax webhook gift that couldn't be matched to an existing person by email or phone lands here. Link it to a person, or leave it unmatched.
    &middot; <a href="/admin/giving/stax-mockup/funds" style="color:var(--teal);">Manage which funds are on the public form &rarr;</a>
    &middot; <a href="/admin/giving/stax-mockup/recurring" style="color:var(--teal);">Recurring gifts &rarr;</a></div>
  <div class="wrap"><table>
    <thead><tr><th>Date</th><th>Fund</th><th>Amount</th><th>Payer</th><th>Card</th><th>Action</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
  </table></div>
<script>
(function(){
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(cents){ return '$' + (Math.round(cents || 0) / 100).toFixed(2); }
  // Lower is better — an exact "first last" match beats a name that only starts with what was
  // typed, which beats one that merely contains it somewhere (an email/phone/envelope hit, or a
  // mid-name match). Used only to re-order this page's own datalist; never touches the shared
  // /admin/api/people endpoint or any other screen using it.
  function matchScore(p, needle){
    var full = ((p.first_name || '') + ' ' + (p.last_name || '')).trim().toLowerCase();
    var first = (p.first_name || '').toLowerCase();
    var last = (p.last_name || '').toLowerCase();
    if (full === needle) return 0;
    if (first.indexOf(needle) === 0 || last.indexOf(needle) === 0 || full.indexOf(needle) === 0) return 1;
    return 2;
  }

  function render(rows){
    var tbody = document.getElementById('rows');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No unmatched Stax gifts right now.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(r){
      return '<tr data-id="' + r.queue_id + '">' +
        '<td>' + esc(r.contribution_date) + '</td>' +
        '<td>' + esc(r.fund_name) + '</td>' +
        '<td class="amt">' + money(r.amount) + '</td>' +
        '<td>' + esc((r.payer_first_name || r.payer_last_name) ? (r.payer_first_name + ' ' + r.payer_last_name).trim() : r.payer_name) +
          '<br><span class="status-msg">' + esc(r.payer_email) + (r.payer_phone ? ' &middot; ' + esc(r.payer_phone) : '') +
          (r.payer_address_line1 ? '<br>' + esc([r.payer_address_line1, r.payer_city, r.payer_state, r.payer_zip].filter(Boolean).join(', ')) : '') +
          '</span></td>' +
        '<td>' + esc(r.card_brand) + (r.card_last4 ? ' &middot;&middot;&middot;&middot;' + esc(r.card_last4) : '') + '</td>' +
        '<td><div class="row-actions">' +
          '<input type="text" class="person-search" placeholder="Type a name…" list="people-' + r.queue_id + '">' +
          '<datalist id="people-' + r.queue_id + '"></datalist>' +
          '<button class="link-btn">Link</button><button class="ghost ignore-btn">Ignore</button></div>' +
          '<div class="status-msg row-status"></div></td>' +
      '</tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function(tr){
      var input = tr.querySelector('.person-search');
      var datalist = tr.querySelector('datalist');
      var debounceTimer = null;
      input.addEventListener('input', function(){
        clearTimeout(debounceTimer);
        var q = input.value.trim();
        if (q.length < 2) { datalist.innerHTML = ''; return; }
        debounceTimer = setTimeout(function(){
          fetch('/admin/api/people?limit=8&q=' + encodeURIComponent(q)).then(function(r){ return r.json(); }).then(function(d){
            // The shared /admin/api/people endpoint sorts alphabetically by last name (it's
            // reused by several other screens that want that, not relevance) — re-rank here,
            // just for this datalist, so the closest match to what was typed shows first
            // instead of wherever it happens to fall alphabetically among the other 7 results.
            var needle = q.toLowerCase();
            var people = (d.people || []).slice().sort(function(a, b){ return matchScore(a, needle) - matchScore(b, needle); });
            datalist.innerHTML = people.map(function(p){
              return '<option data-id="' + p.id + '" value="' + esc((p.first_name || '') + ' ' + (p.last_name || '')) + '">';
            }).join('');
            input.dataset.matches = JSON.stringify(people.map(function(p){ return { id: p.id, name: (p.first_name || '') + ' ' + (p.last_name || '') }; }));
          }).catch(function(){});
        }, 250);
      });
      tr.querySelector('.link-btn').addEventListener('click', function(){ act(tr, 'link'); });
      tr.querySelector('.ignore-btn').addEventListener('click', function(){ act(tr, 'ignore'); });
    });
  }

  function pickedPersonId(tr){
    var input = tr.querySelector('.person-search');
    var matches = [];
    try { matches = JSON.parse(input.dataset.matches || '[]'); } catch (e) {}
    var typed = input.value.trim();
    var hit = matches.filter(function(m){ return m.name.trim() === typed; })[0];
    return hit ? hit.id : '';
  }

  function act(tr, kind){
    var id = tr.dataset.id;
    var statusEl = tr.querySelector('.row-status');
    var body = {};
    if (kind === 'link') {
      var personId = pickedPersonId(tr);
      if (!personId) { statusEl.textContent = 'Choose a person from the suggestions first.'; return; }
      body.person_id = personId;
    }
    statusEl.textContent = 'Saving…';
    fetch('/admin/api/giving/stax-mockup/queue/' + id + '/' + kind, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        if (!res.ok) { statusEl.textContent = res.d.error || 'Failed.'; return; }
        tr.parentNode.removeChild(tr);
        if (!document.querySelectorAll('#rows tr').length) render([]);
      }).catch(function(){ statusEl.textContent = 'Network error.'; });
  }

  fetch('/admin/api/giving/stax-mockup/queue').then(function(r){ return r.json(); }).then(function(d){ render(d.queue || []); })
    .catch(function(){ document.getElementById('rows').innerHTML = '<tr><td colspan="6" class="empty">Could not load the queue.</td></tr>'; });
})();
</script>
</body></html>`);
}

// ── Staff screen: which funds appear on the public form (MOCKUP) ───────────
// Separate page from Manage Funds on purpose — this repo's production `funds` table carries
// every budget line (per Andrew, the public list "loaded every single budget line" before this
// existed), so this is a short curated on/off list, not a general fund editor.
export function renderStaxGivingMockupFundsAdminHtml() {
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Public Giving Funds (mockup) — Connect</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);padding:1.5rem;color:var(--navy);}
  .mockup-banner{max-width:640px;margin:0 auto 1rem;background:#3D2B00;color:#F5D98A;border-radius:10px;
    padding:.7rem 1rem;font-size:.82rem;text-align:center;font-weight:600;}
  h1{max-width:640px;margin:0 auto .25rem;font-size:1.3rem;}
  .sub{max-width:640px;margin:0 auto 1.25rem;color:var(--muted);font-size:.85rem;}
  .wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(30,45,74,.08);overflow:hidden;}
  .row{display:flex;align-items:center;justify-content:space-between;padding:.8rem 1rem;border-top:1px solid #F0EADA;font-size:.92rem;}
  .row:first-child{border-top:none;}
  .empty{padding:2rem;text-align:center;color:var(--muted);}
  label{display:flex;align-items:center;gap:.5rem;cursor:pointer;}
  input[type=checkbox]{width:18px;height:18px;}
  .actions{max-width:640px;margin:1rem auto 0;text-align:right;}
  button{font-family:inherit;font-size:.9rem;padding:.6rem 1.2rem;border-radius:8px;border:none;background:var(--navy);color:#fff;cursor:pointer;}
  button:hover{background:var(--teal);}
  #saveStatus{font-size:.8rem;color:var(--muted);margin-right:.8rem;}
</style></head><body>
  <div class="mockup-banner">MOCKUP — controls what the give.timothystl.org/stax-mockup form offers, not the real Tithe.ly page.</div>
  <h1>Public giving funds</h1>
  <div class="sub">Only checked funds show on the public Stax mockup form. Everything else in Manage Funds stays hidden from donors, even though it's still active for internal use.</div>
  <div class="wrap" id="rows"><div class="empty">Loading&hellip;</div></div>
  <div class="actions"><span id="saveStatus"></span><button id="saveBtn">Save</button></div>
<script>
(function(){
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  fetch('/admin/api/giving/stax-mockup/funds').then(function(r){ return r.json(); }).then(function(d){
    var wrap = document.getElementById('rows');
    var funds = d.funds || [];
    if (!funds.length) { wrap.innerHTML = '<div class="empty">No funds found.</div>'; return; }
    wrap.innerHTML = funds.map(function(f){
      return '<div class="row"><label><input type="checkbox" data-id="' + f.id + '"' + (f.public_giving ? ' checked' : '') + '> ' + esc(f.name) + '</label></div>';
    }).join('');
  }).catch(function(){ document.getElementById('rows').innerHTML = '<div class="empty">Could not load funds.</div>'; });

  document.getElementById('saveBtn').addEventListener('click', function(){
    var checks = document.querySelectorAll('#rows input[type=checkbox]');
    var funds = Array.prototype.map.call(checks, function(c){ return { id: c.dataset.id, public_giving: c.checked }; });
    var status = document.getElementById('saveStatus');
    status.textContent = 'Saving\\u2026';
    fetch('/admin/api/giving/stax-mockup/funds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ funds: funds })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){ status.textContent = res.ok ? 'Saved.' : (res.d.error || 'Failed.'); })
      .catch(function(){ status.textContent = 'Network error.'; });
  });
})();
</script>
</body></html>`);
}

// ── Staff screen: recurring Stax gift schedules — see and cancel (MOCKUP) ──
// Andrew asked directly: where do we see a donor's recurring signup, and how do we cancel one.
// Every occurrence past the first (which /checkout-equivalent-charges immediately at signup —
// see the recurring handler's own comment) depends on the stax_schedule_id Stax's own
// /invoice/schedule/ call returned, so a 'pending_manual_setup' row here means staff need to
// either retry it or set the standing charge up by hand in the Stax dashboard — this screen is
// what makes that visible instead of silent.
export function renderStaxGivingMockupRecurringAdminHtml() {
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Recurring Stax Gifts (mockup) — Connect</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;--warn:#A33B26;--ok:#3A6B2E;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);padding:1.5rem;color:var(--navy);}
  .mockup-banner{max-width:960px;margin:0 auto 1rem;background:#3D2B00;color:#F5D98A;border-radius:10px;
    padding:.7rem 1rem;font-size:.82rem;text-align:center;font-weight:600;}
  h1{max-width:960px;margin:0 auto .25rem;font-size:1.3rem;}
  .sub{max-width:960px;margin:0 auto 1.25rem;color:var(--muted);font-size:.85rem;}
  .wrap{max-width:960px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(30,45,74,.08);overflow:hidden;}
  table{width:100%;border-collapse:collapse;font-size:.88rem;}
  th{text-align:left;padding:.7rem .9rem;background:#F5F0E4;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;}
  td{padding:.7rem .9rem;border-top:1px solid #F0EADA;vertical-align:top;}
  .empty{padding:2rem;text-align:center;color:var(--muted);}
  .amt{font-weight:700;}
  .badge{display:inline-block;font-size:.72rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;}
  .badge.active{background:#E9F3E4;color:var(--ok);}
  .badge.pending{background:#FBEAE7;color:var(--warn);}
  .badge.cancelled{background:#F0EADA;color:var(--muted);}
  button{font-family:inherit;font-size:.85rem;padding:.4rem .7rem;border-radius:6px;border:1.5px solid rgba(30,45,74,.2);
    background:#fff;color:var(--navy);cursor:pointer;}
  button:hover{background:var(--cream);}
  button:disabled{opacity:.5;cursor:default;}
  .status-msg{font-size:.75rem;color:var(--muted);margin-top:.3rem;}
</style></head><body>
  <div class="mockup-banner">MOCKUP — Stax sandbox only. These schedules never touch the Tithe.ly sync.</div>
  <h1>Recurring Stax gifts</h1>
  <div class="sub">The first gift of every recurring signup is charged immediately and appears in the normal Giving ledger like any other gift — this screen is only for the STANDING schedule of future occurrences.
    &middot; <a href="/admin/giving/stax-mockup" style="color:var(--teal);">Unmatched Stax gifts &rarr;</a></div>
  <div class="wrap"><table>
    <thead><tr><th>Started</th><th>Donor</th><th>Fund</th><th>Amount</th><th>Interval</th><th>Status</th><th>Action</th></tr></thead>
    <tbody id="rows"><tr><td colspan="7" class="empty">Loading…</td></tr></tbody>
  </table></div>
<script>
(function(){
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(cents){ return '$' + (Math.round(cents || 0) / 100).toFixed(2); }
  var INTERVAL_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', twice_monthly: '1st & 15th', monthly: 'Monthly' };
  var STATUS_LABELS = { active: ['active', 'Active'], pending_manual_setup: ['pending', 'Needs setup'], cancelled: ['cancelled', 'Cancelled'] };

  function render(rows){
    var tbody = document.getElementById('rows');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No recurring Stax gifts yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(r){
      var statusInfo = STATUS_LABELS[r.status] || ['pending', esc(r.status)];
      var donor = (r.first_name || r.last_name) ? (r.first_name + ' ' + r.last_name).trim() : (r.payer_name || '(anonymous)');
      var cancelled = r.status === 'cancelled';
      return '<tr data-id="' + r.id + '">' +
        '<td>' + esc((r.created_at || '').slice(0, 10)) + '</td>' +
        '<td>' + esc(donor) + '<br><span class="status-msg">' + esc(r.payer_email) + '</span></td>' +
        '<td>' + esc(r.fund_name) + '</td>' +
        '<td class="amt">' + money(r.amount_cents) + '</td>' +
        '<td>' + esc(INTERVAL_LABELS[r.interval] || r.interval) + '</td>' +
        '<td><span class="badge ' + statusInfo[0] + '">' + statusInfo[1] + '</span>' +
          (r.status === 'pending_manual_setup' ? '<br><span class="status-msg">' + esc(r.stax_error || 'No Stax schedule id — set up by hand in Stax, or retry the signup.') + '</span>' : '') +
          '</td>' +
        '<td><button class="cancel-btn"' + (cancelled ? ' disabled' : '') + '>' + (cancelled ? 'Cancelled' : 'Cancel') + '</button>' +
          '<div class="status-msg row-status"></div></td>' +
      '</tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('.cancel-btn'), function(btn){
      btn.addEventListener('click', function(){
        var tr = btn.closest('tr');
        var statusEl = tr.querySelector('.row-status');
        if (!window.confirm('Cancel this recurring gift? This stops future charges.')) return;
        btn.disabled = true;
        statusEl.textContent = 'Cancelling\\u2026';
        fetch('/admin/api/giving/stax-mockup/recurring/' + tr.dataset.id + '/cancel', { method: 'POST' })
          .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
          .then(function(res){
            if (!res.ok) { statusEl.textContent = res.d.error || 'Failed.'; btn.disabled = false; return; }
            btn.textContent = 'Cancelled';
            var badge = tr.querySelector('.badge');
            badge.className = 'badge cancelled'; badge.textContent = 'Cancelled';
            statusEl.textContent = res.d.had_stax_schedule && !res.d.stax_cancelled
              ? 'Cancelled here — could not confirm Stax also stopped it; check the Stax dashboard.'
              : '';
          }).catch(function(){ statusEl.textContent = 'Network error.'; btn.disabled = false; });
      });
    });
  }

  fetch('/admin/api/giving/stax-mockup/recurring').then(function(r){ return r.json(); }).then(function(d){ render(d.schedules || []); })
    .catch(function(){ document.getElementById('rows').innerHTML = '<tr><td colspan="7" class="empty">Could not load recurring gifts.</td></tr>'; });
})();
</script>
</body></html>`);
}
