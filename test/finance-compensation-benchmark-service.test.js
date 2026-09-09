import { describe, expect, it } from 'vitest';
import { buildCompensationReportView } from '../apps/finance/compensation-report-service.js';
import { buildCompensationBenchmarkView, readSyntheticCompensationBenchmarks } from '../apps/finance/compensation-benchmark-service.js';

const planRows = [
  { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', salary_cents: 6000000, benefits_cents: 1200000, adjustment_pct: 3, basis: 'synthetic_fixture' },
  { fiscal_year: 2027, role_label: 'Synthetic Operations Role', salary_cents: 4500000, benefits_cents: 900000, adjustment_pct: 3, basis: 'synthetic_fixture' },
];
const benchmarks = [
  { fiscal_year: 2027, role_label: 'Synthetic Ministry Role', benchmark_salary_cents: 6250000, source_label: 'Synthetic district-style benchmark', source_kind: 'synthetic_fixture' },
  { fiscal_year: 2027, role_label: 'Synthetic Operations Role', benchmark_salary_cents: 4750000, source_label: 'Synthetic district-style benchmark', source_kind: 'synthetic_fixture' },
];

describe('Finance synthetic Compensation benchmarks', () => {
  it('reads one fixture-only role-level benchmark query', async () => {
    const statements = [];
    const db = { prepare(sql) { statements.push(sql); return { sql }; }, async batch() { return [{ results: benchmarks }]; } };
    await expect(readSyntheticCompensationBenchmarks(db)).resolves.toEqual(benchmarks);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
  });

  it('compares salary to benchmark and totals only positive gaps', () => {
    const view = buildCompensationBenchmarkView(buildCompensationReportView(planRows), benchmarks);
    expect(view).toMatchObject({
      fiscalYear: 2027,
      totals: { salaryCents: 10500000, benchmarkSalaryCents: 11000000, gapCents: 500000 },
      sourceClassification: 'synthetic_not_published',
    });
    expect(view.totals.salaryToBenchmarkPct).toBeCloseTo(95.4545, 3);
    expect(view.rows[0]).toMatchObject({ gapCents: 250000, salaryToBenchmarkPct: 96 });
  });

  it('fails closed on missing, duplicate, mixed-year, or non-synthetic benchmarks', () => {
    const report = buildCompensationReportView(planRows);
    for (const invalid of [
      benchmarks.slice(1),
      [benchmarks[0], benchmarks[0]],
      [benchmarks[0], { ...benchmarks[1], fiscal_year: 2028 }],
    ]) expect(() => buildCompensationBenchmarkView(report, invalid)).toThrow(/benchmark comparison/);
  });
});
