-- A line about one day, beside its goals.
--
-- Its own table rather than a goal with a flag: the week's figures are built by counting
-- goals, so a note wearing that shape would be counted, and every day somebody wrote a
-- sentence on would read as a day with an unkept goal.
CREATE TABLE "day_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "owner" TEXT,
    "day" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "day_notes_user_id_day_idx" ON "day_notes"("user_id", "day");

-- One note per day per member. The composite treats NULLs as distinct, so a household of one
-- could stack two notes on a Tuesday and the card would draw whichever came back first —
-- the partial index below is the same rule for that case. See the budgets' ceiling-per-category.
CREATE UNIQUE INDEX "day_notes_user_id_owner_day_key" ON "day_notes"("user_id", "owner", "day");

CREATE UNIQUE INDEX "day_notes_user_id_day_solo_key"
  ON "day_notes" ("user_id", "day")
  WHERE "owner" IS NULL;

ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
