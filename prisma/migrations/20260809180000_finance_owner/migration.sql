-- Which brother a finance row belongs to.
--
-- One login, two brothers. Trading is joint by design — splitting the account would split the
-- book, the 2FA and the broker sync with it. Money is not joint: each brother has his own
-- income and expenses, and a budget that merges them answers a question neither asked.
--
-- Nullable: null is "entered before the split, or deliberately shared", and it surfaces only
-- in the "both" view rather than being assigned to whichever name sorts first.
ALTER TABLE "finance_entries" ADD COLUMN IF NOT EXISTS "owner" TEXT;

-- The screen filters by owner inside the same user scope the existing indexes serve.
CREATE INDEX IF NOT EXISTS "finance_entries_user_id_owner_idx"
  ON "finance_entries" ("user_id", "owner");
