-- Andrew asked directly for this, first thing when he saw a Stax gift land in the batch view:
-- "there should be a refund button inside the app and not have to go to stax to do it." These
-- track the outcome of that in-app action locally so staff can see it happened, without rewriting
-- every batch/deposit/statement total to account for refunds — that's real future work if this
-- mockup ever becomes the live giving processor, not something to smuggle in here.
ALTER TABLE giving_entries ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE giving_entries ADD COLUMN voided_at TEXT NOT NULL DEFAULT '';
