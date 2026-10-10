/**
 * LITEFUSE ADDITION.
 *
 * The traces sidebar has to survive the filter ids our own deep links emit: the
 * evaluators v2 and rules v2 "last 5 runs" markers navigate to
 * `/project/<id>/traces?filter=...` with a column set the traces table does not
 * list verbatim. `traceName` is a real traces filter (the shared Doris mapping
 * aliases it onto `trace_name`), so it is rewritten onto this surface's own
 * `name` column; `isRootObservation` / `ruleId` cannot be applied by the traces
 * query at all and are declared as such, so they are dropped with a readable
 * message instead of the generic "unknown filter column" warning.
 */
import {
  LangfuseInternalTraceEnvironment,
  type FilterState,
} from "@langfuse/shared";

import { evaluatorExecutionsUrl } from "@/src/features/evals/v2/fns/evaluators/evaluatorScoresUrl";
import { ruleExecutionsUrl } from "@/src/features/evals/v2/fns/rules/ruleExecutionsUrl";
import { traceFilterConfig } from "./traces-config";
import {
  decodeAndNormalizeFilters,
  type FilterColumnHandling,
} from "../hooks/useSidebarFilterState";

const handling: FilterColumnHandling = {
  columnAliases: traceFilterConfig.columnAliases,
  unappliedFilterColumns: traceFilterConfig.unappliedFilterColumns,
};

/** Extracts and decodes the `filter` query param of a deep link, like the page does. */
const filtersOf = (href: string): FilterState =>
  decodeAndNormalizeFilters(
    new URL(href, "http://localhost:3000").searchParams.get("filter") ?? "",
    traceFilterConfig.columnDefinitions,
    handling,
  );

describe("traceFilterConfig column handling for deep-link filters", () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("keeps the evaluator executions link filter by aliasing traceName onto the traces name column", () => {
    const href = evaluatorExecutionsUrl("project-1", "Judge", "LLM_AS_JUDGE");

    expect(filtersOf(href)).toEqual([
      {
        column: "name",
        type: "stringOptions",
        operator: "any of",
        value: ["Execute evaluator: Judge"],
      },
      {
        column: "environment",
        type: "stringOptions",
        operator: "any of",
        value: [LangfuseInternalTraceEnvironment.LLMJudge],
      },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports that isRootObservation cannot be applied instead of warning about it", () => {
    const href = evaluatorExecutionsUrl("project-1", "Judge", "LLM_AS_JUDGE");

    filtersOf(href);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Filter on "isRootObservation" is not applied on this view',
      ),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps the rules link environment filter and reports the unsupported ruleId filter", () => {
    const href = ruleExecutionsUrl("project-1", "rule-1");

    const filters = filtersOf(href);

    expect(filters).toEqual([
      {
        column: "environment",
        type: "stringOptions",
        operator: "any of",
        value: [
          LangfuseInternalTraceEnvironment.CodeEval,
          LangfuseInternalTraceEnvironment.LLMJudge,
        ],
      },
    ]);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Filter on "ruleId" is not applied on this view'),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still warns about columns this surface has never heard of", () => {
    const filters = filtersOf(
      "/project/project-1/traces?filter=not_a_column%3Bstring%3B%3Bcontains%3Bx",
    );

    expect(filters).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Unknown filter column skipped: not_a_column",
    );
  });
});
