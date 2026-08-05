-- Giving consolidation (Offerings tab): true many-to-many links between counted batches and
-- bank deposits. A batch can be split across several deposits (a second bank run, or part of
-- the count still in the safe); a deposit can hold several batches (Sunday plate + the week's
-- online payout on one slip). 0031 could only express one deposit per gift, which cannot say
-- "half of Sunday's count went in on Monday and half on Wednesday".
--
-- A deposit's given_cents = SUM of its lines. A batch is fully deposited when SUM of its lines
-- equals the batch total. Fees stay (given - bank_cents) per deposit, exactly as before.
CREATE TABLE IF NOT EXISTS giving_deposit_lines (
  deposit_id   INTEGER NOT NULL,
  batch_id     INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (deposit_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_deposit_lines_batch ON giving_deposit_lines(batch_id);
