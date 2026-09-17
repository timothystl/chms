// ── Commercial Property reserve/distribution/capital-ledger WRITE path -- Finance's OWN D1, not
// a relay ─────────────────────────────────────────────────────────────────────────────────────
//
// A further deliberate exception to "every writer in this app relays elsewhere" -- same pattern as
// compensation-plan-write-service.js's Compensation Planner write path, budget-plan-write-service.js's
// Budget builder write path, and csv-import-service.js's CSV import write paths (see
// route-manifest.js's own comments on all of them). Ported from legacy's real implementation in
// src/api-finance.js's
// handlePropertyApi (the finance/property/ivanhoe/reserves/:reserveKey/monthly, .../disbursements,
// finance/property/ivanhoe/distributions, and finance/property/ivanhoe/capital-ledger POST
// routes). Same validation and the same running-balance rule as legacy -- nothing added, nothing
// dropped. Writes land in Finance's OWN FINANCE_DB (the schema in
// apps/finance/migrations/0001_finance_foundation.sql already matches legacy's tables exactly),
// never the shared Connect D1 legacy still writes to.
//
// Real finding, verified against legacy on 2026-09-17: legacy enforces NO sufficient-funds /
// no-overdraw check anywhere on this path. A reserve's reserve_after_cents is a plain running
// total of (reserve_before_cents + contribution_cents) carried forward from the previous
// report_month row for that (property_key, reserve_key); disbursements live in a wholly separate
// table (finance_property_reserve_disbursements) that legacy never reads back to reduce that
// running total, or to block a new disbursement against it. Grepping src/*.js for
// "insufficient"/"overdraw"/"exceeds"/"sufficient" turns up nothing on this path (see
// src/db.js's schema comments and src/api-finance.js's handlePropertyApi, ~line 2756 onward).
// This port matches that reality rather than inventing a stricter rule legacy never had -- see
// apps/finance/README.md's changelog entry for the same note kept in one durable place. If a real
// balance check is ever wanted, that is a new product decision, not a straight port, and belongs
// in its own change with its own sign-off.
//
// OFF BY DEFAULT: isPropertyLedgerWritesEnabled() is checked first, before any role check, by
// every route in shell.js listed in PROPERTY_LEDGER_WRITE_ROUTE_IDS. A real request against a real
// deployment gets a clear "not yet enabled" response until Andrew explicitly flips the flag in
// that environment's finance_settings (or sets the PROPERTY_LEDGER_WRITES_ENABLED env var) --
// this module and its routes exist, and are fully tested, without being reachable in production.
// Role gating (checked only once the flag is on) is admin-only, matching legacy's own isAdmin
// gate for editing property financials -- a narrower, different set than Compensation Planner's
// admin/council/compensation, because that is what legacy itself enforces for this data.
export class PropertyLedgerValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PropertyLedgerValidationError';
  }
}

export const PROPERTY_LEDGER_WRITES_FLAG_KEY = 'property_ledger_writes_enabled';

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const RESERVE_KEY_RE = /^[a-z_]+$/;
const ENTRY_DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function fail(message) {
  throw new PropertyLedgerValidationError(message);
}

// Mirrors legacy's inline `toCents` helper exactly: '' / null / undefined -> null (meaning "not
// supplied"); anything else is coerced with Number(...)*100 and rounded, which yields NaN for a
// non-numeric input so the caller's Number.isFinite check can reject it the same way legacy does.
function toCentsOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  return Math.round(Number(value) * 100);
}

// Checked FIRST by every route in PROPERTY_LEDGER_WRITE_ROUTE_IDS (shell.js), before any role
// check -- an environment with the flag off answers "not yet enabled" to every caller alike,
// verified role or not, so turning this module on can never be confused with a role-gating
// decision. Same shape as compensation-plan-write-service.js's isCompensationPlanWriteEnabled:
// `env` is optional and only ever grants access (PROPERTY_LEDGER_WRITES_ENABLED === '1'); the
// finance_settings row is authoritative otherwise and defaults closed (missing binding, missing
// row, an unrecognized value, or the read itself throwing are all disabled).
export async function isPropertyLedgerWritesEnabled(env, db) {
  if (env && env.PROPERTY_LEDGER_WRITES_ENABLED === '1') return true;
  if (!db) return false;
  let row;
  try {
    row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(PROPERTY_LEDGER_WRITES_FLAG_KEY).first();
  } catch {
    return false;
  }
  return !!row && row.value === '1';
}

// ── Distributions (finance_property_distributions) ─────────────────────────────────────────
// Mirrors legacy's finance/property/:key/distributions POST exactly: upsert keyed on
// (property_key, period). Legacy places no sign restriction on amount_cents; this doesn't either.
export async function recordPropertyDistribution(db, propertyKey, body) {
  const period = body?.period;
  if (!period || !YEAR_MONTH_RE.test(period)) fail('period must be YYYY-MM');
  const amountCents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(amountCents)) fail('Invalid amount');
  await db.prepare(
    `INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES (?,?,?)
     ON CONFLICT(property_key,period) DO UPDATE SET amount_cents=excluded.amount_cents`
  ).bind(propertyKey, period, amountCents).run();
  return { ok: true };
}

