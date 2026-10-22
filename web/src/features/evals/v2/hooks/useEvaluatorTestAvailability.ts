/* eslint-disable no-nested-ternary */
import { useStore } from "zustand";

import { prepareEvaluatorDraft } from "@/src/features/evals/v2/fns/evaluators/prepareEvaluatorDraft";
import { getScoreOutputValidation } from "@/src/features/evals/v2/fns/scoreOutput/getScoreOutputValidation";
import { useEvaluatorSetupSample } from "@/src/features/evals/v2/hooks/useEvaluatorSetupSample";
import type { EvaluatorSetupStore } from "@/src/features/evals/v2/store/evaluatorSetupStore/evaluatorSetupStore";

export const EVALUATOR_TEST_PERMISSION_REASON =
  "You do not have permission to run evaluator tests in this project.";

export function useEvaluatorTestAvailability({
  projectId,
  store,
  hasValidModel,
  canRunTest,
}: {
  projectId: string;
  store: EvaluatorSetupStore;
  hasValidModel: boolean;
  /** `evaluator:CUD`. A test run bills the configured model, so read-only
   * roles never get an actionable button. */
  canRunTest: boolean;
}) {
  const sampleObject = useEvaluatorSetupSample({ projectId, store });
  const selectedObservation = useStore(
    store,
    (state) => state.selectedObservation,
  );
  const definitionAvailable = useStore(store, (state) =>
    Boolean(prepareEvaluatorDraft(state).definition),
  );
  const scoreOutputReason = useStore(store, (state) =>
    state.type === "LLM_AS_JUDGE"
      ? getScoreOutputValidation(state.scoreOutput).reason
      : null,
  );
  const modelReason = useStore(store, (state) =>
    state.type === "LLM_AS_JUDGE" && !hasValidModel
      ? "Select a model before running a test."
      : null,
  );

  return !canRunTest
    ? EVALUATOR_TEST_PERMISSION_REASON
    : scoreOutputReason
      ? scoreOutputReason
      : modelReason
        ? modelReason
        : !definitionAvailable
          ? "Complete the evaluator before running a test."
          : !selectedObservation
            ? "Select a sample observation first."
            : !sampleObject
              ? "Loading the selected sample."
              : null;
}
