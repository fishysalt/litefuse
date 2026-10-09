// ── LITEFUSE NOTE (authored; replaces five upstream repository readers) ─────
// Upstream answers "what did this evaluator/rule cost?" and "which traces did it
// run against recently?" from ClickHouse, the second one by grouping on an
// \`evaluation_rule_id\` / \`evaluator_id\` column recorded at execution time.
//
// Litefuse decisions (docs/jev as judge/现状-改动与差异总览.md §3.2):
//   - per-rule / per-evaluator cost reporting is CANCELLED — we have no equivalent
//     of upstream's cost-aggregation query, and the feature is not worth the
//     storage work it would need.
//   - "recent execution traces" is CANCELLED as an implementation. Our \`spans\`
//     split tables have no \`evaluation_rule_id\` ownership column, so the precise
//     question cannot be answered without changing ingestion. The agreed
//     replacement is a UI affordance that jumps to the traces page carrying the
//     rule's own filters — i.e. what a rule WOULD evaluate, not what it evaluated.
//     (That UI change belongs to the evaluator pages; these functions are the
//     service-level placeholders so the callers stay intact.)
//
// Consequence of the empty results below: the evaluator/rule lists show no cost and
// no "recent traces" markers. Nothing else reads them.
//
// Replacement suggestion: implement the jump-to-traces affordance in the UI and
// delete the two trace readers; keep the cost functions deleted for good.
// ─────────────────────────────────────────────────────────────────────────────

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
 * Cancelled implementation. The precise answer needs an execution-ownership column
 * our split \`spans\` tables do not have; see the file header for the agreed
 * replacement (jump to the traces page with the rule's filters).
 */
export async function getRecentRuleExecutionTraces(
  _projectId: string,
  _ruleIds: string[],
): Promise<Array<{ ruleId: string; id: string; level: string; timestamp: Date }>> {
  return [];
}

/** Cancelled implementation; see getRecentRuleExecutionTraces above. */
export async function getRecentEvaluatorExecutionTraces(
  _projectId: string,
  _evaluatorIds: string[],
): Promise<
  Array<{ evaluatorId: string; id: string; level: string; timestamp: Date }>
> {
  return [];
}

/**
 * The most recent run cost for an evaluator card. Upstream derives it from
 * execution rows; with cost reporting cancelled there is nothing to report, and
 * \`null\` is a value the callers and their tests already treat as "unknown".
 */
export async function getLatestEvaluatorRunCost(
  _projectId: string,
  _evaluatorId: string,
): Promise<number | null> {
  return null;
}
