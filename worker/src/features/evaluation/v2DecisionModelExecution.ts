// ── LITEFUSE ADDITION (evaluators v2: decision model, i.e. "Jev") ───────────
// The decision-model executor. A decision-model evaluator does not write a prompt:
// it asks a fixed set of questions (`evaluator_versions.questions`) against the
// extracted variables and maps the answers to scores. Upstream runs it from its
// observation/event path; we dispatch it from the trace/dataset path as well —
// documented in `docs/jev as judge/待决问题登记.md` (our rule UI lets a rule target
// a decision-model evaluator, upstream's trace path filters those rules out).
//
// Deviations from upstream's `decisionModel/runDecisionModelEvaluation.ts`, all
// deliberate:
//   * no internal execution trace (`buildDecisionModelTraceInput` +
//     `writeInternalTraceViaOtelIngestion` are not ported),
//   * no OpenTelemetry span attributes beyond the shared execution span,
//   * the model call goes through our hand-written cross-checked TypeSafe client
//     (verbatim wire format) rather than the AI SDK — decision U1.
// ─────────────────────────────────────────────────────────────────────────────

import { type JobExecution } from "@prisma/client";
import {
  DECISION_MODEL_ADAPTER,
  getBlockReasonForInvalidModelConfig,
  getEvaluatorBlockMetadata,
  isDecisionModelAdapter,
  parseDecisionModelQuestions,
  type DecisionModelQuestions,
  type EvaluatorBlockReason,
} from "@langfuse/shared";
import { decrypt } from "@langfuse/shared/encryption";
import {
  EvaluatorBlockSource,
  createTypeSafeDecisionModelClient,
  executeDecisionModelEvaluator,
  instrumentAsync,
  logger,
  type DecisionModelRequest,
  type ExtractedVariable,
} from "@langfuse/shared/src/server";
import { UnrecoverableError } from "../../errors/UnrecoverableError";
import { buildExecutionMetadata } from "./evalExecutionUtils";
import { type EvalExecutionDeps } from "./evalExecutionDeps";
import { persistV2Scores, type V2ScoreData } from "./v2ScorePersistence";
import { writeDecisionModelExecutionTrace } from "./v2InternalTrace";
import { createW3CTraceId } from "../utils";

/** The decision-model evaluator-version fields this executor needs. */
export type V2DecisionModelVersionForExecution = {
  id: string;
  version: number;
  questions: unknown;
  provider: string | null;
  model: string | null;
  modelParams: unknown;
};

