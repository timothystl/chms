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
import {
  applyBudgetPlanOverrideRows, applySalaryPlannerWrite, resolveSalaryPlannerState,
  generateBudgetPlanRows, generateAllBudgetPlan, commitBudgetPlan, deleteBudgetPlanRow,
  applyChurchActualOverride, recordDaycareEntry, applyBoardCategoryMerge, upsertPropertyMonthly,
  addPropertyRepair, upsertPropertyDistribution, upsertPropertyReserveMonthly,
  upsertPropertyReserveDisbursement, addPropertyCapitalLedgerEntry,
  saveRevenueStreamMap, saveFlowExpenseMap, saveCashPolicy, saveDaycareAllocationConfig,
  applyDaycareBudgetOverride, bulkRecordDaycareEntries, importDaycareFromChurchBudget,
} from './api-finance.js';

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

  if (path === '/api/contracts/finance-budget-generate-v1' && req.method === 'POST') {
    return handleFinanceBudgetGenerateContract(req, env);
  }

  if (path === '/api/contracts/finance-budget-generate-all-v1' && req.method === 'POST') {
    return handleFinanceBudgetGenerateAllContract(req, env);
  }

  if (path === '/api/contracts/finance-budget-commit-v1' && req.method === 'POST') {
    return handleFinanceBudgetCommitContract(req, env);
  }

  if (path === '/api/contracts/finance-budget-remove-v1' && req.method === 'POST') {
    return handleFinanceBudgetRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-church-actual-override-v1' && req.method === 'POST') {
    return handleFinanceChurchActualOverrideContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-entry-v1' && req.method === 'POST') {
    return handleFinanceDaycareEntryContract(req, env);
  }

  if (path === '/api/contracts/finance-board-categories-write-v1' && req.method === 'POST') {
    return handleFinanceBoardCategoriesWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-monthly-write-v1' && req.method === 'POST') {
    return handleFinancePropertyMonthlyWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-repair-write-v1' && req.method === 'POST') {
    return handleFinancePropertyRepairWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-distribution-write-v1' && req.method === 'POST') {
    return handleFinancePropertyDistributionWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-reserve-monthly-write-v1' && req.method === 'POST') {
    return handleFinancePropertyReserveMonthlyWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-reserve-disbursement-write-v1' && req.method === 'POST') {
    return handleFinancePropertyReserveDisbursementWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-capital-ledger-write-v1' && req.method === 'POST') {
    return handleFinancePropertyCapitalLedgerWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-revenue-streams-write-v1' && req.method === 'POST') {
    return handleFinanceRevenueStreamsWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-flow-expense-map-write-v1' && req.method === 'POST') {
    return handleFinanceFlowExpenseMapWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-cash-policy-write-v1' && req.method === 'POST') {
    return handleFinanceCashPolicyWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-allocation-config-write-v1' && req.method === 'POST') {
    return handleFinanceDaycareAllocationConfigWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-budget-override-write-v1' && req.method === 'POST') {
    return handleFinanceDaycareBudgetOverrideWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-bulk-write-v1' && req.method === 'POST') {
    return handleFinanceDaycareBulkWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-church-budget-import-write-v1' && req.method === 'POST') {
    return handleFinanceDaycareChurchBudgetImportWriteContract(req, env);
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

// ── Budget Plan generate / generate-all / commit / delete, relayed from Finance's own Budget
// Planner UI ──────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceBudgetWriteContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role decides whether the operation is allowed -- admin only for all
// four, matching finance/planning/church/generate[-all]/commit/DELETE's own gate exactly, since
// each of these calls the identical helper (src/api-finance.js) that route uses. One shared
// implementation per operation means the legacy in-Connect Budget Planner and these relays can
// never drift on validation.
async function handleFinanceBudgetGenerateContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const targetYears = Array.isArray(body.target_years) ? body.target_years.map(y => parseInt(y, 10)).filter(Number.isFinite) : [];
  const result = await generateBudgetPlanRows(db, {
    category: String(body.category || '').trim(), classification: body.classification || 'Expenses',
    baseAmountCents: Math.round(Number(body.base_amount) * 100), growthPct: Number(body.growth_pct),
    targetYears, notes: body.notes,
  });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

async function handleFinanceBudgetGenerateAllContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await generateAllBudgetPlan(db, {
    baseYear: parseInt(body.base_year, 10), targetYear: parseInt(body.target_year, 10),
    growthPct: Number(body.growth_pct), throughWeekInput: body.through_week,
  });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

async function handleFinanceBudgetCommitContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: committing a budget plan requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await commitBudgetPlan(db, parseInt(body.fiscal_year, 10));
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

async function handleFinanceBudgetRemoveContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing budget plans requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await deleteBudgetPlanRow(db, String(body.category || '').trim(), parseInt(body.fiscal_year, 10));
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Church Report actual-figure correction, relayed from Finance's own Church Report UI ─────
// Same shape as the Budget Plan relays above: the X-Contract-Key check only proves the call came
// from Finance's Worker, this proves WHO Finance says is acting, and the verified identity's real
// Connect role decides whether the correction is allowed -- admin only, matching finance/church/
// actual-override's own gate exactly, since this calls the identical applyChurchActualOverride()
// helper that route uses (src/api-finance.js).
async function handleFinanceChurchActualOverrideContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: correcting an actual figure requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await applyChurchActualOverride(db, parseInt(body.year, 10), body.rows);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Daycare entry, relayed from Finance's own Daycare Report UI ─────────────────────────────
// Same shape as handleGivingQuickEntryContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role/permissions decide whether the write is allowed. Unlike every
// other write relay in this file, the legacy finance/daycare route itself has no role check
// beyond the blanket ACCESS_GATE wrapping the whole handler (src/api-chms.js's financeSegItems
// maps this exact segment to ['finance', 'budget', 'compensation'], granting access if ANY of
// those three items is edit-level for this role) -- so this re-derives that same "any of the
// three" check via getRolePermissions/permissionsForRole rather than a simple role-name check,
// the same real-permission-matrix pattern the Giving relay above already uses.
async function handleFinanceDaycareEntryContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, user.role);
  const canEnterDaycare = ['finance', 'budget', 'compensation'].some((item) => rolePerms[item] === 'edit');
  if (!canEnterDaycare) return json({ error: 'Access denied' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const result = await recordDaycareEntry(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_entry_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind(String(result.id ?? ''), '', email).run().catch(() => {});

  return json({ ok: true, id: result.id, savedBy: user.username });
}

// ── Chart of Accounts board-category merge, relayed from Finance's own Chart of Accounts UI ──
// Same shape as handleFinanceBudgetWriteContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role decides whether the merge is allowed -- admin only, matching
// finance/planning/board-categories's own gate exactly, since this calls the identical
// applyBoardCategoryMerge() helper that route uses (src/api-finance.js).
async function handleFinanceBoardCategoriesWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing the chart of accounts requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await applyBoardCategoryMerge(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property monthly-financials write, relayed from Finance's own Property Operating
// Results UI ──────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceBudgetWriteContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role decides whether the write is allowed -- admin only, matching
// finance/property/ivanhoe/monthly's own gate exactly, since this calls the identical
// upsertPropertyMonthly() helper that route uses (src/api-finance.js). The property key is
// hardcoded to 'ivanhoe' here, never taken from the request body, the same way the legacy route's
// own dispatcher (handleFinanceApi) hardcodes it rather than letting a caller target an arbitrary
// key -- see that dispatcher's own comment on why only 'ivanhoe' exists today.
async function handleFinancePropertyMonthlyWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await upsertPropertyMonthly(db, 'ivanhoe', body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property repairs & maintenance log write, relayed from Finance's own Work orders
// UI ─────────────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/repairs's own gate exactly, since this calls the identical
// addPropertyRepair() helper that route uses (src/api-finance.js). The property key is hardcoded
// to 'ivanhoe' here, never taken from the request body, same reasoning as the monthly-write relay.
async function handleFinancePropertyRepairWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await addPropertyRepair(db, 'ivanhoe', body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property distributions write, relayed from Finance's own Distributions UI ──────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/distributions's own gate exactly, since this calls the identical
// upsertPropertyDistribution() helper that route uses (src/api-finance.js). The property key is
// hardcoded to 'ivanhoe' here, never taken from the request body, same reasoning as the
// monthly-write relay.
async function handleFinancePropertyDistributionWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await upsertPropertyDistribution(db, 'ivanhoe', body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property named-reserve monthly schedule write, relayed from Finance's own
// Reserve & distribution UI ─────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/reserves/:reserveKey/monthly's own gate exactly, since this calls the
// identical upsertPropertyReserveMonthly() helper that route uses (src/api-finance.js). The
// property key is hardcoded to 'ivanhoe' here, never taken from the request body; the reserve key
// itself DOES come from the request body (there is no URL path segment on a contract relay), and
// is re-validated by the shared helper against the same [a-z_]+ shape the legacy route's own URL
// regex enforces.
async function handleFinancePropertyReserveMonthlyWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await upsertPropertyReserveMonthly(db, 'ivanhoe', String(body?.reserve_key || ''), body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property named-reserve disbursement write, relayed from Finance's own Reserve &
// distribution UI ───────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyReserveMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/reserves/:reserveKey/disbursements's own gate exactly, since this
// calls the identical upsertPropertyReserveDisbursement() helper that route uses
// (src/api-finance.js). The property key is hardcoded to 'ivanhoe' here, never taken from the
// request body; the reserve key comes from the request body (no URL path segment on a contract
// relay) and is re-validated by the shared helper.
async function handleFinancePropertyReserveDisbursementWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await upsertPropertyReserveDisbursement(db, 'ivanhoe', String(body?.reserve_key || ''), body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property capital-improvements ledger write, relayed from Finance's own Capital
// improvements UI ───────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/capital-ledger's own gate exactly, since this calls the identical
// addPropertyCapitalLedgerEntry() helper that route uses (src/api-finance.js). The property key
// is hardcoded to 'ivanhoe' here, never taken from the request body, same reasoning as the
// monthly-write relay.
async function handleFinancePropertyCapitalLedgerWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing property financials requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await addPropertyCapitalLedgerEntry(db, 'ivanhoe', body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Revenue-stream classification write, relayed from Finance's own Financial Health/Charts UI ──
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/revenue-streams's own gate exactly, since this calls the identical saveRevenueStreamMap()
// helper that route uses (src/api-finance.js).
async function handleFinanceRevenueStreamsWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing revenue-stream classification requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await saveRevenueStreamMap(db, body?.map);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Flow-diagram expense-category mapping write, relayed from Finance's own Financial Health/
// Charts UI ─────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceRevenueStreamsWriteContract above: admin only, matching
// finance/flow-expense-map's own gate exactly, since this calls the identical saveFlowExpenseMap()
// helper that route uses (src/api-finance.js).
async function handleFinanceFlowExpenseMapWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing the expense-category mapping requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await saveFlowExpenseMap(db, body?.map);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Cash policy (runway card) write, relayed from Finance's own Financial Health UI ─────────
// Same shape as handleFinanceRevenueStreamsWriteContract above: admin only, matching
// finance/cash-policy's own gate exactly, since this calls the identical saveCashPolicy() helper
// that route uses (src/api-finance.js).
async function handleFinanceCashPolicyWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing the cash policy requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await saveCashPolicy(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Daycare Utilities/Insurance cost-share config write, relayed from Finance's own Daycare
// Report (Shared costs) UI ───────────────────────────────────────────────────────────────────
// Same shape as handleFinanceRevenueStreamsWriteContract above: admin only, matching
// finance/daycare/allocation-config's own gate exactly, since this calls the identical
// saveDaycareAllocationConfig() helper that route uses (src/api-finance.js).
async function handleFinanceDaycareAllocationConfigWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing the daycare cost-share requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await saveDaycareAllocationConfig(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Daycare per-cell Budget override write, relayed from Finance's own Daycare Report (Budget
// comparison) UI ────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceRevenueStreamsWriteContract above: admin only, matching
// finance/daycare/budget-override's own gate exactly, since this calls the identical
// applyDaycareBudgetOverride() helper that route uses (src/api-finance.js).
async function handleFinanceDaycareBudgetOverrideWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing daycare budget data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await applyDaycareBudgetOverride(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Daycare bulk paste-in write, relayed from Finance's own Daycare Report (Actuals) UI ─────
// Same shape as handleFinanceDaycareEntryContract above: the X-Contract-Key check only proves the
// call came from Finance's Worker, this proves WHO Finance says is acting, and the verified
// identity's real Connect role/permissions decide whether the write is allowed. Like the single-
// entry Daycare relay, the legacy finance/daycare/bulk route itself has no role check beyond the
// blanket ACCESS_GATE wrapping the whole handler (financeSegItems maps this segment to
// ['finance', 'budget', 'compensation'], granting access if ANY of those three items is edit-level
// for this role) -- so this re-derives that same "any of the three" check via
// getRolePermissions/permissionsForRole rather than a simple role-name check, exactly like
// handleFinanceDaycareEntryContract above.
async function handleFinanceDaycareBulkWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, user.role);
  const canEnterDaycare = ['finance', 'budget', 'compensation'].some((item) => rolePerms[item] === 'edit');
  if (!canEnterDaycare) return json({ error: 'Access denied' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await bulkRecordDaycareEntries(db, body?.rows);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_bulk_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind('', '', email).run().catch(() => {});

  return json({ ...result, savedBy: user.username });
}

// ── Daycare-from-Church-Budget import write, relayed from Finance's own Daycare Report
// (Actuals) UI ───────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceDaycareBulkWriteContract above: the same looser "any of
// finance/budget/compensation edit" blanket-ACCESS_GATE re-derivation, matching the legacy
// finance/daycare/church-budget-import route's own gate exactly (no role check beyond that
// blanket wrapper), since this calls the identical importDaycareFromChurchBudget() helper that
// route uses (src/api-finance.js).
async function handleFinanceDaycareChurchBudgetImportWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, user.role);
  const canEnterDaycare = ['finance', 'budget', 'compensation'].some((item) => rolePerms[item] === 'edit');
  if (!canEnterDaycare) return json({ error: 'Access denied' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await importDaycareFromChurchBudget(db, parseInt(body?.year, 10));
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_church_budget_import_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind('', '', email).run().catch(() => {});

  return json({ ...result, savedBy: user.username });
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
