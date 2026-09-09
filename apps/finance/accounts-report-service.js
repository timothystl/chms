import { runBudgetedReadBatch } from './query-budget.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticAccountsReport(db) {
  const sql = "SELECT DISTINCT e.classification, e.category_path, e.account_name, p.board_category_key, p.board_category_label, p.purpose_tag_id, p.purpose_tag_label FROM finance_church_entries e LEFT JOIN finance_account_presentation p ON p.category_path=e.category_path AND p.source='synthetic_fixture' WHERE e.source='synthetic_fixture' ORDER BY e.classification, e.category_path";
  const { results } = await runBudgetedReadBatch(db, 'accountsReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !CLASSIFICATIONS.has(row.classification)
    || typeof row.category_path !== 'string'
    || !row.category_path.startsWith(`${row.classification}:`)
    || typeof row.account_name !== 'string'
    || typeof row.board_category_key !== 'string'
    || !/^[a-z][a-z0-9_]*$/.test(row.board_category_key)
    || typeof row.board_category_label !== 'string'
    || row.board_category_label.trim() === ''
    || (row.purpose_tag_id !== null && (typeof row.purpose_tag_id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.purpose_tag_id)))
    || (row.purpose_tag_label !== null && (typeof row.purpose_tag_label !== 'string' || row.purpose_tag_label.trim() === ''))
    || ((row.purpose_tag_id === null) !== (row.purpose_tag_label === null))
  )) throw new Error('Synthetic Chart of Accounts rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildAccountsReportView(rows) {
  const unique = (field) => new Set(rows.map((row) => row[field]).filter(Boolean)).size;
  return {
    rows,
    counts: {
      total: rows.length,
      income: rows.filter((row) => row.classification === 'Income').length,
      expenses: rows.filter((row) => row.classification === 'Expenses').length,
      boardCategories: unique('board_category_key'),
      purposeTags: unique('purpose_tag_id'),
    },
  };
}
