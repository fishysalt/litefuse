// ── LITEFUSE ADDITION (evaluators v2 execution) ─────────────────────────────
// The v2-native LLM-as-a-judge executor. The legacy executor in `evalService.ts`
// always asks the model for a NUMERIC score (it builds a numeric schema and emits
// `dataType: "NUMERIC"` score events), so a v2 evaluator whose
// `outputDefinition.dataType` is BOOLEAN or CATEGORICAL cannot run through it.
//
// This file is the v2 path:
//   * messages come from the evaluator version's chat prompts,
//   * the output contract comes from `outputDefinition` (all three data types),
//     compiled and validated by the shared v2 code (`executeLlmEvaluator`),
//   * the score event carries the matching `dataType` (categorical matches produce
//     one score each).
//
// Deviations from upstream, both deliberate:
//   1. The LLM call goes through `fetchLLMCompletion` (the layer the rest of the
//      product uses) instead of the AI SDK — decision U1. Our layer takes the
//      compiled zod v4 result schema directly, so upstream's model-facing schema
//      remap (`scoreExplanation`) is not needed.
//   2. Our score body contract has no `evaluatorId` / `evaluationRuleId` fields
//      (upstream added them to the ingestion body). The v2 identity is therefore
//      written into the score `metadata` and `configId` instead of new body fields.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import { type JobExecution } from "@prisma/client";
import {
  getBlockReasonForInvalidModelConfig,
  getEvaluatorBlockMetadata,
  getEvaluatorPromptMessages,
  type EvalOutputResult,
  type EvaluatorBlockReason,
  type PersistedEvalOutputDefinition,
} from "@langfuse/shared";
import {
  EvaluatorBlockSource,
  executeLlmEvaluator,
  fetchLLMCompletion,
  instrumentAsync,
  LangfuseInternalTraceEnvironment,
  logger,
  type ExtractedVariable,
} from "@langfuse/shared/src/server";
import { UnrecoverableError } from "../../errors/UnrecoverableError";
import { buildExecutionMetadata } from "./evalExecutionUtils";
import { type EvalExecutionDeps } from "./evalExecutionDeps";
import { persistV2Scores, type V2ScoreData } from "./v2ScorePersistence";
import { createW3CTraceId } from "../utils";

/** The evaluator-version fields this executor needs (a `evaluator_versions` row). */
export type V2EvaluatorVersionForExecution = {
  id: string;
  version: number;
  prompt: string | null;
  promptMessages: unknown;
  vars: string[];
  provider: string | null;
  model: string | null;
  modelParams: unknown;
  outputDefinition: unknown;
};

/**
 * Turns the shared v2 output result into score payloads.
 *
 * A categorical evaluator may match several categories; each match becomes its own
 * score (that is what upstream's `scores` array expresses as well).
 */
export function toV2Scores(params: {
  output: EvalOutputResult;
  scoreName: string;
  /** Null for a ruleless manual batch run. */
  configId: string | null;
  comment: string;
}): V2ScoreData[] {
  const { output, scoreName, configId, comment } = params;

  switch (output.dataType) {
    case "NUMERIC":
      return [
        {
          name: scoreName,
          value: output.score,
          dataType: "NUMERIC",
          comment,
          configId,
        },
      ];
    case "BOOLEAN":
      // Our ingestion contract stores boolean scores as 0/1.
      return [
        {
          name: scoreName,
          value: output.score ? 1 : 0,
          dataType: "BOOLEAN",
          comment,
          configId,
        },
      ];
    case "CATEGORICAL":
      return output.matches.map((match) => ({
        name: scoreName,
        value: match,
        dataType: "CATEGORICAL" as const,
        comment,
        configId,
      }));
  }
}

/**
 * The trace sink for one evaluator LLM call.
 *
 * The environment MUST be a reserved internal one: `fetchLLMCompletion` refuses
 * to write an internal trace whose environment lacks the `langfuse-` prefix (it
 * logs and skips), and the reserved value is also what keeps this execution from
 * being evaluated again by `isEvalTargetEnvironmentAllowed`. The *score* event
 * keeps the target's environment instead — that is a separate concern.
 */
export function buildEvaluatorTraceSinkParams(params: {
  projectId: string;
  executionTraceId: string;
  traceName: string;
  metadata: Record<string, string>;
}) {
  return {
    targetProjectId: params.projectId,
    traceId: params.executionTraceId,
    traceName: params.traceName,
    environment: LangfuseInternalTraceEnvironment.LLMJudge,
    metadata: params.metadata,
  };
}

