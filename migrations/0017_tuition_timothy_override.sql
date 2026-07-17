-- Tuition Aid Planner: lets a K-8 student's current-year (offset 0) Timothy Award be typed in
-- as an exact dollar amount, the same way Outside Aid already can be, instead of only being
-- derivable from the Family Share % slider. Distinct from the pre-existing
-- timothy_award_exact_cents/family_owed_exact_cents columns (the original Breeze/manual seed
-- snapshot, used only before the family share % has ever been touched) — these new columns
-- represent a deliberate, ongoing manual override that always wins once set, until the
-- Family Share % slider is dragged again (which clears it).
ALTER TABLE tuition_students ADD COLUMN timothy_award_override_cents INTEGER;
ALTER TABLE tuition_students ADD COLUMN family_owed_override_cents INTEGER;
