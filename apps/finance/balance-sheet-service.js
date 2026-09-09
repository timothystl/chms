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
