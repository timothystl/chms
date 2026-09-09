-- Finance-owned display classification. This never renumbers or mutates source ledger accounts.
CREATE TABLE finance_account_presentation (
  category_path TEXT PRIMARY KEY,
  board_category_key TEXT NOT NULL,
  board_category_label TEXT NOT NULL,
  purpose_tag_id TEXT,
  purpose_tag_label TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((purpose_tag_id IS NULL AND purpose_tag_label IS NULL)
      OR (length(purpose_tag_id) > 0 AND length(purpose_tag_label) > 0))
);
CREATE INDEX idx_finance_account_presentation_board_category
  ON finance_account_presentation(board_category_key);
CREATE INDEX idx_finance_account_presentation_purpose_tag
  ON finance_account_presentation(purpose_tag_id);
