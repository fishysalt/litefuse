import { tracesTableCols } from "@langfuse/shared";
import type { FilterConfig } from "@/src/features/filters/lib/filter-config";

// LITEFUSE ADDITION — columns that our own deep links put into `/traces?filter=`:
//
// The evaluators v2 "last 5 runs" marker (fns/evaluators/evaluatorScoresUrl.ts)
// and the rules v2 "last 5 runs" marker (fns/rules/ruleExecutionsUrl.ts) both
// navigate to /project/<id>/traces with an encoded filter of
// `traceName | ruleId`, `environment` and `isRootObservation`. `environment` is
// a traces column and worked; the other two were silently dropped by
// `decodeAndNormalizeFilters` ("Unknown filter column skipped"), so the links
// landed on an unfiltered traces list. What each id needs:
//
//   * `traceName` — genuinely supported by the traces query: the shared Doris
//     mapping has `uiTableId: "traceName"` → `t.trace_name`, an explicit alias of
//     `name` added so evals filters work on the traces table
//     (packages/shared/src/server/tableMappings/mapTracesTable.ts). Aliasing it
//     onto this surface's own `name` column ("Trace Name" facet) keeps the
//     applied filter visible in the sidebar and resolves to the same column.
//
//   * `isRootObservation` — intentionally NOT applied here. The traces list is
//     already root-only by construction (`AND t.is_root = 1`,
//     packages/shared/src/server/services/traces-ui-table-service.ts), and the
//     traces query has no mapping for this id, so forwarding it would make the
//     Doris filter builder throw
//     (`matchAndVerifyTracesUiColumn`, queries/doris-sql/factory.ts) instead of
//     filtering. Declared below so the drop is explicit and readable.
//
//   * `ruleId` — not supported by the traces query either (no `ruleId` mapping
//     exists; the rule id is only carried in score metadata / `job_configuration_id`
//     spans), so it is declared as unapplied rather than silently warned about.
//     Supporting it for real needs a backend column mapping, i.e. a shared change.
export const traceFilterConfig: FilterConfig = {
  tableName: "traces",

  columnDefinitions: tracesTableCols,

  columnAliases: {
    traceName: "name",
  },

  unappliedFilterColumns: {
    isRootObservation:
      "the traces list already shows one row per trace, so it is always the root span",
    ruleId:
      "filtering traces by evaluation rule is not supported by the traces query yet",
  },

  defaultExpanded: ["environment", "name"],

  facets: [
    {
      type: "categorical" as const,
      column: "environment",
      label: "Environment",
    },
    {
      type: "categorical" as const,
      column: "name",
      label: "Trace Name",
    },
    {
      type: "string" as const,
      column: "id",
      label: "Trace ID",
    },
    {
      type: "categorical" as const,
      column: "userId",
      label: "User ID",
    },
    {
      type: "categorical" as const,
      column: "sessionId",
      label: "Session ID",
    },
    {
      type: "stringKeyValue" as const,
      column: "metadata",
      label: "Metadata",
    },
    {
      type: "string" as const,
      column: "version",
      label: "Version",
    },
    {
      type: "string" as const,
      column: "release",
      label: "Release",
    },
    {
      type: "boolean" as const,
      column: "bookmarked",
      label: "Bookmarked",
      trueLabel: "Bookmarked",
      falseLabel: "Not bookmarked",
    },
    {
      type: "numeric" as const,
      column: "commentCount",
      label: "Comment Count",
      min: 0,
      max: 100,
    },
    {
      type: "string" as const,
      column: "commentContent",
      label: "Comment Content",
    },
    {
      type: "categorical" as const,
      column: "tags",
      label: "Tags",
    },
    {
      type: "categorical" as const,
      column: "level",
      label: "Level",
    },
    {
      type: "numeric" as const,
      column: "latency",
      label: "Latency",
      min: 0,
      max: 60,
      unit: "s",
    },
    {
      type: "numeric" as const,
      column: "inputTokens",
      label: "Input Tokens",
      min: 0,
      max: 1000000,
    },
    {
      type: "numeric" as const,
      column: "outputTokens",
      label: "Output Tokens",
      min: 0,
      max: 1000000,
    },
    {
      type: "numeric" as const,
      column: "totalTokens",
      label: "Total Tokens",
      min: 0,
      max: 1000000,
    },
    {
      type: "numeric" as const,
      column: "inputCost",
      label: "Input Cost",
      min: 0,
      max: 100,
      unit: "$",
    },
    {
      type: "numeric" as const,
      column: "outputCost",
      label: "Output Cost",
      min: 0,
      max: 100,
      unit: "$",
    },
    {
      type: "numeric" as const,
      column: "totalCost",
      label: "Total Cost",
      min: 0,
      max: 100,
      unit: "$",
    },
    {
      type: "keyValue" as const,
      column: "score_categories",
      label: "Categorical Scores",
    },
    {
      type: "numericKeyValue" as const,
      column: "scores_avg",
      label: "Numeric Scores",
    },
  ],
};
