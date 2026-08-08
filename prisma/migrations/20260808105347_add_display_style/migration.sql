-- CreateEnum
CREATE TYPE "DisplayStyle" AS ENUM ('depth', 'instrument', 'calm');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_style" "DisplayStyle" NOT NULL DEFAULT 'depth';
