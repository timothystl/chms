import { describe, expect, it } from 'vitest';
import { buildCompensationReportView, readSyntheticCompensationReport } from '../apps/finance/compensation-report-service.js';

const rows = [
  { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', salary_cents: 6000000, benefits_cents: 1200000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
  { fiscal_year: 2027, role_label: 'Synthetic Operations Role', salary_cents: 4500000, benefits_cents: 900000, adjustment_pct: 3, basis: 'synthetic_fixture', notes: 'Synthetic fixture only' },
];

describe('Finance synthetic Compensation service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = { prepare(sql) { statements.push(sql); return { sql }; }, async batch() { return [{ results: rows }]; } };
    const result = await readSyntheticCompensationReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("basis='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('totals salary, benefits, and total compensation', () => {
    expect(buildCompensationReportView(rows)).toMatchObject({
      fiscalYear: 2027,
      totals: { salaryCents: 10500000, benefitsCents: 2100000, totalCents: 12600000 },
    });
  });

  it('fails closed on personal-looking labels and mixed years', async () => {
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: [{ ...rows[0], role_label: 'Named Person' }] }]; } };
    await expect(readSyntheticCompensationReport(db)).rejects.toThrow('Synthetic Compensation rows invalid');
    expect(() => buildCompensationReportView([rows[0], { ...rows[1], fiscal_year: 2028 }])).toThrow('Synthetic Compensation fiscal year mismatch');
  });
});
