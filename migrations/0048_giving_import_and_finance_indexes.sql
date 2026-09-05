-- The Breeze sync formerly re-scanned and de-duplicated the complete gift ledger on every run.
-- Clean historical duplicates once. New API-import lines use an indexed NOT EXISTS guard; a
-- unique index is deliberately avoided because merging two funds can temporarily create two
-- legitimate lines with the same payment/fund identity that the merge workflow must reconcile.
DELETE FROM giving_entries
 WHERE breeze_id != '' AND id NOT IN (
   SELECT MIN(id) FROM giving_entries WHERE breeze_id != '' GROUP BY breeze_id, fund_id
 );

-- Mirrors the income-statement import-status index for legacy balance-sheet import dates.
CREATE INDEX IF NOT EXISTS idx_church_balances_source_synced
  ON finance_church_balances(source, synced_at);
