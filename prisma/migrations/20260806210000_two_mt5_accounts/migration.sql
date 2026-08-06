-- Two MT5 accounts per trader, and every trade knowing which one it came from.
--
-- SPEC §3.3 said one account per user, and `mt5_accounts.user_id` was UNIQUE. A real client
-- runs two FTMO accounts, one for day trades and one for swings. Merged into one book the
-- journal reports the average of two strategies, which describes neither of them.
--
-- Written by hand rather than generated, because two things here are outside what Prisma can
-- express and both are load-bearing.

-- 1. An account is now identified by the broker account it points at, not by its owner.
ALTER TABLE "mt5_accounts" DROP CONSTRAINT IF EXISTS "mt5_accounts_user_id_key";
DROP INDEX IF EXISTS "mt5_accounts_user_id_key";
CREATE UNIQUE INDEX "mt5_accounts_user_id_login_server_key"
  ON "mt5_accounts" ("user_id", "login", "server");

-- 2. What the trader calls it. Null for the account that was connected before there was
--    anything to call it.
ALTER TABLE "mt5_accounts" ADD COLUMN IF NOT EXISTS "label" TEXT;

-- 3. The link from a trade to the account it came from. Null means the trader typed it.
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "mt5_account_id" TEXT;

-- 4. Attach the history that already exists to the account that already exists.
--
--    Every synced trade in this database was pulled by the single account its owner was
--    allowed to have, so "the user's one account" is not a guess — it is the only thing the
--    row could have come from. Manual trades are excluded by their ticket namespace and keep
--    their null, which is what null means here.
UPDATE "trades" t
   SET "mt5_account_id" = a."id"
  FROM "mt5_accounts" a
 WHERE a."user_id" = t."user_id"
   AND t."mt5_account_id" IS NULL
   AND t."ticket" NOT LIKE 'manual:%';

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_mt5_account_id_fkey"
  FOREIGN KEY ("mt5_account_id") REFERENCES "mt5_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. The unique key, and the reason this file is hand-written.
--
--    `(user_id, ticket)` cannot survive two accounts: two brokers can issue the same position
--    ticket, and the second one to arrive would silently overwrite the first. Adding the
--    account to the key fixes that and breaks something else — Postgres treats every NULL as
--    distinct in a unique index, so the manual trades, which all carry a NULL account, would
--    stop colliding with one another. That would quietly undo the idempotency in
--    `createManualTrade`, and a double-clicked form would write the trade twice again.
--
--    NULLS NOT DISTINCT (Postgres 15+, and this database is 16) makes the NULLs compare equal,
--    so both guarantees hold under one index. Prisma has no syntax for it and does not model
--    it, so it reads this as the plain unique constraint it declares.
DROP INDEX IF EXISTS "trades_user_id_ticket_key";
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_user_id_ticket_key";
CREATE UNIQUE INDEX "trades_user_id_mt5_account_id_ticket_key"
  ON "trades" ("user_id", "mt5_account_id", "ticket") NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS "trades_user_id_mt5_account_id_idx"
  ON "trades" ("user_id", "mt5_account_id");
