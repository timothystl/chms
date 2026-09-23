import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';
import givingFixture from '../../contracts/examples/giving-summary-v1.synthetic.json';
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';
import { reconcileSyntheticGivingDelivery } from './connect-giving-transport.js';
import { fetchLiveConnectGivingSummary, defaultLiveGivingPeriod, postConnectGivingQuickEntry } from './connect-giving-client.js';
import { fetchVerifiedRole, roleCanAccessSection } from './connect-role-client.js';
import { callPayrollProxy } from './payroll-proxy-client.js';
import {
  buildPayrollSectionBundle, renderPayrollSection, saveAllHours, approvePeriod,
  saveStaffFromForm, deactivateStaffFromForm, buildCsvForPeriod, resolvePayrollPeriod, loadPayrollWorkspace,
  approverEmailFromJwt, emailReport,
} from './payroll-section.js';
import { missingHours as payrollMissingHours } from './payroll-calc.js';
import { decodeJwtClaimsUnsafe } from './jwt-decode-unsafe.js';
import { buildSummaryV1, FINANCE_SUMMARY_CONTRACT, readSyntheticSummary } from './summary-service.js';
import { isMethodAllowedForRoute, resolveFinanceRoute } from './route-manifest.js';
import { FINANCE_PARITY_SECTIONS, resolveFinanceSection, resolveFinancePage, groupFinanceSections } from './parity-manifest.js';
import { buildFinancialHealthView, FINANCE_HEALTH_DECISIONS } from './health-view-model.js';
import { buildChurchReportView, buildLiveChurchReportView, readSyntheticChurchReport, resolveChurchReport, resolveChurchTrend } from './church-report-service.js';
import {
  postConnectFinanceChurchActualOverride, postConnectChurchBudgetXlsxImport,
  postConnectChurchMonthlyXlsxImport, postConnectChurchActivityXlsxImport, postConnectChurchBudgetMultiYearXlsxImport,
} from './finance-church-report-client.js';
import {
  postConnectFinanceDaycareEntry, postConnectDaycareAllocationConfigWrite, postConnectDaycareBudgetOverrideWrite,
  postConnectDaycareBulkWrite, postConnectDaycareChurchBudgetImportWrite,
  postConnectDaycareEntryEdit, postConnectDaycareEntryRemove, postConnectDaycareSync, postConnectDaycareRoomsSync,
} from './finance-daycare-client.js';
import {
  postConnectBoardCategoriesWrite, postConnectPurposeTagsWrite, postConnectRevenueStreamsWrite, postConnectFlowExpenseMapWrite,
  postConnectCashPolicyWrite,
} from './finance-chart-of-accounts-client.js';
import {
  postConnectPropertyMonthlyWrite, postConnectPropertyMonthlyRemove, postConnectPropertyMonthlyImportCsvWrite,
} from './finance-property-operating-client.js';
import {
  postConnectPropertyRepairWrite, postConnectPropertyRepairRemove, postConnectPropertyCapitalLedgerWrite,
  postConnectPropertyCapitalLedgerRemove, postConnectPropertyMetaWrite, postConnectPropertyBudgetImportWrite,
} from './finance-property-ledgers-client.js';
import {
  postConnectPropertyDistributionWrite, postConnectPropertyDistributionRemove, postConnectPropertyReserveMonthlyWrite,
  postConnectPropertyReserveMonthlyRemove, postConnectPropertyReserveDisbursementWrite,
  postConnectPropertyReserveDisbursementRemove,
} from './finance-property-reserves-client.js';
import { resolveBalanceSheet, resolveBalanceSheetTrend } from './balance-sheet-service.js';
import { postConnectChurchBalancesXlsxImport, postConnectChurchBalancesMultiYearXlsxImport } from './finance-balance-sheet-client.js';
import { buildDaycareReportView, readSyntheticDaycareReport, resolveDaycareReport } from './daycare-report-service.js';
import {
  buildPropertyReportView, readSyntheticPropertyReport, readSyntheticPropertyReserves, readSyntheticPropertyLedgers,
  resolvePropertyValuation, resolvePropertyReport, resolvePropertyReserves, resolvePropertyLedgers,
} from './property-report-service.js';
import { resolveBudgetReport } from './budget-report-service.js';
import {
  postConnectFinanceBudgetWrite, postConnectFinanceBudgetGenerate, postConnectFinanceBudgetGenerateAll,
  postConnectFinanceBudgetCommit, postConnectFinanceBudgetRemove, postConnectBaseProjectionWrite,
} from './finance-budget-client.js';
import { isBudgetPlanWritesEnabled, validateBudgetPlanRows, saveBudgetPlanRows } from './budget-plan-write-service.js';
import { fetchConnectSalaryPlannerState, postConnectFinanceCompensationWrite } from './finance-compensation-client.js';
import { resolveAccountsReport } from './accounts-report-service.js';
import { buildDataStatusView, resolveDataStatus } from './data-status-service.js';
import { readSyntheticCompensationReport, resolveCompensationReport, COMPENSATION_LIVE_ALLOWED_ROLES } from './compensation-report-service.js';
import { isCompensationPlanWriteEnabled, applyCompensationWorkerPlanWrite } from './compensation-plan-write-service.js';
import { saveRaisePlanOptions, RAISE_PLAN_WRITE_ROLES } from './compensation-raise-plan-service.js';
import { saveCouncilDraft } from './compensation-council-draft-service.js';
import {
  isPropertyLedgerWritesEnabled, recordPropertyReserveMonthly, recordPropertyReserveDisbursement,
  recordPropertyDistribution, recordPropertyCapitalLedgerEntry, PropertyLedgerValidationError,
} from './property-ledger-write-service.js';
import { buildCashRunwayView, readSyntheticCashRunway } from './cash-runway-service.js';
import { buildFinancialMixView, buildLiveFinancialMixView } from './financial-mix-service.js';
import { buildEntityOverview } from './entity-overview-service.js';
import { buildOperatingBridge } from './operating-bridge-service.js';
import { readSyntheticPropertyForecast, resolvePropertyForecast } from './property-forecast-service.js';
import { readSyntheticCompensationBenchmarks } from './compensation-benchmark-service.js';
import { readSyntheticCompensationBenefits } from './compensation-benefits-service.js';
import { readSyntheticPropertyDistributions } from './property-distributions-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderDataUnavailablePage, renderUnavailableCard, renderUnavailablePage } from './render-helpers.js';
import { isSyntheticUnavailable, safeSyntheticRead } from './synthetic-read-guard.js';
import { renderChurchPage } from './church-pages.js';
import { renderBalancePage } from './balance-pages.js';
import { renderDaycarePage } from './daycare-pages.js';
import { renderPropertyPage } from './property-pages.js';
import { renderCompensationPage } from './compensation-pages.js';
import { renderPlanningPage } from './planning-pages.js';
import { renderAccountsPage } from './accounts-pages.js';
import { renderChartsPage, renderFinancialMixRows } from './charts-pages.js';
import { renderGiftEntryPage } from './gift-entry-pages.js';
import { renderQuickbooksPage } from './quickbooks-pages.js';
import { renderPacketPage } from './packet-pages.js';
import {
  runChurchEntriesCsvImport, runChurchBalancesCsvImport, runDaycareEntriesCsvImport, runPropertyBudgetMonthlyCsvImport,
} from './csv-import-service.js';
import { runChurchEntriesXlsxImport, runChurchBalancesXlsxImport } from './xlsx-import-service.js';

const PRODUCT = 'finance';
const SUMMARY_CONTRACT = FINANCE_SUMMARY_CONTRACT;
const GIVING_CONTRACT = 'connect.giving-summary.v1';
const GIVING_TRANSPORT_EVIDENCE_CONTRACT = 'finance.connect-giving-transport-evidence.v1';
const SYNTHETIC_GIVING = acceptConnectGivingSummaryV1(givingFixture);

// Tries the real connect.giving-summary.v1 endpoint (see connect-giving-client.js); falls back
// to the committed synthetic fixture whenever the live call isn't configured yet or fails for
// any reason. Never throws, and the caller always gets a valid, already-accepted contract object
// either way — only `source` tells the two apart.
async function resolveGivingSummary(env) {
  const result = await fetchLiveConnectGivingSummary(env, defaultLiveGivingPeriod());
  if (result.ok) return { giving: result.summary, source: 'live' };
  return { giving: SYNTHETIC_GIVING, source: 'synthetic-fallback', fallbackReason: result.reason };
}
const SYNTHETIC_DELIVERY_ID = 'synthetic-giving-2026-01-v1';
const SYNTHETIC_GIVING_TRANSPORT = Object.freeze({
  contract: GIVING_TRANSPORT_EVIDENCE_CONTRACT,
  dataClassification: 'synthetic',
  scenario: reconcileSyntheticGivingDelivery({
    deliveryId: SYNTHETIC_DELIVERY_ID,
    payload: givingFixture,
    attemptedOutcomes: ['temporary_failure', 'delivered'],
  }),
  duplicateReplay: reconcileSyntheticGivingDelivery({
    deliveryId: SYNTHETIC_DELIVERY_ID,
    payload: givingFixture,
    attemptedOutcomes: ['delivered'],
    processedDeliveryIds: [SYNTHETIC_DELIVERY_ID],
  }),
});

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  // form-action is 'self', not 'none', for exactly one reason: the Giving quick-entry form
  // (see the 'giving' section below) has to submit somewhere. It still can't target any other
  // origin. Nothing else here changed -- still no script-src of any kind, so no inline or
  // external JS can run on this page regardless.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
});

function response(body, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(body, { ...init, headers });
}

function releaseMetadata(env) {
  return {
    product: PRODUCT,
    environment: env.ENVIRONMENT || 'unknown',
    version: FINANCE_VERSION,
    releaseChannel: FINANCE_RELEASE_CHANNEL,
    releaseSha: env.RELEASE_SHA || 'local',
  };
}

// Maps a postConnectGivingQuickEntry() failure (or Connect's own refusal message) to something
// a bookkeeper can act on, without leaking wire-level detail (network error text, status codes).
function describeGivingEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Giving entry is not connected yet. Nothing was recorded.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was recorded — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as recorded.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The gift was not recorded.';
  }
}

// Same shape as describeGivingEntryError above, for postConnectFinanceBudgetWrite() failures.
function describeBudgetEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Budget Plan editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The Budget Plan edit was not saved.';
  }
}

// Same shape as describeBudgetEntryError above, for the admin-only generate/generate-all/commit/
// remove-a-category plan operations (postConnectFinanceBudgetGenerate[All]/Commit/Remove) --
// `verb` names the failed operation in the default/not_configured messages so the banner reads
// naturally for whichever of the four just ran.
function describeBudgetPlanOpError(reason, message, verb) {
  switch (reason) {
    case 'not_configured': return `Budget Plan ${verb} is not connected yet. Nothing changed.`;
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing changed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed.';
    case 'http_error': return message ? String(message) : 'Connect refused the request.';
    default: return `The ${verb} did not complete.`;
  }
}
const BUDGET_PLAN_OP_VERBS = { generate: 'generation', 'generate-all': 'generation', commit: 'commit', remove: 'removal' };

// Mirrors REVENUE_STREAMS/BOARD_EXPENSE_KEYS (src/api-finance.js) -- only used here to decide
// which of applyBoardCategoryMerge's two maps (revenue vs expense) a submitted board-category key
// belongs in, since the form (accounts-pages.js) offers one combined picker. Connect's own
// applyBoardCategoryMerge re-validates the key against its own real allowlist regardless, so a
// drift here could only ever misfile a save into the wrong map (a visible, immediately obvious
// mistake), never let an invalid key through.
const BOARD_REVENUE_KEYS = ['donor', 'earned', 'passive', 'restricted'];
const BOARD_EXPENSE_KEYS_LOCAL = ['mdo', 'salaries', 'benefits', 'worship', 'property', 'education', 'youth_family', 'district_synod', 'programs'];

// Same shape as describeBudgetEntryError above, for postConnectFinanceChurchActualOverride() failures.
function describeChurchOverrideError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Church Report corrections are not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the correction.';
    default: return 'The correction was not saved.';
  }
}

// 15 MB matches legacy's own `file.size > 15 * 1024 * 1024` guard on finance/church/import-preview
// and finance/church/balances/import-preview (src/api-finance.js) -- checked client-side here (the
// browser's own File.size, before any bytes are read) so an oversized upload never reaches the
// relay call at all, same as legacy rejecting it before ever calling parseXlsxAllSheets.
const MAX_XLSX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Encodes the uploaded file's bytes for the base64-in-JSON-body relay convention apps/finance's own
// xlsx-import-service.js already established (see decodeBase64Xlsx there) -- the reverse of that
// same byte-by-byte convention this codebase already uses elsewhere for base64 (access-jwt.js's
// base64UrlToUint8Array, push-sender.js's b64uDecode).
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Same shape as describeChurchOverrideError above, for postConnectChurchBudgetXlsxImport() /
// postConnectChurchBalancesXlsxImport() failures. `no_file`/`too_large` are shell.js's own
// client-side checks (before the relay call is even attempted, matching legacy's own
// `file.size > 15 * 1024 * 1024` guard), not a reason the relay call itself ever returns.
function describeChurchXlsxImportError(reason, message) {
  switch (reason) {
    case 'no_file': return 'No file was uploaded.';
    case 'too_large': return 'File too large (max 15 MB).';
    case 'not_configured': return 'Excel import is not connected yet. Nothing was imported.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was imported — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as imported.';
    case 'http_error': return message ? String(message) : 'Connect refused the import.';
    default: return 'The import did not complete.';
  }
}

// Same shape as describeChurchOverrideError above, for postConnectFinanceDaycareEntry() failures.
function describeDaycareEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare entry is not connected yet. Nothing was recorded.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was recorded — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as recorded.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The entry was not recorded.';
  }
}

// Same shape as describeBudgetPlanOpError above, for postConnectBaseProjectionWrite() failures.
function describeBaseProjectionEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Projected-column editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the correction.';
    default: return 'The correction was not saved.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectBoardCategoriesWrite() failures.
function describeBoardCategoryEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Chart of Accounts editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the assignment.';
    default: return 'The assignment was not saved.';
  }
}

// Same shape as describeBoardCategoryEntryError above, for postConnectPropertyMonthlyWrite() failures.
function describePropertyMonthlyEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The month was not saved.';
  }
}

// Same shape as describePropertyMonthlyEntryError above, for postConnectPropertyRepairWrite() failures.
function describePropertyRepairEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The entry was not saved.';
  }
}

// Same shape as describeBoardCategoryEntryError above, for postConnectPurposeTagsWrite() failures.
function describePurposeTagsEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Purpose-tag editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The purpose tags were not saved.';
  }
}

// Same shape as describePropertyRepairEntryError above, for postConnectPropertyDistributionWrite() failures.
function describePropertyDistributionEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The distribution was not saved.';
  }
}

// Same shape as describePropertyDistributionEntryError above, for postConnectPropertyReserveMonthlyWrite() failures.
function describePropertyReserveMonthlyEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The reserve entry was not saved.';
  }
}

// Same shape as describePropertyReserveMonthlyEntryError above, for postConnectPropertyReserveDisbursementWrite() failures.
function describePropertyReserveDisbursementEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The disbursement was not saved.';
  }
}

// Same shape as describePropertyReserveDisbursementEntryError above, for postConnectPropertyCapitalLedgerWrite() failures.
function describePropertyCapitalLedgerEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the entry.';
    default: return 'The entry was not saved.';
  }
}

// Same shape as describePropertyMonthlyEntryError above, for postConnectPropertyMonthlyRemove()
// failures. "Removed" rather than "saved" wording, matching describeBudgetPlanRemoveError-style
// wording used for the budget-plan-remove-v1 form.
function describePropertyMonthlyRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The month was not removed.';
  }
}

// Same shape as describePropertyMonthlyRemoveError above, for postConnectPropertyDistributionRemove() failures.
function describePropertyDistributionRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The distribution was not removed.';
  }
}

// Same shape as describePropertyMonthlyRemoveError above, for postConnectPropertyReserveMonthlyRemove() failures.
function describePropertyReserveMonthlyRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The reserve entry was not removed.';
  }
}

// Same shape as describePropertyMonthlyRemoveError above, for postConnectPropertyReserveDisbursementRemove() failures.
function describePropertyReserveDisbursementRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The disbursement was not removed.';
  }
}

// Same shape as describePropertyMonthlyRemoveError above, for postConnectPropertyCapitalLedgerRemove() failures.
function describePropertyCapitalLedgerRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The entry was not removed.';
  }
}

// Same shape as describePropertyMonthlyRemoveError above, for postConnectPropertyRepairRemove() failures.
function describePropertyRepairRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The entry was not removed.';
  }
}

// Same shape as describePropertyCapitalLedgerEntryError above, for postConnectPropertyMetaWrite() failures.
function describePropertyMetaEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property financials editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The property details were not saved.';
  }
}

// Same shape as describePropertyCapitalLedgerEntryError above, for postConnectPropertyBudgetImportWrite()
// failures, plus the two client-side rejections (no_file/too_large) shared with the Church/Balance
// .xlsx import forms.
function describePropertyBudgetImportError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property Budget import is not connected yet. Nothing was imported.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was imported — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as imported.';
    case 'no_file': return 'No file was uploaded.';
    case 'too_large': return 'That file is larger than 15 MB.';
    case 'http_error': return message ? String(message) : 'Connect refused the import.';
    default: return 'The Property Budget import did not complete.';
  }
}

// Same shape as describePropertyCapitalLedgerEntryError above, for postConnectPropertyMonthlyImportCsvWrite() failures.
function describePropertyMonthlyImportCsvError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Property monthly-financials import is not connected yet. Nothing was imported.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was imported — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as imported.';
    case 'http_error': return message ? String(message) : 'Connect refused the import.';
    default: return 'The monthly-financials import did not complete.';
  }
}

// Same shape as describePropertyCapitalLedgerEntryError above, for postConnectRevenueStreamsWrite()
// failures. No existing live page surfaces this write's form yet (see route-manifest.js's own
// comment), but the redirect-after-POST shape stays identical for when one is added.
function describeRevenueStreamsEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Revenue-stream classification editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The revenue-stream map was not saved.';
  }
}

