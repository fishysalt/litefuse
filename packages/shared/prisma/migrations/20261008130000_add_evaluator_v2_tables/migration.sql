-- CreateEnum
CREATE TYPE "EvaluatorSourceCodeLanguage" AS ENUM ('PYTHON', 'TYPESCRIPT');

-- AlterEnum
ALTER TYPE "EvalTemplateType" ADD VALUE 'CODE';

-- AlterTable
ALTER TABLE "eval_templates" DROP COLUMN "questions",
DROP COLUMN "type",
ALTER COLUMN "prompt" SET NOT NULL,
ALTER COLUMN "output_schema" SET NOT NULL;

-- CreateTable
CREATE TABLE "evaluators" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EvalTemplateType" NOT NULL,
    "description" TEXT,
    "created_by_user_id" TEXT,
    "blocked_at" TIMESTAMP(3),
    "block_reason" "EvaluatorBlockReason",
    "block_message" TEXT,

    CONSTRAINT "evaluators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluator_versions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluator_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_by_user_id" TEXT,
    "prompt" TEXT,
    "prompt_messages" JSONB,
    "partner" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "model_params" JSONB,
    "vars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variable_mapping" JSONB,
    "output_definition" JSONB,
    "source_code" VARCHAR(262144),
    "source_code_language" "EvaluatorSourceCodeLanguage",
    "questions" JSONB,

    CONSTRAINT "evaluator_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_rules" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "name" TEXT NOT NULL,
    "status" "JobConfigState" NOT NULL DEFAULT 'ACTIVE',
    "target_object" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "sampling" DECIMAL(65,30) NOT NULL,
    "delay" INTEGER NOT NULL,
    "time_scope" TEXT[] DEFAULT ARRAY['NEW']::TEXT[],

    CONSTRAINT "evaluation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_rule_evaluator_assignments" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT NOT NULL,
    "evaluation_rule_id" TEXT NOT NULL,
    "evaluator_id" TEXT NOT NULL,
    "variable_mapping" JSONB,

    CONSTRAINT "evaluation_rule_evaluator_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluators_project_id_created_at_idx" ON "evaluators"("project_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "evaluator_versions_evaluator_id_version_key" ON "evaluator_versions"("evaluator_id", "version" DESC);

-- CreateIndex
CREATE INDEX "evaluation_rules_project_id_updated_at_idx" ON "evaluation_rules"("project_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "evaluation_rule_assignments_project_id_idx" ON "evaluation_rule_evaluator_assignments"("project_id");

-- CreateIndex
CREATE INDEX "evaluation_rule_assignments_evaluator_id_idx" ON "evaluation_rule_evaluator_assignments"("evaluator_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_rule_assignments_rule_evaluator_key" ON "evaluation_rule_evaluator_assignments"("evaluation_rule_id", "evaluator_id");

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluators" ADD CONSTRAINT "evaluators_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluator_versions" ADD CONSTRAINT "evaluator_versions_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "evaluators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluator_versions" ADD CONSTRAINT "evaluator_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rules" ADD CONSTRAINT "evaluation_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rules" ADD CONSTRAINT "evaluation_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rule_evaluator_assignments" ADD CONSTRAINT "evaluation_rule_evaluator_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rule_evaluator_assignments" ADD CONSTRAINT "evaluation_rule_evaluator_assignments_evaluation_rule_id_fkey" FOREIGN KEY ("evaluation_rule_id") REFERENCES "evaluation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_rule_evaluator_assignments" ADD CONSTRAINT "evaluation_rule_evaluator_assignments_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "evaluators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

