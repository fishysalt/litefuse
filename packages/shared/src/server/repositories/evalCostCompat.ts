// ── LITEFUSE NOTE (authored; replaces five upstream repository readers) ─────
// Upstream answers "which traces did this evaluator/rule run against recently?"
// and "what did this evaluator/rule cost?" from ClickHouse, the first one by
// grouping evaluation traces on an `evaluation_rule_id` / `evaluator_id` column
// recorded at execution time. Our split `spans_<projectId>` tables have no
// execution-ownership column, so that column cannot be read from telemetry.
//
// Litefuse decisions (docs/jev as judge/现状-改动与差异总览.md §3.2):
//   - per-rule / per-evaluator cost reporting stays CANCELLED (`getTotalCostByRule`,
//     `getTotalCostByEvaluatorIds` and `getLatestEvaluatorRunCost` below still
//     return `[]` / `null`): we have no equivalent of upstream's cost aggregation,
//     and the feature is not worth the storage work it would need.
//   - "recent execution traces" IS implemented, derived from Postgres
//     `job_executions` instead of ClickHouse. These are read-only SELECTs: no
//     storage, ingestion or worker-write change is involved.
//
// How ownership is derived (the key deviation)
//   Upstream reads the ownership column the executor wrote. We have no such
//   column, but our worker records the v2 RULE id in
//   `job_executions.job_configuration_id` — a documented deviation, see
//   worker/src/features/evaluation/v2LlmEvaluatorExecution.ts,
//   v2DecisionModelExecution.ts and observationEval/createSchedulerDeps.ts — next
//   to `execution_trace_id` (the evaluator's own execution trace, i.e. upstream's
//   `trace_id`), `job_input_trace_id` (the evaluated target), `status` and
//   timestamps. So:
//     * a RULE's recent runs      = its own `job_executions` rows, newest 5;
//     * an EVALUATOR's recent runs = the rows of every rule it is assigned to
//       (`evaluation_rule_evaluator_assignments`, resolved project-scoped),
//       newest 5 overall, plus rows whose `job_configuration_id` is the evaluator
//       id itself.
//   The evaluator-id fallback covers ruleless manual batch runs: a v2 batch is
//   scheduled with `id: evaluator.assignments[0]?.evaluationRuleId ?? evaluator.id`
//   (worker/src/features/batchAction/handleBatchActionJob.ts), so a ruleless run
//   is anchored either on one of the evaluator's own rules — already covered by
//   the assignment lookup — or on the evaluator id when it has no rule at all.
//
// What the two readers return, and why
//   The consumers (web/src/features/evals/v2/server/rules/ruleService.ts and
//   .../evaluators/evaluatorService.ts) hand the array straight to
//   `EvaluatorExecutionHistory` (web/src/features/evals/v2/components/Rules/
//   EvaluatorExecutionHistory/EvaluatorExecutionHistory.tsx), which renders one
//   marker per entry, oldest first, and colours it by `level`:
//     * `id`        — `execution_trace_id`, falling back to `job_input_trace_id`.
//       The component currently uses it only as a React key (clicking a marker
//       opens the executions list for that rule/evaluator, not one trace), but a
//       real trace id is the only honest value for it. A row with neither id has
//       nothing the UI could ever open and is dropped.
//     * `level`     — "ERROR" for a failed execution, "WARNING" for a cancelled
//       one, "DEFAULT" otherwise: exactly the three values the component
//       distinguishes, and the same three upstream derives from span levels.
//     * `timestamp` — `created_at`. The scheduler stamps it and it is never null
//       (unlike `start_time`, which observation evals leave empty); it also orders
//       the markers, matching this fork's own executions list
//       (`ORDER BY je.created_at DESC`, web/src/features/evals/server/router.ts).
//
// Knowing limitations
//   (a) An evaluator with several rules can have its ruleless manual runs folded
//       into one of those rules, so per-RULE counts are incomplete for ruleless
//       runs; per-EVALUATOR results are complete.
//   (b) These are *executed* runs, not "all data that matched the rule": a run
//       that is still PENDING/DELAYED shows as a marker before it has executed,
//       and a rule that matched nothing shows none. The Rules table's existing
//       "View traces" link covers the "what would this rule evaluate" side.
//   (c) Cost stays cancelled (see above).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, Prisma, type JobExecutionStatus } from "../../db";

