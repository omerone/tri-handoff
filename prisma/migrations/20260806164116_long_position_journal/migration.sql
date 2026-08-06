-- AlterTable
ALTER TABLE "long_positions" ADD COLUMN     "mood" TEXT,
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "strategy" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
