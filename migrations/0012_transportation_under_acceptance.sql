-- Transportation is now a sub-category of Acceptance (Care Ministry), not its own
-- top-level ministry — re-tag any roles already classified under 'transportation'.
UPDATE ministry_roles SET ministry='acceptance' WHERE ministry='transportation';
