import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticCompensationBenchmarks(db) {
  const sql = "SELECT fiscal_year, role_label, benchmark_salary_cents, source_label, source_kind FROM finance_compensation_benchmarks WHERE source_kind='synthetic_fixture' ORDER BY role_label";
  const { results } = await runBudgetedReadBatch(db, 'compensationBenchmark', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.role_label !== 'string' || !row.role_label.startsWith('Synthetic ')
    || !Number.isInteger(row.benchmark_salary_cents) || row.benchmark_salary_cents <= 0
    || row.source_label !== 'Synthetic district-style benchmark'
    || row.source_kind !== 'synthetic_fixture'
  )) throw new Error('Synthetic Compensation benchmark rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildCompensationBenchmarkView(report, benchmarks) {
  if (!report || !Array.isArray(report.rows) || !Number.isInteger(report.fiscalYear)
    || !Array.isArray(benchmarks) || benchmarks.length !== report.rows.length) {
    throw new Error('Synthetic Compensation benchmark comparison incomplete');
  }
  const byRole = new Map();
  for (const benchmark of benchmarks) {
    if (benchmark.fiscal_year !== report.fiscalYear || byRole.has(benchmark.role_label)) {
      throw new Error('Synthetic Compensation benchmark comparison invalid');
    }
    byRole.set(benchmark.role_label, benchmark);
  }
  const rows = report.rows.map((role) => {
    const benchmark = byRole.get(role.role_label);
    if (!benchmark) throw new Error('Synthetic Compensation benchmark comparison incomplete');
    const gapCents = Math.max(0, benchmark.benchmark_salary_cents - role.salary_cents);
    return {
      roleLabel: role.role_label,
      salaryCents: role.salary_cents,
      benchmarkSalaryCents: benchmark.benchmark_salary_cents,
      salaryToBenchmarkPct: role.salary_cents / benchmark.benchmark_salary_cents * 100,
      gapCents,
      sourceLabel: benchmark.source_label,
    };
  });
  const salaryCents = rows.reduce((sum, row) => sum + row.salaryCents, 0);
  const benchmarkSalaryCents = rows.reduce((sum, row) => sum + row.benchmarkSalaryCents, 0);
  const gapCents = rows.reduce((sum, row) => sum + row.gapCents, 0);
  return {
    fiscalYear: report.fiscalYear,
    rows,
    totals: {
      salaryCents,
      benchmarkSalaryCents,
      salaryToBenchmarkPct: salaryCents / benchmarkSalaryCents * 100,
      gapCents,
    },
    sourceClassification: 'synthetic_not_published',
  };
}