// Same shape as describeRevenueStreamsEntryError above, for postConnectFlowExpenseMapWrite() failures.
function describeFlowExpenseMapEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Expense-category mapping editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The expense-category map was not saved.';
  }
}

// Same shape as describeRevenueStreamsEntryError above, for postConnectCashPolicyWrite() failures.
function describeCashPolicyEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Cash policy editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The cash policy was not saved.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareAllocationConfigWrite() failures.
function describeDaycareAllocationConfigEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare cost-share editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The cost-share config was not saved.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareBudgetOverrideWrite() failures.
function describeDaycareBudgetOverrideEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare Budget editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The Budget override was not saved.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareBulkWrite() failures.
function describeDaycareBulkEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare bulk entry is not connected yet. Nothing was recorded.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was recorded — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as recorded.';
    case 'http_error': return message ? String(message) : 'Connect refused the import.';
    default: return 'The rows were not recorded.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareChurchBudgetImportWrite() failures.
function describeDaycareChurchBudgetImportEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Church Budget import is not connected yet. Nothing was recorded.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was recorded — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as recorded.';
    case 'http_error': return message ? String(message) : 'Connect refused the import.';
    default: return 'The Church Budget import did not complete.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareEntryEdit() failures.
function describeDaycareEntryEditError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare entry editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The entry was not saved.';
  }
}

// Same shape as describeDaycareEntryEditError above, for postConnectDaycareEntryRemove() failures.
// "Removed" rather than "saved" wording, matching describePropertyMonthlyRemoveError-style wording
// used for the property remove forms.
function describeDaycareEntryRemoveError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare entry editing is not connected yet. Nothing was removed.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was removed — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as removed.';
    case 'http_error': return message ? String(message) : 'Connect refused the removal.';
    default: return 'The entry was not removed.';
  }
}

// Same shape as describeDaycareEntryError above, for postConnectDaycareSync() failures. The
// 'http_error' case is the one most likely to fire here in practice: if the daycare app itself
// isn't configured on Connect's side, Connect's own contract handler passes that exact message
// through as an ordinary HTTP error, so it shows up here verbatim rather than a generic relay
// failure -- see postConnectDaycareSync's own header comment in finance-daycare-client.js.
function describeDaycareSyncError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare sync is not connected yet. Nothing was synced.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was synced — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as synced.';
    case 'http_error': return message ? String(message) : 'Connect refused the sync.';
    default: return 'The sync did not complete.';
  }
}

// Same shape as describeDaycareSyncError above, for postConnectDaycareRoomsSync() failures.
function describeDaycareRoomsSyncError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Daycare room sync is not connected yet. Nothing was synced.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was synced — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as synced.';
    case 'http_error': return message ? String(message) : 'Connect refused the sync.';
    default: return 'The room sync did not complete.';
  }
}

// Same shape as describeBudgetEntryError above, for postConnectFinanceCompensationWrite() /
// fetchConnectSalaryPlannerState() failures.
function describeCompensationEntryError(reason, message) {
  switch (reason) {
    case 'not_configured': return 'Compensation Plan editing is not connected yet. Nothing was saved.';
    case 'no_access_identity': return 'Your sign-in was not recognized by Connect. Try reloading the page.';
    case 'network_error': return 'Could not reach Connect. Nothing was saved — please try again.';
    case 'invalid_json': return 'Connect returned an unexpected response. Nothing was confirmed as saved.';
    case 'invalid_index': return 'That worker no longer matches the current plan — reload and try again.';
    case 'http_error': return message ? String(message) : 'Connect refused the edit.';
    default: return 'The Compensation Plan edit was not saved.';
  }
}

// Builds a raw roster worker record from the edit/add form's fields (compensation-editor-pages.js),
// matching the exact raw field names api-finance.js's SALARY_PLANNER_KEY plan stores (see
// api-contracts.js's buildFinanceCompensationV1 comment on the raw roster shape) -- `existing` is
// spread first so an edit only overwrites the fields this form actually collects, never dropping
// a field (like a council-only override) the editor doesn't show.
function workerFromForm(form, existing) {
  const numberOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const w = existing && typeof existing === 'object' ? { ...existing } : {};
  w.name = String(form.get('name') || '');
  w.position = String(form.get('position') || '');
  w.accountCode = String(form.get('accountCode') || '');
  w.role = String(form.get('role') || 'other');
  w.trackKey = String(form.get('trackKey') || '');
  w.education = String(form.get('education') || '');
  w.yearsExperience = numberOrNull(form.get('yearsExperience')) ?? 0;
  w.responsibilityStipend = numberOrNull(form.get('responsibilityStipend')) ?? 0;
  w.attendanceBonus = numberOrNull(form.get('attendanceBonus')) ?? 0;
  const actualSalary = numberOrNull(form.get('actualSalary'));
  w.actualSalaryCents = actualSalary != null ? Math.round(actualSalary * 100) : null;
  w.selfEmployedFica = form.get('selfEmployedFica') === 'on';
  w.hasDependents = form.get('hasDependents') === 'on';
  w.healthEnrolled = form.get('healthEnrolled') === 'on';
  w.hideFromCouncil = form.get('hideFromCouncil') === 'on';
  return w;
}

// Reindexes a per-worker override map (compPerWorkerMethod/compOverrides -- object keyed by roster
// array index, see resolveSalaryPlannerState's own reindex in api-finance.js) after `removedIndex`
// is spliced out of the roster: the removed key is dropped, and every key above it shifts down by
// one to keep tracking the same worker at its new position.
function reindexAfterRemove(obj, removedIndex) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const oldIndex = Number(k);
    if (oldIndex === removedIndex) continue;
    out[oldIndex > removedIndex ? oldIndex - 1 : oldIndex] = obj[k];
  }
  return out;
}

// Confirms the payroll relay actually reached Website's proxy and got real data back, without
// ever putting a staff name, ID, or wage figure in the response -- a count and the real result's
// field names are enough to prove the round trip is genuine, and this is deliberately reachable
// by anyone who can already view it (see the route-manifest.js comment on why this is temporary).
function summarizePayrollRelayDiagnostic(result) {
  if (!result.ok) {
    return {
      ok: false, reason: result.reason, message: result.message || null,
      status: result.status ?? null, bodyPreview: result.bodyPreview ?? null,
    };
  }
  const rows = Array.isArray(result.result) ? result.result : [];
  return { ok: true, staffCount: rows.length, sampleFields: rows[0] ? Object.keys(rows[0]) : [] };
}

// Shows what the incoming Access JWT *claims* (unverified -- see jwt-decode-unsafe.js) so a
// verification failure on Website's side, which deliberately never says which check failed, can
// be narrowed down without any change to Website's auth code. Never used for the actual relay call.
function describeIncomingAccessJwt(accessJwt) {
  if (!accessJwt) return { present: false };
  const claims = decodeJwtClaimsUnsafe(accessJwt);
  return claims ? { present: true, ...claims } : { present: true, malformed: true };
}

