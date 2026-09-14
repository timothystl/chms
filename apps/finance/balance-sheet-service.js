import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceBalanceSheet, defaultLiveBalanceSheetFiscalYear } from './finance-balance-sheet-client.js';

const CLASSIFICATIONS = new Set(['Assets', 'Liabilities', 'Equity']);

export async function readSyntheticBalanceSheet(db) {
  const sql = "SELECT fiscal_year, as_of_date, classification, account_name, own_balance_cents FROM finance_church_balances WHERE source='synthetic_fixture' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_balances WHERE source='synthetic_fixture') ORDER BY classification, account_name";
  const { results } = await runBudgetedReadBatch(db, 'balanceSheet', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.as_of_date !== 'string'
    || !CLASSIFICATIONS.has(row.classification)
    || typeof row.account_name !== 'string'
    || !Number.isInteger(row.own_balance_cents)
  )) throw new Error('Synthetic Balance Sheet rows invalid');
  return rows.map((row) => ({ ...row }));
}

export async function readSyntheticBalanceTrends(db) {
  const sql = "SELECT fiscal_year, MAX(as_of_date) AS as_of_date, SUM(CASE WHEN classification='Assets' THEN own_balance_cents ELSE 0 END) AS assets_cents, SUM(CASE WHEN classification='Liabilities' THEN own_balance_cents ELSE 0 END) AS liabilities_cents, SUM(CASE WHEN classification='Equity' THEN own_balance_cents ELSE 0 END) AS equity_cents FROM finance_church_balances WHERE source='synthetic_fixture' GROUP BY fiscal_year ORDER BY fiscal_year";
  const { results } = await runBudgetedReadBatch(db, 'balanceTrends', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.as_of_date !== 'string'
    || !Number.isInteger(row.assets_cents)
    || !Number.isInteger(row.liabilities_cents)
    || !Number.isInteger(row.equity_cents)
    || row.assets_cents - row.liabilities_cents - row.equity_cents !== 0
  )) throw new Error('Synthetic Balance Sheet trend rows invalid');
  return rows.map((row) => ({ ...row, net_assets_cents: row.assets_cents - row.liabilities_cents }));
}

// Tries the real connect.finance-balance-sheet.v1 endpoint for the current fiscal year; falls
// back to the existing synthetic fixture whenever the live call isn't configured yet or fails for
// any reason -- same never-throws, always-labeled pattern as church-report-service.js's
// resolveChurchReport. `db` here is Finance's own FINANCE_DB, used only for the synthetic
// fallback path. Only the 'balance' section's 'position'/'account-detail' pages use this; the
// 'multi-year' page has no live equivalent yet and stays on the synthetic trend reader below --
// out of scope for this contract, the same way Church Report left its own multi-year trend out.
export async function resolveBalanceSheet(env, db) {
  const fiscalYear = defaultLiveBalanceSheetFiscalYear();
  const result = await fetchLiveFinanceBalanceSheet(env, fiscalYear);
  if (result.ok) {
    return {
      source: 'live',
      fiscalYear: result.balanceSheet.fiscalYear,
      asOfDate: result.balanceSheet.asOfDate,
      accounts: result.balanceSheet.accounts,
      totals: result.balanceSheet.totals,
      equityReclass: result.balanceSheet.equityReclass,
    };
  }
  const rows = await readSyntheticBalanceSheet(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows };
}

// Live view builder -- a genuinely different shape from the synthetic fixture's own flat
// classification/account_name/own_balance_cents rows (readSyntheticBalanceSheet): real accounts
// also carry categoryPath/depth/hasChildren, and real data adds a Donor-Restricted/Without-Donor-
// Restriction breakdown (equityReclass) the synthetic fixture has no equivalent of at all. See
// finance-balance-sheet-consumer.js's header comment for why totals.equityCents and
// equityReclass.totalEquityCents are guaranteed equal (both come from the same already-
// reclassified rows production's own route computes them from).
export function buildLiveBalanceSheetView(accounts, fiscalYear, asOfDate, totals, equityReclass) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live Balance Sheet requires a fiscal year');
  const assets = accounts.filter((a) => a.classification === 'Assets');
  const liabilities = accounts.filter((a) => a.classification === 'Liabilities');
  const equity = accounts.filter((a) => a.classification === 'Equity');
  return {
    fiscalYear,
    asOfDate,
    assets,
    liabilities,
    equity,
    totals: {
      assetsCents: totals.assetsCents,
      liabilitiesCents: totals.liabilitiesCents,
      equityCents: totals.equityCents,
      equationDifferenceCents: totals.balancedCents,
    },
    equityReclass,
  };
}

export function buildBalanceSheetView(rows) {
  const byClassification = (classification) => rows.filter((row) => row.classification === classification);
  const sum = (items) => items.reduce((total, row) => total + row.own_balance_cents, 0);
  const assets = byClassification('Assets');
  const liabilities = byClassification('Liabilities');
  const equity = byClassification('Equity');
  const assetsCents = sum(assets);
  const liabilitiesCents = sum(liabilities);
  const equityCents = sum(equity);
  return {
    fiscalYear: rows[0].fiscal_year,
    asOfDate: rows[0].as_of_date,
    assets,
    liabilities,
    equity,
    totals: {
      assetsCents,
      liabilitiesCents,
      equityCents,
      equationDifferenceCents: assetsCents - liabilitiesCents - equityCents,
    },
  };
}
