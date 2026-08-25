-- Website contact-form submissions (POST /api/intake/connect-card) no longer create a
-- `people` row automatically -- staff reported the People/directory filling up with
-- one-off website contacts they never intended to add as members. The submitter's own
-- name/email/phone are now stored directly on the follow-up item instead, mirroring the
-- requester_name/requester_email pattern prayer_requests already uses.
ALTER TABLE follow_up_items ADD COLUMN requester_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE follow_up_items ADD COLUMN requester_email TEXT NOT NULL DEFAULT '';
ALTER TABLE follow_up_items ADD COLUMN requester_phone TEXT NOT NULL DEFAULT '';
