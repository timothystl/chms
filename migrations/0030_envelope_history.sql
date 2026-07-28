-- GIV-R4/B: retain a person's prior pew-envelope numbers. Envelope numbers are
-- reassigned yearly in Breeze, but old envelopes stay in circulation, so a superseded
-- number must still resolve to its person. Stored as a most-recent-first JSON array of
-- strings (see archiveEnvelope/parseEnvelopeHistory in api-utils.js). The current number
-- stays in the existing people.envelope_number column.
ALTER TABLE people ADD COLUMN envelope_history TEXT NOT NULL DEFAULT '[]';
