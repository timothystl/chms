import { runBudgetedReadBatch } from './query-budget.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticAccountsReport(db) {
  const sql = "SELECT DISTINCT classification, category_path, account_name FROM finance_church_entries WHERE source='synthetic_fixture' ORDER BY classification, category_path";
  const { results } = await runBudgetedReadBatch(db, 'accountsReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !CLASSIFICATIONS.has(row.classification)
    || typeof row.category_path !== 'string'
    || !row.category_path.startsWith(`${row.classification}:`)
    || typeof row.account_name !== 'string'
  )) throw new Error('Synthetic Chart of Accounts rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildAccountsReportView(rows) {
  return {
    rows,
    counts: {
      total: rows.length,
      income: rows.filter((row) => row.classification === 'Income').length,
      expenses: rows.filter((row) => row.classification === 'Expenses').length,
    },
  };
}
