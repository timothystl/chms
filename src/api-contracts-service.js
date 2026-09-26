// ── Cross-Worker server-to-server contract endpoints ────────────────────────
// Called from the Finance application (staging today; production once Finance
// has its own Worker), not from a browser or a staff session directly. Every
// route here requires the X-Contract-Key header matching env.FINANCE_CONTRACT_API_KEY
// -- the same shared-secret pattern already used for the website's intake and
// Christmas Market calls into this Worker (see api-intake.js, api-scheduler.js).
// This stays a distinct, narrower grant from the human role/permission matrix in
// api-chms.js: it reaches nothing but the contracts named below.
import { json, timingSafeEqual } from './auth.js';
import { financeStorageDb } from './finance-storage.js';
import { respondWithFinancePropertyPolicyV1 } from './api-property-policy-contracts.js';
import { respondWithConnectGivingSummaryV1, respondWithFinanceDataStatusV1, respondWithFinanceCashRunwayV1, respondWithFinanceChartOfAccountsV1, respondWithFinanceBudgetV1, respondWithFinanceChurchReportV1, respondWithFinanceChurchReportTrendV1, respondWithFinanceBalanceSheetV1, respondWithFinanceBalanceSheetTrendV1, respondWithFinanceDaycareReportV1, respondWithFinanceDaycareEntriesV1, respondWithFinancePropertyValuationV1, respondWithFinanceCompensationV1, respondWithFinancePropertyOperatingV1, respondWithFinancePropertyReservesV1, respondWithFinancePropertyLedgersV1, respondWithFinancePropertyForecastV1 } from './api-contracts.js';
import { verifyAccessJwt } from './access-jwt.js';
import { getRolePermissions, permissionsForRole } from './api-utils.js';
import { recordQuickGivingEntry } from './api-giving.js';
import { handleGivingBatchContracts } from './api-giving-batch-contracts.js';
import { handleGivingAnalyticsContracts } from './api-giving-analytics-contracts.js';
import { respondWithFinancePlanningBasisV1 } from './api-planning-contracts.js';
import { respondWithFinanceAccessRolesV1 } from './api-access-contracts.js';
import { respondWithFinanceBudgetBuilderV1 } from './api-budget-builder-contracts.js';
import { respondWithFinanceClassificationV1 } from './api-classification-contracts.js';
import {
  applyBudgetPlanOverrideRows, applySalaryPlannerWrite, resolveSalaryPlannerState,
  generateBudgetPlanRows, generateAllBudgetPlan, commitBudgetPlan, deleteBudgetPlanRow,
  applyChurchActualOverride, recordDaycareEntry, applyBoardCategoryMerge, upsertPropertyMonthly,
  addPropertyRepair, upsertPropertyDistribution, upsertPropertyReserveMonthly,
  upsertPropertyReserveDisbursement, addPropertyCapitalLedgerEntry,
  saveRevenueStreamMap, saveFlowExpenseMap, saveCashPolicy, saveDaycareAllocationConfig,
  applyDaycareBudgetOverride, bulkRecordDaycareEntries, importDaycareFromChurchBudget,
  editDaycareEntry, removeDaycareEntry, syncDaycareFromApi, syncDaycareRoomsFromApi,
  saveBaseProjectionOverrides, savePurposeTags,
  importChurchBudgetXlsx, previewChurchBudgetXlsx, commitChurchBudgetXlsxRows,
  importChurchBalancesXlsx, previewChurchBalancesXlsx, commitChurchBalancesXlsxRows,
  importChurchMonthlyXlsx, importChurchActivityXlsx, importChurchBudgetMultiYearXlsx, importChurchBalancesMultiYearXlsx,
  previewChurchMultiPeriodXlsx, commitChurchMultiPeriodXlsxRows,
  removePropertyMonthlyEntry, removePropertyDistribution, removePropertyReserveMonthly,
  removePropertyReserveDisbursement, removePropertyCapitalLedgerEntry, removePropertyRepair,
  savePropertyMeta, importPropertyBudgetRows, importPropertyMonthlyCsv,
} from './api-finance.js';

