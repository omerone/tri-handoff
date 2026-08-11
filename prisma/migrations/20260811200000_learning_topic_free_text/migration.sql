-- Learning topics: a two-value enum becomes a free string.
--
-- The pair it shipped with — psychology and technical — are still the defaults and still
-- carry their own labels and colours in the app. What they cannot do is grow: a trader who
-- spends an evening back-testing had no way to say so, and the answer cannot be "ask for a
-- migration each time". The screens fold the value to a key before grouping, so a topic
-- typed three ways is still one topic.
--
-- `USING topic::text` keeps every existing row exactly as it reads today — 'psychology' and
-- 'technical' are their own names — so nothing is remapped and nothing can be lost.
ALTER TABLE "learning_entries" ALTER COLUMN "topic" TYPE TEXT USING "topic"::text;

-- Nothing references it once the column above is text.
DROP TYPE "LearningTopic";
