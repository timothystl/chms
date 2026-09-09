-- Isolated Finance staging compensation benchmarks. Contains role-level data only.
CREATE TABLE finance_compensation_benchmarks (
  fiscal_year INTEGER NOT NULL,
  role_label TEXT NOT NULL,
  benchmark_salary_cents INTEGER NOT NULL,
  source_label TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fiscal_year, role_label, source_kind)
);
CREATE INDEX idx_finance_compensation_benchmark_year
  ON finance_compensation_benchmarks(fiscal_year, source_kind);
