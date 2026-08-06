-- CreateTable
CREATE TABLE "account_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL,
    "equity" DECIMAL(20,8),
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_snapshots_user_id_at_idx" ON "account_snapshots"("user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "account_snapshots_user_id_at_key" ON "account_snapshots"("user_id", "at");

-- AddForeignKey
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