export async function handleContractsServiceApi(req, env, path) {
  const expectedKey = env.FINANCE_CONTRACT_API_KEY || '';
  if (!expectedKey) return json({ error: 'Contract service not configured' }, 503);
  const key = req.headers.get('X-Contract-Key') || '';
  if (!(await timingSafeEqual(key, expectedKey))) return json({ error: 'Unauthorized' }, 401);
  if (env.FINANCE_STORAGE_MODE === 'copying' && path.startsWith('/api/contracts/finance-') && !['GET','HEAD'].includes(req.method)) return json({error:'Accounting maintenance: please retry shortly.'},503);
  env = { ...env, DB: financeStorageDb(env) };

  // Gift Entry batches (Finance v3): donor-level, identity-checked -- see api-giving-batch-contracts.js.
  if (path.startsWith('/api/contracts/giving-batch-')) {
    const batchResponse = await handleGivingBatchContracts(req, env, path);
    if (batchResponse) return batchResponse;
  }

  // Giving analytics (Finance v3): aggregate for any Giving access including council's anonymous
  // one; named statements/nudges need Giving view -- see api-giving-analytics-contracts.js.
  if (path.startsWith('/api/contracts/giving-analytics-') || path === '/api/contracts/giving-followup-write-v1') {
    const analyticsResponse = await handleGivingAnalyticsContracts(req, env, path);
    if (analyticsResponse) return analyticsResponse;
  }

  if (path === '/api/contracts/connect-giving-summary-v1' && req.method === 'GET') {
    return respondWithConnectGivingSummaryV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-data-status-v1' && req.method === 'GET') {
    return respondWithFinanceDataStatusV1(env.DB);
  }

  if (path === '/api/contracts/finance-classification-v1' && req.method === 'GET') {
    return respondWithFinanceClassificationV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-cash-runway-v1' && req.method === 'GET') {
    return respondWithFinanceCashRunwayV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-chart-of-accounts-v1' && req.method === 'GET') {
    return respondWithFinanceChartOfAccountsV1(env.DB);
  }

  // Access & roles (Finance v3): the role matrix and role holders, identity-checked.
  if (path === '/api/contracts/finance-access-roles-v1' && req.method === 'GET') {
    return respondWithFinanceAccessRolesV1(req, env);
  }

  // Budget builder (Finance v3): each plan line beside its prior actual, base budget and projection.
  if (path === '/api/contracts/finance-budget-builder-v1' && req.method === 'GET') {
    return respondWithFinanceBudgetBuilderV1(new URL(req.url), env.DB);
  }

  // Planning scenarios and forecast (Finance v3): the budget plan sorted into scenario groups.
  if (path === '/api/contracts/finance-planning-basis-v1' && req.method === 'GET') {
    return respondWithFinancePlanningBasisV1(new URL(req.url), env.DB);
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

  if (path === '/api/contracts/finance-daycare-entries-v1' && req.method === 'GET') {
    return respondWithFinanceDaycareEntriesV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-valuation-v1' && req.method === 'GET') {
    return respondWithFinancePropertyValuationV1(new URL(req.url), env.DB);
  }

  if (path === '/api/contracts/finance-property-policy-v1' && req.method === 'GET') {
    return respondWithFinancePropertyPolicyV1(new URL(req.url), env.DB);
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

  if (path === '/api/contracts/finance-property-monthly-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyMonthlyRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-distribution-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyDistributionRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-reserve-monthly-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyReserveMonthlyRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-reserve-disbursement-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyReserveDisbursementRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-capital-ledger-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyCapitalLedgerRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-repair-remove-v1' && req.method === 'POST') {
    return handleFinancePropertyRepairRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-property-meta-write-v1' && req.method === 'POST') {
    return handleFinancePropertyMetaWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-property-budget-import-v1' && req.method === 'POST') {
    return handleFinancePropertyBudgetImportContract(req, env);
  }

  if (path === '/api/contracts/finance-property-monthly-import-csv-v1' && req.method === 'POST') {
    return handleFinancePropertyMonthlyImportCsvContract(req, env);
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

  if (path === '/api/contracts/finance-daycare-entry-edit-v1' && req.method === 'POST') {
    return handleFinanceDaycareEntryEditContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-entry-remove-v1' && req.method === 'POST') {
    return handleFinanceDaycareEntryRemoveContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-sync-v1' && req.method === 'POST') {
    return handleFinanceDaycareSyncContract(req, env);
  }

  if (path === '/api/contracts/finance-daycare-rooms-sync-v1' && req.method === 'POST') {
    return handleFinanceDaycareRoomsSyncContract(req, env);
  }

  if (path === '/api/contracts/finance-base-projection-write-v1' && req.method === 'POST') {
    return handleFinanceBaseProjectionWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-purpose-tags-write-v1' && req.method === 'POST') {
    return handleFinancePurposeTagsWriteContract(req, env);
  }

  if (path === '/api/contracts/finance-church-budget-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchBudgetXlsxImportContract(req, env);
  }

  if (path === '/api/contracts/finance-church-budget-xlsx-preview-v1' && req.method === 'POST') {
    return handleFinanceChurchBudgetXlsxPreviewContract(req, env);
  }

  if (path === '/api/contracts/finance-church-budget-xlsx-commit-v1' && req.method === 'POST') {
    return handleFinanceChurchBudgetXlsxCommitContract(req, env);
  }

  if (path === '/api/contracts/finance-church-balances-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchBalancesXlsxImportContract(req, env);
  }

  if (path === '/api/contracts/finance-church-balances-xlsx-preview-v1' && req.method === 'POST') {
    return handleFinanceChurchBalancesXlsxPreviewContract(req, env);
  }

  if (path === '/api/contracts/finance-church-balances-xlsx-commit-v1' && req.method === 'POST') {
    return handleFinanceChurchBalancesXlsxCommitContract(req, env);
  }

  if (path === '/api/contracts/finance-church-monthly-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchMonthlyXlsxImportContract(req, env);
  }

  if (path === '/api/contracts/finance-church-activity-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchActivityXlsxImportContract(req, env);
  }

  if (path === '/api/contracts/finance-church-budget-multi-year-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchBudgetMultiYearXlsxImportContract(req, env);
  }

  if (path === '/api/contracts/finance-church-balances-multi-year-xlsx-import-v1' && req.method === 'POST') {
    return handleFinanceChurchBalancesMultiYearXlsxImportContract(req, env);
  }

  const multiPeriodPreviewKind = {
    '/api/contracts/finance-church-monthly-xlsx-preview-v1': 'monthly',
    '/api/contracts/finance-church-activity-xlsx-preview-v1': 'activity',
    '/api/contracts/finance-church-budget-multi-year-xlsx-preview-v1': 'budget',
    '/api/contracts/finance-church-balances-multi-year-xlsx-preview-v1': 'balances',
  }[path];
  if (multiPeriodPreviewKind && req.method === 'POST') return handleFinanceMultiPeriodXlsxPreviewContract(req, env, multiPeriodPreviewKind);

  const multiPeriodCommitKind = {
    '/api/contracts/finance-church-monthly-xlsx-commit-v1': 'monthly',
    '/api/contracts/finance-church-activity-xlsx-commit-v1': 'activity',
    '/api/contracts/finance-church-budget-multi-year-xlsx-commit-v1': 'budget',
    '/api/contracts/finance-church-balances-multi-year-xlsx-commit-v1': 'balances',
  }[path];
  if (multiPeriodCommitKind && req.method === 'POST') return handleFinanceMultiPeriodXlsxCommitContract(req, env, multiPeriodCommitKind);

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
// verification as handleGivingQuickEntryContract above. The verified role and normalized
// identity let Finance enforce section access and isolate private drafts without trusting
// unsigned claims or copying the Connect user directory.
async function handleStaffRoleContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const user = await env.DB.prepare(
    `SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`
  ).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  const permissions = permissionsForRole(await getRolePermissions(env.DB), user.role);
  // username keys a council member's private raise-plan overlay, which Finance now writes itself
  // (apps/finance/compensation-council-overlay.js).
  return json({ role: user.role, identity: email, username: user.username || '', permissions });
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

  if (user.role === 'council') {
    const permissions = permissionsForRole(await getRolePermissions(db), user.role);
    if (permissions.budget !== 'edit') {
      return json({ error: 'Access denied: budget permission required' }, 403);
    }
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

// ── Commercial Property monthly-entry removal, relayed from Finance's own Operating results UI ──
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/monthly/:period's own DELETE gate exactly, since this calls the
// identical removePropertyMonthlyEntry() helper that route uses (src/api-finance.js). The property
// key is hardcoded to 'ivanhoe' here, never taken from the request body, same reasoning as the
// other property relays. Removing a period that was never recorded is a silent no-op, matching the
// legacy route's own behavior exactly (its DELETE statement's affected-row count is never checked).
async function handleFinancePropertyMonthlyRemoveContract(req, env) {
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
  const result = await removePropertyMonthlyEntry(db, 'ivanhoe', String(body?.period || ''));
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property distribution removal, relayed from Finance's own Distributions UI ──────
// Same shape as handleFinancePropertyMonthlyRemoveContract above: admin only, matching
// finance/property/ivanhoe/distributions/:period's own DELETE gate exactly, since this calls the
// identical removePropertyDistribution() helper that route uses (src/api-finance.js).
async function handleFinancePropertyDistributionRemoveContract(req, env) {
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
  const result = await removePropertyDistribution(db, 'ivanhoe', String(body?.period || ''));
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property named-reserve monthly-schedule removal, relayed from Finance's own
// Reserve & distribution UI ─────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyReserveMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/reserves/:reserveKey/monthly/:report_month's own DELETE gate exactly,
// since this calls the identical removePropertyReserveMonthly() helper that route uses
// (src/api-finance.js). The reserve key comes from the request body (no URL path segment on a
// contract relay) and is re-validated by the shared helper, same reasoning as the write relay.
async function handleFinancePropertyReserveMonthlyRemoveContract(req, env) {
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
  const result = await removePropertyReserveMonthly(db, 'ivanhoe', String(body?.reserve_key || ''), String(body?.report_month || ''));
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property named-reserve disbursement removal, relayed from Finance's own Reserve &
// distribution UI ───────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyReserveDisbursementWriteContract above: admin only, matching
// finance/property/ivanhoe/reserves/:reserveKey/disbursements/:period_key's own DELETE gate
// exactly, since this calls the identical removePropertyReserveDisbursement() helper that route
// uses (src/api-finance.js). The legacy route URL-decodes its period_key path segment before
// deleting; the relay's period_key is an ordinary JSON string field, already decoded.
async function handleFinancePropertyReserveDisbursementRemoveContract(req, env) {
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
  const result = await removePropertyReserveDisbursement(db, 'ivanhoe', String(body?.reserve_key || ''), body?.period_key);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property capital-improvements ledger removal, relayed from Finance's own Capital
// improvements UI ───────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyCapitalLedgerWriteContract above: admin only, matching
// finance/property/ivanhoe/capital-ledger/:id's own DELETE gate exactly, since this calls the
// identical removePropertyCapitalLedgerEntry() helper that route uses (src/api-finance.js).
async function handleFinancePropertyCapitalLedgerRemoveContract(req, env) {
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
  const result = await removePropertyCapitalLedgerEntry(db, 'ivanhoe', body?.id);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property repairs & maintenance log removal, relayed from Finance's own Work
// orders UI ─────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyRepairWriteContract above: admin only, matching
// finance/property/ivanhoe/repairs/:id's own DELETE gate exactly, since this calls the identical
// removePropertyRepair() helper that route uses (src/api-finance.js).
async function handleFinancePropertyRepairRemoveContract(req, env) {
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
  const result = await removePropertyRepair(db, 'ivanhoe', body?.id);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property meta write, relayed from Finance's own Property Overview UI ────────────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/meta's own PATCH gate exactly, since this calls the identical
// savePropertyMeta() helper that route uses (src/api-finance.js). Same per-section MERGE
// (property/valuation/loan/reserves/capital) as the legacy route, never a whole-blob replace.
async function handleFinancePropertyMetaWriteContract(req, env) {
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
  const result = await savePropertyMeta(db, 'ivanhoe', body);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property AHRA "Budget Detail" (.xlsx) import, relayed from Finance's own Run-rate
// forecast UI ───────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinanceChurchBudgetXlsxImportContract below: admin only, matching
// finance/property/ivanhoe/budget-import's own gate exactly, since this calls the identical
// importPropertyBudgetRows() helper (src/api-finance.js). The uploaded file travels as a base64
// string in the JSON body, decoded with the same decodeBase64XlsxUpload() helper the Church/
// Balance .xlsx import relays use, capped at the same 15 MB limit.
async function handleFinancePropertyBudgetImportContract(req, env) {
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
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importPropertyBudgetRows(db, 'ivanhoe', decoded.bytes.buffer);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Commercial Property monthly-financials CSV import, relayed from Finance's own Operating
// results UI ────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePropertyMonthlyWriteContract above: admin only, matching
// finance/property/ivanhoe/monthly-import-csv's own gate exactly, since this calls the identical
// importPropertyMonthlyCsv() helper (src/api-finance.js). Legacy parses `csv` as a plain pasted-in
// text field (not a file upload), so this relay carries it the same way -- a plain JSON string
// field, no base64/file-upload complexity needed.
async function handleFinancePropertyMonthlyImportCsvContract(req, env) {
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
  const result = await importPropertyMonthlyCsv(db, 'ivanhoe', body && body.csv, body && body.source_report);
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

// ── Base-year "FY{base} Projected" override write, relayed from Finance's own Budget builder UI ──
// Same shape as handleFinanceCashPolicyWriteContract above: admin only, matching
// finance/planning/base-projection's own gate exactly, since this calls the identical
// saveBaseProjectionOverrides() helper that route uses (src/api-finance.js).
async function handleFinanceBaseProjectionWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing the budget plan requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await saveBaseProjectionOverrides(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── Purpose-tags write, relayed from Finance's own Chart of Accounts UI ─────────────────────
// Same shape as handleFinanceBoardCategoriesWriteContract above: admin only, matching
// finance/planning/purpose-tags's own gate exactly, since this calls the identical
// savePurposeTags() helper that route uses (src/api-finance.js).
async function handleFinancePurposeTagsWriteContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: editing purpose tags requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await savePurposeTags(db, body);
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// Base64-decodes an uploaded .xlsx file carried as JSON (Finance's shell.js reads the browser's
// multipart upload, then re-encodes the bytes this way before relaying) -- same `atob` +
// byte-by-byte Uint8Array convention already used elsewhere in this codebase for a base64 payload
// (access-jwt.js's base64UrlToUint8Array, push-sender.js's b64uDecode, apps/finance's own
// xlsx-import-service.js's decodeBase64Xlsx), just plain base64 here rather than base64url since
// there's no URL to embed it in. Capped at 15 MB, matching every legacy Excel-upload route's own
// `file.size > 15 * 1024 * 1024` limit (see finance/church/import-preview and
// finance/church/balances/import-preview above) -- decoded length is the real byte count, so the
// cap is enforced against that, not the (slightly larger) base64 string length.
const MAX_XLSX_UPLOAD_BYTES = 15 * 1024 * 1024;
function decodeBase64XlsxUpload(fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) return { error: 'No file uploaded', status: 400 };
  let binary;
  try {
    binary = atob(fileBase64);
  } catch {
    return { error: 'Uploaded file is not valid base64', status: 400 };
  }
  if (binary.length > MAX_XLSX_UPLOAD_BYTES) return { error: 'File too large (max 15 MB)', status: 413 };
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes };
}

// ── Church Budget-vs-Actuals .xlsx import, relayed from Finance's own Church Report (Budget vs
// actual) UI ─────────────────────────────────────────────────────────────────────────────────
// Same shape as handleFinancePurposeTagsWriteContract above: admin only, matching
// finance/church/import(-preview)'s own gate exactly (importing/correcting church financial data
// is exactly the kind of action finance-church-actual-override-v1 already gates admin-only), since
// this calls the identical importChurchBudgetXlsx() helper (src/api-finance.js), which itself
// reuses the SAME parseXlsxAllSheets/findBudgetVsActualsSheet/parseBudgetVsActualsGrid/
// persistChurchEntriesImport primitives those legacy routes use -- just combined into one
// parse-and-persist call instead of legacy's separate preview-then-commit steps (see
// importChurchBudgetXlsx's own header comment for why that reduction is deliberate here).
async function handleFinanceChurchBudgetXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchBudgetXlsx(db, { fiscalYearHint: body && body.fiscal_year_hint, fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

async function authorizeChurchFinancialImport(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return { response: json({ error: 'Access verification not configured' }, 503) };
  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return { response: json({ error: 'Unauthorized' }, 401) };
  const user = await env.DB.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return { response: json({ error: 'No matching active Connect account for this identity' }, 403) };
  if (user.role !== 'admin') return { response: json({ error: 'Access denied: importing church financial data requires admin access' }, 403) };
  return { user };
}

async function handleFinanceChurchBudgetXlsxPreviewContract(req, env) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await previewChurchBudgetXlsx({ fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json(result);
}

async function handleFinanceChurchBudgetXlsxCommitContract(req, env) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await commitChurchBudgetXlsxRows(env.DB, {
    fiscalYear: body && body.fiscal_year,
    rows: body && body.rows,
  });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: auth.user.username });
}

// ── Balance Sheet .xlsx import, relayed from Finance's own Balance Sheet (Position) UI ─────────
// Same shape as handleFinanceChurchBudgetXlsxImportContract above: admin only, same reasoning,
// calling the identical importChurchBalancesXlsx() helper (src/api-finance.js).
async function handleFinanceChurchBalancesXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchBalancesXlsx(db, { fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

async function handleFinanceChurchBalancesXlsxPreviewContract(req, env) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await previewChurchBalancesXlsx({ fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json(result);
}

async function handleFinanceChurchBalancesXlsxCommitContract(req, env) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await commitChurchBalancesXlsxRows(env.DB, {
    fiscalYear: body && body.fiscal_year,
    asOfDate: body && body.as_of_date,
    rows: body && body.rows,
  });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: auth.user.username });
}


async function handleFinanceMultiPeriodXlsxPreviewContract(req, env, kind) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await previewChurchMultiPeriodXlsx(kind, { fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json(result);
}

async function handleFinanceMultiPeriodXlsxCommitContract(req, env, kind) {
  const auth = await authorizeChurchFinancialImport(req, env);
  if (auth.response) return auth.response;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const result = await commitChurchMultiPeriodXlsxRows(env.DB, kind, { years: body?.years, rows: body?.rows });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: auth.user.username });
}

// ── Monthly P&L .xlsx import, relayed from Finance's own Church Report UI ──────────────────────
// Unlike handleFinanceChurchBudgetXlsxImportContract/handleFinanceChurchBalancesXlsxImportContract
// above (both admin-only, matching finance/church/actual-override's own EXPLICIT `if (!isAdmin)`
// check), the legacy finance/church/monthly-import-preview/finance/church/monthly-import routes
// carry NO isAdmin check of their own -- verified directly against src/api-finance.js's source,
// not assumed. The only gate legacy applies is the blanket ACCESS_GATE wrapping the whole
// handler (src/api-chms.js's financeSegItems falls through to the default `['finance']` for this
// segment, since it is not one of financeSegItems' explicitly-listed special cases), so this
// re-derives that SAME single-item "finance edit" check via getRolePermissions/permissionsForRole
// rather than a simple role-name check -- the same real-permission-matrix pattern
// handleFinanceDaycareEntryContract/handleFinanceDaycareBulkWriteContract already established for
// legacy routes with no isAdmin check of their own (those use `finance`/`budget`/`compensation`
// together because financeSegItems explicitly lists their segment against all three; this
// segment isn't listed, so only the single `finance` item applies here, matching
// canEditItem('finance') exactly). Calls the identical importChurchMonthlyXlsx() helper
// (src/api-finance.js), which reuses the SAME findMonthlyPnLSheet/parseMonthlyPnLGrid/
// persistChurchEntriesMonthlyImport primitives legacy's own routes use.
async function handleFinanceChurchMonthlyXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  // Imports are admin-only in Finance (Andrew, 2026-09-25), matching the annual imports above.
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchMonthlyXlsx(db, { fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── "Statement of Activity" multi-year .xlsx import, relayed from Finance's own Church Report
// UI ─────────────────────────────────────────────────────────────────────────────────────────
// Same shape and same reasoning as handleFinanceChurchMonthlyXlsxImportContract above: the legacy
// finance/church/activity-import-preview/finance/church/activity-import routes carry no isAdmin
// check either -- only the same blanket single-item `finance` edit re-derivation applies. Calls
// the identical importChurchActivityXlsx() helper (src/api-finance.js), which reuses the SAME
// findActivityMultiYearSheet/parseActivityMultiYearGrid/persistChurchEntriesActivityImport
// primitives legacy's own routes use.
async function handleFinanceChurchActivityXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  // Imports are admin-only in Finance (Andrew, 2026-09-25), matching the annual imports above.
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchActivityXlsx(db, { fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── "Budget by Year" multi-year .xlsx import, relayed from Finance's own Church Report UI ──────
// Same shape and same reasoning as handleFinanceChurchMonthlyXlsxImportContract above: the legacy
// finance/church/budget-multi-year-import-preview/finance/church/budget-multi-year-import routes
// carry no isAdmin check either -- only the same blanket single-item `finance` edit re-derivation
// applies. Calls the identical importChurchBudgetMultiYearXlsx() helper (src/api-finance.js),
// which reuses the SAME findBudgetMultiYearSheet/parseBudgetMultiYearGrid/
// persistChurchEntriesBudgetMultiYearImport primitives legacy's own routes use.
async function handleFinanceChurchBudgetMultiYearXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  // Imports are admin-only in Finance (Andrew, 2026-09-25), matching the annual imports above.
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchBudgetMultiYearXlsx(db, { fileBytes: decoded.bytes });
  if (result.error) return json({ error: result.error }, result.status || 400);
  return json({ ...result, savedBy: user.username });
}

// ── "Statement of Financial Position" multi-year .xlsx import, relayed from Finance's own
// Balance Sheet UI ───────────────────────────────────────────────────────────────────────────
// Same shape and same reasoning as handleFinanceChurchMonthlyXlsxImportContract above: the legacy
// finance/church/balances/multi-year-import-preview/finance/church/balances/multi-year-import
// routes carry no isAdmin check either -- only the same blanket single-item `finance` edit
// re-derivation applies. Calls the identical importChurchBalancesMultiYearXlsx() helper
// (src/api-finance.js), which reuses the SAME findFinancialPositionMultiYearSheet/
// parseFinancialPositionMultiYearGrid/persistChurchBalancesMultiYearImport primitives legacy's
// own routes use.
async function handleFinanceChurchBalancesMultiYearXlsxImportContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);

  // Imports are admin-only in Finance (Andrew, 2026-09-25), matching the annual imports above.
  if (user.role !== 'admin') return json({ error: 'Access denied: importing church financial data requires admin access' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const decoded = decodeBase64XlsxUpload(body && body.file_base64);
  if (decoded.error) return json({ error: decoded.error }, decoded.status || 400);
  const result = await importChurchBalancesMultiYearXlsx(db, { fileBytes: decoded.bytes });
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

  // Imports are admin-only in Finance (Andrew, 2026-09-25).
  if (user.role !== 'admin') return json({ error: 'Access denied: importing daycare budget data requires admin access' }, 403);

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

// ── Daycare entry edit (partial update), relayed from Finance's own Daycare Report UI ──────────
// Same shape as handleFinanceDaycareEntryContract above: the same looser "any of
// finance/budget/compensation edit" blanket-ACCESS_GATE re-derivation, matching the legacy
// finance/daycare/:id PUT route's own gate exactly (no role check beyond that blanket wrapper),
// since this calls the identical editDaycareEntry() helper that route uses (src/api-finance.js).
async function handleFinanceDaycareEntryEditContract(req, env) {
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
  const result = await editDaycareEntry(db, body?.id, body);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_entry_edit_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind(String(body?.id ?? ''), '', email).run().catch(() => {});

  return json({ ...result, savedBy: user.username });
}

// ── Daycare entry removal, relayed from Finance's own Daycare Report UI ────────────────────────
// Same shape as handleFinanceDaycareEntryEditContract above: the same looser "any of
// finance/budget/compensation edit" blanket-ACCESS_GATE re-derivation, matching the legacy
// finance/daycare/:id DELETE route's own gate exactly (no role check beyond that blanket
// wrapper), since this calls the identical removeDaycareEntry() helper that route uses
// (src/api-finance.js). Removing an already-absent id is a silent no-op, matching the legacy
// DELETE statement's own unchecked affected-row count.
async function handleFinanceDaycareEntryRemoveContract(req, env) {
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
  const result = await removeDaycareEntry(db, body?.id);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_entry_remove_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind(String(body?.id ?? ''), '', email).run().catch(() => {});

  return json({ ...result, savedBy: user.username });
}

// ── Daycare-app money sync, relayed from Finance's own Daycare Report UI ───────────────────────
// Same shape as handleFinanceDaycareEntryEditContract above: the same looser "any of
// finance/budget/compensation edit" blanket-ACCESS_GATE re-derivation, matching the legacy
// finance/daycare/sync route's own gate exactly (no role check beyond that blanket wrapper), since
// this calls the identical syncDaycareFromApi() helper that route uses (src/api-finance.js). If
// the daycare app's own env vars (DAYCARE_API_URL/DAYCARE_API_KEY) are not configured HERE on
// Connect's side, syncDaycareFromApi returns the exact same "not configured" error the legacy
// route itself already returns -- this is surfaced through as a plain 503, not swallowed or
// reworded into a relay-specific failure.
async function handleFinanceDaycareSyncContract(req, env) {
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

  const result = await syncDaycareFromApi(env, db);
  if (result.error) return json({ error: result.error }, result.status || 400);

  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('daycare_sync_via_finance','finance_daycare_entries',?,?,'entered_by','',?)`
  ).bind('', '', email).run().catch(() => {});

  return json({ ...result, savedBy: user.username });
}

// ── Daycare-app room sync, relayed from Finance's own Daycare Report UI ────────────────────────
// Same shape as handleFinanceDaycareAllocationConfigWriteContract above: admin only, matching
// finance/daycare/rooms/sync's own gate exactly, since this calls the identical
// syncDaycareRoomsFromApi() helper that route uses (src/api-finance.js). Same "not configured"
// pass-through as handleFinanceDaycareSyncContract above.
async function handleFinanceDaycareRoomsSyncContract(req, env) {
  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return json({ error: 'Access verification not configured' }, 503);

  const email = await verifyAccessJwt(req.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return json({ error: 'Unauthorized' }, 401);

  const db = env.DB;
  const user = await db.prepare(`SELECT username, role FROM app_users WHERE LOWER(email)=? AND active=1 LIMIT 1`).bind(email).first();
  if (!user) return json({ error: 'No matching active Connect account for this identity' }, 403);
  if (user.role !== 'admin') return json({ error: 'Access denied: syncing daycare room data requires admin access' }, 403);

  const result = await syncDaycareRoomsFromApi(env, db);
  if (result.error) return json({ error: result.error }, result.status || 400);
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

  if (user.role === 'council') {
    const permissions = permissionsForRole(await getRolePermissions(db), user.role);
    if (permissions.compensation !== 'edit') {
      return json({ error: 'Access denied: compensation permission required' }, 403);
    }
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

  if (user.role === 'council') {
    const permissions = permissionsForRole(await getRolePermissions(db), user.role);
    if (!['view', 'edit'].includes(permissions.compensation)) {
      return json({ error: 'Access denied: compensation permission required' }, 403);
    }
  }

  const data = await resolveSalaryPlannerState(db, user.role, user.username);
  return json({ data });
}
