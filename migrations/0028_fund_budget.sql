-- Per-fund annual budget (integer cents), used by the Board Report's YTD-budget/variance
-- columns and the year-end-projection-vs-budget KPI. 0 = no budget set → the report shows
-- "—" for that fund's budget/variance, exactly like the Memorials row in the design.
ALTER TABLE funds ADD COLUMN budget_annual_cents INTEGER NOT NULL DEFAULT 0;
