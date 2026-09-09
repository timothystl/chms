export const FINANCE_QUERY_BUDGETS = Object.freeze({
  summary: 4,
  churchReport: 1,
  churchTrends: 1,
  balanceSheet: 1,
  balanceTrends: 1,
  daycareReport: 1,
  propertyReport: 1,
  budgetReport: 1,
  accountsReport: 1,
  dataStatus: 1,
  compensationReport: 1,
});

export async function runBudgetedReadBatch(db, budgetName, statements) {
  const limit = FINANCE_QUERY_BUDGETS[budgetName];
  if (!Number.isInteger(limit)) throw new Error(`Unknown Finance query budget: ${budgetName}`);
  if (!Array.isArray(statements) || statements.length > limit) {
    throw new Error(`Finance query budget exceeded: ${budgetName}`);
  }
  if (statements.some((sql) => typeof sql !== 'string' || !/^\s*SELECT\b/i.test(sql))) {
    throw new Error(`Finance query budget permits SELECT statements only: ${budgetName}`);
  }

  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  if (!Array.isArray(results) || results.length !== statements.length) {
    throw new Error(`Finance query batch incomplete: ${budgetName}`);
  }
  return { results, used: statements.length, limit };
}
