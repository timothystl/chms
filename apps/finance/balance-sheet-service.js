import { runBudgetedReadBatch } from './query-budget.js';

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
