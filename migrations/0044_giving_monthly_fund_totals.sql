-- Dashboard giving totals are requested on every Home load but change only when a gift changes.
-- Store one row per fund/month and maintain it at write time rather than re-aggregating all gift
-- history for every reader. The fund_id stays unclassified here: joining the small funds table at
-- read time means renaming/reclassifying a fund immediately changes the Dashboard without a rebuild.
CREATE TABLE IF NOT EXISTS giving_monthly_fund_totals (
  month       TEXT    NOT NULL,
  fund_id     INTEGER NOT NULL,
  gift_count  INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, fund_id)
);

-- contribution_date is authoritative now. This one-time compatibility backfill makes that true
-- for a database created before the column existed; current production had zero blank dates when
-- this migration was written.
UPDATE giving_entries
   SET contribution_date = COALESCE(
     (SELECT batch_date FROM giving_batches WHERE id = giving_entries.batch_id),
     ''
   )
 WHERE contribution_date = '';

INSERT INTO giving_monthly_fund_totals (month, fund_id, gift_count, total_cents)
SELECT substr(contribution_date, 1, 7), fund_id, COUNT(*), COALESCE(SUM(amount), 0)
  FROM giving_entries
 WHERE contribution_date != ''
 GROUP BY substr(contribution_date, 1, 7), fund_id
ON CONFLICT(month, fund_id) DO UPDATE SET
  gift_count = excluded.gift_count,
  total_cents = excluded.total_cents;

CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_insert
AFTER INSERT ON giving_entries
WHEN COALESCE(NULLIF(NEW.contribution_date, ''),
              (SELECT batch_date FROM giving_batches WHERE id = NEW.batch_id), '') != ''
BEGIN
  INSERT INTO giving_monthly_fund_totals (month, fund_id, gift_count, total_cents)
  VALUES (
    substr(COALESCE(NULLIF(NEW.contribution_date, ''),
                    (SELECT batch_date FROM giving_batches WHERE id = NEW.batch_id)), 1, 7),
    NEW.fund_id, 1, NEW.amount
  )
  ON CONFLICT(month, fund_id) DO UPDATE SET
    gift_count = gift_count + 1,
    total_cents = total_cents + excluded.total_cents;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_delete
AFTER DELETE ON giving_entries
WHEN COALESCE(NULLIF(OLD.contribution_date, ''),
              (SELECT batch_date FROM giving_batches WHERE id = OLD.batch_id), '') != ''
BEGIN
  UPDATE giving_monthly_fund_totals
     SET gift_count = gift_count - 1,
         total_cents = total_cents - OLD.amount
   WHERE month = substr(COALESCE(NULLIF(OLD.contribution_date, ''),
                                 (SELECT batch_date FROM giving_batches WHERE id = OLD.batch_id)), 1, 7)
     AND fund_id = OLD.fund_id;
  DELETE FROM giving_monthly_fund_totals WHERE gift_count <= 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_update
AFTER UPDATE OF batch_id, contribution_date, fund_id, amount ON giving_entries
BEGIN
  UPDATE giving_monthly_fund_totals
     SET gift_count = gift_count - 1,
         total_cents = total_cents - OLD.amount
   WHERE COALESCE(NULLIF(OLD.contribution_date, ''),
                  (SELECT batch_date FROM giving_batches WHERE id = OLD.batch_id), '') != ''
     AND month = substr(COALESCE(NULLIF(OLD.contribution_date, ''),
                                 (SELECT batch_date FROM giving_batches WHERE id = OLD.batch_id)), 1, 7)
     AND fund_id = OLD.fund_id;
  DELETE FROM giving_monthly_fund_totals WHERE gift_count <= 0;
  INSERT INTO giving_monthly_fund_totals (month, fund_id, gift_count, total_cents)
  SELECT substr(COALESCE(NULLIF(NEW.contribution_date, ''),
                         (SELECT batch_date FROM giving_batches WHERE id = NEW.batch_id)), 1, 7),
         NEW.fund_id, 1, NEW.amount
   WHERE COALESCE(NULLIF(NEW.contribution_date, ''),
                  (SELECT batch_date FROM giving_batches WHERE id = NEW.batch_id), '') != ''
  ON CONFLICT(month, fund_id) DO UPDATE SET
    gift_count = gift_count + 1,
    total_cents = total_cents + excluded.total_cents;
END;