/** How many markers the "Last 5 runs" column shows per row (upstream: 5). */
const RECENT_RUNS_PER_OWNER = 5;

/** A `job_executions` row projected to what the two readers need. */
type RecentExecutionRow = {
  owner_id: string;
  execution_trace_id: string | null;
  job_input_trace_id: string | null;
  status: JobExecutionStatus;
  created_at: Date;
};

type RecentExecution = {
  ownerId: string;
  id: string;
  level: string;
  timestamp: Date;
};

/**
 * The marker colour the UI understands. `EvaluatorExecutionHistory` branches on
 * exactly these three strings, and upstream derives the same three from span
 * levels (`multiIf(countIf(e.level = 'ERROR') > 0, 'ERROR', …)`).
 */
function toExecutionLevel(status: JobExecutionStatus): string {
  if (status === "ERROR") return "ERROR";
  if (status === "CANCELLED") return "WARNING";
  return "DEFAULT";
}

/**
 * The newest executions per `job_configuration_id` owner, newest first.
 *
 * `ownerId` is a `job_executions.job_configuration_id` value, which our worker
 * anchors on the v2 rule id (see the file header). `PARTITION BY` +
 * `ROW_NUMBER()` is the Postgres spelling of upstream's `limitByCount(5, …)`, so
 * one round trip returns at most `perOwner` rows per owner instead of a shared
 * window that a busy owner could fill on its own. The filter is served by the
 * `(project_id, job_configuration_id, job_input_trace_id)` index.
 */
async function findRecentExecutionsByOwner(params: {
  projectId: string;
  ownerIds: string[];
  perOwner?: number;
}): Promise<RecentExecution[]> {
  const ownerIds = [...new Set(params.ownerIds)];
  if (ownerIds.length === 0) return [];

  const perOwner = Math.max(
    1,
    Math.floor(params.perOwner ?? RECENT_RUNS_PER_OWNER),
  );

  const rows = await prisma.$queryRaw<RecentExecutionRow[]>(Prisma.sql`
    SELECT ranked.owner_id,
           ranked.execution_trace_id,
           ranked.job_input_trace_id,
           ranked.status,
           ranked.created_at
    FROM (
      SELECT je.job_configuration_id AS owner_id,
             je.execution_trace_id,
             je.job_input_trace_id,
             je.status,
             je.created_at,
             ROW_NUMBER() OVER (
               PARTITION BY je.job_configuration_id
               ORDER BY je.created_at DESC, je.id DESC
             ) AS run_rank
      FROM job_executions je
      WHERE je.project_id = ${params.projectId}
        AND je.job_configuration_id = ANY(${ownerIds})
    ) ranked
    WHERE ranked.run_rank <= ${perOwner}
    ORDER BY ranked.created_at DESC, ranked.owner_id, ranked.run_rank
  `);

  return rows.flatMap((row) => {
    // `execution_trace_id` is the evaluator's own trace (written by the v2
    // executors when they persist a score); `job_input_trace_id` is the target
    // trace, the only id available on rows that never reached execution.
    const id = row.execution_trace_id ?? row.job_input_trace_id;
    if (!id) return [];

    return [
      {
        ownerId: row.owner_id,
        id,
        level: toExecutionLevel(row.status),
        timestamp: row.created_at,
      },
    ];
  });
}

/** Cancelled feature: per-rule cost reporting. Returns no costs. */
export async function getTotalCostByRule(
  _projectId: string,
  _ruleIds: string[],
): Promise<Array<{ ruleId: string; totalCost: number }>> {
  return [];
}

/** Cancelled feature: per-evaluator cost reporting. Returns no costs. */
export async function getTotalCostByEvaluatorIds(
  _projectId: string,
  _evaluatorIds: string[],
): Promise<Array<{ evaluatorId: string; totalCost: number }>> {
  return [];
}

