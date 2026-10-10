import {
  isAllowedDecisionModel,
  LLMAdapter,
  OPENAI_DECISION_MODEL_IDS,
  supportedModels,
  supportsDecisionModels,
} from "@langfuse/shared";

/**
 * LITEFUSE ADDITION (gap D4): wires the ported capability predicates
 * (`supportsDecisionModels` / `isAllowedDecisionModel`, both in
 * `packages/shared/src/server/llm/types.ts`) into the decision-model evaluator
 * validation path. They answer "can this connection answer a decision-model
 * question at all, and is this specific model allowed to?" — a question the
 * adapter-only check (`isDecisionModelAdapter`) cannot answer, because it says
 * nothing about the model.
 *
 * Composition rule (do not loosen it): this helper only ever *adds* a rejection
 * reason. The execution path in litefuse is still restricted to the
 * `DECISION_MODEL_ADAPTERS` adapters, so callers keep their existing adapter
 * check after this one — a connection the runtime cannot execute is never
 * accepted just because the capability registry knows the adapter.
 */

/** Decision models `adapter` may answer with, for use in error messages. */
export function getAllowedDecisionModelIds(adapter: string): string[] {
  if (adapter === LLMAdapter.TypeSafe) {
    return [...supportedModels[LLMAdapter.TypeSafe]];
  }
  if (adapter === LLMAdapter.OpenAI) {
    return [...OPENAI_DECISION_MODEL_IDS];
  }
  return [];
}

/**
 * Returns a user-readable reason why `adapter`/`model` cannot be used for a
 * decision-model evaluator, or `null` when the connection is capable.
 */
export function getDecisionModelCapabilityError(params: {
  provider: string;
  adapter: string;
  model: string | null | undefined;
}): string | null {
  const model = params.model ?? "";

  if (!supportsDecisionModels(params.adapter)) {
    return (
      `Connection "${params.provider}" uses adapter "${params.adapter}", which cannot answer ` +
      `decision-model questions. Decision-model evaluators need a TypeSafe connection — add one ` +
      `under Settings → LLM Connections first.`
    );
  }

  if (!isAllowedDecisionModel(params.adapter, model)) {
    const allowed = getAllowedDecisionModelIds(params.adapter);
    return (
      `Model "${model}" cannot answer decision-model questions on connection ` +
      `"${params.provider}" (adapter "${params.adapter}"). Allowed decision models for this ` +
      `adapter: ${allowed.length > 0 ? allowed.join(", ") : "none"}.`
    );
  }

  return null;
}