function renderSectionNav(activeSection, activePage) {
  const renderPages = (section, isActiveSection) => `<div class="nav-pages">${section.pages.map((page) =>
    `<a href="/?section=${section.id}&amp;page=${page.id}"${isActiveSection && page.id === activePage.id ? ' aria-current="page"' : ''}>${escapeHtml(page.label)}</a>`
  ).join('')}</div>`;

  return groupFinanceSections(FINANCE_PARITY_SECTIONS).map(({ group, sections }) => {
    // Most groups wrap exactly one section, so labeling both the group ("Church") and the
    // section ("Church Report") would just repeat the same idea -- only Accounts & Data
    // actually bundles more than one distinct section under one label, so only there does the
    // section get its own sub-label beneath the group's.
    if (sections.length === 1) {
      const [section] = sections;
      const isActiveSection = section.id === activeSection.id;
      const body = section.pages.length <= 1
        ? `<a href="/?section=${section.id}"${isActiveSection ? ' aria-current="page"' : ''}>${section.label}</a>`
        : renderPages(section, isActiveSection);
      return `<div class="nav-group">
        <div class="nav-group-label">${escapeHtml(group)}</div>
        ${body}
      </div>`;
    }
    return `<div class="nav-group">
      <div class="nav-group-label">${escapeHtml(group)}</div>
      ${sections.map((section) => {
        const isActiveSection = section.id === activeSection.id;
        if (section.pages.length <= 1) {
          return `<a href="/?section=${section.id}"${isActiveSection ? ' aria-current="page"' : ''}>${section.label}</a>`;
        }
        return `<div class="nav-section">
          <div class="nav-section-label${isActiveSection ? ' is-active' : ''}">${section.label}</div>
          ${renderPages(section, isActiveSection)}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function renderEntityCards(entities) {
  return entities.map((entity) => `<div class="card"><small>${escapeHtml(entity.label)} · ${escapeHtml(entity.periodLabel)}</small><strong>${formatSignedCents(entity.resultCents)}</strong><span>Income ${formatCents(entity.incomeCents)} · expenses ${formatCents(entity.expenseCents)}</span></div>`).join('');
}

function renderSectionBody(ctx) {
  const {
    section, pageId, summary, giving, givingSource, churchReport, churchReportLive, churchTrendLive, balanceSheet, balanceTrends,
    daycareReport, daycareReportLive, propertyReport, propertyReportLive, propertyReserves, propertyReservesLive,
    propertyLedgers, propertyLedgersLive, propertyValuation,
    propertyForecast, propertyForecastLive, propertyDistributions, budgetReport, accountsReport, dataStatus, compensationReport,
    compensationReportLive, compensationBenchmarks, compensationBenefits, cashRunway, givingEntryStatus, givingEntryMessage,
    budgetEntryStatus, budgetEntryMessage, payrollBundle,
    compensationPlanRaw, canEditCompensation, compensationEditIndex, compensationEntryStatus, compensationEntryMessage,
    canManageBudgetPlan, planOpStatus, planOpMessage, planOpKind,
    baseProjectionEntryStatus, baseProjectionEntryMessage,
    churchOverrideStatus, churchOverrideMessage,
    churchBudgetXlsxImportStatus, churchBudgetXlsxImportMessage,
    balanceXlsxImportStatus, balanceXlsxImportMessage,
    churchActivityXlsxImportStatus, churchActivityXlsxImportMessage,
    churchBudgetMultiYearXlsxImportStatus, churchBudgetMultiYearXlsxImportMessage,
    balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage,
    daycareEntryStatus, daycareEntryMessage,
    daycareAllocationConfigEntryStatus, daycareAllocationConfigEntryMessage,
    daycareBudgetOverrideEntryStatus, daycareBudgetOverrideEntryMessage,
    daycareBulkEntryStatus, daycareBulkEntryMessage,
    daycareChurchBudgetImportEntryStatus, daycareChurchBudgetImportEntryMessage,
    daycareSyncStatus, daycareSyncMessage, daycareRoomsSyncStatus, daycareRoomsSyncMessage,
    boardCategoryEntryStatus, boardCategoryEntryMessage,
    purposeTagsEntryStatus, purposeTagsEntryMessage,
    propertyMonthlyEntryStatus, propertyMonthlyEntryMessage,
    propertyRepairEntryStatus, propertyRepairEntryMessage,
    propertyDistributionEntryStatus, propertyDistributionEntryMessage,
    propertyReserveMonthlyEntryStatus, propertyReserveMonthlyEntryMessage,
    propertyReserveDisbursementEntryStatus, propertyReserveDisbursementEntryMessage,
    propertyCapitalLedgerEntryStatus, propertyCapitalLedgerEntryMessage,
    propertyMonthlyRemoveStatus, propertyMonthlyRemoveMessage,
    propertyDistributionRemoveStatus, propertyDistributionRemoveMessage,
    propertyReserveMonthlyRemoveStatus, propertyReserveMonthlyRemoveMessage,
    propertyReserveDisbursementRemoveStatus, propertyReserveDisbursementRemoveMessage,
    propertyCapitalLedgerRemoveStatus, propertyCapitalLedgerRemoveMessage,
    propertyRepairRemoveStatus, propertyRepairRemoveMessage,
    propertyMetaEntryStatus, propertyMetaEntryMessage,
    propertyBudgetImportStatus, propertyBudgetImportMessage,
    propertyMonthlyImportCsvStatus, propertyMonthlyImportCsvMessage,
    roleResult,
  } = ctx;
  if (section.id === 'health') {
    // Each panel below is independently guarded against its own upstream synthetic read having
    // degraded to SYNTHETIC_UNAVAILABLE (see synthetic-read-guard.js) -- one missing dependency
    // (e.g. cash runway) renders an honest "unavailable" panel in its own place, never a
    // fabricated blank/zero, and never takes down the rest of this page. Operating result and
    // Financial position are no longer purely synthetic: buildFinancialHealthView tries the live
    // churchReportLive/balanceSheet results (each already resolved above, live-first, for this
    // section too) before falling back to the synthetic `summary` fields, independently per card --
    // see health-view-model.js. It never throws and never returns null itself; `operating`/
    // `position` inside it are each independently null only when neither their own live result nor
    // `summary` was usable, which is what the per-card renders below check for. Giving was already
    // live-first and unconditional before this change (resolveGivingSummary always succeeds to at
    // least the synthetic fixture) and is untouched here.
    //
    // Operating mix and Church operating bridge are now live-first too, reusing the same
    // churchReportLive result (and buildLiveFinancialMixView/buildLiveChurchReportView, the exact
    // functions Charts' revenue-mix/expense-mix/giving-pace pages already use -- see
    // charts-pages.js) rather than a new resolver, contract, or read. Entity overview deliberately
    // stays fully synthetic -- see the comment just above its own build below for why: the live
    // Daycare/Property resolvers' shapes were investigated and found genuinely incompatible with
    // it, not merely unwired.
    const health = buildFinancialHealthView(summary, giving, { churchReportLive, balanceSheetLive: balanceSheet });
    const isChurchLive = churchReportLive != null && !isSyntheticUnavailable(churchReportLive) && churchReportLive.source === 'live';
    // Reflects only Operating result/Financial position -- the two cards this badge has ever
    // summarized. Giving already carries its own independent, always-shown inline label right next
    // to it (see the General Fund giving card below) and was never represented by this badge
    // even before this change, so folding it in here would not add information, only ambiguity.
    const healthSources = [health.operating?.source, health.position?.source].filter(Boolean);
    const liveHealthSources = healthSources.filter((source) => source === 'live').length;
    const healthBadge = healthSources.length === 0 ? 'Unavailable'
      : liveHealthSources === healthSources.length ? 'Live from Connect'
      : liveHealthSources === 0 ? 'Synthetic staging' : 'Partially live';
    const runway = isSyntheticUnavailable(cashRunway) ? null : buildCashRunwayView(cashRunway);
    // Same live-first pattern as Charts' revenue-mix/expense-mix pages (charts-pages.js):
    // buildLiveFinancialMixView(accounts, fiscalYear, totals) reads churchReportLive's own contract
    // shape directly, so no synthetic churchReport read is needed on the live path at all.
    const mix = isChurchLive
      ? buildLiveFinancialMixView(churchReportLive.accounts, churchReportLive.fiscalYear, churchReportLive.totals)
      : (isSyntheticUnavailable(churchReport) ? null : buildFinancialMixView(churchReport));
    // `church` stays synthetic-only -- it feeds Entity overview below, which is a deliberate,
    // investigated decision to NOT mix live and synthetic entities (see that comment). It is
    // intentionally a separate variable from `churchForBridge` just below, which IS live-first.
    const church = isSyntheticUnavailable(churchReport) ? null : buildChurchReportView(churchReport);
    const daycareEntity = isSyntheticUnavailable(daycareReport) ? null : buildDaycareReportView(daycareReport);
    const propertyEntity = isSyntheticUnavailable(propertyReport) ? null : buildPropertyReportView(propertyReport);
    // Entity overview (church/daycare/property side by side) was investigated for the same
    // live-first treatment and deliberately left fully synthetic:
    //  - Daycare's live resolver (resolveDaycareReport/buildLiveDaycareReportView) reports one
    //    whole-fiscal-year total, and its `period` is just String(fiscalYear) (e.g. "2026") --
    //    buildEntityOverview's own validation requires a monthly `YYYY-MM` period for daycare/
    //    property (confirmed against the synthetic fixture's own periods, e.g. "Daycare · 2026-01"
    //    in this same page today). That is a genuine granularity mismatch, not a formatting
    //    detail -- reformatting an annual total to look like one month would misrepresent it, and
    //    "all three live" can therefore never actually happen with today's resolver shapes.
    //  - Property's live resolver can carry null totalExpensesCents/netOperatingIncomeCents/
    //    availableForDistributionCents/reserveBalanceCents per period (confirmed real production
    //    behavior -- see property-report-service.js's resolvePropertyReport comment); summing those
    //    into buildPropertyReportView's totals would silently produce NaN, and
    //    buildEntityOverview's integer validation would then throw -- with no per-panel guard
    //    around this specific call (unlike the null-checks above it), that throw would take down
    //    the ENTIRE Financial Health section, not just this one card row.
    //  - Since "all three live" can't occur today anyway, independently mixing (e.g. live Church
    //    with synthetic Daycare/Property) was also rejected: renderEntityCards has no per-card
    //    source label today, so three cards from two different sources would sit side by side with
    //    no way for a reader to tell which are real Connect data -- exactly the misleading mix this
    //    page's honest-degradation discipline exists to prevent.
    // daycareReportLive/propertyReportLive are therefore also NOT resolved for 'health' in this
    // request (no gate change above) -- there is nothing on this page that would use them yet, and
    // fetching them anyway would only add unused query-budget cost.
    const entities = (church && daycareEntity && propertyEntity)
      ? buildEntityOverview({ church, daycare: daycareEntity, property: propertyEntity })
      : null;
    // Church operating bridge prefers the live church view instead: buildOperatingBridge reads only
    // fiscalYear/totals.{incomeActualCents,expenseActualCents,actualNetCents}, which is exactly what
    // buildLiveChurchReportView's output already provides (see church-report-service.js) -- no
    // live-aware wrapper needed here, the same direct reuse Charts' giving-pace page already relies
    // on. Independent of `church` above (which stays synthetic-only for Entity overview).
    const churchForBridge = isChurchLive
      ? buildLiveChurchReportView(churchReportLive.accounts, churchReportLive.fiscalYear, churchReportLive.totals)
      : church;
    const bridge = churchForBridge ? buildOperatingBridge(churchForBridge) : null;
    const status = (dataStatus && !isSyntheticUnavailable(dataStatus)) ? buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    }) : null;
    const attentionItems = [];
    if (status?.freshness === 'stale') attentionItems.push(`Source data hasn't been reviewed in over ${status.freshnessWindowDays} days (${status.ageDays} days old) — see Data &amp; Imports.`);
    if (!health.giving.reconciled) attentionItems.push('Giving totals do not reconcile yet — review before relying on them.');
    if (health.operating && health.operating.varianceCents < 0) attentionItems.push(`Operating result is ${formatSignedCents(health.operating.varianceCents)} behind budget.`);
    const unavailableNote = (what) => `<p class="status status-pending">${escapeHtml(what)} could not be read for this request. Nothing shown here is a real $0 or blank figure — see Data &amp; Imports.</p>`;
    return `<section aria-label="Synthetic financial health">
      <div class="dashboard-intro"><div class="eyebrow">Dashboard</div><h2 class="dashboard-title">Are we okay?</h2><p>Four questions the council asks first — each one links to the report it came from.</p></div>
      <div class="section-heading"><div><div class="eyebrow">Needs your attention</div><h2>${attentionItems.length ? `${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'} flagged` : 'Nothing flagged right now'}</h2></div><span class="badge">${attentionItems.length ? 'Review' : 'Clear'}</span></div>
      ${attentionItems.length
        ? `<ul class="attention-list">${attentionItems.map((item) => `<li>${item}</li>`).join('')}</ul>`
        : '<p class="status">Nothing needs your attention right now.</p>'}
      <div class="section-heading"><div><div class="eyebrow">Financial Health</div><h2>How are we doing, and what should we decide?</h2></div><span class="badge">${healthBadge}</span></div>
      <div class="grid">
        ${health.operating ? `<div class="card"><small>Operating result</small><strong>${formatSignedCents(health.operating.actualNetCents)}</strong><span>Budget ${formatSignedCents(health.operating.budgetNetCents)} · variance ${formatSignedCents(health.operating.varianceCents)} · ${health.operating.source === 'live' ? 'live from Connect' : 'synthetic fixture'}</span></div>` : renderUnavailableCard('Operating result')}
        ${health.position ? `<div class="card"><small>Financial position</small><strong>${formatCents(health.position.netAssetsCents)}</strong><span>Assets ${formatCents(health.position.assetsCents)} · liabilities ${formatCents(health.position.liabilitiesCents)} · ${health.position.source === 'live' ? 'live from Connect' : 'synthetic fixture'}</span></div>` : renderUnavailableCard('Financial position')}
        <div class="card"><small>General Fund giving</small><strong>${formatCents(health.giving.netCents)}</strong><span>${health.giving.sourceRecordCount} aggregate records · ${health.giving.reconciled ? 'totals match' : 'review required'} · ${givingSource === 'live' ? 'live from Connect' : 'synthetic fixture'}</span></div>
      </div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Liquidity</div><h2>Operating cash runway</h2></div><span class="badge">${runway ? `As of ${escapeHtml(runway.asOfDate)}` : 'Unavailable'}</span></div>
      ${runway
        ? `<div class="grid"><div class="card"><small>Operating cash</small><strong>${formatCents(runway.operatingCashCents)}</strong><span>${escapeHtml(runway.accountName)} · synthetic fixture</span></div><div class="card"><small>Average monthly expense</small><strong>${formatCents(runway.monthlyExpenseCents)}</strong><span>FY${runway.fiscalYear} annual expense ${formatCents(runway.annualExpenseCents)}</span></div><div class="card"><small>Expense coverage</small><strong>${runway.runwayMonths.toFixed(1)} months</strong><span>Cash divided by average monthly expense · read-only</span></div></div>`
        : unavailableNote('Operating cash runway')}
      <div class="section-heading trend-heading"><div><div class="eyebrow">Operating mix</div><h2>Where money comes from and goes</h2></div><span class="badge">${mix ? `FY${mix.fiscalYear} · reconciled · ${isChurchLive ? 'Live from Connect' : 'Synthetic staging'}` : 'Unavailable'}</span></div>
      ${mix
        ? `<div class="grid"><div><h3>Revenue mix</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Share</th></tr></thead><tbody>${renderFinancialMixRows(mix.income.items)}</tbody></table></div></div><div><h3>Expense mix</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Share</th></tr></thead><tbody>${renderFinancialMixRows(mix.expenses.items)}</tbody></table></div></div></div>`
        : unavailableNote('Revenue and expense mix')}
      <div class="section-heading trend-heading"><div><div class="eyebrow">Entity overview</div><h2>Separate operating views</h2></div><span class="badge">Not consolidated</span></div>
      ${entities
        ? `<div class="grid">${renderEntityCards(entities.entities)}</div>
      <p>Periods are shown separately because these synthetic sources do not share one reporting window; their results are not added together.</p>`
        : unavailableNote('The entity overview')}
      <div class="section-heading trend-heading"><div><div class="eyebrow">Money flow</div><h2>${bridge ? `FY${bridge.fiscalYear} ` : ''}Church operating bridge</h2></div><span class="badge">${bridge ? `Reconciled · ${isChurchLive ? 'Live from Connect' : 'Synthetic staging'}` : 'Unavailable'}</span></div>
      ${bridge
        ? `<div class="grid"><div class="card"><small>1 · Income</small><strong>${formatCents(bridge.incomeCents)}</strong></div><div class="card"><small>2 · Expenses</small><strong>−${formatCents(bridge.expenseCents)}</strong></div><div class="card"><small>3 · ${bridge.resultLabel}</small><strong>${formatSignedCents(bridge.resultCents)}</strong><span>Income minus expenses</span></div></div>
      <p>This is an arithmetic operating bridge, not donor-to-expense tracing or a claim that particular revenue funded particular costs.</p>`
        : unavailableNote('The Church operating bridge')}
      <div class="decision-grid">${FINANCE_HEALTH_DECISIONS.map((decision) => `<div class="decision"><small>${decision.stream}</small><b>${decision.authority}</b><span>${decision.action}</span></div>`).join('')}</div>
    </section>`;
  }
  const page = resolveFinancePage(section, pageId);
  if (page.status === 'unavailable') {
    return renderUnavailablePage({ eyebrow: section.label, heading: page.label, reason: page.reason });
  }
  if (section.id === 'giving') {
    return renderGiftEntryPage(page.id, { giving, givingSource, givingEntryStatus, givingEntryMessage });
  }
  if (section.id === 'giving-analytics') {
    return renderUnavailablePage({ eyebrow: section.label, heading: page.label, reason: 'Not yet available.' });
  }
  if (section.id === 'charts') {
    return renderChartsPage(page.id, { churchReport, churchReportLive, cashRunway, propertyReserves, propertyReservesLive, giving, givingSource });
  }
  if (section.id === 'church') {
    // Same admin-only gate as the legacy in-Connect Church Report's own actual-override route --
    // UI hiding is never authorization, the real gate is finance-church-actual-override-v1's own
    // role check on Connect's side, but there's no reason to show a form that will only 403.
    const canManageChurchReport = roleResult.ok && roleResult.role === 'admin';
    // Looser gate for the Activity/Budget-by-Year multi-year .xlsx import forms on Multi-year
    // trend -- unlike canManageChurchReport above, the legacy finance/church/activity-import(-
    // preview)/finance/church/budget-multi-year-import(-preview) routes carry no isAdmin check of
    // their own, only the same blanket "finance edit" ACCESS_GATE finance/daycare's own relayed
    // forms already use (canRecordDaycareEntry below) -- verified directly against
    // src/api-chms.js's source, not assumed. Any verified role may attempt it; Connect's own
    // contract handler re-derives the real permission-matrix check independently of what this
    // form shows or hides (UI hiding is never authorization).
    const canImportChurchMultiYear = roleResult.ok;
    return renderChurchPage(page.id, {
      churchReport: churchReportLive, churchTrendLive, canManageChurchReport, churchOverrideStatus, churchOverrideMessage,
      // Same admin-only gate as canManageChurchReport above -- the Budget vs. Actuals .xlsx import
      // form is a separate write (finance-church-budget-xlsx-import-v1), but matches legacy's own
      // finance/church/import(-preview) admin-only gate exactly, so there's no reason for a
      // different check here.
      churchBudgetXlsxImportStatus, churchBudgetXlsxImportMessage,
      canImportChurchMultiYear,
      churchActivityXlsxImportStatus, churchActivityXlsxImportMessage,
      churchBudgetMultiYearXlsxImportStatus, churchBudgetMultiYearXlsxImportMessage,
    });
  }
  if (section.id === 'balance') {
    // Same admin-only gate as the legacy in-Connect Balance Sheet's own
    // finance/church/balances/import(-preview) routes -- UI hiding is never authorization, the
    // real gate is finance-church-balances-xlsx-import-v1's own role check on Connect's side.
    const canManageBalanceImport = roleResult.ok && roleResult.role === 'admin';
    // Looser gate for the multi-year .xlsx import form on Multi-year position -- the legacy
    // finance/church/balances/multi-year-import(-preview) route carries no isAdmin check of its
    // own either, same reasoning as canImportChurchMultiYear above.
    const canImportBalanceMultiYear = roleResult.ok;
    return renderBalancePage(page.id, {
      balanceSheet, balanceTrends, canManageBalanceImport, balanceXlsxImportStatus, balanceXlsxImportMessage,
      canImportBalanceMultiYear, balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage,
    });
  }
  if (section.id === 'daycare') {
    // Any verified role that can reach this section at all may attempt an entry -- the legacy
    // in-Connect route's own gate is edit permission on any of finance/budget/compensation, not a
    // simple role-name check apps/finance's coarse role model can precisely replicate; the real
    // gate is finance-daycare-entry-v1's own permission check on Connect's side (see its header
    // comment in src/api-contracts-service.js).
    const canRecordDaycareEntry = roleResult.ok;
    // Same admin-only gate as the legacy in-Connect Daycare Report's own allocation-config and
    // budget-override POST routes -- UI hiding is never authorization, the real gate is each
    // finance-daycare-*-write-v1 contract's own role check on Connect's side.
    const canManageDaycareAllocation = roleResult.ok && roleResult.role === 'admin';
    const canManageDaycareBudgetOverride = roleResult.ok && roleResult.role === 'admin';
    // Money sync uses the SAME looser gate as canRecordDaycareEntry above -- the legacy
    // finance/daycare/sync route also carries no isAdmin check of its own. Room sync stays
    // admin-only, matching finance/daycare/rooms/sync's own explicit isAdmin check exactly.
    const canSyncDaycareRooms = roleResult.ok && roleResult.role === 'admin';
    return renderDaycarePage(page.id, {
      daycareReport: daycareReportLive, canRecordDaycareEntry, daycareEntryStatus, daycareEntryMessage,
      canManageDaycareAllocation, daycareAllocationConfigEntryStatus, daycareAllocationConfigEntryMessage,
      canManageDaycareBudgetOverride, daycareBudgetOverrideEntryStatus, daycareBudgetOverrideEntryMessage,
      daycareBulkEntryStatus, daycareBulkEntryMessage,
      daycareChurchBudgetImportEntryStatus, daycareChurchBudgetImportEntryMessage,
      canSyncDaycare: canRecordDaycareEntry, daycareSyncStatus, daycareSyncMessage,
      canSyncDaycareRooms, daycareRoomsSyncStatus, daycareRoomsSyncMessage,
    });
  }
  if (section.id === 'property') {
    // Same admin-only gate as the legacy in-Connect Property Operating Results' own monthly POST
    // route and Work orders' own repairs POST route -- UI hiding is never authorization, the real
    // gate is finance-property-monthly-write-v1's/finance-property-repair-write-v1's own role
    // check on Connect's side.
    const canManagePropertyMonthly = roleResult.ok && roleResult.role === 'admin';
    const canManagePropertyRepairs = roleResult.ok && roleResult.role === 'admin';
    // Same admin-only gate as above, for Distributions/Reserve schedule & disbursement/Capital
    // improvements' own POST routes -- UI hiding is never authorization, the real gate is each
    // finance-property-*-write-v1 contract's own role check on Connect's side.
    const canManagePropertyLedgers = roleResult.ok && roleResult.role === 'admin';
    return renderPropertyPage(page.id, {
      propertyReport, propertyReportLive, propertyReserves, propertyReservesLive,
      propertyLedgers, propertyLedgersLive, propertyValuation, propertyForecast, propertyForecastLive, propertyDistributions,
      canManagePropertyMonthly, propertyMonthlyEntryStatus, propertyMonthlyEntryMessage,
      canManagePropertyRepairs, propertyRepairEntryStatus, propertyRepairEntryMessage,
      canManagePropertyLedgers,
      propertyDistributionEntryStatus, propertyDistributionEntryMessage,
      propertyReserveMonthlyEntryStatus, propertyReserveMonthlyEntryMessage,
      propertyReserveDisbursementEntryStatus, propertyReserveDisbursementEntryMessage,
      propertyCapitalLedgerEntryStatus, propertyCapitalLedgerEntryMessage,
      // Same admin-only gate as canManagePropertyMonthly/canManagePropertyRepairs/
      // canManagePropertyLedgers above -- completes Commercial Property's write parity with a
      // per-row Remove action on each already-rendered table, plus the meta and bulk-import forms.
      // The real gate is each finance-property-*-remove-v1/-meta-write-v1/-budget-import-v1/
      // -monthly-import-csv-v1 contract's own role check on Connect's side.
      propertyMonthlyRemoveStatus, propertyMonthlyRemoveMessage,
      propertyDistributionRemoveStatus, propertyDistributionRemoveMessage,
      propertyReserveMonthlyRemoveStatus, propertyReserveMonthlyRemoveMessage,
      propertyReserveDisbursementRemoveStatus, propertyReserveDisbursementRemoveMessage,
      propertyCapitalLedgerRemoveStatus, propertyCapitalLedgerRemoveMessage,
      propertyRepairRemoveStatus, propertyRepairRemoveMessage,
      propertyMetaEntryStatus, propertyMetaEntryMessage,
      propertyBudgetImportStatus, propertyBudgetImportMessage,
      propertyMonthlyImportCsvStatus, propertyMonthlyImportCsvMessage,
    });
  }
  if (section.id === 'planning') {
    // Same gate as the legacy in-Connect Budget Planner's override-bulk route (admin or council
    // only) -- UI hiding is never authorization, the real gate is finance-budget-write-v1's own
    // role check on Connect's side, but there's no reason to show a form that will only 403.
    const canEditBudget = roleResult.ok && (roleResult.role === 'admin' || roleResult.role === 'council');
    // generate/generate-all/commit/remove-a-category stay admin-only, matching their legacy
    // routes' own gate exactly (see the shared helpers' header comment in src/api-finance.js) --
    // council may only hand-correct a planned amount via canEditBudget's form above, never
    // regenerate or finalize the shared plan wholesale.
    const canManageBudgetPlan = roleResult.ok && roleResult.role === 'admin';
    return renderPlanningPage(page.id, {
      budgetReport, canEditBudget, budgetEntryStatus, budgetEntryMessage,
      // Same admin-only gate as generate/generate-all/commit/remove-a-category above, matching the
      // legacy in-Connect Planning table's own base-projection PUT route exactly -- reused here
      // rather than a second identical role check, since both share the same "editing the budget
      // plan requires admin access" message on Connect's side.
      canManageBudgetPlan, planOpStatus, planOpMessage, planOpKind,
      baseProjectionEntryStatus, baseProjectionEntryMessage,
    });
  }
  if (section.id === 'accounts') {
    // Same admin-only gate as the legacy in-Connect Chart of Accounts' own board-categories PUT
    // route -- UI hiding is never authorization, the real gate is
    // finance-board-categories-write-v1's own role check on Connect's side.
    const canManageBoardCategories = roleResult.ok && roleResult.role === 'admin';
    // Same admin-only gate as above, for the legacy in-Connect Chart of Accounts' own purpose-tags
    // PUT route -- UI hiding is never authorization, the real gate is
    // finance-purpose-tags-write-v1's own role check on Connect's side.
    const canManagePurposeTags = roleResult.ok && roleResult.role === 'admin';
    return renderAccountsPage(page.id, {
      accountsReport, canManageBoardCategories, boardCategoryEntryStatus, boardCategoryEntryMessage,
      canManagePurposeTags, purposeTagsEntryStatus, purposeTagsEntryMessage,
    });
  }
  if (section.id === 'compensation') {
    // viewerRole (not just the compensationRoleVerified boolean that gates the live fetch itself)
    // is threaded through so the Council sub-page can apply the same hideFromCouncil filtering the
    // real Salary Planner already enforces for that exact role -- see
    // buildLiveCompensationCouncilSnapshot's header comment in compensation-report-service.js.
    return renderCompensationPage(page.id, {
      compensationReport, compensationReportLive, compensationBenchmarks, compensationBenefits,
      viewerRole: roleResult && roleResult.ok ? roleResult.role : null,
      compensationPlanRaw, canEditCompensation, editIndex: compensationEditIndex,
      entryStatus: compensationEntryStatus, entryMessage: compensationEntryMessage,
    });
  }
  if (section.id === 'quickbooks') {
    return renderQuickbooksPage(page.id, { dataStatus, accountsReport });
  }
  if (section.id === 'packet') {
    return renderPacketPage({ churchReportLive, balanceSheetLive: balanceSheet, churchTrendLive, giving, givingSource });
  }
  if (section.id === 'data') {
    const isLive = dataStatus.source === 'live';
    const status = buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    });
    return `<section class="report" aria-label="${isLive ? 'Data and Imports Status' : 'Synthetic Data and Imports Status'}">
      <div class="section-heading"><div><div class="eyebrow">Data &amp; Imports</div><h2>Source and isolation status</h2></div><span class="badge">${isLive ? 'Live from Connect' : 'Synthetic staging'}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Import activity' : 'Fixture source'}</small><strong>${escapeHtml(status.source)}</strong><span>${escapeHtml(status.note)}</span></div><div class="card"><small>Production connection</small><strong>${status.productionConnected ? 'Connected' : 'Disconnected'}</strong></div><div class="card"><small>QuickBooks writer</small><strong>${status.writerConnected ? 'Connected' : 'Disconnected'}</strong><span>${isLive ? "Connect's real finance_qb_connection state" : 'No competing staging writer'}</span></div></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Source freshness</div><h2>${status.freshness === 'stale' ? `Review before relying on this ${isLive ? 'data' : 'fixture'}` : `${isLive ? 'Data' : 'Fixture'} is within the review window`}</h2></div><span class="badge">${status.freshness}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Most recent import' : 'Last fixture import'}</small><strong>${escapeHtml(status.lastImportedAt)}</strong></div><div class="card"><small>Age at request</small><strong>${status.ageDays} days</strong><span>Policy window ${status.freshnessWindowDays} days</span></div></div>
      <p><small>${isLive ? "Fetched live from Connect's real, aggregate-only finance-data-status contract endpoint." : `The committed synthetic fixture (the live endpoint is not configured or did not answer${dataStatus.fallbackReason ? `: ${escapeHtml(dataStatus.fallbackReason)}` : ''}).`}</small></p>
    </section>`;
  }
  if (section.id === 'payroll') {
    return renderPayrollSection(payrollBundle);
  }
  return `<section class="parity" aria-label="${section.label} staging scaffold">
    <h2>${section.label}</h2>
    <p>This familiar workspace is retained in the parity plan. Its production workflow and data are not connected to staging.</p>
    <ul>${section.capabilities.map((capability) => `<li>${capability}</li>`).join('')}</ul>
  </section>`;
}

function renderShell(ctx) {
  const { metadata, section, pageId, givingSource, councilPreview, roleResult } = ctx;
  const page = resolveFinancePage(section, pageId);
  const release = `${metadata.version} · ${metadata.releaseChannel}`;
  // renderSectionBody() (and the *-pages.js render functions it delegates to) can still throw --
  // e.g. a page that unconditionally builds a view from a companion synthetic read shell.js could
  // only degrade to SYNTHETIC_UNAVAILABLE, not repair (see synthetic-read-guard.js). This is the
  // per-section safety net that replaces the old whole-route 503: the rest of this page (nav,
  // banners, footer) still renders, and the visitor sees an honest "data unavailable" message
  // scoped to the one section that failed, not a generic error for the entire app. The route-level
  // try/catch around this whole handler (shell.js's fetch()) remains as a final backstop for
  // genuinely unexpected errors outside this render path.
  let sectionBody;
  try {
    sectionBody = renderSectionBody(ctx);
  } catch {
    sectionBody = renderDataUnavailablePage({
      eyebrow: section.label,
      heading: page.label,
      reason: 'This section could not be rendered because required data was unavailable for this request. Nothing else on this page was affected.',
    });
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Timothy Finance — Staging</title>
  <style>
    :root { color-scheme: light; font-family: "DM Sans", "Source Sans 3", Arial, sans-serif; --navy:#1e2d4a; --teal:#2e7ea6; --gold:#c9973a; --charcoal:#1a1a2a; --warm-gray:#8a8377; --warm-meta:#8a7a5c; --warm-label:#5c4b2e; --border:#e5d9be; --divider:#f1e7d2; --page:#fbf8f1; --header:#fbf3e1; --card:#fffdf9; --sage:#6b8f71; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; background: var(--page); color: var(--charcoal); }
    .app-shell { display:grid; grid-template-columns:15.5rem minmax(0,1fr); min-height:100vh; }
    .app-sidebar { background:var(--navy); color:#fff; display:flex; flex-direction:column; position:sticky; top:0; height:100vh; overflow-y:auto; }
    .sidebar-brand { min-height:4.5rem; display:flex; align-items:center; gap:.75rem; padding:.9rem 1.1rem; border-bottom:1px solid rgba(255,255,255,.12); font-family:Georgia,serif; font-size:1.02rem; font-weight:700; }
    .sidebar-brand small { display:block; color:rgba(255,255,255,.65); font-family:Arial,sans-serif; font-size:.66rem; letter-spacing:.12em; text-transform:uppercase; margin-top:.12rem; }
    .mark { width:2.2rem; height:2.2rem; flex:0 0 auto; display:grid; place-items:center; border:1px solid rgba(255,255,255,.45); border-radius:50%; color:#f5e0b0; font-size:1.2rem; }
    .sidebar-foot { margin-top:auto; padding:.85rem 1.1rem; border-top:1px solid rgba(255,255,255,.12); color:rgba(255,255,255,.55); font-size:.68rem; line-height:1.5; }
    main { width:min(72rem,calc(100% - 2rem)); margin:0 auto; padding:2.3rem 0 3rem; }
    .eyebrow { color:var(--warm-meta); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:.35rem 0 .55rem; color:var(--navy); font-family:Georgia,serif; font-size:clamp(2.1rem,6vw,3.2rem); line-height:1; }
    p { color:var(--warm-gray); line-height:1.6; }
    .status { margin-top:1.2rem; padding:.75rem 1rem; border-left:4px solid var(--sage); border-radius:.55rem; background:#edf3ee; color:#4a6e52; font-size:.84rem; font-weight:700; }
    .status-error { border-left-color:#b23b3b; background:#fbeceb; color:#8a2f2f; }
    form { margin-top:1.25rem; }
    .form-grid { margin-top:0; }
    .field { display:flex; flex-direction:column; gap:.3rem; margin-top:1rem; }
    .field:first-child { margin-top:0; }
    label { color:var(--warm-label); font-size:.72rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    input, select { padding:.6rem .75rem; border:1px solid var(--border); border-radius:.55rem; background:var(--card); color:var(--charcoal); font-size:.9rem; font-family:inherit; }
    button { margin-top:1.4rem; padding:.75rem 1.4rem; border:none; border-radius:.6rem; background:var(--navy); color:#fff; font-size:.85rem; font-weight:700; cursor:pointer; }
    button:hover { background:#16233b; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(12rem,1fr)); gap:1rem; margin-top:1.25rem; }
    .card { padding:1.15rem 1.25rem; border-top:4px solid var(--teal); border-radius:1.1rem; background:var(--card); box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05); }
    .card small { display:block; color:var(--warm-meta); margin-bottom:.4rem; font-size:.7rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .card strong { color:var(--charcoal); font-size:1.65rem; font-variant-numeric:tabular-nums; }
    .card span, .decision span { display:block; margin-top:.45rem; color:var(--warm-gray); font-size:.76rem; line-height:1.45; }
    .section-heading { display:flex; justify-content:space-between; gap:1rem; align-items:end; margin-top:1.4rem; }
    .section-heading h2 { margin:.25rem 0 0; color:var(--navy); font-family:Georgia,serif; font-size:1.75rem; }
    .badge { padding:.35rem .7rem; border-radius:999px; background:#eaf4fa; color:var(--teal); font-size:.72rem; font-weight:700; }
    .decision-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.75rem; margin-top:.75rem; }
    .decision { padding:1rem; border:1px solid var(--border); border-left:4px solid var(--gold); background:var(--card); border-radius:.75rem; }
    .decision small, .decision b { display:block; }
    .decision small { color:var(--warm-meta); text-transform:uppercase; font-size:.68rem; font-weight:700; }
    .decision b { color:var(--navy); margin-top:.25rem; }
    .table-wrap { overflow-x:auto; margin-top:1rem; border:1px solid var(--border); border-radius:.85rem; background:var(--card); }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th, td { padding:.75rem .85rem; border-bottom:1px solid var(--divider); text-align:left; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
    th { color:var(--warm-label); background:var(--header); font-size:.68rem; letter-spacing:.05em; text-transform:uppercase; }
    nav { flex:1; overflow-y:auto; padding:.6rem .55rem 1rem; }
    .nav-group { margin-bottom:.35rem; }
    .nav-group-label { padding:.5rem .65rem .3rem; color:rgba(255,255,255,.5); font-size:.66rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
    .nav-section { margin-top:.15rem; }
    .nav-section-label { padding:.3rem .65rem; color:rgba(255,255,255,.65); font-size:.76rem; font-weight:700; }
    .nav-section-label.is-active { color:#fff; }
    .nav-pages { display:flex; flex-direction:column; }
    nav a { display:block; padding:.55rem .65rem; margin:1px 0; border-radius:.5rem; color:rgba(255,255,255,.78); text-decoration:none; font-size:.82rem; font-weight:600; }
    .nav-pages a { padding:.4rem .65rem .4rem 1.2rem; font-size:.78rem; font-weight:500; }
    nav a[aria-current="page"] { background:rgba(255,255,255,.14); color:#fff; }
    .dashboard-intro { margin-bottom:.25rem; }
    .dashboard-title { margin:.25rem 0 0; color:var(--navy); font-family:Georgia,serif; font-size:clamp(1.8rem,5vw,2.6rem); line-height:1.1; }
    .attention-list { margin:.75rem 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:.5rem; }
    .attention-list li { padding:.75rem 1rem; border:1px solid var(--border); border-left:4px solid var(--gold); border-radius:.55rem; background:var(--card); color:var(--warm-label); font-size:.84rem; }
    .status-pending { border-left-color:var(--warm-gray); background:var(--header); color:var(--warm-label); }
    .council-banner { display:flex; align-items:center; gap:.6rem; margin-top:1.1rem; padding:.75rem 1rem; border:1px solid var(--gold); border-radius:.6rem; background:#fdf8ec; color:#5c4b2e; font-size:.82rem; }
    .council-pill { padding:.2rem .55rem; border-radius:99px; background:var(--gold); color:#241a05; font-size:.66rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
    .council-toggle { margin-left:auto; padding:.4rem .7rem; border:1px solid var(--border); border-radius:.5rem; background:var(--card); color:var(--navy); font-size:.76rem; font-weight:700; text-decoration:none; }
    body.council-preview form[method="POST"] { display:none; }
    .parity { margin-top:1.25rem; padding:1.25rem; border:1px solid var(--border); border-radius:.85rem; background:var(--card); }
    .parity h2 { margin:0 0 .5rem; }
    .parity ul { columns:2; color:var(--warm-gray); line-height:1.8; }
    footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); color:var(--warm-meta); font-size:.75rem; }
    @media(max-width:767px){.app-shell{grid-template-columns:1fr}.app-sidebar{position:static;height:auto}nav{display:flex;flex-wrap:wrap;gap:.25rem;padding:.6rem}.nav-group,.nav-section,.nav-pages{display:contents}.nav-group-label,.nav-section-label{display:none}main{width:min(100% - 1.2rem,72rem);padding-top:1.4rem}.section-heading{align-items:start;flex-direction:column}.grid{grid-template-columns:1fr}.parity ul{columns:1}}
    /* ── Payroll ── */
    .pay-toolbar { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; }
    .pay-toolbar select { min-width:14rem; }
    .pay-tab { padding:.55rem .9rem; border:1px solid var(--border); border-radius:.6rem; background:var(--card); color:var(--warm-label); font-size:.78rem; font-weight:700; text-decoration:none; }
    .pay-tab.is-on { border-color:var(--teal); background:#e4eef4; color:var(--navy); }
    .pay-note { display:block; color:var(--warm-meta); font-size:.76rem; margin-top:.2rem; }
    .pay-pill { display:inline-block; padding:.2rem .6rem; border-radius:999px; font-size:.68rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
    .pay-pill-good { background:#eaf1e5; color:#3b4c2e; }
    .pay-pill-warn { background:#fbf1dc; color:#7a5b18; }
    .pay-pill-plain { background:#f1efea; color:#6a6858; }
    .pay-in { width:5.5rem; padding:.4rem .5rem; text-align:right; font-size:.85rem; }
    .pay-in[readonly] { background:var(--header); }
    .pay-group { margin:1.4rem 0 .6rem; color:var(--warm-meta); font-size:.7rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .pay-card { border:1px solid var(--border); border-radius:.85rem; overflow:hidden; background:var(--card); margin-top:.85rem; }
    .pay-card-bar { padding:.65rem 1rem; background:var(--header); color:var(--warm-label); font-size:.7rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; caption-side:top; text-align:left; }
    .pay-li { display:flex; justify-content:space-between; gap:1rem; padding:.55rem 1rem; border-bottom:1px solid var(--divider); font-size:.85rem; }
    .pay-li:last-child { border-bottom:0; }
    .pay-li.muted { color:var(--warm-meta); }
    .pay-li.neg { color:#8a4a4a; }
    .pay-li.total { background:var(--header); font-weight:700; }
    .pay-combined { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding:1rem 1.2rem; border:1px solid var(--gold); border-radius:.85rem; background:#fdf8ec; }
    .pay-combined b { margin-left:auto; font-size:1.5rem; color:var(--navy); }
    .pay-warn { margin-top:1rem; padding:.85rem 1rem; border:1px solid #e4c8c8; border-radius:.6rem; background:#faefef; color:#8a4a4a; font-size:.85rem; }
    .pay-foot { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border); }
    .pay-approve { background:var(--gold); color:#1b1608; }
    .pay-approve.is-done { background:var(--card); color:var(--navy); border:1px solid var(--border); }
    #pay-print { display:none; }
    .pt-header h2 { margin:0; font-size:1.05rem; color:var(--navy); }
    .pt-period { color:var(--warm-meta); font-size:.75rem; }
    .pt-section { margin:.85rem 0; }
    .pt-section-label { font-size:.68rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--warm-meta); border-bottom:1.5px solid var(--border); padding-bottom:.15rem; margin-bottom:.25rem; }
    .pt-table { width:100%; border-collapse:collapse; font-size:.78rem; }
    .pt-table th { text-align:left; padding:.2rem .5rem; background:var(--header); font-size:.65rem; text-transform:uppercase; }
    .pt-table td { padding:.2rem .5rem; }
    .pt-table .pt-num { text-align:right; font-variant-numeric:tabular-nums; }
    .pt-table .pt-sub td { font-weight:700; background:var(--header); }
    .pt-total { display:flex; justify-content:space-between; margin-top:.6rem; padding:.55rem .75rem; border-radius:.5rem; background:var(--navy); color:#fff; font-weight:700; }
    .pt-warn { margin:0 0 .75rem; padding:.55rem .75rem; border:1px solid #e4c8c8; border-radius:.5rem; background:#faefef; color:#8a4a4a; font-size:.78rem; }
    @media print {
      .app-sidebar, nav, .pay-toolbar, form, .status, footer, h1, .eyebrow, main > p:first-of-type { display:none !important; }
      .app-shell { display:block; }
      #pay-print { display:block !important; }
    }
  </style>
</head>
<body${councilPreview ? ' class="council-preview"' : ''}>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="sidebar-brand"><span class="mark" aria-hidden="true">T</span><div>Timothy Finance<small>Standalone · alpha</small></div></div>
      <nav aria-label="Finance workspace">${renderSectionNav(section, page)}</nav>
      <div class="sidebar-foot">Synthetic staging data<br>No production writers attached</div>
    </aside>
    <main>
      <div class="eyebrow">Isolated staging environment</div>
      <h1>Timothy Finance</h1>
      <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
      <div class="status">Environment ready · no production writers attached</div>
      <div class="council-banner">
        <span class="council-pill">Role check</span>
        ${!roleResult || !roleResult.ok
          ? `<span>Role verification unavailable in this environment${roleResult && roleResult.reason ? ` (reason: ${escapeHtml(roleResult.reason)})` : ''} -- section access is not currently restricted by verified role for this request.</span>`
          : roleResult.role === 'compensation'
            ? `<span>Verified via Connect as role “compensation” -- restricted to the Compensation Planner section only.</span>`
            : `<span>Verified via Connect as role “${escapeHtml(roleResult.role)}”.</span>`}
      </div>
      <div class="council-banner">
        <span class="council-pill">Council view</span>
        ${councilPreview
          ? `<span>Previewing what a view-only council/auditor login would see. Editing controls are hidden. Everything shown is already aggregate/role-only synthetic data, so there is nothing further to redact here.</span><a class="council-toggle" href="/?section=${section.id}&amp;page=${page.id}">Exit preview</a>`
          : `<span>Not a real access boundary yet -- Finance has no verified staff-identity/role check of its own (that is the still-unbuilt shared-login piece of the overhaul). This only previews what a future council view’s chrome would hide.</span><a class="council-toggle" href="/?section=${section.id}&amp;page=${page.id}&amp;council=1">Preview council view</a>`}
      </div>
      ${sectionBody}
      <p><small>Every value besides Giving shown here comes from deterministic synthetic staging fixtures. Giving is ${givingSource === 'live' ? 'fetched live from Connect’s real, aggregate-only contract endpoint' : 'the committed Connect contract example (the live endpoint is not configured or did not answer), validated locally with no network call'}.</small></p>
      <footer>Timothy Lutheran Church · ${release}</footer>
    </main>
  </div>
</body>
</html>`;
}

// ── PROPERTY LEDGER WRITES ── a deliberate group that writes to Finance's own FINANCE_DB rather
// than relaying elsewhere, same pattern as COMPENSATION PLANNER WRITE just above (see
// route-manifest.js's and property-ledger-write-service.js's header comments). The enablement
// flag is checked FIRST, before any role verification, so a real request against an environment
// where it is still off (every environment, until Andrew explicitly turns it on) gets the same
// clear "not yet enabled" answer regardless of who is asking. Role gating here is admin-only,
// matching legacy's own isAdmin gate for editing property financials (src/api-finance.js's
// handlePropertyApi) -- a different, narrower set than Compensation Planner's
// admin/council/compensation, because that is what legacy itself enforces for this data.
const PROPERTY_LEDGER_WRITE_ROUTE_IDS = new Set([
  'property-reserve-entry-v1', 'property-reserve-disbursement-entry-v1',
  'property-distribution-entry-v1', 'property-capital-ledger-entry-v1',
]);
const PROPERTY_LEDGER_WRITE_PROPERTY_KEY = 'ivanhoe'; // Only property that exists today -- see property-report-service.js.

async function runPropertyLedgerWrite(routeId, db, body) {
  switch (routeId) {
    case 'property-reserve-entry-v1':
      return recordPropertyReserveMonthly(db, PROPERTY_LEDGER_WRITE_PROPERTY_KEY, String(body.reserve_key || ''), body);
    case 'property-reserve-disbursement-entry-v1':
      return recordPropertyReserveDisbursement(db, PROPERTY_LEDGER_WRITE_PROPERTY_KEY, String(body.reserve_key || ''), body);
    case 'property-distribution-entry-v1':
      return recordPropertyDistribution(db, PROPERTY_LEDGER_WRITE_PROPERTY_KEY, body);
    case 'property-capital-ledger-entry-v1':
      return recordPropertyCapitalLedgerEntry(db, PROPERTY_LEDGER_WRITE_PROPERTY_KEY, body);
    default:
      throw new Error(`Unhandled property ledger write route: ${routeId}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metadata = releaseMetadata(env);

    const route = resolveFinanceRoute(url.pathname);
    if (!route) {
      return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (!isMethodAllowedForRoute(route, request.method)) {
      return response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: route.methods.join(', ') },
      });
    }

    if (route.id === 'health') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', ...metadata });
      return response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (route.id === 'summary-v1') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify(buildSummaryV1(metadata, summary));
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Finance-Contract': SUMMARY_CONTRACT,
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'giving-preview-v1') {
      const { giving, source } = await resolveGivingSummary(env);
      const body = request.method === 'HEAD' ? null : JSON.stringify(giving);
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_CONTRACT,
        'X-Giving-Source': source,
      } });
    }

    if (route.id === 'giving-transport-evidence-v1') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({
        ...SYNTHETIC_GIVING_TRANSPORT,
        release: metadata,
      });
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_TRANSPORT_EVIDENCE_CONTRACT,
      } });
    }

    if (route.id === 'giving-quick-entry-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=giving&status=error&reason=invalid_json' } });
      }
      const entry = {
        date: form.get('date') || '',
        fund_id: form.get('fund_id') || '',
        amount: form.get('amount') || '',
        method: form.get('method') || '',
        check_number: form.get('check_number') || '',
        person_id: form.get('person_id') || '',
        notes: form.get('notes') || '',
      };
      const result = await postConnectGivingQuickEntry(env, accessJwt, entry);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=giving&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'giving', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // ── Budget builder edit/save -- Finance's own genuine write to FINANCE_DB's finance_budget_plan
    // (see budget-plan-write-service.js's top comment for the full port rationale). Gated off by
    // default: `isBudgetPlanWritesEnabled` is checked FIRST, before role verification even runs, so
    // a real request against this route today -- from any role, in any environment -- gets a plain
    // "not yet enabled" response rather than reaching the write path at all. Only a later, separately
    // approved cutover stage flips the finance_settings flag that turns this on.
    if (route.id === 'budget-plan-save-v1') {
      const writesEnabled = await isBudgetPlanWritesEnabled(env.FINANCE_DB);
      if (!writesEnabled) {
        return response(JSON.stringify({ error: 'not_yet_enabled', message: 'Budget builder editing is not yet enabled in this environment.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const roleResult = await fetchVerifiedRole(env, accessJwt);
      // Admin-only, matching every legacy Budget Planner write EXCEPT override-bulk's council
      // carve-out -- see budget-plan-write-service.js's top comment for why that carve-out isn't
      // ported yet. Every verification failure (not just an explicitly wrong role) fails closed.
      if (!roleResult.ok || roleResult.role !== 'admin') {
        return response(JSON.stringify({ error: 'access_denied', message: 'Access denied: editing budget plans requires admin access' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return response(JSON.stringify({ error: 'invalid_json', message: 'Request body must be JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const validated = validateBudgetPlanRows(payload && payload.rows);
      if (!validated.ok) {
        return response(JSON.stringify({ error: 'invalid_rows', message: validated.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const saved = await saveBudgetPlanRows(env.FINANCE_DB, validated.rows);
      return response(JSON.stringify({ ok: true, saved }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Finance-Contract': 'finance.budget-plan-save.v1' },
      });
    }

    if (route.id === 'budget-plan-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=planning&status=error&reason=invalid_json' } });
      }
      const row = {
        category: form.get('category') || '',
        fiscal_year: form.get('fiscal_year') || '',
        classification: form.get('classification') || 'Expenses',
        planned_amount: form.get('planned_amount') || '',
        notes: form.get('notes') || '',
      };
      const result = await postConnectFinanceBudgetWrite(env, accessJwt, [row]);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=planning&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'planning', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Admin-only generate/generate-all/commit/remove-a-category plan operations, each relaying to
    // its own Connect contract endpoint (src/api-contracts-service.js) -- same 303-redirect-after-
    // POST shape as budget-plan-write-v1 above, distinguished on redirect by the 'op' query param
    // (planOpKind in shell.js's GET handler) so the right form/table shows the right status.
    if (route.id === 'budget-generate-v1' || route.id === 'budget-generate-all-v1'
      || route.id === 'budget-commit-v1' || route.id === 'budget-plan-remove-v1') {
      const opKind = { 'budget-generate-v1': 'generate', 'budget-generate-all-v1': 'generate-all', 'budget-commit-v1': 'commit', 'budget-plan-remove-v1': 'remove' }[route.id];
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: `/?section=planning&op=${opKind}&status=error&reason=invalid_json` } });
      }
      let result;
      if (opKind === 'generate') {
        const targetYears = String(form.get('target_years') || '').split(',').map((s) => s.trim()).filter(Boolean);
        result = await postConnectFinanceBudgetGenerate(env, accessJwt, {
          category: form.get('category') || '', classification: form.get('classification') || 'Expenses',
          base_amount: form.get('base_amount') || '', growth_pct: form.get('growth_pct') || '', target_years: targetYears,
          notes: form.get('notes') || '',
        });
      } else if (opKind === 'generate-all') {
        result = await postConnectFinanceBudgetGenerateAll(env, accessJwt, {
          base_year: form.get('base_year') || '', target_year: form.get('target_year') || '', growth_pct: form.get('growth_pct') || '',
        });
      } else if (opKind === 'commit') {
        result = await postConnectFinanceBudgetCommit(env, accessJwt, { fiscal_year: form.get('fiscal_year') || '' });
      } else {
        result = await postConnectFinanceBudgetRemove(env, accessJwt, { category: form.get('category') || '', fiscal_year: form.get('fiscal_year') || '' });
      }
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: `/?section=planning&op=${opKind}&status=ok` } });
      }
      const params = new URLSearchParams({ section: 'planning', op: opKind, status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Budget builder's admin-only "FY{base} Projected" column correction -- shown near the
    // existing budget edit form. One category per submit (the legacy body also accepts several
    // rows at once, but this form matches the single-row shape every other Planning-adjacent form
    // here uses); leaving the amount blank clears any existing override for that category and year.
    if (route.id === 'base-projection-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=planning&status=error&reason=invalid_json' } });
      }
      const row = {
        category: form.get('category') || '',
        amount: form.get('amount') || '',
      };
      const result = await postConnectBaseProjectionWrite(env, accessJwt, { year: form.get('year') || '', rows: [row] });
      // `op=base-projection` distinguishes this form's own status from the Budget edit form
      // (budgetEntryStatus) and the generate/generate-all/commit/remove operations (planOpStatus)
      // that all share the same 'planning' section and 'status' query param -- see the GET
      // handler's own status computation below.
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=planning&op=base-projection&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'planning', op: 'base-projection', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Church Report's admin-only actual-figure correction, same 303-redirect-after-POST shape as
    // the routes above.
    if (route.id === 'church-actual-override-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=church&status=error&reason=invalid_json' } });
      }
      const row = {
        category: form.get('category') || '',
        classification: form.get('classification') || 'Expenses',
        account_name: form.get('account_name') || '',
        amount: form.get('amount') || '',
      };
      const result = await postConnectFinanceChurchActualOverride(env, accessJwt, { year: form.get('year') || '', rows: [row] });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=church&page=income-expense&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'church', page: 'income-expense', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Church Budget-vs-Actuals / Balance Sheet .xlsx import, relayed live to Connect. Unlike every
    // other write route in this file, the browser posts a real multipart/form-data file upload
    // (church-pages.js's/balance-pages.js's `<form enctype="multipart/form-data">`), not plain
    // fields -- request.formData() already parses that correctly either way, and `form.get('file')`
    // returns a File (a Blob with .size/.arrayBuffer()) here instead of a string. The relay call to
    // Connect's contract endpoint still carries JSON, per the same base64-in-JSON-body convention
    // apps/finance's own xlsx-import-service.js already established for its off-by-default routes
    // (see this codebase's other base64 users: access-jwt.js's base64UrlToUint8Array, push-sender.js's
    // b64uDecode) -- so the uploaded bytes are base64-encoded here, in the Worker, before relaying.
    // Capped at 15 MB client-side, matching legacy's own `file.size > 15 * 1024 * 1024` guard, so an
    // oversized upload never even reaches the relay call.
    if (route.id === 'church-budget-xlsx-import-write-v1' || route.id === 'church-balances-xlsx-import-write-v1') {
      const isBalances = route.id === 'church-balances-xlsx-import-write-v1';
      const redirectBase = isBalances ? { section: 'balance', page: 'position' } : { section: 'church', page: 'budget-actual' };
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'invalid_json' }).toString()}` } });
      }
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'no_file' }).toString()}` } });
      }
      if (file.size > MAX_XLSX_UPLOAD_BYTES) {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'too_large' }).toString()}` } });
      }
      const fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const result = isBalances
        ? await postConnectChurchBalancesXlsxImport(env, accessJwt, { file_base64: fileBase64 })
        : await postConnectChurchBudgetXlsxImport(env, accessJwt, { fiscal_year_hint: form.get('fiscal_year_hint') || '', file_base64: fileBase64 });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'ok' }).toString()}` } });
      }
      const params = new URLSearchParams({ ...redirectBase, status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // The four remaining Church Excel import relays, completing Church's import write parity --
    // same real multipart/form-data file-upload handling as the block above (base64-encoded here
    // before relaying, capped at MAX_XLSX_UPLOAD_BYTES client-side first so an oversized upload
    // never reaches the relay call). Monthly P&L has no linked form anywhere in this app (its
    // period_month-scoped rows are never read by any live view here -- see
    // route-manifest.js's own comment on this route), so it redirects to the plain root, same
    // convention as revenue-streams-write-v1/flow-expense-map-write-v1/cash-policy-write-v1 above;
    // Activity and Budget-by-Year both redirect back to Church Report's Multi-year trend page,
    // and the Balance Sheet counterpart to Multi-year position -- the pages whose underlying data
    // each import directly feeds.
    if (
      route.id === 'church-monthly-xlsx-import-write-v1' || route.id === 'church-activity-xlsx-import-write-v1'
      || route.id === 'church-budget-multi-year-xlsx-import-write-v1' || route.id === 'church-balances-multi-year-xlsx-import-write-v1'
    ) {
      const redirectBase = route.id === 'church-monthly-xlsx-import-write-v1' ? {}
        : route.id === 'church-balances-multi-year-xlsx-import-write-v1' ? { section: 'balance', page: 'multi-year' }
        : { section: 'church', page: 'trend' };
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'invalid_json' }).toString()}` } });
      }
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'no_file' }).toString()}` } });
      }
      if (file.size > MAX_XLSX_UPLOAD_BYTES) {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'error', reason: 'too_large' }).toString()}` } });
      }
      const fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const body = { file_base64: fileBase64 };
      const result = route.id === 'church-monthly-xlsx-import-write-v1' ? await postConnectChurchMonthlyXlsxImport(env, accessJwt, body)
        : route.id === 'church-activity-xlsx-import-write-v1' ? await postConnectChurchActivityXlsxImport(env, accessJwt, body)
        : route.id === 'church-budget-multi-year-xlsx-import-write-v1' ? await postConnectChurchBudgetMultiYearXlsxImport(env, accessJwt, body)
        : await postConnectChurchBalancesMultiYearXlsxImport(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: `/?${new URLSearchParams({ ...redirectBase, status: 'ok' }).toString()}` } });
      }
      const params = new URLSearchParams({ ...redirectBase, status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'daycare-entry-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const amount = Number(form.get('amount'));
      const body = {
        period: form.get('period') || '',
        category: form.get('category') || '',
        entry_type: form.get('entry_type') || 'actual',
        amount_cents: Number.isFinite(amount) ? Math.round(amount * 100) : null,
        notes: form.get('notes') || '',
      };
      const result = await postConnectFinanceDaycareEntry(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=actuals&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'actuals', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'board-categories-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=accounts&status=error&reason=invalid_json' } });
      }
      const path = form.get('category_path') || '';
      const boardCategory = form.get('board_category') || '';
      const body = BOARD_REVENUE_KEYS.includes(boardCategory)
        ? { revenue: { [path]: boardCategory } }
        : BOARD_EXPENSE_KEYS_LOCAL.includes(boardCategory)
          ? { expense: { [path]: boardCategory } }
          // Blank/unrecognized selection clears the assignment -- sent to both maps since this
          // form doesn't know which one (if either) currently holds this path; an empty value for
          // a path that was never in a given map is a harmless no-op there.
          : { revenue: { [path]: '' }, expense: { [path]: '' } };
      const result = await postConnectBoardCategoriesWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=accounts&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'accounts', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Chart of Accounts' purpose-tag list and per-account assignment -- two separate <form>s
    // posting to this same route (accounts-pages.js), told apart here by which fields are present.
    // The tag-list textarea always carries every tag this page currently knows about, one
    // "id,label" pair per line (a blank id mints a fresh one on Connect's side) -- a line taken out
    // is a tag taken out, so that form's own body always includes `tags`. The assignment form only
    // ever sends `category_path`/`purpose_tag_id`, never `tags`, so it merges into whatever tag
    // list Connect already has instead of swapping the whole thing in.
    if (route.id === 'purpose-tags-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=accounts&status=error&reason=invalid_json' } });
      }
      const body = {};
      if (form.has('tags')) {
        body.tags = String(form.get('tags') || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const commaIndex = line.indexOf(',');
            const id = commaIndex === -1 ? '' : line.slice(0, commaIndex).trim();
            const label = (commaIndex === -1 ? line : line.slice(commaIndex + 1)).trim();
            return id ? { id, label } : { label };
          });
      }
      const path = form.get('category_path');
      if (path) {
        body.categories = { [path]: form.get('purpose_tag_id') || '' };
      }
      const result = await postConnectPurposeTagsWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=accounts&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'accounts', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-monthly-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        period: form.get('period') || '',
        occupancy_pct: form.get('occupancy_pct') || '',
        total_revenue: form.get('total_revenue') || '',
        total_expenses: form.get('total_expenses') || '',
        net_income: form.get('net_income') || '',
        net_operating_income: form.get('net_operating_income') || '',
        available_for_distribution: form.get('available_for_distribution') || '',
        reserve_balance: form.get('reserve_balance') || '',
        loan_payment: form.get('loan_payment') || '',
        interest_expense: form.get('interest_expense') || '',
        source_report: 'finance-app',
      };
      const result = await postConnectPropertyMonthlyWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=operating-results&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'operating-results', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-repair-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        entry_date: form.get('entry_date') || '',
        category: form.get('category') || '',
        description: form.get('description') || '',
        amount: form.get('amount') || '',
        payee: form.get('payee') || '',
        capitalized: form.get('capitalized') === 'on',
      };
      const result = await postConnectPropertyRepairWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=work-orders&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'work-orders', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-distribution-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        period: form.get('period') || '',
        amount: form.get('amount') || '',
      };
      const result = await postConnectPropertyDistributionWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=distributions&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'distributions', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-reserve-monthly-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        reserve_key: form.get('reserve_key') || '',
        report_month: form.get('report_month') || '',
        tax_year: form.get('tax_year') || '',
        target_estimate: form.get('target_estimate') || '',
        contribution: form.get('contribution') || '',
        reserve_before: form.get('reserve_before') || '',
        note: form.get('note') || '',
      };
      const result = await postConnectPropertyReserveMonthlyWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=reserve-distribution&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'reserve-distribution', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-reserve-disbursement-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        reserve_key: form.get('reserve_key') || '',
        period_key: form.get('period_key') || '',
        amount: form.get('amount') || '',
        paid_via_report_month: form.get('paid_via_report_month') || '',
        note: form.get('note') || '',
      };
      const result = await postConnectPropertyReserveDisbursementWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=reserve-distribution&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'reserve-distribution', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-capital-ledger-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        entry_date: form.get('entry_date') || '',
        amount: form.get('amount') || '',
        payee: form.get('payee') || '',
        description: form.get('description') || '',
        check_ref: form.get('check_ref') || '',
        project: form.get('project') || '',
      };
      const result = await postConnectPropertyCapitalLedgerWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=capital&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'capital', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Completes Commercial Property's write parity: the six per-row Remove actions (each removes
    // one row by its natural key, same 303-redirect-after-POST shape as the write routes above --
    // the browser form always POSTs, even though the legacy route this relays to uses a different
    // HTTP method), the meta edit, and the two bulk imports.
    if (route.id === 'property-monthly-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = { period: form.get('period') || '' };
      const result = await postConnectPropertyMonthlyRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=operating-results&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'operating-results', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-distribution-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = { period: form.get('period') || '' };
      const result = await postConnectPropertyDistributionRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=distributions&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'distributions', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-reserve-monthly-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        reserve_key: form.get('reserve_key') || '',
        report_month: form.get('report_month') || '',
      };
      const result = await postConnectPropertyReserveMonthlyRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=reserve-distribution&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'reserve-distribution', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-reserve-disbursement-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        reserve_key: form.get('reserve_key') || '',
        period_key: form.get('period_key') || '',
      };
      const result = await postConnectPropertyReserveDisbursementRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=reserve-distribution&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'reserve-distribution', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-capital-ledger-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = { id: form.get('id') || '' };
      const result = await postConnectPropertyCapitalLedgerRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=capital&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'capital', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'property-repair-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = { id: form.get('id') || '' };
      const result = await postConnectPropertyRepairRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=work-orders&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'work-orders', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Property Overview's meta edit -- a per-section MERGE (property/valuation/loan/reserves/
    // capital), same shape as every other property write above; each section is submitted as its
    // own JSON object field so postConnectPropertyMetaWrite can pass it straight through unchanged.
    if (route.id === 'property-meta-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {};
      for (const section of ['property', 'valuation', 'loan', 'reserves', 'capital']) {
        const raw = form.get(section);
        if (raw === null || raw === '') continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') body[section] = parsed;
        } catch {
          return response(null, { status: 303, headers: { Location: '/?section=property&page=overview&status=error&reason=invalid_json' } });
        }
      }
      const result = await postConnectPropertyMetaWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=overview&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'overview', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Commercial Property's AHRA "Budget Detail" .xlsx import -- same real multipart/form-data
    // file-upload handling as church-budget-xlsx-import-write-v1/church-balances-xlsx-import-write-v1
    // above (base64-encoded here before relaying, capped at MAX_XLSX_UPLOAD_BYTES client-side first
    // so an oversized upload never reaches the relay call).
    if (route.id === 'property-budget-import-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=forecast&status=error&reason=no_file' } });
      }
      if (file.size > MAX_XLSX_UPLOAD_BYTES) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=forecast&status=error&reason=too_large' } });
      }
      const fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const result = await postConnectPropertyBudgetImportWrite(env, accessJwt, { file_base64: fileBase64 });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=forecast&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'forecast', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Commercial Property's pasted-in monthly-financials CSV import -- unlike the .xlsx import
    // above, legacy parses this as a plain pasted-in text field (not a file upload), so this relay
    // carries it the same way: a plain textarea field, no base64/file-upload complexity needed.
    if (route.id === 'property-monthly-import-csv-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=property&status=error&reason=invalid_json' } });
      }
      const body = {
        csv: form.get('csv') || '',
        source_report: form.get('source_report') || '',
      };
      const result = await postConnectPropertyMonthlyImportCsvWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=property&page=operating-results&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'property', page: 'operating-results', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Revenue-stream classification, flow-expense-category mapping, and the cash-runway policy
    // settings -- no existing live page in this app surfaces their read data yet (see
    // route-manifest.js's own comment), so these three routes have no linked form and redirect
    // back to the plain root rather than a specific `section`/`page`. Still a fully real,
    // directly POST-able write path: `label`/`stream` (resp. `label`/`key`) are parallel repeated
    // fields so a future form can submit the whole map at once (Connect's own
    // saveRevenueStreamMap()/saveFlowExpenseMap() overwrite the whole stored map, same as legacy).
    if (route.id === 'revenue-streams-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?status=error&reason=invalid_json' } });
      }
      const labels = form.getAll('label');
      const streams = form.getAll('stream');
      const map = {};
      labels.forEach((label, i) => { if (label) map[String(label)] = streams[i] || ''; });
      const result = await postConnectRevenueStreamsWrite(env, accessJwt, { map });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?status=ok' } });
      }
      const params = new URLSearchParams({ status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'flow-expense-map-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?status=error&reason=invalid_json' } });
      }
      const labels = form.getAll('label');
      const keys = form.getAll('key');
      const map = {};
      labels.forEach((label, i) => { if (label) map[String(label)] = keys[i] || ''; });
      const result = await postConnectFlowExpenseMapWrite(env, accessJwt, { map });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?status=ok' } });
      }
      const params = new URLSearchParams({ status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'cash-policy-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?status=error&reason=invalid_json' } });
      }
      const body = {
        policy_floor_months: form.get('policy_floor_months') || '',
        cash_on_hand_cents: form.get('cash_on_hand_cents') || '',
        cash_account_code: form.get('cash_account_code') || '',
        general_fund_budget_code: form.get('general_fund_budget_code') || '',
      };
      const result = await postConnectCashPolicyWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?status=ok' } });
      }
      const params = new URLSearchParams({ status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's Utilities/Insurance cost-share config -- shown on the Shared costs page.
    if (route.id === 'daycare-allocation-config-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const body = {
        utilityPct: form.get('utility_pct') || '',
        insurancePct: form.get('insurance_pct') || '',
      };
      const result = await postConnectDaycareAllocationConfigWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=shared-costs&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'shared-costs', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's per-(year,category) Budget-cell override -- shown on the Budget comparison
    // page. Omitting the amount field clears any existing override, same as the legacy form.
    if (route.id === 'daycare-budget-override-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const body = {
        year: form.get('year') || '',
        category: form.get('category') || '',
        budget: form.get('budget') || '',
      };
      const result = await postConnectDaycareBudgetOverrideWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=budget-comparison&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'budget-comparison', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's bulk paste-in entry -- shown on the Actuals detail page, alongside the
    // single-entry form. One row per line: period,category,entry_type,amount,notes (amount in
    // whole dollars, converted to cents here -- entry_type defaults to "actual" if omitted/blank).
    if (route.id === 'daycare-bulk-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const pasted = String(form.get('rows') || '');
      const rows = pasted.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [period, category, entryType, amount, ...noteParts] = line.split(',').map((f) => f.trim());
        const dollars = Number(amount);
        return {
          period, category,
          entry_type: entryType === 'budget' ? 'budget' : 'actual',
          amount_cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN,
          notes: noteParts.join(',').trim(),
        };
      });
      const result = await postConnectDaycareBulkWrite(env, accessJwt, { rows });
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=actuals&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'actuals', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's re-derivation from an already-imported Church Budget -- shown on the
    // Actuals detail page, alongside the single-entry and bulk-paste forms.
    if (route.id === 'daycare-church-budget-import-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const body = { year: form.get('year') || '' };
      const result = await postConnectDaycareChurchBudgetImportWrite(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=actuals&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'actuals', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report entry edit (partial correction, by id) -- same looser gate as the
    // single-entry/bulk/church-budget-import forms above, since the legacy finance/daycare/:id
    // route this relays carries no role check of its own beyond the blanket ACCESS_GATE. Ships
    // without a page form: the connect.finance-daycare-report.v1 contract this section's own
    // Actuals detail table reads is aggregated by category and never exposes a row's own id (see
    // apps/finance/README.md's changelog entry for this batch), the same allowance the Property
    // capital-ledger/repair-remove routes already used -- still a fully real, directly POST-able
    // relay for a caller that already has an id. Only fields actually present in the submitted form
    // are forwarded, so a field the caller leaves out keeps its existing value on Connect's side
    // (editDaycareEntry's own partial-edit semantics, src/api-finance.js).
    if (route.id === 'daycare-entry-edit-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const body = { id: form.get('id') || '' };
      if (form.get('period') !== null) body.period = form.get('period') || '';
      if (form.get('category') !== null) body.category = form.get('category') || '';
      if (form.get('entry_type') !== null) body.entry_type = form.get('entry_type') || '';
      if (form.get('amount') !== null) {
        const dollars = Number(form.get('amount'));
        body.amount_cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
      }
      if (form.get('notes') !== null) body.notes = form.get('notes') || '';
      const result = await postConnectDaycareEntryEdit(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=actuals&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'actuals', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report entry removal (by id) -- same shape and same "no page form yet" reasoning as
    // daycare-entry-edit-v1 above.
    if (route.id === 'daycare-entry-remove-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const body = { id: form.get('id') || '' };
      const result = await postConnectDaycareEntryRemove(env, accessJwt, body);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&page=actuals&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', page: 'actuals', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's "Sync now" trigger -- pulls fresh money figures from the daycare app's own
    // finance API, same looser gate as the forms above (finance/daycare/sync itself carries no
    // isAdmin check). Shown on Overview. Takes no fields; a bare POST is enough to trigger it.
    if (route.id === 'daycare-sync-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      try {
        await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const result = await postConnectDaycareSync(env, accessJwt, {});
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'daycare', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Daycare Report's room-data "Sync now" trigger -- pulls fresh room-level figures from the
    // daycare app's own room API, admin-only, matching finance/daycare/rooms/sync's own explicit
    // isAdmin check exactly. Shown on Overview, next to the money sync trigger above. Takes no
    // fields; a bare POST is enough to trigger it.
    if (route.id === 'daycare-rooms-sync-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      try {
        await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=error&reason=invalid_json' } });
      }
      const result = await postConnectDaycareRoomsSync(env, accessJwt, {});
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=daycare&status=ok&op=rooms-sync' } });
      }
      const params = new URLSearchParams({ section: 'daycare', status: 'error', op: 'rooms-sync', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // Compensation Plan roster editor's own fetch-edit-resubmit save: fetch the CURRENT complete
    // plan from Connect (never trust a stale copy the browser may have rendered from), apply one
    // add/edit/remove, and resubmit the whole merged plan -- see finance-compensation-client.js's
    // own comment on why a partial body would wipe the rest of a real plan.
    if (route.id === 'compensation-plan-write-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try {
        form = await request.formData();
      } catch {
        return response(null, { status: 303, headers: { Location: '/?section=compensation&status=error&reason=invalid_json' } });
      }
      const current = await fetchConnectSalaryPlannerState(env, accessJwt);
      if (!current.ok) {
        const params = new URLSearchParams({ section: 'compensation', status: 'error', reason: current.reason || 'unknown' });
        if (current.message) params.set('message', String(current.message).slice(0, 200));
        return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
      }
      const data = current.data && typeof current.data === 'object' ? { ...current.data } : {};
      const roster = Array.isArray(data.roster) ? [...data.roster] : [];
      const action = String(form.get('action') || 'add');
      const indexRaw = form.get('index');
      const index = indexRaw !== null && indexRaw !== '' ? Number(indexRaw) : null;

      if (action === 'remove' || action === 'edit') {
        if (index == null || !Number.isInteger(index) || !roster[index]) {
          return response(null, { status: 303, headers: { Location: '/?section=compensation&status=error&reason=invalid_index' } });
        }
      }
      if (action === 'remove') {
        roster.splice(index, 1);
        data.compPerWorkerMethod = reindexAfterRemove(data.compPerWorkerMethod, index);
        data.compOverrides = reindexAfterRemove(data.compOverrides, index);
      } else if (action === 'edit') {
        roster[index] = workerFromForm(form, roster[index]);
      } else {
        roster.push(workerFromForm(form, null));
      }
      data.roster = roster;

      const result = await postConnectFinanceCompensationWrite(env, accessJwt, data);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=compensation&status=ok' } });
      }
      const params = new URLSearchParams({ section: 'compensation', status: 'error', reason: result.reason || 'unknown' });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-relay-diagnostic-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const result = await callPayrollProxy(env, accessJwt, 'payroll_get_staff', {});
      const body = request.method === 'HEAD' ? null : JSON.stringify({
        ...summarizePayrollRelayDiagnostic(result),
        incomingAccessJwt: describeIncomingAccessJwt(accessJwt),
      });
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': 'finance.payroll-relay-diagnostic.v1',
      } });
    }

    // ── PAYROLL WRITES ── every one relays to Website's payroll_* RPCs, and Website's own
    // proxy is the real, authoritative gate (payroll_manage on the resolved contract-relay
    // identity, plus the period-lock check on payroll_save_hours) -- these handlers only
    // orchestrate the calls and redirect back to the page with a status message, the same
    // 303-redirect-after-POST shape giving-quick-entry-v1 above already uses.
    if (route.id === 'payroll-hours-save-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const periodStart = String(form.get('period') || '');
      const { period } = resolvePayrollPeriod(periodStart);
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const result = await saveAllHours(env, accessJwt, period.start, workspace.churchStaff, workspace.periodEntries, form);
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      params.set('status', result.ok ? 'saved' : 'error');
      if (!result.ok && result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-period-approve-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const periodStart = String(form.get('period') || '');
      const { period } = resolvePayrollPeriod(periodStart);
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const wantsApprove = form.get('action') !== 'unapprove';

      if (wantsApprove && !workspace.periodApproval) {
        const missing = payrollMissingHours(workspace.churchStaff, workspace.periodEntries);
        if (missing.length && form.get('confirm_missing') !== '1') {
          return response(null, { status: 303, headers: { Location: `/?section=payroll&period=${encodeURIComponent(period.start)}&view=entry&needs_confirm=1` } });
        }
      }
      if (!wantsApprove && form.get('confirm_unapprove') !== '1') {
        return response(null, { status: 303, headers: { Location: `/?section=payroll&period=${encodeURIComponent(period.start)}&view=entry` } });
      }

      const approvedBy = approverEmailFromJwt(accessJwt) || 'Finance';
      const result = await approvePeriod(env, accessJwt, period.start, approvedBy, workspace);
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      params.set('status', result.ok ? (wantsApprove ? 'approved' : 'unapproved') : 'error');
      if (!result.ok && result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-staff-save-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=staff-form&status=error&message=Could+not+read+the+form' } });
      }
      const result = await saveStaffFromForm(env, accessJwt, form);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=staff_saved' } });
      }
      const params = new URLSearchParams({ section: 'payroll', view: 'staff-form', status: 'error' });
      if (form.get('id')) params.set('id', String(form.get('id')));
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-staff-deactivate-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=error&message=Could+not+read+the+form' } });
      }
      const result = await deactivateStaffFromForm(env, accessJwt, form);
      if (result.ok) {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&view=entry&status=staff_removed' } });
      }
      const params = new URLSearchParams({ section: 'payroll', view: 'staff-form', status: 'error', id: String(form.get('id') || '') });
      if (result.message) params.set('message', String(result.message).slice(0, 200));
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    if (route.id === 'payroll-csv-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const { period } = resolvePayrollPeriod(url.searchParams.get('period'));
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const csv = buildCsvForPeriod(period, workspace);
      if (request.method === 'HEAD') {
        return response(null, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
      }
      return response(csv, { headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll-${period.start}.csv"`,
      } });
    }

    if (route.id === 'payroll-email-v1') {
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      let form;
      try { form = await request.formData(); } catch {
        return response(null, { status: 303, headers: { Location: '/?section=payroll&status=error&message=Could+not+read+the+form' } });
      }
      const { period } = resolvePayrollPeriod(String(form.get('period') || ''));
      const workspace = await loadPayrollWorkspace(env, accessJwt, period.start, period.end);
      const result = await emailReport(env, accessJwt, period, workspace, form.get('force') === '1');
      const params = new URLSearchParams({ section: 'payroll', period: period.start, view: 'entry' });
      if (result.ok) {
        params.set('status', 'emailed');
        if (result.to) params.set('to', result.to);
      } else if (result.reason === 'already_sent') {
        params.set('status', 'already_sent');
        if (result.alreadySentTo) params.set('to', result.alreadySentTo);
        if (result.alreadySentAt) params.set('at', result.alreadySentAt);
      } else {
        params.set('status', 'error');
        params.set('message', String(result.message || result.reason || 'unknown error').slice(0, 200));
      }
      return response(null, { status: 303, headers: { Location: `/?${params.toString()}` } });
    }

    // ── CSV import writes (see csv-import-service.js's own header comment) — each handler here
    // only reads the JSON body and turns the pure result object back into a Response; every gate,
    // parse, validation, and write decision lives in the service module. Every one of these four
    // routes is gated OFF by default inside its own `run*CsvImport` call (`isCsvImportWritesEnabled`)
    // -- a real request today gets a 403 with a clear "not yet enabled" message, not a write.
    if (route.id === 'import-church-v1' || route.id === 'import-church-balances-v1'
      || route.id === 'import-daycare-v1' || route.id === 'import-property-budget-v1') {
      let body;
      try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== 'object') {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const runner = {
        'import-church-v1': runChurchEntriesCsvImport,
        'import-church-balances-v1': runChurchBalancesCsvImport,
        'import-daycare-v1': runDaycareEntriesCsvImport,
        'import-property-budget-v1': runPropertyBudgetMonthlyCsvImport,
      }[route.id];
      const result = await runner(env, env.FINANCE_DB, body);
      const { status, ...payload } = result;
      return response(JSON.stringify(payload), {
        status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // ── .xlsx (Excel) import writes -- see xlsx-import-service.js's own header comment. A
    // SEPARATE gate from the CSV import routes just above (`isXlsxImportWritesEnabled`, checked
    // inside each `run*XlsxImport` call, never `isCsvImportWritesEnabled`) -- enabling CSV import
    // must never silently enable this path. The uploaded file arrives as a `fileBase64` field on
    // the same plain JSON body every other FINANCE_DB write route in this app already takes.
    if (route.id === 'import-church-xlsx-v1' || route.id === 'import-church-balances-xlsx-v1') {
      let body;
      try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== 'object') {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const runner = {
        'import-church-xlsx-v1': runChurchEntriesXlsxImport,
        'import-church-balances-xlsx-v1': runChurchBalancesXlsxImport,
      }[route.id];
      const result = await runner(env, env.FINANCE_DB, body);
      const { status, ...payload } = result;
      return response(JSON.stringify(payload), {
        status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // ── COMPENSATION PLANNER WRITE ── the one route in this file that writes to Finance's own
    // FINANCE_DB rather than relaying elsewhere (see route-manifest.js's and
    // compensation-plan-write-service.js's header comments). The enablement flag is checked
    // FIRST, before any role verification, so a real request against an environment where it is
    // still off (every environment, until Andrew explicitly turns it on) gets the same clear
    // "not yet enabled" answer regardless of who is asking.
    if (route.id === 'compensation-plan-save-v1') {
      const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
      const enabled = await isCompensationPlanWriteEnabled(env, env.FINANCE_DB);
      if (!enabled) {
        return response(JSON.stringify({
          error: 'not_yet_enabled',
          message: 'Compensation Planner editing is not yet enabled in this environment.',
        }), { status: 503, headers: jsonHeaders });
      }
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const roleResult = await fetchVerifiedRole(env, accessJwt);
      if (!roleResult.ok || !COMPENSATION_LIVE_ALLOWED_ROLES.includes(roleResult.role)) {
        return response(JSON.stringify({
          error: 'Access denied: editing the Compensation Planner requires a verified admin, council, or compensation role',
        }), { status: 403, headers: jsonHeaders });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      const fiscalYear = Number.isInteger(payload.fiscalYear) ? payload.fiscalYear : parseInt(payload.fiscalYear, 10);
      // Display-only, unverified label for who made this save -- same precedent and same safety
      // argument as approverEmailFromJwt's own header comment in payroll-section.js: the real
      // access decision already happened above via fetchVerifiedRole's independently-verified
      // signature check, so a forged token cannot reach this line with a disallowed role, and
      // this value is never used for anything but the audit column.
      const updatedBy = approverEmailFromJwt(accessJwt) || '';
      const result = await applyCompensationWorkerPlanWrite(env.FINANCE_DB, {
        fiscalYear, role: roleResult.role, updatedBy, rows: payload.rows,
      });
      if (result.error) {
        return response(JSON.stringify({ error: result.error }), { status: result.status || 400, headers: jsonHeaders });
      }
      return response(JSON.stringify({ ok: true, saved: result.saved }), { status: 200, headers: jsonHeaders });
    }

    // ── COMPENSATION PLANNER: GLOBAL raise-plan options -- additive to the write above, admin/
    // compensation only (see compensation-raise-plan-service.js's header comment; council is
    // deliberately excluded here, matching legacy's own split -- council's equivalent is its own
    // private draft, the next route below). Reuses the SAME isCompensationPlanWriteEnabled flag
    // and the SAME "gate before role check" ordering as compensation-plan-save-v1 above.
    if (route.id === 'compensation-raise-plan-save-v1') {
      const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
      const enabled = await isCompensationPlanWriteEnabled(env, env.FINANCE_DB);
      if (!enabled) {
        return response(JSON.stringify({
          error: 'not_yet_enabled',
          message: 'Compensation Planner editing is not yet enabled in this environment.',
        }), { status: 503, headers: jsonHeaders });
      }
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const roleResult = await fetchVerifiedRole(env, accessJwt);
      if (!roleResult.ok || !RAISE_PLAN_WRITE_ROLES.includes(roleResult.role)) {
        return response(JSON.stringify({
          error: 'Access denied: editing global raise-plan options requires a verified admin or compensation role',
        }), { status: 403, headers: jsonHeaders });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      const fiscalYear = Number.isInteger(payload.fiscalYear) ? payload.fiscalYear : parseInt(payload.fiscalYear, 10);
      const updatedBy = approverEmailFromJwt(accessJwt) || '';
      const result = await saveRaisePlanOptions(env.FINANCE_DB, {
        fiscalYear, role: roleResult.role, updatedBy,
        customPct: payload.customPct, scalePct: payload.scalePct, baselineRosterOnly: payload.baselineRosterOnly,
      });
      if (result.error) {
        return response(JSON.stringify({ error: result.error }), { status: result.status || 400, headers: jsonHeaders });
      }
      return response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
    }

    // ── COMPENSATION PLANNER: per-council-member PRIVATE draft save -- council only. See
    // The identity comes only from Connect's verified role contract; a role-only older
    // response cannot authorize selecting a private draft row.
    if (route.id === 'compensation-council-draft-save-v1') {
      const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
      const enabled = await isCompensationPlanWriteEnabled(env, env.FINANCE_DB);
      if (!enabled) {
        return response(JSON.stringify({
          error: 'not_yet_enabled',
          message: 'Compensation Planner editing is not yet enabled in this environment.',
        }), { status: 503, headers: jsonHeaders });
      }
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const roleResult = await fetchVerifiedRole(env, accessJwt);
      if (!roleResult.ok || roleResult.role !== 'council') {
        return response(JSON.stringify({
          error: 'Access denied: only a verified council role may save a private compensation draft',
        }), { status: 403, headers: jsonHeaders });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      const fiscalYear = Number.isInteger(payload.fiscalYear) ? payload.fiscalYear : parseInt(payload.fiscalYear, 10);
      const councilIdentity = roleResult.identity || '';
      if (!councilIdentity) return response(JSON.stringify({error:'Verified identity unavailable'}), {status:403,headers:jsonHeaders});
      const result = await saveCouncilDraft(env.FINANCE_DB, {
        fiscalYear, role: roleResult.role, councilIdentity,
        customPct: payload.customPct, scalePct: payload.scalePct, baselineRosterOnly: payload.baselineRosterOnly,
        workerOverrides: payload.workerOverrides,
      });
      if (result.error) {
        return response(JSON.stringify({ error: result.error }), { status: result.status || 400, headers: jsonHeaders });
      }
      return response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
    }

    if (PROPERTY_LEDGER_WRITE_ROUTE_IDS.has(route.id)) {
      const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
      const enabled = await isPropertyLedgerWritesEnabled(env, env.FINANCE_DB);
      if (!enabled) {
        return response(JSON.stringify({
          error: 'not_yet_enabled',
          message: 'Property ledger writes are not yet enabled in this environment.',
        }), { status: 503, headers: jsonHeaders });
      }
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const roleResult = await fetchVerifiedRole(env, accessJwt);
      if (!roleResult.ok || roleResult.role !== 'admin') {
        return response(JSON.stringify({
          error: 'Access denied: editing property financials requires admin access',
        }), { status: 403, headers: jsonHeaders });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
      }
      try {
        const result = await runPropertyLedgerWrite(route.id, env.FINANCE_DB, body);
        return response(JSON.stringify(result), { status: 200, headers: jsonHeaders });
      } catch (e) {
        if (e instanceof PropertyLedgerValidationError) {
          return response(JSON.stringify({ error: e.message }), { status: 400, headers: jsonHeaders });
        }
        return response(JSON.stringify({ error: 'Write failed' }), { status: 500, headers: jsonHeaders });
      }
    }

    if (route.id === 'summary-legacy') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify({ ...metadata, dataClassification: 'synthetic', summary });
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Deprecation: 'true',
          Link: '</api/v1/summary>; rel="successor-version"',
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'shell') {
      if (request.method === 'HEAD') return response(null, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      try {
        const section = resolveFinanceSection(url.searchParams.get('section'));
        const pageId = url.searchParams.get('page');
        // The 'page' query param is optional -- resolveFinancePage() is what actually defaults a
        // missing/unknown one to the section's first page (e.g. Compensation's 'plan'), the same
        // resolution renderCompensationPage's own pageId argument (page.id, not this raw pageId)
        // already goes through in renderSectionBody below. Needed here, before that render happens,
        // to gate the Compensation Plan roster editor's own live fetch on the right page.
        const effectivePageId = resolveFinancePage(section, pageId).id;
        const councilPreview = url.searchParams.get('council') === '1';
        const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
        const roleResult = await fetchVerifiedRole(env, accessJwt);
        // Only tightens what this pass has real, verified evidence for -- member/volunteer get
        // nothing, compensation gets only the compensation-tagged section -- and only when a
        // role was actually verified. See connect-role-client.js's own comment for why this
        // deliberately stops short of replicating the full legacy permission matrix, and the
        // council-banner markup below for how the sole remaining fail-open case (verification
        // genuinely not configured -- staging's permanent, intentional state) is disclosed rather
        // than silently treated as fully open.
        //
        // Every OTHER verification failure -- no Access identity reached this deep, a network
        // error, a non-200 from Connect, malformed JSON, or a malformed role payload -- must fail
        // CLOSED, not open: those are exactly the conditions under which a real production
        // member/volunteer/compensation-only identity could otherwise see every section simply
        // because the verification call happened to fail at that moment. 'not_configured' is
        // structurally different: it is staging's normal, permanent, disclosed state (no
        // CONNECT_SERVICE binding/key exists there at all), not a runtime failure of a real check,
        // so it alone keeps failing open exactly as before.
        const roleVerificationBrokenUnsafely = !roleResult.ok && (env.ENVIRONMENT !== 'staging' || roleResult.reason !== 'not_configured');
        if (roleVerificationBrokenUnsafely || (roleResult.ok && !roleCanAccessSection(roleResult.role, section))) {
          // Not just "/" -- the default section (Financial Health) is itself off-limits to a
          // role this narrow, so that would only bounce straight back into another denial. There
          // is no available-section link to offer when verification itself is broken -- there is
          // no verified role to compute one from.
          const availableSection = roleResult.ok
            ? FINANCE_PARITY_SECTIONS.find((s) => roleCanAccessSection(roleResult.role, s))
            : null;
          const returnLink = availableSection
            ? `<p><a href="/?section=${escapeHtml(availableSection.id)}">Return to your available section</a></p>` : '';
          const denialMessage = roleVerificationBrokenUnsafely
            ? 'Role verification failed and access cannot be safely confirmed for this request. Try reloading the page; if this continues, contact the Finance administrator.'
            : 'Your verified Connect role does not have access to this section of Finance.';
          return response(
            `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.5rem;color:#1a1a2a">`
            + `<h1>Access denied</h1><p>${denialMessage}</p>`
            + `${returnLink}</body></html>`,
            { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        // Every conditional read below is wrapped in safeSyntheticRead() (see
        // synthetic-read-guard.js): production's real Finance D1 starts with zero
        // `source='synthetic_fixture'` rows, and several of these readers correctly throw when
        // their expected fixture row is entirely absent rather than genuinely erroring. Before this
        // guard, one such throw took down the ENTIRE response with a generic 503 -- even for a
        // section whose own independent live-first resolver (church/balance/daycare/property/
        // compensation) had already succeeded. Now a failed read degrades to the
        // SYNTHETIC_UNAVAILABLE sentinel instead, and renderSectionBody/the per-section render
        // functions below show an honest "data unavailable" indication for just that piece --
        // never a fabricated blank/zero, and never a crash of the rest of the page. `null` still
        // means "not applicable to this section" everywhere below; the sentinel is a distinct value
        // exactly so the two are never confused.
        // 'packet' no longer reads the plain synthetic summary directly -- Board packet's
        // Financial position card now reads the SAME live-first balanceSheet resolver result
        // Financial Health/Balance Sheet already use (see balanceSheet's own gate below), instead
        // of this section's own separately-summed synthetic aggregate. Health/Church are unchanged.
        const summary = ['health', 'church'].includes(section.id)
          ? await safeSyntheticRead(() => readSyntheticSummary(env.FINANCE_DB)) : null;
        // Health/Packet still read the plain synthetic rows -- unchanged, out of scope for this
        // contract. The 'church' section (Church Report itself) instead tries the real
        // connect.finance-church-report.v1 endpoint first and falls back to the same synthetic
        // fixture, labeled, via resolveChurchReport -- same live-first pattern as Budget's
        // resolveBudgetReport for the 'planning' section below. 'charts' now also computes
        // churchReportLive (its revenue-mix/expense-mix/giving-pace pages prefer it), still
        // alongside the plain synthetic `churchReport` array below that Health/Packet need.
        // Unlike propertyReservesLive/propertyReserves further down -- where resolvePropertyReserves
        // deliberately has no fallback re-read of its own, and the caller supplies the
        // already-fetched synthetic array instead -- resolveChurchReport's own fallback re-reads
        // readSyntheticChurchReport() itself (see church-report-service.js; the 'church' section
        // never also needed the plain array, so this never came up there). For 'charts' specifically,
        // when the live call isn't configured or fails, this does mean two separate reads of the
        // same synthetic fixture in one request (one for `churchReport`, one inside
        // `churchReportLive`'s fallback) -- a known, accepted duplicate-read cost of reusing an
        // existing single-purpose resolver here rather than changing its shared signature.
        // 'packet' no longer reads the plain synthetic churchReport array directly either -- Board
        // packet's Operating result card now reads churchReportLive just below (its own fallback
        // re-reads readSyntheticChurchReport() internally when needed), same split as 'church'
        // already has with churchReport/churchReportLive here. Health/Charts are unchanged.
        const churchReport = ['health', 'charts'].includes(section.id)
          ? await safeSyntheticRead(() => readSyntheticChurchReport(env.FINANCE_DB)) : null;
        // Financial Health's Operating result card also tries the real endpoint now, via the same
        // resolveChurchReport used by the 'church' section -- see health-view-model.js's
        // resolveOperating. This is a deliberate second, independent call/read of the same
        // synthetic fallback as `churchReport` just above when the live fetch isn't configured or
        // fails (one extra query-budgeted SELECT on that path): `churchReport`'s raw rows still
        // feed Health's own Revenue/expense mix and Church operating bridge panels unchanged and
        // out of scope for this contract, so it can't simply be reused here without those panels
        // also silently switching shape. Charts' revenue-mix/expense-mix/giving-pace pages
        // independently prefer this same live result too.
        // Board packet's Operating result card now also uses this live-first result (see
        // board-packet-service.js's resolveBoardPacketOperating) -- same deliberate second/
        // independent-read tradeoff already noted above for Health's own Operating result card,
        // not a new one introduced by 'packet'.
        const churchReportLive = ['health', 'church', 'charts', 'packet'].includes(section.id)
          ? await safeSyntheticRead(() => resolveChurchReport(env, env.FINANCE_DB)) : null;
        // The plain synthetic `churchTrends` read that used to live here is gone -- only Board
        // packet ever used it, and Board packet now uses churchTrendLive below instead (same split
        // as churchReport/churchReportLive just above).
        // The 'trend' page of the 'church' section (multi-year operating trend) tries the real
        // connect.finance-church-report-trend.v1 endpoint first and falls back to the same
        // synthetic fixture (readSyntheticChurchTrends, called internally by resolveChurchTrend's
        // own fallback), same live-first pattern as Church Report's own resolveChurchReport. Board
        // packet's Operating trend card now uses this same live-first result too (see
        // board-packet-service.js's resolveBoardPacketTrend) instead of a separate plain synthetic
        // `churchTrends` read -- same deliberate second/independent-read tradeoff as
        // churchReportLive just above, not a new query-budget type.
        const churchTrendLive = ['church', 'packet'].includes(section.id)
          ? await safeSyntheticRead(() => resolveChurchTrend(env, env.FINANCE_DB)) : null;
        // Balance Sheet tries the real connect.finance-balance-sheet.v1 endpoint first and falls
        // back to the same synthetic fixture, labeled, via resolveBalanceSheet -- same live-first
        // pattern as Church Report's resolveChurchReport just above and Budget's
        // resolveBudgetReport below. readSyntheticBalanceSheet is still used internally by
        // resolveBalanceSheet's own fallback path, not called directly here anymore. Financial
        // Health's Financial position card also uses this now (see health-view-model.js's
        // resolvePosition) -- same deliberate second/independent-read tradeoff noted above
        // churchReportLive for Health's Operating result card. Board packet's own Financial
        // position card uses this same result too (see board-packet-service.js's
        // resolveBoardPacketPosition) instead of its old separate synthetic `summary.balanceSheet`
        // aggregate -- not a new query-budget type, the same tradeoff as churchReportLive above.
        const balanceSheet = ['health', 'balance', 'packet'].includes(section.id)
          ? await safeSyntheticRead(() => resolveBalanceSheet(env, env.FINANCE_DB)) : null;
        // Multi-year position tries the real connect.finance-balance-sheet-trend.v1 endpoint first
        // and falls back to the same synthetic trend fixture, labeled, via resolveBalanceSheetTrend
        // -- same live-first pattern as resolveBalanceSheet just above. readSyntheticBalanceTrends
        // is still used internally by resolveBalanceSheetTrend's own fallback path, not called
        // directly here anymore.
        const balanceTrends = section.id === 'balance'
          ? await safeSyntheticRead(() => resolveBalanceSheetTrend(env, env.FINANCE_DB)) : null;
        const daycareReport = section.id === 'health'
          ? await safeSyntheticRead(() => readSyntheticDaycareReport(env.FINANCE_DB)) : null;
        // The 'daycare' section (Daycare Report itself) tries the real
        // connect.finance-daycare-report.v1 endpoint first and falls back to the same synthetic
        // fixture, labeled, via resolveDaycareReport -- same live-first pattern as Church Report's
        // resolveChurchReport and Balance Sheet's resolveBalanceSheet above. 'health' keeps reading
        // the plain synthetic rows above -- unchanged, out of scope for this contract.
        const daycareReportLive = section.id === 'daycare'
          ? await safeSyntheticRead(() => resolveDaycareReport(env, env.FINANCE_DB)) : null;
        const propertyReport = section.id === 'property' || section.id === 'health'
          ? await safeSyntheticRead(() => readSyntheticPropertyReport(env.FINANCE_DB)) : null;
        const propertyReserves = ['property', 'charts'].includes(section.id)
          ? await safeSyntheticRead(() => readSyntheticPropertyReserves(env.FINANCE_DB)) : null;
        const propertyLedgers = section.id === 'property'
          ? await safeSyntheticRead(() => readSyntheticPropertyLedgers(env.FINANCE_DB)) : null;
        // Property Valuation tries the real connect.finance-property-valuation.v1 endpoint first
        // and falls back to the same synthetic fixture, labeled, via resolvePropertyValuation --
        // same live-first pattern as Church Report's resolveChurchReport and Balance Sheet's
        // resolveBalanceSheet above.
        const propertyValuation = section.id === 'property'
          ? await safeSyntheticRead(() => resolvePropertyValuation(env, env.FINANCE_DB)) : null;
        // Property Operating results/Reserves & distribution/Capital & repairs ledgers each try
        // their own real connect.finance-property-*.v1 endpoint first and fall back to the same
        // synthetic fixtures read just above, labeled -- same live-first pattern as Property
        // Valuation above. Only the 'property' section's own pages use propertyReportLive/
        // propertyLedgersLive; 'overview'/'health' keep reading the plain synthetic
        // propertyReport/propertyLedgers above directly, unchanged and out of scope for this
        // contract. propertyReport may itself already be SYNTHETIC_UNAVAILABLE here --
        // resolvePropertyReport only threads it through as its own fallback's `rows`, it never
        // dereferences it, so this call still can't throw. propertyReservesLive is also computed
        // for 'charts' (its cash-reserve page's property-tax-reserve KPI prefers it, falling back
        // to the already-fetched synthetic `propertyReserves` array above) -- same shape as
        // churchReportLive's 'church'/'charts' split above.
        const propertyReportLive = section.id === 'property'
          ? await safeSyntheticRead(() => resolvePropertyReport(env, propertyReport)) : null;
        const propertyReservesLive = ['property', 'charts'].includes(section.id)
          ? await safeSyntheticRead(() => resolvePropertyReserves(env)) : null;
        const propertyLedgersLive = section.id === 'property'
          ? await safeSyntheticRead(() => resolvePropertyLedgers(env)) : null;
        const propertyForecast = section.id === 'property'
          ? await safeSyntheticRead(() => readSyntheticPropertyForecast(env.FINANCE_DB)) : null;
        // Run-rate forecast tries the real connect.finance-property-forecast.v1 endpoint first and
        // falls back to the plain synthetic rows just above, labeled -- same live-first pattern as
        // Property Operating/Reserves/Ledgers above. propertyForecast may itself already be
        // SYNTHETIC_UNAVAILABLE here -- resolvePropertyForecast only threads it through as its own
        // fallback's `rows`, it never dereferences it, so this call still can't throw.
        const propertyForecastLive = section.id === 'property'
          ? await safeSyntheticRead(() => resolvePropertyForecast(env, propertyForecast)) : null;
        const propertyDistributions = section.id === 'property'
          ? await safeSyntheticRead(() => readSyntheticPropertyDistributions(env.FINANCE_DB)) : null;
        const budgetReport = section.id === 'planning'
          ? await safeSyntheticRead(() => resolveBudgetReport(env, env.FINANCE_DB)) : null;
        const accountsReport = ['accounts', 'quickbooks'].includes(section.id)
          ? await safeSyntheticRead(() => resolveAccountsReport(env, env.FINANCE_DB)) : null;
        const dataStatus = ['data', 'health', 'quickbooks'].includes(section.id)
          ? await safeSyntheticRead(() => resolveDataStatus(env, env.FINANCE_DB)) : null;
        const compensationReport = section.id === 'compensation'
          ? await safeSyntheticRead(() => readSyntheticCompensationReport(env.FINANCE_DB)) : null;
        // The 'plan' page of the compensation section tries the real connect.finance-compensation.v1
        // endpoint and falls back to the same synthetic fixture, labeled, via resolveCompensationReport
        // -- same live-first pattern as every resolver above, with one deliberate difference: the live
        // fetch is only ever attempted when roleResult independently confirms the viewer is
        // admin/council/compensation (see compensation-report-service.js's own comment on why this
        // one contract cannot safely fail open the way the aggregate contracts above do).
        // compensationReport may already be SYNTHETIC_UNAVAILABLE here -- same as propertyReport
        // above, resolveCompensationReport only threads it through, it never dereferences it.
        const compensationRoleVerified = roleResult.ok && COMPENSATION_LIVE_ALLOWED_ROLES.includes(roleResult.role);
        const compensationReportLive = section.id === 'compensation'
          ? await safeSyntheticRead(() => resolveCompensationReport(env, compensationReport, compensationRoleVerified)) : null;
        const compensationBenchmarks = section.id === 'compensation'
          ? await safeSyntheticRead(() => readSyntheticCompensationBenchmarks(env.FINANCE_DB)) : null;
        const compensationBenefits = section.id === 'compensation'
          ? await safeSyntheticRead(() => readSyntheticCompensationBenefits(env.FINANCE_DB)) : null;
        // The roster editor (compensation-editor-pages.js) is admin/compensation only -- council's
        // real editing surface stays the separate, narrower raise-plan-field overlay
        // (COUNCIL_EDITABLE_FIELDS, api-finance.js), not this whole-roster editor. Only fetched on
        // the Plan page itself, and only via the same fetchConnectSalaryPlannerState() relay the
        // save route resubmits against -- it never throws, so no safeSyntheticRead wrapper is
        // needed here (unlike the resolvers above, which can).
        const canEditCompensation = roleResult.ok && (roleResult.role === 'admin' || roleResult.role === 'compensation');
        const compensationPlanRaw = (section.id === 'compensation' && effectivePageId === 'plan' && canEditCompensation)
          ? await fetchConnectSalaryPlannerState(env, request.headers.get('Cf-Access-Jwt-Assertion') || '') : null;
        const compensationEditIndex = (section.id === 'compensation' && effectivePageId === 'plan') ? (() => {
          const raw = url.searchParams.get('edit');
          if (raw === null) return null;
          const n = Number(raw);
          return Number.isInteger(n) && n >= 0 ? n : null;
        })() : null;
        const compensationEntryStatus = section.id === 'compensation' ? url.searchParams.get('status') : null;
        const compensationEntryMessage = compensationEntryStatus === 'error'
          ? describeCompensationEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const cashRunway = ['health', 'charts'].includes(section.id)
          ? await safeSyntheticRead(() => readSyntheticCashRunway(env.FINANCE_DB)) : null;
        const { giving, source: givingSource } = ['health', 'giving', 'charts', 'packet'].includes(section.id)
          ? await resolveGivingSummary(env) : { giving: SYNTHETIC_GIVING, source: 'synthetic-fallback' };
        const givingEntryStatus = section.id === 'giving' ? url.searchParams.get('status') : null;
        const givingEntryMessage = givingEntryStatus === 'error'
          ? describeGivingEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // 'op' distinguishes a generate/generate-all/commit/remove redirect (planOp* below) from a
        // plain manual-edit redirect (budgetEntryStatus, unchanged) -- both land back on
        // ?section=planning with the same status/reason/message shape, so the presence of 'op' is
        // what tells the two apart.
        const planOpKind = section.id === 'planning' ? url.searchParams.get('op') : null;
        const budgetEntryStatus = section.id === 'planning' && !planOpKind ? url.searchParams.get('status') : null;
        const budgetEntryMessage = budgetEntryStatus === 'error'
          ? describeBudgetEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const planOpStatus = planOpKind && planOpKind !== 'base-projection' ? url.searchParams.get('status') : null;
        const planOpMessage = planOpStatus === 'error'
          ? describeBudgetPlanOpError(url.searchParams.get('reason'), url.searchParams.get('message'), BUDGET_PLAN_OP_VERBS[planOpKind] || 'operation')
          : null;
        // Base-projection is its own form on the same 'builder' page as the Budget edit form and
        // the generate/generate-all/commit/remove operations above -- `op=base-projection` (set by
        // the POST handler) keeps its status/message from bleeding onto those other forms, the same
        // way planOpKind itself already separates the operations from budgetEntryStatus.
        const baseProjectionEntryStatus = planOpKind === 'base-projection' ? url.searchParams.get('status') : null;
        const baseProjectionEntryMessage = baseProjectionEntryStatus === 'error'
          ? describeBaseProjectionEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const churchOverrideStatus = section.id === 'church' ? url.searchParams.get('status') : null;
        const churchOverrideMessage = churchOverrideStatus === 'error'
          ? describeChurchOverrideError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // The Budget vs. Actuals .xlsx import form lives on its own 'budget-actual' page (never
        // the same page as the actual-override form above), so reusing the same
        // section-id-scoped status/reason/message query-param shape as churchOverrideStatus above
        // cannot bleed between the two forms -- only one of the two pages is ever rendered per
        // request.
        const churchBudgetXlsxImportStatus = section.id === 'church' ? url.searchParams.get('status') : null;
        const churchBudgetXlsxImportMessage = churchBudgetXlsxImportStatus === 'error'
          ? describeChurchXlsxImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape, for the Balance Sheet .xlsx import
        // form on the 'position' page.
        const balanceXlsxImportStatus = section.id === 'balance' ? url.searchParams.get('status') : null;
        const balanceXlsxImportMessage = balanceXlsxImportStatus === 'error'
          ? describeChurchXlsxImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape, for the Activity/Budget-by-Year
        // multi-year .xlsx import forms, both on the 'trend' page -- same "both forms show the same
        // redirect's status" imprecision daycareBulkEntryStatus/daycareChurchBudgetImportEntryStatus
        // below already accept for two forms sharing one page.
        const churchActivityXlsxImportStatus = section.id === 'church' ? url.searchParams.get('status') : null;
        const churchActivityXlsxImportMessage = churchActivityXlsxImportStatus === 'error'
          ? describeChurchXlsxImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const churchBudgetMultiYearXlsxImportStatus = section.id === 'church' ? url.searchParams.get('status') : null;
        const churchBudgetMultiYearXlsxImportMessage = churchBudgetMultiYearXlsxImportStatus === 'error'
          ? describeChurchXlsxImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape, for the Balance Sheet multi-year
        // .xlsx import form on the 'multi-year' page.
        const balanceMultiYearXlsxImportStatus = section.id === 'balance' ? url.searchParams.get('status') : null;
        const balanceMultiYearXlsxImportMessage = balanceMultiYearXlsxImportStatus === 'error'
          ? describeChurchXlsxImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const daycareEntryStatus = section.id === 'daycare' ? url.searchParams.get('status') : null;
        const daycareEntryMessage = daycareEntryStatus === 'error'
          ? describeDaycareEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape as daycareEntryStatus above, for the
        // three further Daycare Report write forms (allocation-config, budget-override, bulk,
        // church-budget-import) -- distinguished by `page`, each page shows only its own form.
        const daycareAllocationConfigEntryStatus = section.id === 'daycare' ? url.searchParams.get('status') : null;
        const daycareAllocationConfigEntryMessage = daycareAllocationConfigEntryStatus === 'error'
          ? describeDaycareAllocationConfigEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const daycareBudgetOverrideEntryStatus = section.id === 'daycare' ? url.searchParams.get('status') : null;
        const daycareBudgetOverrideEntryMessage = daycareBudgetOverrideEntryStatus === 'error'
          ? describeDaycareBudgetOverrideEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const daycareBulkEntryStatus = section.id === 'daycare' ? url.searchParams.get('status') : null;
        const daycareBulkEntryMessage = daycareBulkEntryStatus === 'error'
          ? describeDaycareBulkEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const daycareChurchBudgetImportEntryStatus = section.id === 'daycare' ? url.searchParams.get('status') : null;
        const daycareChurchBudgetImportEntryMessage = daycareChurchBudgetImportEntryStatus === 'error'
          ? describeDaycareChurchBudgetImportEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape as daycareEntryStatus above, for the
        // two "Sync now" triggers on Overview -- both redirect to the same ?section=daycare, so an
        // `op=rooms-sync` marker (set only by the room-sync route) tells the two statuses apart.
        const daycareSyncStatus = section.id === 'daycare' && url.searchParams.get('op') !== 'rooms-sync' ? url.searchParams.get('status') : null;
        const daycareSyncMessage = daycareSyncStatus === 'error'
          ? describeDaycareSyncError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const daycareRoomsSyncStatus = section.id === 'daycare' && url.searchParams.get('op') === 'rooms-sync' ? url.searchParams.get('status') : null;
        const daycareRoomsSyncMessage = daycareRoomsSyncStatus === 'error'
          ? describeDaycareRoomsSyncError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const boardCategoryEntryStatus = section.id === 'accounts' ? url.searchParams.get('status') : null;
        const boardCategoryEntryMessage = boardCategoryEntryStatus === 'error'
          ? describeBoardCategoryEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape as boardCategoryEntryStatus above --
        // both the tag-list form and the assignment form (accounts-pages.js) redirect back to this
        // same ?section=accounts, so this one status covers whichever of the two was just submitted.
        const purposeTagsEntryStatus = section.id === 'accounts' ? url.searchParams.get('status') : null;
        const purposeTagsEntryMessage = purposeTagsEntryStatus === 'error'
          ? describePurposeTagsEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Both property forms (Operating results' monthly entry and Work orders' repair entry)
        // redirect back to ?section=property with the same status/reason/message shape,
        // distinguished by `page` (each page shows only its own form) -- so both statuses read the
        // same query params, just through their own describer for the right wording.
        const propertyMonthlyEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyMonthlyEntryMessage = propertyMonthlyEntryStatus === 'error'
          ? describePropertyMonthlyEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyRepairEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyRepairEntryMessage = propertyRepairEntryStatus === 'error'
          ? describePropertyRepairEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shape as the two property statuses above, for Distributions/Reserve schedule &
        // disbursement/Capital improvements -- also reading the same shared status/reason/message
        // query params (distinguished by `page`, each page shows only its own form).
        const propertyDistributionEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyDistributionEntryMessage = propertyDistributionEntryStatus === 'error'
          ? describePropertyDistributionEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyReserveMonthlyEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyReserveMonthlyEntryMessage = propertyReserveMonthlyEntryStatus === 'error'
          ? describePropertyReserveMonthlyEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyReserveDisbursementEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyReserveDisbursementEntryMessage = propertyReserveDisbursementEntryStatus === 'error'
          ? describePropertyReserveDisbursementEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyCapitalLedgerEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyCapitalLedgerEntryMessage = propertyCapitalLedgerEntryStatus === 'error'
          ? describePropertyCapitalLedgerEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        // Same shared status/reason/message query-param shape as the six property statuses above,
        // completing Commercial Property's write parity: the six per-row Remove actions, the meta
        // edit, and the two bulk imports each redirect back to ?section=property (distinguished by
        // `page`, each page shows only its own forms).
        const propertyMonthlyRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyMonthlyRemoveMessage = propertyMonthlyRemoveStatus === 'error'
          ? describePropertyMonthlyRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyDistributionRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyDistributionRemoveMessage = propertyDistributionRemoveStatus === 'error'
          ? describePropertyDistributionRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyReserveMonthlyRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyReserveMonthlyRemoveMessage = propertyReserveMonthlyRemoveStatus === 'error'
          ? describePropertyReserveMonthlyRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyReserveDisbursementRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyReserveDisbursementRemoveMessage = propertyReserveDisbursementRemoveStatus === 'error'
          ? describePropertyReserveDisbursementRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyCapitalLedgerRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyCapitalLedgerRemoveMessage = propertyCapitalLedgerRemoveStatus === 'error'
          ? describePropertyCapitalLedgerRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyRepairRemoveStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyRepairRemoveMessage = propertyRepairRemoveStatus === 'error'
          ? describePropertyRepairRemoveError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyMetaEntryStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyMetaEntryMessage = propertyMetaEntryStatus === 'error'
          ? describePropertyMetaEntryError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyBudgetImportStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyBudgetImportMessage = propertyBudgetImportStatus === 'error'
          ? describePropertyBudgetImportError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const propertyMonthlyImportCsvStatus = section.id === 'property' ? url.searchParams.get('status') : null;
        const propertyMonthlyImportCsvMessage = propertyMonthlyImportCsvStatus === 'error'
          ? describePropertyMonthlyImportCsvError(url.searchParams.get('reason'), url.searchParams.get('message'))
          : null;
        const payrollBundle = section.id === 'payroll'
          ? await buildPayrollSectionBundle(env, request.headers.get('Cf-Access-Jwt-Assertion') || '', url.searchParams)
          : null;
        return response(renderShell({
          metadata, summary, giving, givingSource, section, pageId, councilPreview, roleResult, churchReport, churchReportLive, churchTrendLive,
          balanceSheet, balanceTrends, daycareReport, daycareReportLive, propertyReport, propertyReportLive, propertyReserves,
          propertyReservesLive, propertyLedgers, propertyLedgersLive, propertyValuation, propertyForecast, propertyForecastLive, propertyDistributions, budgetReport, accountsReport,
          dataStatus, compensationReport, compensationReportLive, compensationBenchmarks, compensationBenefits, cashRunway,
          compensationPlanRaw, canEditCompensation, compensationEditIndex, compensationEntryStatus, compensationEntryMessage,
          givingEntryStatus, givingEntryMessage, budgetEntryStatus, budgetEntryMessage, payrollBundle,
          planOpKind, planOpStatus, planOpMessage, baseProjectionEntryStatus, baseProjectionEntryMessage,
          churchOverrideStatus, churchOverrideMessage,
          churchBudgetXlsxImportStatus, churchBudgetXlsxImportMessage,
          balanceXlsxImportStatus, balanceXlsxImportMessage,
          churchActivityXlsxImportStatus, churchActivityXlsxImportMessage,
          churchBudgetMultiYearXlsxImportStatus, churchBudgetMultiYearXlsxImportMessage,
          balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage,
          daycareEntryStatus, daycareEntryMessage,
          daycareAllocationConfigEntryStatus, daycareAllocationConfigEntryMessage,
          daycareBudgetOverrideEntryStatus, daycareBudgetOverrideEntryMessage,
          daycareBulkEntryStatus, daycareBulkEntryMessage,
          daycareChurchBudgetImportEntryStatus, daycareChurchBudgetImportEntryMessage,
          daycareSyncStatus, daycareSyncMessage, daycareRoomsSyncStatus, daycareRoomsSyncMessage,
          boardCategoryEntryStatus, boardCategoryEntryMessage,
          purposeTagsEntryStatus, purposeTagsEntryMessage,
          propertyMonthlyEntryStatus, propertyMonthlyEntryMessage, propertyRepairEntryStatus, propertyRepairEntryMessage,
          propertyDistributionEntryStatus, propertyDistributionEntryMessage,
          propertyReserveMonthlyEntryStatus, propertyReserveMonthlyEntryMessage,
          propertyReserveDisbursementEntryStatus, propertyReserveDisbursementEntryMessage,
          propertyCapitalLedgerEntryStatus, propertyCapitalLedgerEntryMessage,
          propertyMonthlyRemoveStatus, propertyMonthlyRemoveMessage,
          propertyDistributionRemoveStatus, propertyDistributionRemoveMessage,
          propertyReserveMonthlyRemoveStatus, propertyReserveMonthlyRemoveMessage,
          propertyReserveDisbursementRemoveStatus, propertyReserveDisbursementRemoveMessage,
          propertyCapitalLedgerRemoveStatus, propertyCapitalLedgerRemoveMessage,
          propertyRepairRemoveStatus, propertyRepairRemoveMessage,
          propertyMetaEntryStatus, propertyMetaEntryMessage,
          propertyBudgetImportStatus, propertyBudgetImportMessage,
          propertyMonthlyImportCsvStatus, propertyMonthlyImportCsvMessage,
        }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch {
        return response('Synthetic staging data unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }

    return response('Route manifest mismatch', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
