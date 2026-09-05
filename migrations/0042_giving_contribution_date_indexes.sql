-- Every finance and giving report filters giving_entries by a contribution_date range, and
-- giving_entries had no index on that column at all -- only batch_id, person_id, breeze_id and
-- deposit_id. Measured with EXPLAIN QUERY PLAN against a realistic 8-year, ~42k-row fixture:
-- each of those reports was a full `SCAN ge` of every year ever recorded in order to read one.
--
-- Both indexes lead with contribution_date so the range is a SEARCH, and both carry the columns
-- their query actually reads, so SQLite answers from the index alone:
--
--   month-by-fund giving   -> SEARCH ge USING COVERING INDEX idx_giving_date_fund
--   per-household totals   -> SEARCH ge USING COVERING INDEX idx_giving_date_person
--
-- On that fixture one year is an eighth of the table, so this is roughly an 8x cut in rows read
-- per report -- it does NOT replace reading giving_entries fewer times (see buildChurchThisYear
-- in src/api-finance.js), it makes each remaining read proportional to the year asked for.
CREATE INDEX IF NOT EXISTS idx_giving_date_fund ON giving_entries(contribution_date, fund_id, amount);
CREATE INDEX IF NOT EXISTS idx_giving_date_person ON giving_entries(contribution_date, person_id, amount);