export async function runV2LlmEvaluatorEvaluation({
  projectId,
  jobExecutionId,
  job,
  evaluatorId,
  evaluationRuleId,
  scoreName,
  version,
  variableMapping,
  extractedVariables,
  environment,
  deps,
}: {
  projectId: string;
  jobExecutionId: string;
  job: JobExecution;
  evaluatorId: string;
  /** Null for a ruleless manual batch run. */
  evaluationRuleId: string | null;
  scoreName: string;
  version: V2EvaluatorVersionForExecution;
  variableMapping: unknown;
  extractedVariables: ExtractedVariable[];
  environment: string;
  deps: EvalExecutionDeps;
}): Promise<void> {
  return instrumentAsync(
    { name: "eval.execute-v2-llm-evaluator" },
    async (span) => {
      span.setAttribute("langfuse.project.id", projectId);
      span.setAttribute("eval.job_execution.id", jobExecutionId);
      span.setAttribute("eval.evaluator.id", evaluatorId);
      if (evaluationRuleId) {
        span.setAttribute("eval.evaluation_rule.id", evaluationRuleId);
      }
      span.setAttribute("eval.evaluator.version", version.version);
      if (job.jobInputTraceId) {
        span.setAttribute("eval.target.trace_id", job.jobInputTraceId);
      }
      if (job.jobInputObservationId) {
        span.setAttribute(
          "eval.target.observation_id",
          job.jobInputObservationId,
        );
      }

      const promptMessages = getEvaluatorPromptMessages({
        prompt: version.prompt,
        promptMessages: version.promptMessages,
      });
      const outputDefinition =
        version.outputDefinition as PersistedEvalOutputDefinition | null;
      if (!outputDefinition) {
        throw new UnrecoverableError(
          `Evaluator version ${version.id} has no output definition`,
        );
      }

      const executionTraceId = createW3CTraceId(jobExecutionId);
      const executionMetadata = {
        ...buildExecutionMetadata({
          jobExecutionId,
          jobConfigurationId: evaluationRuleId ?? job.jobConfigurationId,
          targetTraceId: job.jobInputTraceId,
          targetObservationId: job.jobInputObservationId,
          targetDatasetItemId: job.jobInputDatasetItemId,
        }),
        evaluator_id: evaluatorId,
        evaluator_version_id: version.id,
        // Absent on ruleless manual batch runs.
        ...(evaluationRuleId ? { evaluation_rule_id: evaluationRuleId } : {}),
      };

      /** Pauses the evaluator row (the field the migrated UI reads). */
      const pauseEvaluator = async (
        blockReason: EvaluatorBlockReason,
        source: EvaluatorBlockSource,
      ) => {
        await deps.blockEvaluator?.({
          projectId,
          evaluatorId,
          blockReason,
          blockMessage: getEvaluatorBlockMetadata(blockReason).message,
          source,
        });
      };

      logger.debug(
        `Executing evaluator v2 LLM judge for job ${jobExecutionId} (${scoreName})`,
      );

      let execution: Awaited<ReturnType<typeof executeLlmEvaluator>>;
      try {
        execution = await executeLlmEvaluator({
          promptMessages,
          variables: extractedVariables,
          outputDefinition,
          callLlm: async ({ messages, compiledOutputDefinition }) => {
            const modelConfig = await deps.fetchModelConfig({
              projectId,
              provider: version.provider ?? undefined,
              model: version.model ?? undefined,
              modelParams: (version.modelParams ?? null) as Record<
                string,
                unknown
              > | null,
            });

            if (!modelConfig.valid) {
              const blockReason = getBlockReasonForInvalidModelConfig({
                templateProvider: version.provider,
                templateModel: version.model,
                error: modelConfig.error,
              });
              await pauseEvaluator(
                blockReason,
                EvaluatorBlockSource.INVALID_MODEL_CONFIG,
              );
              throw new UnrecoverableError(
                `Invalid model configuration for job ${jobExecutionId}: ${modelConfig.error}`,
              );
            }

            span.setAttribute(
              "eval.model.provider",
              modelConfig.config.provider,
            );
            span.setAttribute("eval.model.name", modelConfig.config.model);

            // Type assertions mirror the legacy executor: the deps interface keeps
            // the connection shape small for testability.
            const llmConnection = modelConfig.config
              .apiKey as unknown as Parameters<
              typeof fetchLLMCompletion
            >[0]["llmConnection"];
            const adapter = modelConfig.config.apiKey
              .adapter as unknown as Parameters<
              typeof fetchLLMCompletion
            >[0]["modelParams"]["adapter"];

            return fetchLLMCompletion({
              streaming: false,
              llmConnection,
              messages,
              modelParams: {
                provider: modelConfig.config.provider,
                model: modelConfig.config.model,
                adapter,
                ...modelConfig.config.modelParams,
              },
              structuredOutputSchema:
                compiledOutputDefinition.outputResultSchema,
              maxRetries: 1,
              traceSinkParams: buildEvaluatorTraceSinkParams({
                projectId,
                executionTraceId,
                traceName: `Execute evaluator: ${scoreName}`,
                metadata: executionMetadata,
              }),
            });
          },
        });
      } catch (e) {
        span.setAttribute("eval.execution.outcome", "failed");
        throw e;
      }

      if (!execution.output.success) {
        span.setAttribute("eval.execution.outcome", "invalid_model_output");
        throw new UnrecoverableError(
          `Invalid LLM response for job ${jobExecutionId}: ${execution.output.error}`,
        );
      }

      const scores = toV2Scores({
        output: execution.output.data,
        scoreName,
        configId: evaluationRuleId,
        comment: execution.output.data.reasoning,
      });
      span.setAttribute("eval.score.count", scores.length);

      // Every score is persisted (a categorical multi-match produces more than one).
      await persistV2Scores({
        deps,
        projectId,
        jobExecutionId,
        job,
        scores,
        environment,
        executionTraceId,
        metadata: executionMetadata,
      });

      logger.debug(
        `Evaluator v2 job ${jobExecutionId} completed with ${scores.length} score(s)`,
      );
    },
  );
}