/**
 * The newest executions of each rule, at most five per rule, newest first.
 *
 * Implemented from `job_executions` (see the file header): our worker writes the
 * v2 rule id into `job_configuration_id`, so those rows are the rule's executed
 * runs.
 */
export async function getRecentRuleExecutionTraces(
  projectId: string,
  ruleIds: string[],
): Promise<
  Array<{ ruleId: string; id: string; level: string; timestamp: Date }>
> {
  const runs = await findRecentExecutionsByOwner({
    projectId,
    ownerIds: ruleIds,
  });

  return runs.map(({ ownerId, id, level, timestamp }) => ({
    ruleId: ownerId,
    id,
    level,
    timestamp,
  }));
}

/**
 * The newest executions of each evaluator, at most five per evaluator, newest
 * first, across every rule the evaluator is assigned to (plus its own id as the
 * anchor of ruleless manual batch runs — see the file header).
 */
export async function getRecentEvaluatorExecutionTraces(
  projectId: string,
  evaluatorIds: string[],
): Promise<
  Array<{ evaluatorId: string; id: string; level: string; timestamp: Date }>
> {
  const uniqueEvaluatorIds = [...new Set(evaluatorIds)];
  if (uniqueEvaluatorIds.length === 0) return [];

  // The evaluator → rule edges. `evaluation_rule_evaluator_assignments` is the
  // only place that knows which rules an evaluator runs under; upstream reads the
  // same relationship from its telemetry column instead.
  const assignments = await prisma.evaluationRuleEvaluatorAssignment.findMany({
    where: { projectId, evaluatorId: { in: uniqueEvaluatorIds } },
    select: { evaluatorId: true, evaluationRuleId: true },
  });

  const ruleIdsByEvaluator = new Map<string, string[]>();
  for (const { evaluatorId, evaluationRuleId } of assignments) {
    const ruleIds = ruleIdsByEvaluator.get(evaluatorId);
    if (ruleIds) {
      ruleIds.push(evaluationRuleId);
    } else {
      ruleIdsByEvaluator.set(evaluatorId, [evaluationRuleId]);
    }
  }

  // Ownership anchors: every assigned rule, plus the evaluator id itself for the
  // ruleless manual batch runs that are anchored on it.
  const ownerIds = new Set<string>(uniqueEvaluatorIds);
  for (const ruleIds of ruleIdsByEvaluator.values()) {
    for (const ruleId of ruleIds) ownerIds.add(ruleId);
  }

  const runs = await findRecentExecutionsByOwner({
    projectId,
    ownerIds: [...ownerIds],
  });

  const runsByOwner = new Map<string, RecentExecution[]>();
  for (const run of runs) {
    const ownerRuns = runsByOwner.get(run.ownerId);
    if (ownerRuns) {
      ownerRuns.push(run);
    } else {
      runsByOwner.set(run.ownerId, [run]);
    }
  }

  const result: Array<{
    evaluatorId: string;
    id: string;
    level: string;
    timestamp: Date;
  }> = [];

  for (const evaluatorId of uniqueEvaluatorIds) {
    // Each per-owner list already arrives newest first and capped at five; the
    // merge re-sorts them together and caps again, so the cap is per evaluator
    // rather than per rule.
    const evaluatorRuns = [
      ...(runsByOwner.get(evaluatorId) ?? []),
      ...(ruleIdsByEvaluator.get(evaluatorId) ?? []).flatMap(
        (ruleId) => runsByOwner.get(ruleId) ?? [],
      ),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    for (const { id, level, timestamp } of evaluatorRuns.slice(
      0,
      RECENT_RUNS_PER_OWNER,
    )) {
      result.push({ evaluatorId, id, level, timestamp });
    }
  }

  return result;
}

/**
 * The most recent run cost for an evaluator card. Upstream derives it from
 * execution rows; with cost reporting cancelled there is nothing to report, and
 * `null` is a value the callers and their tests already treat as "unknown".
 */
export async function getLatestEvaluatorRunCost(
  _projectId: string,
  _evaluatorId: string,
): Promise<number | null> {
  return null;
}
