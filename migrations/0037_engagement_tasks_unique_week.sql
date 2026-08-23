-- P24-B. Two staff opening the dashboard the same Monday morning both saw an empty
-- engagement_tasks list for the new week and both seeded the five default rows, leaving ten
-- instead of five. A UNIQUE constraint on (title, week_key) closes the race: the dashboard
-- handler now seeds via INSERT OR IGNORE, so a losing concurrent seed is silently dropped
-- instead of duplicated.
--
-- Dedup first: a database that already hit this race has real duplicate (title, week_key)
-- rows sitting in it, and CREATE UNIQUE INDEX would fail outright against them. Keeps the
-- lowest id per (title, week_key) pair — arbitrary but stable, and these are unchecked
-- checklist rows with no other state worth preferring one copy over another for.
DELETE FROM engagement_tasks WHERE id NOT IN (
  SELECT MIN(id) FROM engagement_tasks GROUP BY title, week_key
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_tasks_title_week ON engagement_tasks(title, week_key);
