// ── Cross-Worker server-to-server contract endpoints ────────────────────────
// Called from the Finance application (staging today; production once Finance
// has its own Worker), not from a browser or a staff session directly. Every
// route here requires the X-Contract-Key header matching env.FINANCE_CONTRACT_API_KEY
// -- the same shared-secret pattern already used for the website's intake and
// Christmas Market calls into this Worker (see api-intake.js, api-scheduler.js).
// This stays a distinct, narrower grant from the human role/permission matrix in
// api-chms.js: it reaches nothing but the contracts named below.
import { json, timingSafeEqual } from './auth.js';
import { respondWithConnectGivingSummaryV1, respondWithFinanceDataStatusV1, respondWithFinanceChartOfAccountsV1, respondWithFinanceBudgetV1, respondWithFinanceChurchReportV1, respondWithFinanceChurchReportTrendV1, respondWithFinanceBalanceSheetV1, respondWithFinanceBalanceSheetTrendV1, respondWithFinanceDaycareReportV1, respondWithFinancePropertyValuationV1, respondWithFinanceCompensationV1, respondWithFinancePropertyOperatingV1, respondWithFinancePropertyReservesV1, respondWithFinancePropertyLedgersV1, respondWithFinancePropertyForecastV1 } from './api-contracts.js';
import { verifyAccessJwt } from './access-jwt.js';
import { getRolePermissions, permissionsForRole } from './api-utils.js';
import { recordQuickGivingEntry } from './api-giving.js';
import { applyBudgetPlanOverrideRows, applySalaryPlannerWrite, resolveSalaryPlannerState } from './api-finance.js';

export async function handleContractsServiceApi(req, env, path) {
  const expectedKey = env.FINANCE_CONTRACT_API_KEY || '';
  if (!expectedKey) return json({ error: 'Contract service not configured' }, 503);
  const key = req.headers.get('X-Contract-Key') || '';
  if (!(await timingSafeEqual(key, expectedKey))) return json({ error: 'Unauthorized' }, 401);

  if (path === '/api/contracts/connect-giving-summary-v1' && req.method === 'GET') {
    return respondWithConnectGivingSummaryV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-data-status-v1' && req.method === 'GET') {
    return respondWithFinanceDataStatusV1(env.DB);
  }

  if (path === '/api/contracts/finance-chart-of-accounts-v1' && req.method === 'GET') {
    return respondWithFinanceChartOfAccountsV1(env.DB);
  }

  if (path === '/api/contracts/finance-budget-v1' && req.method === 'GET') {
    return respondWithFinanceBudgetV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-church-report-v1' && req.method === 'GET') {
    return respondWithFinanceChurchReportV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-church-report-trend-v1' && req.method === 'GET') {
    return respondWithFinanceChurchReportTrendV1(env.DB);
  }

  if (path === '/api/contracts/finance-balance-sheet-v1' && req.method === 'GET') {
    return respondWithFinanceBalanceSheetV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-balance-sheet-trend-v1' && req.method === 'GET') {
    return respondWithFinanceBalanceSheetTrendV1(env.DB);
  }

  if (path === '/api/contracts/finance-daycare-report-v1' && req.method === 'GET') {
    return respondWithFinanceDaycareReportV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-valuation-v1' && req.method === 'GET') {
    return respondWithFinancePropertyValuationV1(new URL(req.url), env.DB);
  }

  // Real, individually-identifiable per-person compensation data (see finance-compensation-
  // consumer.js's header comment) -- this X-Contract-Key check only proves the call came from
  // Finance's own Worker, same as every route above; it does NOT check who the human viewer on
  // Finance's side is. That check lives entirely in apps/finance's own shell (resolveCompensation
  // Report's roleVerified gate + connect-role-client.js's roleCanAccessSection), which only ever
  // attempts this fetch for a Connect role independently verified as admin/council/compensation.
  if (path === '/api/contracts/finance-compensation-v1' && req.method === 'GET') {
    return respondWithFinanceCompensationV1(env.DB);
  }

  if (path === '/api/contracts/finance-property-operating-v1' && req.method === 'GET') {
    return respondWithFinancePropertyOperatingV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-reserves-v1' && req.method === 'GET') {
    return respondWithFinancePropertyReservesV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-ledgers-v1' && req.method === 'GET') {
    return respondWithFinancePropertyLedgersV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-forecast-v1' && req.method === 'GET') {
    return respondWithFinancePropertyForecastV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/giving-quick-entry-v1' && req.method === 'POST') {
    return handleGivingQuickEntryContract(req, env);
  }

  if (path === '/api/contracts/finance-budget-write-v1' && req.method === 'POST') {
    return handleFinanceBudgetWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-compensation-write-v1' && req.method === 'POST') {
    return handleFinanceCompensationWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-compensation-plan-v1' && req.method === 'GET') {
    return handleFinanceCompensationPlanContract(req, env);
  }

  if (path === '/api/contracts/staff-role-v1' && req.method === 'GET') {
    return handleStaffRoleContract(req, env);
  }

  return json({ error: 'Not found' }, 404);
}

