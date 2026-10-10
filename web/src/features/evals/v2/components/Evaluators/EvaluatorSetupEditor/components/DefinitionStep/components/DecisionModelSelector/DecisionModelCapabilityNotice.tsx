import {
  isAllowedDecisionModel,
  isDecisionModelAdapter,
  supportedModels,
  supportsDecisionModels,
} from "@langfuse/shared";

/**
 * LITEFUSE ADDITION (gap D4): the decision-model picker only offers connections
 * whose adapter can actually answer a decision-model question, and only the
 * models `isAllowedDecisionModel` allows. This component makes the *excluded*
 * connections explicit, so a project that added an LLM connection for the Jev
 * judge sees why it is missing instead of an empty picker.
 *
 * It is purely presentational: the picker keeps its own option list, and this
 * notice only explains the connections that did not make it into that list.
 */
export type DecisionModelCapabilityConnection = {
  provider: string;
  adapter: string;
  customModels: string[];
  withDefaultModels: boolean;
};

/**
 * Mirrors the model list the picker builds (custom models first, then the
 * adapter defaults when the connection includes them).
 */
function getConnectionModels(connection: DecisionModelCapabilityConnection) {
  return [
    ...new Set(
      connection.withDefaultModels
        ? [
            ...connection.customModels,
            ...(supportedModels[
              connection.adapter as keyof typeof supportedModels
            ] ?? []),
          ]
        : connection.customModels,
    ),
  ];
}

export function getDecisionModelConnectionExclusionReason(
  connection: DecisionModelCapabilityConnection,
): string | null {
  const label = `"${connection.provider}" (adapter "${connection.adapter}")`;

  if (!supportsDecisionModels(connection.adapter)) {
    return `${label} cannot answer decision-model questions.`;
  }

  if (!isDecisionModelAdapter(connection.adapter)) {
    return `${label} can serve decision models, but this deployment runs decision models on TypeSafe connections only.`;
  }

  const hasAllowedModel = getConnectionModels(connection).some((model) =>
    isAllowedDecisionModel(connection.adapter, model),
  );
  if (!hasAllowedModel) {
    return `${label} has no allowed decision model configured.`;
  }

  return null;
}

export function DecisionModelCapabilityNotice({
  connections,
}: {
  connections: DecisionModelCapabilityConnection[];
}) {
  const reasons = connections
    .map(getDecisionModelConnectionExclusionReason)
    .filter((reason): reason is string => reason !== null);

  if (reasons.length === 0) {
    return null;
  }

  return (
    <p className="text-muted-foreground text-xs">
      Not available for decision models: {reasons.join(" ")}
    </p>
  );
}
