-- Budgets written before the form resolved a category's name back to its key.
--
-- Built-in categories are stored as keys and offered by their translated name, so a ceiling
-- set by picking "משכנתא" was stored as that word while the expenses under it are filed as
-- `mortgage`. The two never met: the dial read a confident zero against real spending, and
-- the category appeared twice in the suggestion list — once as itself, once as the key's name.
--
-- The form resolves it now. This is the rows already written.

-- Only where the key is free, so this can never collide with the unique constraint.
UPDATE budgets
SET category = names.key
FROM (VALUES
  ('משכורת', 'salary'),
  ('בונוס', 'bonus'),
  ('פרויקט צד', 'sideProject'),
  ('השקעות', 'investment'),
  ('החזר', 'refund'),
  ('שכר דירה', 'rent'),
  ('משכנתא', 'mortgage'),
  ('מזון ומסעדות', 'food'),
  ('תחבורה', 'transport'),
  ('חשבונות', 'utilities'),
  ('ביטוח', 'insurance'),
  ('בריאות', 'health'),
  ('חינוך', 'education'),
  ('פנאי', 'leisure'),
  ('קניות', 'shopping'),
  ('הפקדה לחשבון מסחר', 'tradingDeposit'),
  ('אחר', 'other'),
  ('Side project', 'sideProject'),
  ('Investments', 'investment'),
  ('Food & dining', 'food'),
  ('Deposit to trading', 'tradingDeposit')
) AS names(label, key)
WHERE budgets.category = names.label
  AND NOT EXISTS (
    SELECT 1 FROM budgets other
    WHERE other.user_id = budgets.user_id
      AND other.owner = budgets.owner
      AND other.category = names.key
  );

-- Anything left is a ceiling on a category that already has one under its key: the same
-- budget twice, drawn as two dials with the same name. The keyed one is the one measuring
-- money, so the duplicate goes rather than sitting there reading zero forever.
DELETE FROM budgets
WHERE category IN (SELECT label FROM (VALUES
  ('משכורת', 'salary'),
  ('בונוס', 'bonus'),
  ('פרויקט צד', 'sideProject'),
  ('השקעות', 'investment'),
  ('החזר', 'refund'),
  ('שכר דירה', 'rent'),
  ('משכנתא', 'mortgage'),
  ('מזון ומסעדות', 'food'),
  ('תחבורה', 'transport'),
  ('חשבונות', 'utilities'),
  ('ביטוח', 'insurance'),
  ('בריאות', 'health'),
  ('חינוך', 'education'),
  ('פנאי', 'leisure'),
  ('קניות', 'shopping'),
  ('הפקדה לחשבון מסחר', 'tradingDeposit'),
  ('אחר', 'other'),
  ('Side project', 'sideProject'),
  ('Investments', 'investment'),
  ('Food & dining', 'food'),
  ('Deposit to trading', 'tradingDeposit')
) AS names(label, key));
