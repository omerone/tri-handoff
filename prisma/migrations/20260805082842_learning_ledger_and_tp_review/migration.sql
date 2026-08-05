-- CreateEnum
CREATE TYPE "TpTiming" AS ENUM ('early', 'onTime', 'late');

-- CreateEnum
CREATE TYPE "LearningTopic" AS ENUM ('psychology', 'technical');

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "took_original_tp" BOOLEAN,
ADD COLUMN     "tp_timing" "TpTiming";

-- CreateTable
CREATE TABLE "learning_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic" "LearningTopic" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "hours" DECIMAL(6,2) NOT NULL,
    "learned_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_entries_user_id_learned_on_idx" ON "learning_entries"("user_id", "learned_on");

-- AddForeignKey
ALTER TABLE "learning_entries" ADD CONSTRAINT "learning_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
