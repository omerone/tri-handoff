-- What each broker account is for, and therefore what its trades are.
--
-- The trader runs one account for swings and one for day trades. That is the reason there are
-- two of them, not a note about them — so the account decides the style of everything it
-- imports, and `styleOf` stops deriving it from the calendar for those rows.
--
-- Null keeps the old behaviour, which is what an account connected before this column existed
-- should get: the open and close dates are the only evidence there is when nobody has said.
ALTER TABLE "mt5_accounts" ADD COLUMN IF NOT EXISTS "purpose" "TradeStyle";
