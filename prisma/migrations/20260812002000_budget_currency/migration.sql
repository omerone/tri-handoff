-- A budget carries the currency it was written in.
--
-- The column is renamed rather than replaced: every ceiling already stored was typed in
-- shekels, so the existing figures are correct as they stand and the new default says so.
ALTER TABLE "budgets" RENAME COLUMN "amount_ils" TO "amount";
ALTER TABLE "budgets" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ILS';
