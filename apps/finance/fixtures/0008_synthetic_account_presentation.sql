-- Synthetic staging data only. Never use this file with a production database.
INSERT INTO finance_account_presentation
  (category_path, board_category_key, board_category_label, purpose_tag_id, purpose_tag_label, source, updated_at)
VALUES
  ('Income:Synthetic Contributions', 'donor', 'Unrestricted Gifts', 'ministry', 'Ministry', 'synthetic_fixture', '2026-01-01T00:00:00Z'),
  ('Expenses:Synthetic Programs', 'programs', 'Programs', 'ministry', 'Ministry', 'synthetic_fixture', '2026-01-01T00:00:00Z');
