-- CreateIndex
CREATE INDEX "trades_user_id_strategy_idx" ON "trades"("user_id", "strategy");

-- CreateIndex
CREATE INDEX "trades_tags_idx" ON "trades" USING GIN ("tags");
