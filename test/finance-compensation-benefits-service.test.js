import { describe, expect, it } from 'vitest';
import { buildCompensationReportView } from '../apps/finance/compensation-report-service.js';
import { buildCompensationBenefitsView, readSyntheticCompensationBenefits } from '../apps/finance/compensation-benefits-service.js';

const plan = buildCompensationReportView([
  { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', salary_cents: 6000000, benefits_cents: 1200000, adjustment_pct: 3, basis: 'synthetic_fixture' },
  { fiscal_year: 2027, role_label: 'Synthetic Operations Role', salary_cents: 4500000, benefits_cents: 900000, adjustment_pct: 3, basis: 'synthetic_fixture' },
]);
const parts = { pension: [400000, 300000], health: [600000, 400000], disability: [100000, 50000], employer_taxes: [100000, 150000] };
const labels = { pension: 'Pension', health: 'Group health plan', disability: 'Disability', employer_taxes: 'Employer taxes' };
const rows = Object.entries(parts).flatMap(([key, amounts]) => plan.rows.map((role, index) => ({
  fiscal_year: 2027, role_label: role.role_label, component_key: key, component_label: labels[key],
  amount_cents: amounts[index], source_kind: 'synthetic_fixture',
})));

describe('Finance synthetic Compensation benefits', () => {
  it('reads one fixture-only role-level component query', async () => {
    const statements = [];
    const db = { prepare(sql) { statements.push(sql); return { sql }; }, async batch() { return [{ results: rows }]; } };
    await expect(readSyntheticCompensationBenefits(db)).resolves.toEqual(rows);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('reconciles four components to every role and the plan total', () => {
    expect(buildCompensationBenefitsView(plan, rows)).toEqual({
      fiscalYear: 2027, totalCents: 2100000, reconciled: true, identitiesIncluded: false,
      rows: [
        { componentKey: 'pension', componentLabel: 'Pension', amountCents: 700000, roleCount: 2 },
        { componentKey: 'health', componentLabel: 'Group health plan', amountCents: 1000000, roleCount: 2 },
        { componentKey: 'disability', componentLabel: 'Disability', amountCents: 150000, roleCount: 2 },
        { componentKey: 'employer_taxes', componentLabel: 'Employer taxes', amountCents: 250000, roleCount: 2 },
      ],
    });
  });

  it('fails closed on missing components and non-reconciling amounts', () => {
    expect(() => buildCompensationBenefitsView(plan, rows.slice(1))).toThrow('Synthetic Compensation benefits do not reconcile');
    expect(() => buildCompensationBenefitsView(plan, rows.map((row, i) => i === 0 ? { ...row, amount_cents: row.amount_cents + 1 } : row)))
      .toThrow('Synthetic Compensation benefits do not reconcile');
  });
});
