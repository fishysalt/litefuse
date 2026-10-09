// ── LITEFUSE ADDITION (evaluators v2: decision-model execution trace) ───────
// The LLM judge runs through `fetchLLMCompletion`, whose `traceSinkParams` write
// an internal execution trace (environment `langfuse-llm-as-a-judge`). The
// decision model calls TypeSafe directly, so without this module a "Jev" run
// leaves no trace to inspect.
//
// Upstream builds the same record in `buildDecisionModelTraceInput` and writes it
// with `writeInternalTraceViaOtelIngestion` (its `internalTraceEvents.ts` +
// `internalTraceOtelWriter.ts`, ~830 lines combined). Litefuse already has the
// two primitives that matter — `internalTraceEventsToResourceSpans` (classic
// internal events → OTLP resource spans) and `OtelIngestionProcessor.
// publishToOtelIngestionQueue` — so this module builds the two events inline
// instead of porting that pair of files. Same pipeline, same attributes.
//
// Best-effort by design: a failed trace must never fail the evaluation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  LangfuseInternalTraceEnvironment,
  OtelIngestionProcessor,
  internalTraceEventsToResourceSpans,
  logger,
  traceException,
} from "@langfuse/shared/src/server";
import {
  type DecisionModelEvaluation,
  type DecisionModelRequest,
} from "@langfuse/shared/src/server";

/** The classic internal-tracing event shape the converter consumes. */
export type InternalTraceEvent = {
  type: string;
  body: Record<string, unknown>;
};

/**
 * Builds the internal-tracing events for one decision-model call: a trace event
 * plus one GENERATION observation carrying the request as input and the answers
 * as output. Pure, so tests can assert the record without a queue.
 */
export function buildDecisionModelTraceEvents(params: {
  projectId: string;
  executionTraceId: string;
  traceName: string;
  traceStartTime: Date;
  traceEndTime: Date;
  request: DecisionModelRequest;
  evaluation: DecisionModelEvaluation;
  metadata: Record<string, unknown>;
}): InternalTraceEvent[] {
  const { evaluation } = params;
  const usage = evaluation.usage;

  return [
    {
      type: "trace-create",
      body: {
        id: params.executionTraceId,
        timestamp: params.traceStartTime.toISOString(),
        name: params.traceName,
        metadata: params.metadata,
      },
    },
    {
      type: "generation-create",
      body: {
        id: params.executionTraceId,
        traceId: params.executionTraceId,
        name: params.traceName,
        startTime: params.traceStartTime.toISOString(),
        endTime: params.traceEndTime.toISOString(),
        model: evaluation.model,
        input: JSON.stringify(params.request),
        output: JSON.stringify(evaluation.answers),
        metadata: params.metadata,
        ...(usage
          ? {
              usageDetails: {
                ...(usage.inputTokens !== null
                  ? { input: usage.inputTokens }
                  : {}),
                ...(usage.outputTokens !== null
                  ? { output: usage.outputTokens }
                  : {}),
              },
            }
          : {}),
      },
    },
  ];
}

/**
 * Publishes the decision-model execution as an internal trace.
 *
 * The environment is the reserved judge environment, exactly like upstream: it is
 * what keeps an eval from being scheduled on its own execution telemetry
 * (`isEvalTargetEnvironmentAllowed` blocks it).
 */
export async function writeDecisionModelExecutionTrace(params: {
  projectId: string;
  executionTraceId: string;
  traceName: string;
  traceStartTime: Date;
  request: DecisionModelRequest;
  evaluation: DecisionModelEvaluation;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    const events = buildDecisionModelTraceEvents({
      ...params,
      traceEndTime: new Date(),
    });

    const resourceSpans = internalTraceEventsToResourceSpans(
      events as Array<{ type: string; body: Record<string, unknown> }>,
      { environment: LangfuseInternalTraceEnvironment.LLMJudge },
    );

    if (!resourceSpans[0]?.scopeSpans?.[0]?.spans?.length) {
      logger.debug(
        `No decision-model trace spans produced for ${params.executionTraceId}`,
      );
      return;
    }

    const processor = new OtelIngestionProcessor({
      projectId: params.projectId,
    });
    await processor.publishToOtelIngestionQueue(resourceSpans);
  } catch (error) {
    // Same contract as upstream: tracing is observability, not the result.
    logger.error("Failed to write decision-model execution trace", {
      executionTraceId: params.executionTraceId,
      error,
    });
    traceException(error);
  }
}
