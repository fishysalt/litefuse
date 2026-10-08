import {
  LangfuseNotFoundError,
  observationForEvalSchema,
  type ObservationForEval,
} from "@langfuse/shared";
import { getObservationByIdFromEventsTable } from "@langfuse/shared/src/server";

/**
 * Loads the observation an evaluator is about to score.
 *
 * Upstream has two read paths here and switches between them with a migration
 * flag: the legacy `observations` table, or an events stream. This fork has a
 * single analytics store — Doris, one split table per project, where trace roots
 * and observations live together — so there is only one path: the Doris-backed
 * events repository.
 *
 * `shouldReadFromObservationsTable` is accepted so upstream call sites port over
 * unchanged; there is no observations table here, so it is ignored.
 */
export async function getObservationForEvalById(params: {
  projectId: string;
  id: string;
  traceId: string;
  startTime: Date;
  shouldReadFromObservationsTable?: boolean;
}): Promise<ObservationForEval> {
  const observation = await getObservationByIdFromEventsTable({
    id: params.id,
    projectId: params.projectId,
    traceId: params.traceId,
    startTime: params.startTime,
    fetchWithInputOutput: true,
  });

  if (!observation) {
    throw new LangfuseNotFoundError(
      `Observation ${params.id} not found in project ${params.projectId}`,
    );
  }

  return observationForEvalSchema.parse(observation);
}
