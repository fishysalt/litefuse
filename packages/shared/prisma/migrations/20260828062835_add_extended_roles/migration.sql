-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'DEVELOPER';
ALTER TYPE "Role" ADD VALUE 'PROMPT_MANAGER';
ALTER TYPE "Role" ADD VALUE 'EVALUATOR';
ALTER TYPE "Role" ADD VALUE 'ANNOTATOR';
ALTER TYPE "Role" ADD VALUE 'AUDITOR';

-- AlterTable
ALTER TABLE "stripe_webhook_events" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
