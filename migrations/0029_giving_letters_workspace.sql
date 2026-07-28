-- Phase 2 of the Giving-tab redesign (GIV-R2): the Letters & Statements workspace.
-- Extends the send-tracking table so it can dedup/resume across more than the original
-- per-person year_end/midyear email sends:
--   * household_id  — set when a send is scoped to a whole household (e.g. the appeal), so
--                     spouses sharing a household aren't sent twice; person_id still holds the
--                     actual recipient person (the one whose email/address was used).
--   * channel       — 'email' | 'print'. A printed letter is recorded here too so the workspace
--                     status shows it as done and a later email run skips it (and vice versa is a
--                     deliberate re-send, not a dup).
--   * recipient_key — 'p<person_id>' or 'h<household_id>'. The stable dedup identity for a send,
--                     independent of which person inside a household happened to be the recipient.
-- letter_type now also accepts: quarterly | thank_you | appeal | memorial (was year_end|midyear).
-- The original UNIQUE(person_id, year, letter_type) is left in place for backward-compatible
-- per-person email sends; the new partial unique index below is the identity used by the
-- workspace's status/send endpoints.
ALTER TABLE giving_letter_sends ADD COLUMN household_id INTEGER;
ALTER TABLE giving_letter_sends ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE giving_letter_sends ADD COLUMN recipient_key TEXT;

-- Idempotent identity for the workspace: one recorded send per recipient/year/type/channel.
-- Partial (WHERE recipient_key IS NOT NULL) so the pre-existing rows written by the legacy
-- per-person send path (recipient_key NULL) are untouched and don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gls_recipient
  ON giving_letter_sends(recipient_key, year, letter_type, channel)
  WHERE recipient_key IS NOT NULL;
