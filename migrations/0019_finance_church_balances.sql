-- Point-in-time Balance Sheet snapshots (Assets/Liabilities/Equity) — a structurally different
-- report from finance_church_entries (which models Income Statement actual-vs-budget over a
-- period). One row per real account's own balance at a given as-of date, never a "Total for X"
-- subtotal row — same principle as finance_church_entries, so roll-ups (Total Assets, Total
-- Liabilities, etc.) are always safely re-derivable by summing category_path prefix matches.
CREATE TABLE IF NOT EXISTS finance_church_balances (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,      -- year of the as_of_date, for year-scoped replace/read
  as_of_date        TEXT    NOT NULL DEFAULT '', -- raw "As of ..." label from the export, for display
  classification    TEXT    NOT NULL,      -- 'Assets' | 'Liabilities' | 'Equity'
  category_path     TEXT    NOT NULL,      -- colon-joined full path incl. classification
  account_name      TEXT    NOT NULL,      -- last path segment, denormalized for display
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,  -- informational only; doesn't affect rollup math
  own_balance_cents INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL DEFAULT 'import',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, category_path, source)
);
CREATE INDEX IF NOT EXISTS idx_church_balances_year ON finance_church_balances(fiscal_year);
