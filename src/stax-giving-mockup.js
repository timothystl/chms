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
import { normalizePhone } from './api-utils.js';

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

// ⚠ ESTIMATE ONLY. A rough blended card-processing rate (2.9% + $0.30), used only to show a
// "cover the fees" amount on the form before any real charge exists. Not verified against
// Timothy Lutheran's actual negotiated Stax rate — replace with the real rate (and re-derive it
// per payment method, since ACH is typically much cheaper than card) before this is anything
// more than a mockup. The AUTHORITATIVE fee, once a card is actually charged, is whatever Stax's
// own `total_fees` on the transaction says — recordStaxGift always stores that, not this guess.
const ESTIMATED_FEE_RATE = 0.029;
const ESTIMATED_FEE_FIXED_CENTS = 30;
function estimateFeeCents(subtotalCents) {
  return Math.round(subtotalCents * ESTIMATED_FEE_RATE) + ESTIMATED_FEE_FIXED_CENTS;
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
    return j({ funds: rows, configured: staxMockupConfigured(env), estimatedFeeRate: ESTIMATED_FEE_RATE, estimatedFeeFixedCents: ESTIMATED_FEE_FIXED_CENTS });
  }

  // The web payments token is a merchant-level, publishable-style token (not a secret) that
  // Stax.js needs client-side to mount its hosted card fields — same role as childcare-portal's
  // STAX_WEB_PAYMENTS_TOKEN. It cannot move money by itself; STAX_SANDBOX_API_KEY (server-only)
  // is what authorizes the actual /customer and /charge calls above.
  if (path === 'webpayments-token' && method === 'GET') {
    if (!staxMockupConfigured(env)) return j({ token: null });
    return j({ token: env.STAX_SANDBOX_WEB_PAYMENTS_TOKEN });
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
    const created = await staxRequest(apiKey, '/customer', {
      method: 'POST',
      body: JSON.stringify({
        firstname: contact.payerFirstName, lastname: contact.payerLastName,
        email: contact.payerEmail || undefined,
        reference: `chms-mockup-${Date.now()}`,
      }),
    });
    if (!created.ok || !created.data?.id) return j({ error: 'Could not start payment with Stax.' }, 502);
    const staxCustomerId = created.data.id;

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
      return j({ error: charge.data?.message || 'The charge was not approved.' }, 402);
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
    const splits = giftResult.splits;
    // Only set when a submission actually has more than one fund, so every pre-existing
    // single-fund schedule (and every one this mockup already wrote) keeps reading as ''.
    const scheduleGroup = splits.length > 1 ? crypto.randomUUID() : '';
    const payerName = `${contact.payerFirstName} ${contact.payerLastName}`.trim();

    let staxCustomerId = '';
    if (staxMockupConfigured(env) && b.payment_method_id) {
      const created = await staxRequest(env.STAX_SANDBOX_API_KEY, '/customer', {
        method: 'POST',
        body: JSON.stringify({
          firstname: contact.payerFirstName, lastname: contact.payerLastName,
          email: contact.payerEmail || undefined,
          reference: `chms-mockup-recurring-${Date.now()}`,
        }),
      });
      if (created.ok && created.data?.id) staxCustomerId = created.data.id;
    }

    const ids = [];
    for (const split of splits) {
      let staxScheduleId = '', status = 'pending_manual_setup';
      if (staxCustomerId && b.payment_method_id) {
        // ⚠ UNVERIFIED against a live Stax sandbox — childcare-portal's integration never needed
        // recurring billing (MDO tuition schedules its own charges), so there is no proven
        // request/response shape to copy the way /customer and /charge were copied above.
        // Stax's own docs disagree with themselves on the path (docs.staxpayments.com currently
        // names POST /scheduled-invoices; an older reference names POST /invoice/schedule/) —
        // /scheduled-invoices is tried first as the more likely current one. Failure here is not
        // fatal to the mockup — the schedule still exists locally with status
        // 'pending_manual_setup' so staff can see and hand-create it in the Stax dashboard.
        try {
          const sched = await staxRequest(env.STAX_SANDBOX_API_KEY, '/scheduled-invoices', {
            method: 'POST',
            body: JSON.stringify({
              customer_id: staxCustomerId,
              payment_method_id: b.payment_method_id,
              total: amountStr(split.amountCents),
              frequency: interval,
              meta: { fund_id: split.fundId, mockup: true },
            }),
          });
          if (sched.ok && sched.data?.id) { staxScheduleId = String(sched.data.id); status = 'active'; }
        } catch { /* left as pending_manual_setup below */ }
      }
      const r = await db.prepare(
        `INSERT INTO giving_stax_recurring_schedules
           (person_id, fund_id, amount_cents, interval, stax_customer_id, stax_schedule_id, status, payer_name, payer_email, schedule_group)
         VALUES (NULL,?,?,?,?,?,?,?,?,?)`
      ).bind(split.fundId, split.amountCents, interval, staxCustomerId, staxScheduleId, status, payerName, contact.payerEmail, scheduleGroup).run();
      ids.push(r.meta?.last_row_id);
    }
    return j({ ok: true, ids, id: ids[0] });
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
    &middot; <a href="/admin/giving/stax-mockup/funds" style="color:var(--teal);">Manage which funds are on the public form &rarr;</a></div>
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
