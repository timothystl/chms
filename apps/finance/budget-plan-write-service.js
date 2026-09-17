// ── Budget builder editing/saving write path — Finance's own database ──────────────────────────
// Ports the "bulk manual save" behavior of legacy `finance/planning/church/override-bulk`
// (src/api-finance.js) onto Finance's OWN `finance_budget_plan` table (FINANCE_DB), instead of
// the shared Connect D1 the legacy route still writes. This is the first genuine write Finance
// makes to its own database -- every other write in this app (Giving quick entry, payroll saves)
// is a live relay to Connect/Website that never touches FINANCE_DB (see route-manifest.js).
//
// Deliberately narrower than the legacy route in one respect: legacy also lets a `council` role
// save into a private per-user `finance_settings` overlay that never touches the shared plan table
// (see api-finance.js's `councilBudgetKey`). That overlay depends on a username Finance's own role
// contract (connect-role-client.js's `fetchVerifiedRole`) does not carry today -- forking on a
// missing username would either silently collapse every council reviewer onto one shared key
// (defeating the whole point of the overlay) or require guessing at an identity we cannot verify.
// Rather than fabricate that, the admin-only path below is ported now (matching every OTHER write
// in the legacy Budget planner -- generate, generate-all, override, commit, delete are all
// admin-only; override-bulk is the one route that also allows council); council's overlay is left
// for a follow-up once Finance's role contract can carry a verified username.
//
// Reachability is gated off by default -- see `isBudgetPlanWritesEnabled` -- so this module can be
// fully implemented and tested well before the route is ever turned on in a real environment.

export const BUDGET_PLAN_CLASSIFICATIONS = new Set(['Income', 'Expenses']);

// Same fiscal-year sanity bound a real church budget plan could ever need -- rejects garbage
// (e.g. a pasted timestamp, a negative number, a typo like "20270") rather than silently accepting
// any finite number the way the legacy route's own `Number.isFinite` check alone would.
const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;

// finance_settings key that gates this route on. Off (row absent, or any value other than exactly
// '1') by default -- see apps/finance/README.md's changelog entry for this feature and shell.js's
// use of this function on the route below. A settings-read failure fails CLOSED (never silently
// enables a write path just because the flag couldn't be read).
export const BUDGET_PLAN_WRITES_ENABLED_KEY = 'finance_budget_builder_writes_enabled';

export async function isBudgetPlanWritesEnabled(db) {
  try {
    const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(BUDGET_PLAN_WRITES_ENABLED_KEY).first();
    return !!row && row.value === '1';
  } catch {
    return false;
  }
}

// Pure validation, mirroring override-bulk's row shape and its all-or-nothing behavior: a single
// malformed row fails the whole batch (returned as { ok: false, error }) rather than saving the
// valid rows and silently dropping the bad one. `rows` is the raw, untrusted request payload.
export function validateBudgetPlanRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'No rows to save' };
  }
  const parsed = [];
  for (const raw of rows) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const category = String(row.category || '').trim();
    const fiscalYear = parseInt(row.fiscal_year, 10);
    if (!category || !Number.isFinite(fiscalYear)) {
      return { ok: false, error: 'Every row needs a category and fiscal_year' };
    }
    if (fiscalYear < MIN_FISCAL_YEAR || fiscalYear > MAX_FISCAL_YEAR) {
      return { ok: false, error: `fiscal_year out of range for ${category}` };
    }
    const classification = row.classification || 'Expenses';
    if (!BUDGET_PLAN_CLASSIFICATIONS.has(classification)) {
      return { ok: false, error: `Invalid classification for ${category} -- must be Income or Expenses` };
    }
    // Whole dollars only, same as the legacy Plan/Projected override paths -- round to the
    // nearest dollar before converting to cents rather than trusting a fractional client value.
    const amountCents = Math.round(Number(row.planned_amount)) * 100;
    if (!Number.isFinite(amountCents)) {
      return { ok: false, error: `Invalid amount for ${category}` };
    }
    parsed.push({ category, fiscalYear, classification, amountCents, notes: String(row.notes || '') });
  }
  return { ok: true, rows: parsed };
}

// Upserts each validated row into Finance's own finance_budget_plan (basis='manual', clearing any
// prior grown-plan base/growth so a hand-edit always wins cleanly) -- identical SQL shape to the
// legacy override-bulk route's admin write. Returns the number of rows saved.
export async function saveBudgetPlanRows(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const ops = rows.map((r) => db.prepare(
    `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,notes,updated_at)
     VALUES (?,?,?,?,'manual',?,datetime('now'))
     ON CONFLICT(category,fiscal_year) DO UPDATE SET
       classification=excluded.classification, planned_amount_cents=excluded.planned_amount_cents, basis='manual',
       growth_pct=NULL, base_amount_cents=NULL, notes=excluded.notes, updated_at=excluded.updated_at`
  ).bind(r.category, r.classification, r.fiscalYear, r.amountCents, r.notes));
  await db.batch(ops);
  return ops.length;
}
