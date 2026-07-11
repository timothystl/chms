-- 0012 reclassified transportation roles to acceptance by running the UPDATE after
-- seedMinistryRolesFromStatic, which had already started seeding those 3 roles directly
-- under 'acceptance' (the seed source was changed in the same deploy). Any database that
-- cold-started in that window ended up with duplicate rows (transportation-origin +
-- freshly-seeded acceptance-origin) for each of the 3 driving roles. Collapse them back to
-- one row per name, keeping the earliest-created (lowest id).
DELETE FROM ministry_roles WHERE ministry='acceptance'
  AND name IN ('Regular Sunday Driver','Special-Occasion Driver','Ride Coordinator')
  AND id NOT IN (
    SELECT MIN(id) FROM ministry_roles WHERE ministry='acceptance'
      AND name IN ('Regular Sunday Driver','Special-Occasion Driver','Ride Coordinator')
    GROUP BY name
  );
