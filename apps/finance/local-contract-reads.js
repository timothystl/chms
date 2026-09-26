// Serves Finance's own report reads from Finance's database instead of asking Connect.
//
// Connect's read contracts build every Finance report from accounting tables that now live only
// in Finance's database (Connect reaches them through its FINANCE_DB binding, the same database
// this Worker binds as FINANCE_DB). Running the same contract functions here, against that same
// database, returns the identical response without a round trip through Connect, so a slow or
// redeploying Connect no longer blanks Finance's reports.
//
// Only GET reads whose every table is Finance-owned are listed. Giving, staff identity and roles,
// and every write still go to Connect. If a local read fails for any reason, the request falls
// through to Connect unchanged, so this can only add a faster path, never remove the old one.
import {
  respondWithFinanceDataStatusV1, respondWithFinanceCashRunwayV1, respondWithFinanceChartOfAccountsV1,
  respondWithFinanceBudgetV1, respondWithFinanceChurchReportV1, respondWithFinanceChurchReportTrendV1,
  respondWithFinanceBalanceSheetV1, respondWithFinanceBalanceSheetTrendV1, respondWithFinanceDaycareReportV1,
  respondWithFinanceDaycareEntriesV1, respondWithFinancePropertyValuationV1, respondWithFinanceCompensationV1,
  respondWithFinancePropertyOperatingV1, respondWithFinancePropertyReservesV1, respondWithFinancePropertyLedgersV1,
  respondWithFinancePropertyForecastV1,
} from '../../src/api-contracts.js';
import { respondWithFinanceClassificationV1 } from '../../src/api-classification-contracts.js';
import { respondWithFinanceBoardLayoutV1 } from '../../src/api-board-layout-contracts.js';
import { respondWithFinanceBudgetBuilderV1 } from '../../src/api-budget-builder-contracts.js';
import { respondWithFinancePlanningBasisV1 } from '../../src/api-planning-contracts.js';
import { respondWithFinancePropertyPolicyV1 } from '../../src/api-property-policy-contracts.js';
import { respondWithFinancePropertyDebtV1 } from '../../src/api-property-debt-contracts.js';
import { respondWithFinanceImportStatusV1, respondWithFinanceDaycareChurchBudgetPreviewV1 } from '../../src/api-data-imports-contracts.js';

const LOCAL_READS = {
  'finance-data-status-v1': (url, db) => respondWithFinanceDataStatusV1(db),
  'finance-classification-v1': respondWithFinanceClassificationV1,
  // finance_import_log plus the imported tables it derives dates from, and finance_church_entries:
  // all Finance-owned. (The board packet also reads Giving's fund totals, so it stays with Connect.)
  'finance-import-status-v1': (url, db) => respondWithFinanceImportStatusV1(db),
  'finance-daycare-church-budget-preview-v1': respondWithFinanceDaycareChurchBudgetPreviewV1,
  'finance-cash-runway-v1': respondWithFinanceCashRunwayV1,
  'finance-chart-of-accounts-v1': (url, db) => respondWithFinanceChartOfAccountsV1(db),
  'finance-board-layout-v1': (url, db) => respondWithFinanceBoardLayoutV1(db),
  'finance-budget-builder-v1': respondWithFinanceBudgetBuilderV1,
  'finance-planning-basis-v1': respondWithFinancePlanningBasisV1,
  'finance-budget-v1': respondWithFinanceBudgetV1,
  'finance-church-report-v1': respondWithFinanceChurchReportV1,
  'finance-church-report-trend-v1': (url, db) => respondWithFinanceChurchReportTrendV1(db),
  'finance-balance-sheet-v1': respondWithFinanceBalanceSheetV1,
  'finance-balance-sheet-trend-v1': (url, db) => respondWithFinanceBalanceSheetTrendV1(db),
  'finance-daycare-report-v1': respondWithFinanceDaycareReportV1,
  'finance-daycare-entries-v1': respondWithFinanceDaycareEntriesV1,
  'finance-property-valuation-v1': respondWithFinancePropertyValuationV1,
  'finance-property-policy-v1': respondWithFinancePropertyPolicyV1,
  'finance-property-debt-v1': respondWithFinancePropertyDebtV1,
  'finance-compensation-v1': (url, db) => respondWithFinanceCompensationV1(db),
  'finance-property-operating-v1': respondWithFinancePropertyOperatingV1,
  'finance-property-reserves-v1': respondWithFinancePropertyReservesV1,
  'finance-property-ledgers-v1': respondWithFinancePropertyLedgersV1,
  'finance-property-forecast-v1': respondWithFinancePropertyForecastV1,
};

export function localContractReadsEnabled(env) {
  return env.FINANCE_LOCAL_CONTRACT_READS === '1' && !!env.FINANCE_DB && !!env.CONNECT_SERVICE;
}

// Wraps the Connect service binding: listed reads are answered from FINANCE_DB, everything else
// (and any local read that fails) goes to Connect exactly as before.
export function withLocalContractReads(env) {
  if (!localContractReadsEnabled(env)) return env;
  const connect = env.CONNECT_SERVICE;
  const db = env.FINANCE_DB;
  return {
    ...env,
    CONNECT_SERVICE: {
      async fetch(request, init) {
        const req = request instanceof Request ? request : new Request(request, init);
        const url = new URL(req.url);
        const read = req.method === 'GET' ? LOCAL_READS[url.pathname.replace(/^\/api\/contracts\//, '')] : null;
        if (read && url.pathname.startsWith('/api/contracts/')) {
          try {
            const res = await read(url, db);
            if (res.ok) return res;
          } catch {
            // Fall through to Connect.
          }
        }
        return connect.fetch(req);
      },
    },
  };
}