export async function runV2DecisionModelEvaluation({
  projectId,
  jobExecutionId,
  job,
  evaluatorId,
  evaluationRuleId,
  scoreName,
  version,
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
  version: V2DecisionModelVersionForExecution;
  extractedVariables: ExtractedVariable[];
  environment: string;
  deps: EvalExecutionDeps;
}): Promise<void> {
  return instrumentAsync(
    { name: "eval.execute-v2-decision-model" },
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

      // 1. Questions are part of the evaluator version; an unparseable set is a
      //    permanent failure (retrying cannot fix it).
      span.setAttribute("eval.execution.stage", "validate_questions");
      const parsedQuestions = parseDecisionModelQuestions(version.questions);
      if (!parsedQuestions.success) {
        span.setAttribute("eval.execution.outcome", "invalid_questions");
        throw new UnrecoverableError(
          `Decision-model questions are invalid for evaluator ${evaluatorId}: ${parsedQuestions.error}`,
        );
      }
      const questions: DecisionModelQuestions = parsedQuestions.data;
      span.setAttribute("eval.decision_model.question_count", questions.length);

      // 2. Resolve the connection and make sure it really is a decision-model one.
      span.setAttribute("eval.execution.stage", "resolve_model_config");
      const modelConfig = await deps.fetchModelConfig({
        projectId,
        provider: version.provider ?? undefined,
        model: version.model ?? undefined,
        modelParams: null,
      });

      let modelConfigError: string | null = null;
      if (!modelConfig.valid) {
        modelConfigError = modelConfig.error;
      } else if (!isDecisionModelAdapter(modelConfig.config.apiKey.adapter)) {
        modelConfigError = `Connection "${modelConfig.config.provider}" is not a decision-model connection (expected adapter "${DECISION_MODEL_ADAPTER}")`;
      }

      if (modelConfigError !== null || !modelConfig.valid) {
        const blockReason = getBlockReasonForInvalidModelConfig({
          templateProvider: version.provider,
          templateModel: version.model,
          error: modelConfigError ?? "",
        });
        span.setAttributes({
          "eval.execution.outcome": "blocked",
          "eval.llm.block.reason": blockReason,
        });
        await pauseEvaluator(
          blockReason,
          EvaluatorBlockSource.INVALID_MODEL_CONFIG,
        );
        throw new UnrecoverableError(
          `Invalid model configuration for job ${jobExecutionId}: ${modelConfigError}`,
        );
      }

      const { apiKey } = modelConfig.config;
      const secretKey = apiKey.secretKey;
      if (typeof secretKey !== "string") {
        throw new UnrecoverableError(
          "Decision-model connection is missing its secret key",
        );
      }

      let decryptedSecretKey: string;
      try {
        decryptedSecretKey = decrypt(secretKey);
      } catch {
        throw new UnrecoverableError(
          "Decision-model connection secret could not be decrypted",
        );
      }

      // 3. Ask the decision model.
      const executionTraceId = createW3CTraceId(jobExecutionId);
      const traceStartTime = new Date();
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

      span.setAttributes({
        "eval.execution.trace_id": executionTraceId,
        "eval.execution.stage": "call_decision_model",
        "eval.model.provider": modelConfig.config.provider,
        "eval.model.name": modelConfig.config.model,
      });

      let request: DecisionModelRequest | undefined;
      let execution: Awaited<ReturnType<typeof executeDecisionModelEvaluator>>;
      try {
        const client = createTypeSafeDecisionModelClient({
          apiKey: decryptedSecretKey,
          model: modelConfig.config.model,
          baseURL:
            typeof apiKey.baseURL === "string" ? apiKey.baseURL : null,
        });

        execution = await executeDecisionModelEvaluator({
          variables: extractedVariables,
          questions,
          client: {
            evaluate: (sent) => {
              request = sent;
              return client.evaluate(sent);
            },
          },
        });
      } catch (e) {
        span.setAttribute("eval.execution.outcome", "llm_error");
        throw e;
      }

      logger.debug(
        `Job ${jobExecutionId} received ${execution.scores.length} decision-model answer(s) from ${execution.evaluation.model}`,
      );
      span.setAttribute(
        "eval.decision_model.model",
        execution.evaluation.model,
      );
      span.setAttribute("eval.score.count", execution.scores.length);

      // Record the call as an internal trace. The LLM judge gets this for free
      // through `fetchLLMCompletion`'s trace sink; the decision model does not go
      // through that layer, so it is written explicitly. Best-effort: a trace
      // failure must not fail the evaluation.
      await writeDecisionModelExecutionTrace({
        projectId,
        executionTraceId,
        traceName: `Execute evaluator: ${scoreName}`,
        traceStartTime,
        request: execution.request,
        evaluation: execution.evaluation,
        metadata: executionMetadata,
      });

      // 4. Persist. Decision-model answers already arrive as score payloads
      //    (name + value + data type), unlike the LLM judge's single output.
      const persistableDataTypes = new Set<V2ScoreData["dataType"]>([
        "NUMERIC",
        "BOOLEAN",
        "CATEGORICAL",
      ]);
      const scores: V2ScoreData[] = execution.scores
        .filter((score) => {
          const supported = persistableDataTypes.has(
            score.dataType as V2ScoreData["dataType"],
          );
          if (!supported) {
            logger.warn(
              `Skipping decision-model score "${score.name}" of job ${jobExecutionId}: unsupported data type ${score.dataType}`,
            );
          }
          return supported;
        })
        .map((score) => ({
          name: score.name,
          value: score.value,
          dataType: score.dataType as V2ScoreData["dataType"],
          comment: score.comment ?? null,
          configId: evaluationRuleId,
          metadata: score.metadata ?? null,
        }));

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

      // `request` is captured for parity with upstream's internal execution trace,
      // which is not ported (see the file header); logging keeps it debuggable.
      logger.debug(
        `Decision-model request for job ${jobExecutionId}: ${JSON.stringify(request?.state ?? {})}`,
      );
    },
  );
}
