-- Learning hours: two decimal places to four.
--
-- A whole number of minutes is almost never a clean hundredth of an hour — 35 minutes is
-- 0.58333… — so at two places every entry is stored slightly wrong and the error accumulates.
-- Measured: forty sessions of 35 minutes came back as 1,392 minutes instead of 1,400. Four
-- places round-trip the same forty exactly.
--
-- Widening only. Every existing value is representable at the new scale, so nothing is
-- rewritten and nothing can be lost.
ALTER TABLE "learning_entries" ALTER COLUMN "hours" SET DATA TYPE DECIMAL(8,4);
