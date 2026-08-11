-- A monthly spending ceiling per category, per brother.
--
-- The ledger already answers "what did I spend"; this is what turns it into "how much is
-- left". Additive only: a new table and its constraints, nothing existing is touched.
-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount_ils" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "budgets_user_id_owner_idx" ON "budgets"("user_id", "owner");
-- CreateIndex
CREATE UNIQUE INDEX "budgets_user_id_owner_category_key" ON "budgets"("user_id", "owner", "category");
-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