-- First-time-giver detection starts with recent gifts and uses this covering index to prove that
-- the same person has no earlier gift, instead of grouping the lifetime gift table on every Home.
CREATE INDEX IF NOT EXISTS idx_giving_person_date
  ON giving_entries(person_id, contribution_date);

-- Annual household/band statistics are more expensive than fund totals because they depend on
-- the giver's current household and member type. Rebuild one year once after relevant data
-- changes, then serve every Finance read from this single row until that year becomes dirty.
CREATE TABLE IF NOT EXISTS giving_year_stats (
  year              INTEGER PRIMARY KEY,
  giving_households INTEGER NOT NULL DEFAULT 0,
  giver_count       INTEGER NOT NULL DEFAULT 0,
  band_high         INTEGER NOT NULL DEFAULT 0,
  band_mid          INTEGER NOT NULL DEFAULT 0,
  band_low          INTEGER NOT NULL DEFAULT 0,
  refreshed_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS giving_year_household_totals (
  year          INTEGER NOT NULL,
  household_key TEXT    NOT NULL,
  total_cents   INTEGER NOT NULL DEFAULT 0,
  giver_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (year, household_key)
);

CREATE TABLE IF NOT EXISTS giving_rollup_dirty (
  year       INTEGER PRIMARY KEY,
  dirtied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO giving_year_household_totals(year,household_key,total_cents,giver_count)
WITH household_totals AS (
  SELECT CAST(substr(ge.contribution_date,1,4) AS INTEGER) AS year,
         CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0
              THEN 'h:' || p.household_id ELSE 'p:' || p.id END AS household_key,
         SUM(ge.amount) AS cents, COUNT(DISTINCT ge.person_id) AS givers
    FROM giving_entries ge
    JOIN people p ON p.id=ge.person_id
   WHERE ge.contribution_date!=''
     AND LOWER(COALESCE(p.member_type,''))!='organization'
   GROUP BY year, household_key
)
SELECT year,household_key,cents,givers FROM household_totals WHERE 1
ON CONFLICT(year,household_key) DO UPDATE SET
  total_cents=excluded.total_cents,giver_count=excluded.giver_count;

INSERT INTO giving_year_stats(year,giving_households,giver_count,band_high,band_mid,band_low,refreshed_at)
SELECT ht.year,COUNT(*),
       SUM(ht.giver_count),
       SUM(CASE WHEN ht.total_cents>=200000 THEN 1 ELSE 0 END),
       SUM(CASE WHEN ht.total_cents>=50000 AND ht.total_cents<200000 THEN 1 ELSE 0 END),
       SUM(CASE WHEN ht.total_cents>0 AND ht.total_cents<50000 THEN 1 ELSE 0 END),datetime('now')
  FROM giving_year_household_totals ht GROUP BY ht.year
ON CONFLICT(year) DO UPDATE SET
  giving_households=excluded.giving_households,
  giver_count=excluded.giver_count,
  band_high=excluded.band_high,
  band_mid=excluded.band_mid,
  band_low=excluded.band_low,
  refreshed_at=excluded.refreshed_at;

CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_insert
AFTER INSERT ON giving_entries
WHEN NEW.contribution_date!=''
BEGIN
  INSERT INTO giving_rollup_dirty(year,dirtied_at)
  VALUES(CAST(substr(NEW.contribution_date,1,4) AS INTEGER),datetime('now'))
  ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_delete
AFTER DELETE ON giving_entries
WHEN OLD.contribution_date!=''
BEGIN
  INSERT INTO giving_rollup_dirty(year,dirtied_at)
  VALUES(CAST(substr(OLD.contribution_date,1,4) AS INTEGER),datetime('now'))
  ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_update
AFTER UPDATE OF contribution_date, person_id, amount ON giving_entries
BEGIN
  INSERT INTO giving_rollup_dirty(year,dirtied_at)
  SELECT CAST(substr(OLD.contribution_date,1,4) AS INTEGER),datetime('now')
   WHERE OLD.contribution_date!=''
  ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
  INSERT INTO giving_rollup_dirty(year,dirtied_at)
  SELECT CAST(substr(NEW.contribution_date,1,4) AS INTEGER),datetime('now')
   WHERE NEW.contribution_date!=''
  ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_person_update
AFTER UPDATE OF household_id, member_type ON people
BEGIN
  INSERT INTO giving_rollup_dirty(year,dirtied_at)
  SELECT DISTINCT CAST(substr(contribution_date,1,4) AS INTEGER),datetime('now')
    FROM giving_entries
   WHERE person_id=NEW.id AND contribution_date!=''
  ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
END;
