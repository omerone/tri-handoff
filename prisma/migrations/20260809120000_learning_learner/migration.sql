-- Who did the studying.
--
-- One login, two people. "We did eleven hours this month" answers nothing about whether one of
-- them did ten of them, and the whole point of a study ledger is to see where the hours went.
--
-- Nullable, and null means "recorded before anyone was named" rather than "nobody" — an
-- existing row must not be attributed to a person who may not have done it.
ALTER TABLE "learning_entries" ADD COLUMN IF NOT EXISTS "learner" TEXT;

-- The screen groups and filters by learner within a date window, which is the same shape the
-- existing (user_id, learned_on) index serves; this one carries the name so the grouping does
-- not fall back to a scan once a couple of years of sessions have accumulated.
CREATE INDEX IF NOT EXISTS "learning_entries_user_id_learner_idx"
  ON "learning_entries" ("user_id", "learner");
