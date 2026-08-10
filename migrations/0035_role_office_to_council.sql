-- The `office` role is renamed to `council` (church governance tier: sees the Finance
-- workspace and Reports, and giving only in aggregate — never an individual donor).
-- `office` is no longer a valid role, so any account still holding it would resolve to an
-- empty permission row. Move them across.
UPDATE app_users SET role = 'council' WHERE role = 'office';
