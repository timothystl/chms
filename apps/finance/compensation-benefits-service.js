import { runBudgetedReadBatch } from './query-budget.js';

const COMPONENTS = Object.freeze([
  ['pension', 'Pension'],
  ['health', 'Group health plan'],
  ['disability', 'Disability'],
  ['employer_taxes', 'Employer taxes'],
]);

export async function readSyntheticCompensationBenefits(db) {
  const sql = "SELECT fiscal_year, role_label, component_key, component_label, amount_cents, source_kind FROM finance_compensation_benefit_components WHERE source_kind='synthetic_fixture' ORDER BY role_label, component_key";
  const { results } = await runBudgetedReadBatch(db, 'compensationBenefits', [sql]);
  const rows = results[0]?.results;
  const labels = new Map(COMPONENTS);
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.role_label !== 'string' || !row.role_label.startsWith('Synthetic ')
    || labels.get(row.component_key) !== row.component_label
    || !Number.isInteger(row.amount_cents) || row.amount_cents < 0
    || row.source_kind !== 'synthetic_fixture'
  )) throw new Error('Synthetic Compensation benefit rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildCompensationBenefitsView(report, benefitRows) {
  if (!report || !Array.isArray(report.rows) || !Array.isArray(benefitRows)) {
    throw new Error('Synthetic Compensation benefit comparison invalid');
  }
  const expectedKeys = new Set(COMPONENTS.map(([key]) => key));
  const byRole = new Map();
  for (const row of benefitRows) {
    if (row.fiscal_year !== report.fiscalYear || !expectedKeys.has(row.component_key)) {
      throw new Error('Synthetic Compensation benefit comparison invalid');
    }
    const roleRows = byRole.get(row.role_label) || [];
    if (roleRows.some((existing) => existing.component_key === row.component_key)) {
      throw new Error('Synthetic Compensation benefit comparison invalid');
    }
    roleRows.push(row);
    byRole.set(row.role_label, roleRows);
  }
  for (const role of report.rows) {
    const roleRows = byRole.get(role.role_label);
    if (!roleRows || roleRows.length !== COMPONENTS.length
      || roleRows.reduce((sum, row) => sum + row.amount_cents, 0) !== role.benefits_cents) {
      throw new Error('Synthetic Compensation benefits do not reconcile');
    }
  }
  if (byRole.size !== report.rows.length) throw new Error('Synthetic Compensation benefit comparison invalid');
  const rows = COMPONENTS.map(([componentKey, componentLabel]) => ({
    componentKey,
    componentLabel,
    amountCents: benefitRows.filter((row) => row.component_key === componentKey)
      .reduce((sum, row) => sum + row.amount_cents, 0),
    roleCount: benefitRows.filter((row) => row.component_key === componentKey && row.amount_cents > 0).length,
  }));
  const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  if (totalCents !== report.totals.benefitsCents) throw new Error('Synthetic Compensation benefits do not reconcile');
  return { fiscalYear: report.fiscalYear, rows, totalCents, reconciled: true, identitiesIncluded: false };
}
