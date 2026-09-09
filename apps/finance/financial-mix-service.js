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
