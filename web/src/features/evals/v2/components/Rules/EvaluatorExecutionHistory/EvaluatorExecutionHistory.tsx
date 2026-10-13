/* eslint-disable no-nested-ternary */
import { Tooltip } from "@/src/components/design-system/Tooltip/Tooltip";
import { cn } from "@/src/utils/tailwind";

/**
 * One marker per execution, oldest first, coloured by outcome. The evaluator
 * table feeds this from the evaluator's OWN execution traces
 * (`evalsV2.recentExecutions` → Doris `spans_<projectId>` grouped by
 * `metadata['evaluator_id']`), the rules table from the rule's own
 * `job_executions` runs.
 *
 * `statusMessage`/`durationMs` are optional so the rules table keeps working; when
 * present they turn a red marker into something explainable ("why did this run
 * fail").
 */
export function EvaluatorExecutionHistory({
  traces,
}: {
  traces: Array<{
    id: string;
    level: string;
    timestamp: Date;
    statusMessage?: string | null;
    durationMs?: number | null;
  }>;
}) {
  if (traces.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">No recent runs</span>
    );
  }

  const describe = (trace: {
    level: string;
    timestamp: Date;
    statusMessage?: string | null;
    durationMs?: number | null;
  }) => {
    const parts = [
      `${trace.level.toLowerCase()} at ${trace.timestamp.toLocaleString()}`,
    ];
    if (typeof trace.durationMs === "number") {
      parts.push(`took ${trace.durationMs} ms`);
    }
    if (trace.statusMessage) {
      parts.push(trace.statusMessage);
    }
    return parts.join(" — ");
  };

  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={traces.map(describe).join(", ")}
    >
      {[...traces].reverse().map((trace) => (
        <Tooltip key={trace.id} label={describe(trace)}>
          {({ getTriggerProps }) => (
            <span
              {...getTriggerProps()}
              className={cn(
                "block h-4 w-1.5 rounded-full",
                trace.level === "ERROR"
                  ? "bg-destructive"
                  : trace.level === "WARNING"
                    ? "bg-dark-yellow"
                    : "bg-dark-green",
              )}
            />
          )}
        </Tooltip>
      ))}
    </div>
  );
}