// ── Reserve monthly schedule (finance_property_reserves) ───────────────────────────────────
// Mirrors legacy's finance/property/:key/reserves/:reserveKey/monthly POST exactly, including its
// running-balance rule: reserve_before defaults to the latest prior report_month's
// reserve_after_cents for the same (property_key, reserve_key) -- 0 if none exists yet -- and
// reserve_after is always reserve_before + contribution, never independently supplied. Legacy
// enforces no minimum/maximum on contribution_cents (a negative correction is allowed, matching
// the AHRA schedule's own convention) and no check against target_estimate_cents; this does not
// add either.
export async function recordPropertyReserveMonthly(db, propertyKey, reserveKey, body) {
  if (!RESERVE_KEY_RE.test(reserveKey || '')) fail('reserve key must match [a-z_]+');
  const reportMonth = body?.report_month;
  if (!reportMonth || !YEAR_MONTH_RE.test(reportMonth)) fail('report_month must be YYYY-MM');
  const targetEstimateCents = toCentsOrNull(body.target_estimate);
  if (targetEstimateCents !== null && !Number.isFinite(targetEstimateCents)) fail('Invalid target_estimate');
  const contributionCents = toCentsOrNull(body.contribution) ?? 0;
  if (!Number.isFinite(contributionCents)) fail('Invalid contribution');
  const taxYear = (body.tax_year === '' || body.tax_year === null || body.tax_year === undefined) ? null : parseInt(body.tax_year, 10);

  let reserveBeforeCents = toCentsOrNull(body.reserve_before);
  if (reserveBeforeCents === null) {
    const prior = await db.prepare(
      `SELECT reserve_after_cents FROM finance_property_reserves WHERE property_key=? AND reserve_key=? AND report_month<? ORDER BY report_month DESC LIMIT 1`
    ).bind(propertyKey, reserveKey, reportMonth).first();
    reserveBeforeCents = prior?.reserve_after_cents ?? 0;
  }
  const reserveAfterCents = reserveBeforeCents + contributionCents;

  await db.prepare(
    `INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(property_key,reserve_key,report_month) DO UPDATE SET
       tax_year=excluded.tax_year, target_estimate_cents=excluded.target_estimate_cents, reserve_before_cents=excluded.reserve_before_cents,
       contribution_cents=excluded.contribution_cents, reserve_after_cents=excluded.reserve_after_cents, note=excluded.note`
  ).bind(propertyKey, reserveKey, reportMonth, taxYear, targetEstimateCents, reserveBeforeCents, contributionCents, reserveAfterCents, body.note || '').run();

  return { ok: true, reserve_before_cents: reserveBeforeCents, reserve_after_cents: reserveAfterCents };
}

// ── Reserve disbursements (finance_property_reserve_disbursements) ─────────────────────────
// Mirrors legacy's finance/property/:key/reserves/:reserveKey/disbursements POST exactly: an
// upsert log keyed on (property_key, reserve_key, period_key), independent of the reserve
// schedule above. See this file's header note: legacy never checks a disbursement's amount
// against the reserve's running balance, so this does not either.
export async function recordPropertyReserveDisbursement(db, propertyKey, reserveKey, body) {
  if (!RESERVE_KEY_RE.test(reserveKey || '')) fail('reserve key must match [a-z_]+');
  const periodKey = (body?.period_key !== undefined && body?.period_key !== null) ? String(body.period_key).trim() : '';
  if (!periodKey) fail('period_key is required');
  const amountCents = (body.amount === '' || body.amount === null || body.amount === undefined) ? null : Math.round(Number(body.amount) * 100);
  if (amountCents !== null && !Number.isFinite(amountCents)) fail('Invalid amount');
  await db.prepare(
    `INSERT INTO finance_property_reserve_disbursements (property_key,reserve_key,period_key,amount_cents,paid_via_report_month,note)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(property_key,reserve_key,period_key) DO UPDATE SET amount_cents=excluded.amount_cents, paid_via_report_month=excluded.paid_via_report_month, note=excluded.note`
  ).bind(propertyKey, reserveKey, periodKey, amountCents, body.paid_via_report_month || '', body.note || '').run();
  return { ok: true };
}

// ── Capital improvements ledger (finance_property_capital_ledger) ──────────────────────────
// Mirrors legacy's finance/property/:key/capital-ledger POST exactly: a plain append-only insert,
// sort_order auto-incremented from this property's current max (-1 if none yet).
export async function recordPropertyCapitalLedgerEntry(db, propertyKey, body) {
  const amountCents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(amountCents)) fail('Invalid amount');
  if (body.entry_date && !ENTRY_DATE_RE.test(body.entry_date)) fail('entry_date must be YYYY, YYYY-MM, or YYYY-MM-DD');
  const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order),-1) as m FROM finance_property_capital_ledger WHERE property_key=?').bind(propertyKey).first();
  const r = await db.prepare(
    `INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,payee,description,check_ref,project,sort_order) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(propertyKey, body.entry_date || '', amountCents, body.payee || '', body.description || '', body.check_ref || '', body.project || '', (maxSort?.m ?? -1) + 1).run();
  return { ok: true, id: r.meta?.last_row_id };
}
