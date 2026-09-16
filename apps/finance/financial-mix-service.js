const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export function buildFinancialMixView(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || !CLASSIFICATIONS.has(row.classification)
    || typeof row.account_name !== 'string'
    || row.account_name.trim() === ''
    || !Number.isInteger(row.own_actual_cents)
    || row.own_actual_cents < 0
  )) throw new Error('Synthetic financial mix rows invalid');

  const fiscalYear = rows[0].fiscal_year;
  if (rows.some((row) => row.fiscal_year !== fiscalYear)) {
    throw new Error('Synthetic financial mix fiscal year mismatch');
  }
  const buildSide = (classification) => {
    const source = rows.filter((row) => row.classification === classification);
    const totalCents = source.reduce((total, row) => total + row.own_actual_cents, 0);
    if (source.length === 0 || totalCents <= 0) throw new Error('Synthetic financial mix totals invalid');
    const items = source.map((row) => ({
      accountName: row.account_name,
      amountCents: row.own_actual_cents,
      sharePct: row.own_actual_cents / totalCents * 100,
    }));
    return {
      totalCents,
      items,
      reconciled: items.reduce((total, item) => total + item.amountCents, 0) === totalCents,
    };
  };
  return { fiscalYear, income: buildSide('Income'), expenses: buildSide('Expenses') };
}

// Live sibling of buildFinancialMixView above -- same {fiscalYear, income, expenses} shape (each
// side's {totalCents, items: [{accountName, amountCents, sharePct}], reconciled}), but built from
// the live connect.finance-church-report.v1 contract's own `accounts`/`totals` shape (see
// church-report-service.js's resolveChurchReport/buildLiveChurchReportView) rather than the
// synthetic fixture's flat classification/account_name/own_actual_cents rows. `totals` supplies
// each side's authoritative sum directly from the contract instead of re-deriving it from
// `accounts`, matching buildLiveChurchReportView's own totals usage -- accounts can be a partial
// hierarchy (see the contract's `depth`/`hasChildren` fields), so summing accounts here would risk
// double-counting parent/child rows the same way buildLiveChurchReportView already avoids for its
// own income/expense totals.
export function buildLiveFinancialMixView(accounts, fiscalYear, totals) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live financial mix requires a fiscal year');
  const buildSide = (classification, totalCents) => {
    const items = accounts
      .filter((account) => account.classification === classification)
      .map((account) => ({
        accountName: account.accountName,
        amountCents: account.actualCents,
        sharePct: totalCents !== 0 ? (account.actualCents / totalCents) * 100 : 0,
      }));
    if (items.length === 0 || totalCents <= 0) throw new Error('Live financial mix totals invalid');
    return {
      totalCents,
      items,
      reconciled: items.reduce((sum, item) => sum + item.amountCents, 0) === totalCents,
    };
  };
  return {
    fiscalYear,
    income: buildSide('Income', totals.incomeActualCents),
    expenses: buildSide('Expenses', totals.expenseActualCents),
  };
}
