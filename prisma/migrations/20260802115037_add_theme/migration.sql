-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('dark', 'light', 'system');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "theme" "Theme" NOT NULL DEFAULT 'dark';
