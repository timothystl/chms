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
import { json, html, timingSafeEqual } from './auth.js';
import { normalizePhone, escLite } from './api-utils.js';

// Same single Core API host for sandbox and production; only the API key differs. Verified live
// against this host by childcare-portal's Stax integration (see its create-stax-charge and
// charge-stax-payment functions) — mirrored here, not re-derived from scratch.
const STAX_API_URL = 'https://apiprod.fattlabs.com';
const STAXJS_URL = 'https://staxjs.staxpayments.com/staxjs-captcha.js';

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

async function staxRequest(apiKey, path, init) {
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

// ── Shared insert path: a verified Stax gift → giving_entries ──────────────
// Idempotent on (processor, external_txn_id) via idx_giving_external_txn — calling this twice
// for the same Stax transaction id (a webhook redelivery, or a synchronous-success path followed
// by the same event arriving over the webhook) is a no-op the second time, matching
// childcare-portal stax-webhook's "recover a synchronous charge whose response was lost, without
// ever double-recording one that wasn't" contract.
export async function recordStaxGift(db, g) {
  const externalTxnId = String(g.externalTxnId || '');
  if (!externalTxnId) return { error: 'external_txn_id required' };
  const existing = await db.prepare(
    `SELECT ge.id, ge.person_id FROM giving_entries ge WHERE ge.processor='stax' AND ge.external_txn_id=?`
  ).bind(externalTxnId).first();
  if (existing) return { entryId: existing.id, alreadyRecorded: true, matched: existing.person_id != null, personId: existing.person_id || null };

  const fundId = parseInt(g.fundId);
  const amountCents = Math.round(Number(g.amountCents));
  if (!Number.isInteger(fundId) || !Number.isFinite(amountCents) || amountCents === 0) {
    return { error: 'fund_id and a non-zero amount are required' };
  }

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

  const er = await db.prepare(
    `INSERT INTO giving_entries
       (batch_id, person_id, fund_id, amount, method, notes, contribution_date,
        fee_cents, source, processor, external_txn_id, reconcile_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    batchId, person ? person.id : null, fundId, amountCents,
    g.method || 'card', g.note || '', contributionDate,
    Math.max(0, Math.round(Number(g.feeCents) || 0)), 'stax_mockup', 'stax', externalTxnId, 'recorded'
  ).run();
  const entryId = er.meta?.last_row_id;

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
  if (!person) {
    await db.prepare(
      `INSERT INTO giving_stax_unmatched
         (giving_entry_id, payer_name, payer_email, payer_phone, card_brand, card_last4, stax_customer_id, status)
       VALUES (?,?,?,?,?,?,?,'open')`
    ).bind(entryId, g.payerName || '', g.payerEmail || '', g.payerPhone || '', g.cardBrand || '', g.cardLast4 || '', g.staxCustomerId || '').run();
  }

  return { entryId, matched: !!person, personId: person ? person.id : null, alreadyRecorded: false };
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
// insert.
async function recordStaxReversal(db, { kind, eventTxnId, parentTxnId, amountCents }) {
  const existing = await db.prepare(
    `SELECT id FROM giving_entries WHERE processor='stax' AND external_txn_id=?`
  ).bind(eventTxnId).first();
  if (existing) return { entryId: existing.id, alreadyRecorded: true };

  const original = await db.prepare(
    `SELECT id, person_id, fund_id, batch_id FROM giving_entries WHERE processor='stax' AND external_txn_id=?`
  ).bind(parentTxnId).first();
  if (!original) return { error: 'Original gift not found for this ' + kind };

  const er = await db.prepare(
    `INSERT INTO giving_entries
       (batch_id, person_id, fund_id, amount, method, notes, contribution_date,
        source, processor, external_txn_id, reconcile_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    original.batch_id, original.person_id, original.fund_id, -Math.abs(amountCents),
    kind, `Stax ${kind} of gift #${original.id} (mockup)`, todayIso(),
    'stax_mockup', 'stax', eventTxnId, 'recorded'
  ).run();
  return { entryId: er.meta?.last_row_id, alreadyRecorded: false, reversalOf: original.id };
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
    const result = await recordStaxGift(db, {
      externalTxnId: eventTransactionId,
      fundId: meta.fund_id,
      amountCents,
      feeCents: cents(transaction?.total_fees) || 0,
      method: transaction?.payment_method?.method_type === 'ach' ? 'ach' : 'card',
      payerName: meta.payer_name || '', payerEmail: meta.payer_email || '', payerPhone: meta.payer_phone || '',
      cardBrand: transaction?.payment_method?.card_type || '', cardLast4: transaction?.payment_method?.card_last_four || '',
      staxCustomerId: String(transaction?.customer_id || ''),
    });
    if (result.error) return json({ error: result.error }, 422);
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

// ── Public API: funds list, checkout, recurring signup ──────────────────────
export async function handleStaxGivingMockupPublicApi(req, env, url, method, path) {
  const db = env.DB;

  if (path === 'funds' && method === 'GET') {
    const rows = (await db.prepare(
      "SELECT id, name FROM funds WHERE active=1 ORDER BY sort_order, name"
    ).all()).results || [];
    return json({ funds: rows, configured: staxMockupConfigured(env) });
  }

  // The web payments token is a merchant-level, publishable-style token (not a secret) that
  // Stax.js needs client-side to mount its hosted card fields — same role as childcare-portal's
  // STAX_WEB_PAYMENTS_TOKEN. It cannot move money by itself; STAX_SANDBOX_API_KEY (server-only)
  // is what authorizes the actual /customer and /charge calls above.
  if (path === 'webpayments-token' && method === 'GET') {
    if (!staxMockupConfigured(env)) return json({ token: null });
    return json({ token: env.STAX_SANDBOX_WEB_PAYMENTS_TOKEN });
  }

  if (path === 'checkout' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const fundId = parseInt(b.fund_id);
    const amountCents = cents(b.amount);
    const payerName = String(b.payer_name || '').trim().slice(0, 200);
    const payerEmail = String(b.payer_email || '').trim().slice(0, 200);
    const payerPhone = String(b.payer_phone || '').trim().slice(0, 40);
    if (!Number.isInteger(fundId)) return json({ error: 'fund_id required' }, 400);
    if (amountCents === null) return json({ error: 'A valid amount is required' }, 400);
    const fund = await db.prepare('SELECT id, active FROM funds WHERE id=?').bind(fundId).first();
    if (!fund || !fund.active) return json({ error: 'That fund is not open for giving.' }, 400);

    if (!staxMockupConfigured(env)) {
      // DEMO MODE — no Stax sandbox credentials wired into this environment yet. Records the
      // gift through the exact same recordStaxGift() path a verified webhook would use, so the
      // rest of the mockup (matching, review queue, statements) is fully clickable without live
      // sandbox keys. A synthetic transaction id keeps it distinguishable in the ledger.
      const result = await recordStaxGift(db, {
        externalTxnId: `demo-${crypto.randomUUID()}`,
        fundId, amountCents, method: 'card',
        payerName, payerEmail, payerPhone,
      });
      if (result.error) return json({ error: result.error }, 422);
      return json({ ok: true, demo: true, ...result });
    }

    const paymentMethodId = String(b.payment_method_id || '');
    if (!paymentMethodId) return json({ error: 'payment_method_id required (from Stax.js tokenize)' }, 400);
    const apiKey = env.STAX_SANDBOX_API_KEY;
    const created = await staxRequest(apiKey, '/customer', {
      method: 'POST',
      body: JSON.stringify({
        firstname: payerName.split(/\s+/)[0] || 'Giving',
        lastname: payerName.split(/\s+/).slice(1).join(' ') || 'Donor',
        email: payerEmail || undefined,
        reference: `chms-mockup-${Date.now()}`,
      }),
    });
    if (!created.ok || !created.data?.id) return json({ error: 'Could not start payment with Stax.' }, 502);
    const staxCustomerId = created.data.id;

    const idempotencyId = crypto.randomUUID();
    const charge = await staxRequest(apiKey, '/charge', {
      method: 'POST',
      body: JSON.stringify({
        payment_method_id: paymentMethodId,
        customer_id: staxCustomerId,
        total: amountStr(amountCents),
        pre_auth: false,
        idempotency_id: idempotencyId,
        meta: {
          memo: 'Timothy Lutheran Church — Giving (mockup)',
          fund_id: fundId, payer_name: payerName, payer_email: payerEmail, payer_phone: payerPhone,
        },
      }),
    });
    const chargeSuccess = charge.data?.success === true;
    if (!charge.ok || !chargeSuccess || !charge.data?.id) {
      return json({ error: charge.data?.message || 'The charge was not approved.' }, 402);
    }
    // Record synchronously when Stax answers directly — recordStaxGift is idempotent on
    // external_txn_id, so if the webhook ALSO fires for this same transaction id later
    // (Stax's normal behavior), that second call is a confirmed no-op, not a double gift.
    const result = await recordStaxGift(db, {
      externalTxnId: String(charge.data.id),
      fundId, amountCents,
      feeCents: cents(charge.data?.total_fees) || 0,
      method: charge.data?.payment_method?.method_type === 'ach' ? 'ach' : 'card',
      payerName, payerEmail, payerPhone,
      cardBrand: charge.data?.payment_method?.card_type || '',
      cardLast4: charge.data?.payment_method?.card_last_four || '',
      staxCustomerId,
    });
    if (result.error) return json({ error: result.error }, 422);
    return json({ ok: true, demo: false, ...result });
  }

  if (path === 'recurring' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const fundId = parseInt(b.fund_id);
    const amountCents = cents(b.amount);
    const interval = ['weekly', 'monthly'].includes(b.interval) ? b.interval : 'monthly';
    const payerName = String(b.payer_name || '').trim().slice(0, 200);
    const payerEmail = String(b.payer_email || '').trim().slice(0, 200);
    if (!Number.isInteger(fundId) || amountCents === null) return json({ error: 'fund_id and a valid amount are required' }, 400);
    const fund = await db.prepare('SELECT id, active FROM funds WHERE id=?').bind(fundId).first();
    if (!fund || !fund.active) return json({ error: 'That fund is not open for giving.' }, 400);

    let staxCustomerId = '', staxScheduleId = '', status = 'pending_manual_setup';
    if (staxMockupConfigured(env) && b.payment_method_id) {
      const apiKey = env.STAX_SANDBOX_API_KEY;
      const created = await staxRequest(apiKey, '/customer', {
        method: 'POST',
        body: JSON.stringify({
          firstname: payerName.split(/\s+/)[0] || 'Giving',
          lastname: payerName.split(/\s+/).slice(1).join(' ') || 'Donor',
          email: payerEmail || undefined,
          reference: `chms-mockup-recurring-${Date.now()}`,
        }),
      });
      if (created.ok && created.data?.id) {
        staxCustomerId = created.data.id;
        // ⚠ UNVERIFIED against a live Stax sandbox — childcare-portal's integration never needed
        // recurring billing (MDO tuition schedules its own charges), so there is no proven
        // request/response shape to copy the way /customer and /charge were copied above. Best
        // effort against Stax's documented Schedule/Subscription resource; failure here is not
        // fatal to the mockup — the schedule still exists locally with status
        // 'pending_manual_setup' so staff can see and hand-create it in the Stax dashboard.
        try {
          const sched = await staxRequest(apiKey, '/schedule', {
            method: 'POST',
            body: JSON.stringify({
              customer_id: staxCustomerId,
              payment_method_id: b.payment_method_id,
              total: amountStr(amountCents),
              frequency: interval,
              meta: { fund_id: fundId, payer_name: payerName, payer_email: payerEmail, mockup: true },
            }),
          });
          if (sched.ok && sched.data?.id) { staxScheduleId = String(sched.data.id); status = 'active'; }
        } catch { /* left as pending_manual_setup below */ }
      }
    }

    const r = await db.prepare(
      `INSERT INTO giving_stax_recurring_schedules
         (person_id, fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email)
       VALUES (NULL,?,?,?,?,?,?,?,?)`
    ).bind(fundId, amountCents, interval, staxCustomerId, staxScheduleId, status, payerName, payerEmail).run();
    return json({ ok: true, id: r.meta?.last_row_id, status });
  }

  return json({ error: 'Not found' }, 404);
}

// ── Apple Pay domain verification — noted, not activated ───────────────────
// Stax requires a domain-verification file hosted at this exact well-known path on whichever
// domain ends up serving the mockup/real giving form, then that domain registered in the Stax
// dashboard, before Apple Pay can appear as a StaxJs wallet option. This route intentionally
// does NOT serve fake verification content (only Stax/Apple can issue the real file) — it exists
// so visiting the URL shows exactly what's missing and where it goes once a domain is chosen.
export function applePayDomainPlaceholderResponse() {
  return new Response(
    '# Apple Pay domain association placeholder (Stax Giving mockup)\n' +
    '#\n' +
    '# This file is not the real Apple/Stax verification content — it cannot be, Stax issues it\n' +
    '# per registered domain. Once a real domain is chosen for the giving portal:\n' +
    '#   1. Register that domain in the Stax dashboard for Apple Pay.\n' +
    '#   2. Stax provides the actual verification file content.\n' +
    '#   3. Replace this placeholder response (see connect-worker.js\'s route for this path) with\n' +
    '#      that content, served at exactly this path, with no redirect.\n',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

// ── Public giving form (MOCKUP) ─────────────────────────────────────────────
// Stax.js loads a script from staxjs.staxpayments.com and mounts hosted card-field iframes plus
// makes its own tokenization calls, none of which the app's default CSP (src/auth.js SEC_HEADERS
// — script-src/connect-src/frame-src effectively 'self' only) permits. Widened only for this one
// response, only to Stax's own domains. ⚠ *.staxpayments.com / *.fattlabs.com is a reasonable
// guess at Stax.js's actual hosted-field/tokenization origins, not something this mockup could
// verify against a live sandbox load — recheck the exact origins Stax.js actually requests
// (browser devtools' CSP violation reports are the fastest way) once real sandbox keys are wired
// in, and narrow this back down.
const STAX_GIVING_MOCKUP_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://staxjs.staxpayments.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src * data: blob:; " +
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://*.staxpayments.com https://*.fattlabs.com; " +
  "frame-src https://*.staxpayments.com https://*.fattlabs.com; frame-ancestors 'none';";

export function renderStaxGivingMockupFormHtml() {
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Give (Stax mockup) — Timothy Lutheran Church</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);min-height:100vh;padding:2rem 1rem;}
  .mockup-banner{max-width:480px;margin:0 auto 1rem;background:#3D2B00;color:#F5D98A;border-radius:10px;
    padding:.7rem 1rem;font-size:.82rem;text-align:center;font-weight:600;letter-spacing:.02em;}
  .card{background:#fff;border-radius:16px;padding:2.25rem;max-width:480px;margin:0 auto;box-shadow:0 4px 24px rgba(30,45,74,.12);}
  .wm-display{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:2.1rem;color:var(--navy);text-align:center;margin-bottom:.25rem;}
  .wm-sub{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);text-align:center;margin-bottom:1.75rem;}
  .field{margin-bottom:1rem;}
  label{display:block;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.15em;color:var(--navy);margin-bottom:.4rem;}
  input,select{width:100%;padding:.7rem 1rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.95rem;font-family:inherit;outline:none;background:#fff;}
  input:focus,select:focus{border-color:var(--teal);}
  .amount-row{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.6rem;}
  .amount-chip{flex:1 1 70px;padding:.6rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;text-align:center;cursor:pointer;font-weight:600;color:var(--navy);}
  .amount-chip.active{background:var(--navy);color:#fff;border-color:var(--navy);}
  .toggle-row{display:flex;gap:.5rem;margin-bottom:1.25rem;}
  .toggle{flex:1;padding:.6rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;text-align:center;cursor:pointer;font-size:.85rem;font-weight:600;color:var(--navy);}
  .toggle.active{background:var(--teal);color:#fff;border-color:var(--teal);}
  .wallet-row{display:flex;gap:.6rem;margin-bottom:1rem;}
  .wallet-mount{flex:1;min-height:44px;border-radius:8px;overflow:hidden;}
  .card-field{border:1.5px solid rgba(30,45,74,.2);border-radius:8px;padding:0;margin-bottom:.8rem;}
  .btn{width:100%;background:var(--navy);color:#fff;border:none;padding:.9rem;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.5rem;font-family:inherit;}
  .btn:hover{background:var(--teal);} .btn:disabled{opacity:.6;cursor:wait;}
  .msg{padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.85rem;}
  .msg.err{background:#fceae8;color:#c0392b;} .msg.ok{background:#e8f6ed;color:#1d6b3a;}
  .fine{font-size:.75rem;color:var(--muted);margin-top:1rem;text-align:center;}
  .demo-note{font-size:.75rem;color:#7A6E5A;background:#FDFAF0;border:1px dashed #E8E0CC;border-radius:8px;padding:.6rem .8rem;margin-bottom:1rem;}
</style></head><body>
  <div class="mockup-banner">MOCKUP — sandbox only, no real charges. Tithe.ly giving is unchanged.</div>
  <div class="card">
    <div class="wm-display">Give</div>
    <div class="wm-sub">Timothy Lutheran Church &middot; Stax mockup</div>
    <div id="msg"></div>
    <form id="giveForm">
      <div class="field">
        <label for="fund">Fund</label>
        <select id="fund" required><option value="">Loading funds…</option></select>
      </div>
      <div class="field">
        <label>Amount</label>
        <div class="amount-row" id="amountChips"></div>
        <input id="amount" type="number" min="1" step="0.01" placeholder="Other amount" required>
      </div>
      <div class="toggle-row">
        <div class="toggle active" data-freq="once">One-time</div>
        <div class="toggle" data-freq="recurring">Recurring</div>
      </div>
      <div class="field" id="intervalField" hidden>
        <label for="interval">Frequency</label>
        <select id="interval"><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select>
      </div>
      <div class="field"><label for="payerName">Name</label><input id="payerName" type="text" required></div>
      <div class="field"><label for="payerEmail">Email</label><input id="payerEmail" type="email" required></div>
      <div class="field"><label for="payerPhone">Phone (optional)</label><input id="payerPhone" type="tel"></div>

      <div class="wallet-row">
        <div class="wallet-mount" id="applePayMount"></div>
        <div class="wallet-mount" id="googlePayMount"></div>
      </div>
      <div class="field">
        <label>Card number</label>
        <div class="card-field" id="staxCardNumber" style="height:38px;"></div>
      </div>
      <div class="field">
        <label>CVV</label>
        <div class="card-field" id="staxCardCvv" style="height:38px;max-width:120px;"></div>
      </div>

      <button class="btn" id="payBtn" type="submit">Give</button>
    </form>
    <div class="fine">Apple Pay appears here automatically once this domain is registered with Stax — see docs/STAX_GIVING_MOCKUP.md.</div>
  </div>
<script>
(function(){
  var freq = 'once';
  var chips = [25,50,100,250];
  var amountChips = document.getElementById('amountChips');
  chips.forEach(function(v){
    var el = document.createElement('div');
    el.className = 'amount-chip'; el.textContent = '$' + v; el.dataset.v = v;
    el.addEventListener('click', function(){
      document.getElementById('amount').value = v;
      Array.prototype.forEach.call(amountChips.children, function(c){ c.classList.remove('active'); });
      el.classList.add('active');
    });
    amountChips.appendChild(el);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.toggle'), function(t){
    t.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.toggle'), function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      freq = t.dataset.freq;
      document.getElementById('interval').closest('.field').hidden = (freq !== 'recurring');
      document.getElementById('interval').hidden = (freq !== 'recurring');
      document.getElementById('intervalField').hidden = (freq !== 'recurring');
    });
  });

  var configured = false, staxInstance = null, paymentMethodId = null;

  function showMsg(text, ok){
    var m = document.getElementById('msg');
    m.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + text + '</div>';
  }

  fetch('/api/mockup/stax-giving/funds').then(function(r){ return r.json(); }).then(function(d){
    configured = !!d.configured;
    var sel = document.getElementById('fund');
    sel.innerHTML = '';
    (d.funds || []).forEach(function(f){
      var o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o);
    });
    if (!configured) {
      var note = document.createElement('div');
      note.className = 'demo-note';
      note.textContent = 'Demo mode: no live Stax sandbox key configured in this environment yet, so card fields are skipped and submitting records a simulated gift through the exact same matching/ledger path a real Stax webhook would use.';
      document.getElementById('giveForm').parentNode.insertBefore(note, document.getElementById('giveForm'));
      document.getElementById('staxCardNumber').closest('.field').hidden = true;
      document.getElementById('staxCardCvv').closest('.field').hidden = true;
      return;
    }
    var s = document.createElement('script');
    s.src = '${STAXJS_URL}';
    s.onload = function(){
      fetch('/api/mockup/stax-giving/webpayments-token').then(function(r){ return r.json(); }).then(function(t){
        if (!t.token) return;
        staxInstance = new window.StaxJs(t.token, {
          number: { id: 'staxCardNumber', placeholder: '0000 0000 0000 0000', style: 'height:36px;width:100%;font-size:15px;padding:0 12px;border:none;outline:none;', type: 'text', format: 'prettyFormat' },
          cvv: { id: 'staxCardCvv', placeholder: 'CVV', style: 'height:36px;width:100%;font-size:15px;padding:0 12px;border:none;outline:none;', type: 'text' },
        });
        if (typeof staxInstance.showCardForm === 'function') staxInstance.showCardForm();
      });
    };
    document.head.appendChild(s);
  }).catch(function(){ showMsg('Could not load funds. Please try again.', false); });

  document.getElementById('giveForm').addEventListener('submit', function(e){
    e.preventDefault();
    var payBtn = document.getElementById('payBtn');
    payBtn.disabled = true; payBtn.textContent = 'Processing…';
    var payload = {
      fund_id: document.getElementById('fund').value,
      amount: document.getElementById('amount').value,
      payer_name: document.getElementById('payerName').value,
      payer_email: document.getElementById('payerEmail').value,
      payer_phone: document.getElementById('payerPhone').value,
    };

    function submit(pmId){
      var endpoint = freq === 'recurring' ? '/api/mockup/stax-giving/recurring' : '/api/mockup/stax-giving/checkout';
      if (freq === 'recurring') payload.interval = document.getElementById('interval').value;
      if (pmId) payload.payment_method_id = pmId;
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(res){
          payBtn.disabled = false; payBtn.textContent = 'Give';
          if (!res.ok) { showMsg(res.d.error || 'Something went wrong.', false); return; }
          showMsg(res.d.demo ? 'Simulated gift recorded (demo mode).' : 'Thank you — your gift was recorded.', true);
          document.getElementById('giveForm').reset();
        }).catch(function(){ payBtn.disabled = false; payBtn.textContent = 'Give'; showMsg('Network error. Please try again.', false); });
    }

    if (configured && staxInstance && typeof staxInstance.tokenize === 'function') {
      staxInstance.tokenize({}).then(function(res){ submit(res && res.id); })
        .catch(function(){ payBtn.disabled = false; payBtn.textContent = 'Give'; showMsg('Could not read the card. Please check the number and try again.', false); });
    } else {
      submit(null);
    }
  });
})();
</script>
</body></html>`, 200, { 'Content-Security-Policy': STAX_GIVING_MOCKUP_CSP });
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
  <div class="sub">A Stax webhook gift that couldn't be matched to an existing person by email or phone lands here. Link it to a person, or leave it unmatched.</div>
  <div class="wrap"><table>
    <thead><tr><th>Date</th><th>Fund</th><th>Amount</th><th>Payer</th><th>Card</th><th>Action</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
  </table></div>
<script>
(function(){
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(cents){ return '$' + (Math.round(cents || 0) / 100).toFixed(2); }

  function render(rows){
    var tbody = document.getElementById('rows');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No unmatched Stax gifts right now.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(r){
      return '<tr data-id="' + r.queue_id + '">' +
        '<td>' + esc(r.contribution_date) + '</td>' +
        '<td>' + esc(r.fund_name) + '</td>' +
        '<td class="amt">' + money(r.amount) + '</td>' +
        '<td>' + esc(r.payer_name) + '<br><span class="status-msg">' + esc(r.payer_email) + (r.payer_phone ? ' &middot; ' + esc(r.payer_phone) : '') + '</span></td>' +
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
            datalist.innerHTML = (d.people || []).map(function(p){
              return '<option data-id="' + p.id + '" value="' + esc((p.first_name || '') + ' ' + (p.last_name || '')) + '">';
            }).join('');
            input.dataset.matches = JSON.stringify((d.people || []).map(function(p){ return { id: p.id, name: (p.first_name || '') + ' ' + (p.last_name || '') }; }));
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
