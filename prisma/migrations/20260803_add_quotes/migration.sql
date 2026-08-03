-- Market-price cache for long-term positions.
--
-- Shared rather than tenant-scoped: a quote is a fact about a listing, and sharing the row is
-- what keeps a hundred-symbol portfolio inside a free API budget.
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "mic_code" TEXT NOT NULL,
    -- Null when the provider had nothing for this listing: the row still carries `fetched_at`,
    -- which is what backs an unknown ticker off instead of retrying it on every tick.
    "price" DECIMAL(20,8),
    "currency" TEXT,
    "as_of" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotes_symbol_mic_code_key" ON "quotes"("symbol", "mic_code");

-- Existing positions keep their manually entered prices: `manual` is the default, so nothing
-- that worked before this migration changes behaviour after it.
ALTER TABLE "long_positions" ADD COLUMN "price_source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "long_positions" ADD COLUMN "mic_code" TEXT NOT NULL DEFAULT '';

-- The refresh's own query: open, auto-priced positions, distinct by listing.
CREATE INDEX "long_positions_price_source_closed_at_idx" ON "long_positions"("price_source", "closed_at");
