-- Persisted, per-account Church financial data — backs the Church Report's This Year and
-- Multi-Year views instead of the ephemeral finance_qb_snapshot blob cache (which stays,
-- powering only the Overview tab's raw-tree "Budget vs. Actual" card — see src/api-finance.js).
--
-- Never stores QuickBooks' own "Total for X" subtotal rows — only each real account/category
-- node's own, non-cumulative amount (a node can have both its own direct posting AND child
-- accounts, e.g. "Job Expenses" posts its own amount separate from its nested "Job Materials"
-- children). Roll-ups are always recomputed at query time via category_path prefix matching —
-- this is what makes double-counting structurally impossible, mirroring what mergeSection()
-- already computes in memory in src/api-finance.js.
CREATE TABLE IF NOT EXISTS finance_church_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL DEFAULT 0,  -- 0 = annual row; 1-12 = that month's own amount
                                          -- (unused for now — always 0 currently). Deliberately
                                          -- NOT NULL: SQLite/D1 treat NULL as never equal to NULL
                                          -- for UNIQUE-constraint purposes, so a nullable column
                                          -- in this table's UNIQUE key would silently let every
                                          -- annual re-sync insert a fresh duplicate row instead of
                                          -- upserting — 0 is a real, poolable value instead.
  classification    TEXT    NOT NULL,     -- QuickBooks' own literal top-level P&L section label,
                                          -- e.g. 'Income'/'Cost of Goods Sold'/'Expenses'/
                                          -- 'Other Income'/'Other Expenses' — stored verbatim
                                          -- (not a normalized enum) since it's also always the
                                          -- first segment of category_path already
  category_path     TEXT    NOT NULL,     -- colon-joined full path incl. classification, e.g.
                                          -- 'Expenses:Job Expenses:Job Materials:Fountains and Garden Lighting'
  account_name      TEXT    NOT NULL,     -- last path segment, denormalized for display
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,  -- informational only; doesn't affect rollup math
  own_actual_cents  INTEGER NOT NULL DEFAULT 0,
  own_budget_cents  INTEGER,              -- NULL = no budget known (distinct from a real $0 budget)
  account_qbo_id    TEXT    NOT NULL DEFAULT '',
  source            TEXT    NOT NULL DEFAULT 'qbo_sync',  -- 'qbo_sync' | 'import' | 'manual'
  notes             TEXT    NOT NULL DEFAULT '',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, period_month, category_path, source)
);
CREATE INDEX IF NOT EXISTS idx_church_entries_year       ON finance_church_entries(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_church_entries_year_class ON finance_church_entries(fiscal_year, classification);
CREATE INDEX IF NOT EXISTS idx_church_entries_path        ON finance_church_entries(category_path);
