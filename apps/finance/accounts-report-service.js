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

function createHierarchyNode(label, path, depth) {
  return { label, path, depth, account: null, children: [], childIndex: new Map() };
}

export function buildAccountHierarchy(rows) {
  const roots = new Map(['Income', 'Expenses'].map((classification) => [
    classification, createHierarchyNode(classification, classification, 0),
  ]));
  for (const row of rows) {
    if (!CLASSIFICATIONS.has(row?.classification) || typeof row?.category_path !== 'string') {
      throw new Error('Synthetic account hierarchy path invalid');
    }
    const segments = row.category_path.split(':');
    if (segments.some((segment) => segment.trim() === '') || segments[0] !== row.classification) {
      throw new Error('Synthetic account hierarchy path invalid');
    }
    let node = roots.get(row.classification);
    for (let index = 1; index < segments.length; index += 1) {
      const label = segments[index];
      if (!node.childIndex.has(label)) {
        const path = segments.slice(0, index + 1).join(':');
        const child = createHierarchyNode(label, path, index);
        node.childIndex.set(label, child);
        node.children.push(child);
      }
      node = node.childIndex.get(label);
    }
    if (node.account !== null) throw new Error('Synthetic account hierarchy duplicate leaf');
    node.account = {
      name: row.account_name,
      boardCategoryLabel: row.board_category_label,
      purposeTagLabel: row.purpose_tag_label,
    };
  }
  const stripIndex = (node) => ({
    label: node.label,
    path: node.path,
    depth: node.depth,
    account: node.account,
    children: node.children.map(stripIndex),
  });
  return [...roots.values()].map(stripIndex);
}

export function buildAccountsReportView(rows) {
  const unique = (field) => new Set(rows.map((row) => row[field]).filter(Boolean)).size;
  return {
    rows,
    hierarchy: buildAccountHierarchy(rows),
    counts: {
      total: rows.length,
      income: rows.filter((row) => row.classification === 'Income').length,
      expenses: rows.filter((row) => row.classification === 'Expenses').length,
      boardCategories: unique('board_category_key'),
      purposeTags: unique('purpose_tag_id'),
    },
  };
}
