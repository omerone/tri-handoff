-- A household of one writes no owner on its rows.
--
-- Goals and budgets required an owner because the household was a constant of two; with the
-- household per-tenant and possibly empty, "nobody in particular" became a legal answer, the
-- same one finance and learning already store as NULL.
ALTER TABLE "goals" ALTER COLUMN "owner" DROP NOT NULL;
ALTER TABLE "budgets" ALTER COLUMN "owner" DROP NOT NULL;

-- The budgets table's ceiling-per-category rule, kept for the null owner too. The composite
-- unique treats NULLs as distinct, so a solo tenant could stack two "food" ceilings and the
-- screen would silently sum them. Partial unique closes it; the write path branches to
-- find-then-write for null, because an upsert cannot name a null in its unique key.
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_user_id_category_solo_key"
  ON "budgets" ("user_id", "category")
  WHERE "owner" IS NULL;
