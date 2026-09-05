-- Offerings list/work-queue screens need only a batch's count and total, not its individual gifts.
CREATE TABLE IF NOT EXISTS giving_batch_totals (
  batch_id    INTEGER PRIMARY KEY,
  entry_count INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0
);

INSERT INTO giving_batch_totals(batch_id,entry_count,total_cents)
SELECT batch_id,COUNT(*),COALESCE(SUM(amount),0) FROM giving_entries GROUP BY batch_id
ON CONFLICT(batch_id) DO UPDATE SET
  entry_count=excluded.entry_count,total_cents=excluded.total_cents;

CREATE TRIGGER IF NOT EXISTS trg_giving_batch_totals_insert
AFTER INSERT ON giving_entries
BEGIN
  INSERT INTO giving_batch_totals(batch_id,entry_count,total_cents)
  VALUES(NEW.batch_id,1,NEW.amount)
  ON CONFLICT(batch_id) DO UPDATE SET
    entry_count=entry_count+1,total_cents=total_cents+excluded.total_cents;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_batch_totals_delete
AFTER DELETE ON giving_entries
BEGIN
  UPDATE giving_batch_totals
     SET entry_count=entry_count-1,total_cents=total_cents-OLD.amount
   WHERE batch_id=OLD.batch_id;
  DELETE FROM giving_batch_totals WHERE batch_id=OLD.batch_id AND entry_count<=0;
END;

CREATE TRIGGER IF NOT EXISTS trg_giving_batch_totals_update
AFTER UPDATE OF batch_id,amount ON giving_entries
BEGIN
  UPDATE giving_batch_totals
     SET entry_count=entry_count-1,total_cents=total_cents-OLD.amount
   WHERE batch_id=OLD.batch_id;
  DELETE FROM giving_batch_totals WHERE batch_id=OLD.batch_id AND entry_count<=0;
  INSERT INTO giving_batch_totals(batch_id,entry_count,total_cents)
  VALUES(NEW.batch_id,1,NEW.amount)
  ON CONFLICT(batch_id) DO UPDATE SET
    entry_count=entry_count+1,total_cents=total_cents+excluded.total_cents;
END;
