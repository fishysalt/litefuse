import {
  isAllowedDecisionModel,
  LLMAdapter,
  supportedModels,
  supportsDecisionModels,
} from "@langfuse/shared";

/**
 * LITEFUSE ADDITION (gap D4): wires the capability predicates
 * (`supportsDecisionModels` / `isAllowedDecisionModel`, both in
 * `packages/shared/src/server/llm/types.ts`) into the decision-model evaluator
 * validation path. They answer "can this connection answer a decision-model
 * question at all, and is this specific model allowed to?" — a question the
 * adapter-only check (`isDecisionModelAdapter`) cannot answer, because it says
 * nothing about the model.
 *
 * LITEFUSE: decision-model support is narrowed to TypeSafe (see the LITEFUSE
 * NOTE in `packages/shared/src/server/llm/types.ts`). Upstream also reports
 * `LLMAdapter.OpenAI` as decision-model capable there, because upstream ships an
 * OpenAI decision-model client; we do not, so the OpenAI branch this module used
 * to carry is gone. Consequence here: `supportsDecisionModels(adapter)` and
 * `isDecisionModelAdapter(adapter)` are now the *same* predicate (TypeSafe only),
 * which is exactly the point — the save-time capability check can no longer pass
 * an adapter the worker execution gate will refuse on the first real run.
 *
 * Composition rule (do not loosen it): this helper only ever *adds* a rejection
 * reason. The execution path in litefuse is still restricted to the
 * `DECISION_MODEL_ADAPTERS` adapters, so callers keep their existing adapter
 * check after this one — a connection the runtime cannot execute is never
 * accepted just because the capability registry knows the adapter.
 */

/**
 * Decision models `adapter` may answer with, for use in error messages.
 *
 * LITEFUSE: TypeSafe only. The OpenAI branch (`OPENAI_DECISION_MODEL_IDS`) was
 * removed with the narrowing — it is unreachable now, because
 * `getDecisionModelCapabilityError` rejects every non-TypeSafe adapter before it
 * would ask for this list.
 */
export function getAllowedDecisionModelIds(adapter: string): string[] {
  if (adapter === LLMAdapter.TypeSafe) {
    return [...supportedModels[LLMAdapter.TypeSafe]];
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
    // Reached for every non-TypeSafe adapter, OpenAI included: decision models
    // run on TypeSafe connections only in this deployment, and we cannot execute
    // an OpenAI decision model at all (no client, no AI SDK dependency).
    return (
      `Connection "${params.provider}" uses adapter "${params.adapter}", which cannot answer ` +
      `decision-model questions. Decision-model evaluators need a TypeSafe connection — add one ` +
      `under Settings → LLM Connections first.`
    );
  }

  if (!isAllowedDecisionModel(params.adapter, model)) {
    // TypeSafe only from here on, so this fires on an empty model name.
    const allowed = getAllowedDecisionModelIds(params.adapter);
    return (
      `Model "${model}" cannot answer decision-model questions on connection ` +
      `"${params.provider}" (adapter "${params.adapter}"). Allowed decision models for this ` +
      `adapter: ${allowed.length > 0 ? allowed.join(", ") : "none"}.`
    );
  }

  return null;
}