// ── Verified staff role, relayed from Finance's own shell ───────────────────
// The X-Contract-Key check above only proves the CALL came from Finance's Worker. This proves
// WHO Finance says is acting -- same Cf-Access-Jwt-Assertion forwarding + independent signature
// verification as handleGivingQuickEntryContract above -- and hands back ONLY the caller's role
// (never username, email, or anything else from app_users), the minimum Finance needs to enforce
// its own per-section access (see apps/finance/parity-manifest.js's `permission` field) without
// Finance re-implementing session verification or holding its own copy of app_users.
async function handleStaffRoleContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const user = await env.DB.prepare(
    `SELECT role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  return json({ role: user.role });
}

// ── Giving quick-entry, relayed from Finance's own UI ───────────────────────
// The X-Contract-Key check above only proves the CALL came from Finance's Worker.
// This proves WHO Finance says is acting: Finance forwards the Cf-Access-Jwt-Assertion
// header Cloudflare Access already attached to the bookkeeper's own request, and
// Connect independently verifies that signature against Access's own published
// keys (access-jwt.js) rather than trusting whatever Finance forwards. The
// verified email is then checked against Connect's own app_users + role/permission
// matrix -- requiring edit-level `giving` permission specifically, since this is a
// write, not just any finance-role read access -- so someone who couldn't enter a
// gift in Connect directly can't do it through Finance either.
async function handleGivingQuickEntryContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, user.role);
  const canEnterGiving = user.role === 'admin' || rolePerms.giving === 'edit';
  if (!canEnterGiving) return json({ error: 'Access denied' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const result = await recordQuickGivingEntry(db, body);
  if (result.error) return json(result, 400);

  // Best-effort audit trail -- who entered this gift, and via which surface.
  // Reuses the existing generic audit_log table (same one people-record and
  // finance-clear actions already write to) rather than adding a new column to
  // giving_entries; never blocks the entry itself if this insert fails.
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('giving_quick_entry_via_finance','giving_entries',?,?,'entered_by','',?)`
  ).bind(result.id, '', email).run().catch(() => {});

  return json({ ...result, enteredBy: user.username });
}

// ── Budget Plan write, relayed from Finance's own Budget Planner UI ─────────
// Same shape as handleGivingQuickEntryContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting (independently
// re-verified against Access's own published keys, never trusted from Finance directly), and the
// verified identity's real Connect role is what actually decides whether the write is allowed --
// admin or council, matching finance/planning/church/override-bulk's own gate exactly, since this
// calls the identical applyBudgetPlanOverrideRows() helper that route uses (src/api-finance.js).
// One shared implementation means the legacy in-Connect Budget Planner and this relay can never
// drift on validation, on council's fork-into-their-own-overlay behavior, or on the exact set of
// roles allowed to write -- finance/staff/compensation/member/volunteer all get the same 403 here
// that they'd get in Connect directly.
async function handleFinanceBudgetWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  if (user.role !== 'admin' && user.role !== 'council') {
    return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const result = await applyBudgetPlanOverrideRows(db, user.role, user.username, body.rows);
  if (result.error) return json({ error: result.error }, result.status || 400);

  // Best-effort audit trail, same pattern as the Giving relay above -- never blocks the write
  // itself if this insert fails.
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('budget_plan_write_via_finance','finance_budget_plan',?,?,'saved_by','',?)`
  ).bind('', '', email).run().catch(() => {});

  return json({ ok: true, saved: result.saved, savedBy: user.username });
}

// ── Salary/Compensation Planner write, relayed from Finance's own Compensation Planner UI ───
// Same shape as handleFinanceBudgetWriteContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role decides whether the write is allowed -- admin, compensation, or
// council, matching finance/planning/salary's own gate exactly, since this calls the identical
// applySalaryPlannerWrite() helper that route uses (src/api-finance.js). One shared
// implementation means the legacy in-Connect Salary Planner and this relay can never drift on
// validation, on the compensation role's separate-fork behavior, or on exactly which fields
// council may steer.
//
// The request body carries real, individually-identifiable compensation data (worker names,
// positions, current pay, District Worksheet inputs) -- unlike the Giving/Budget relays' audit
// entries, this one deliberately never logs the body itself, only who saved and when.
async function handleFinanceCompensationWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  if (user.role !== 'admin' && user.role !== 'compensation' && user.role !== 'council') {
    return json({ error: 'Access denied: editing the salary planner requires admin access' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const result = await applySalaryPlannerWrite(db, user.role, user.username, body);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('salary_planner_write_via_finance','finance_settings',?,?,'saved_by','',?)`
  ).bind('', '', email).run().catch(() => {});

  return json({ ok: true, savedBy: user.username });
}

// ── Salary/Compensation Planner READ, relayed to Finance's own Compensation Planner editor ──
// Returns the exact raw, editable plan state the legacy finance/planning/salary GET route would
// for this identity's role (resolveSalaryPlannerState, src/api-finance.js) -- the complete
// internal roster/settings shape Finance's own write relay above expects back on save, NOT the
// normalized connect.finance-compensation.v1 reporting contract's per-person roster (different
// field shapes; that contract exists to describe compensation data for display, not to round-trip
// a save). Finance's editor fetches this first, lets the viewer change specific fields, and
// resubmits the COMPLETE result to finance-compensation-write-v1 -- fetch-edit-resubmit, never a
// partial body, so nothing else in the real plan is silently wiped (see finance-compensation-
// client.js's own comment on why postConnectFinanceCompensationWrite requires the whole state).
//
// Same real, individually-identifiable compensation data as the write side -- gated to admin,
// compensation, or council only, matching COMPENSATION_LIVE_ALLOWED_ROLES (apps/finance/
// compensation-report-service.js) and the legacy Salary Planner's own access.
async function handleFinanceCompensationPlanContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  if (user.role !== 'admin' && user.role !== 'compensation' && user.role !== 'council') {
    return json({ error: 'Access denied: the salary planner requires admin, compensation, or council access' }, 403);
  }

  const data = await resolveSalaryPlannerState(db, user.role, user.username);
  return json({ data });
}
