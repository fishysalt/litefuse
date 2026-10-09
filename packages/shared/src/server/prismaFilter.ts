import type { Prisma } from "@prisma/client";
import { InvalidRequestError } from "../errors";
import type { FilterState } from "../types";

type PrismaFilter = FilterState[number];
type PrismaFilterType = PrismaFilter["type"];

export type PrismaFilterColumnHandlers<TWhere> = {
  [Type in PrismaFilterType]?: (
    filter: Extract<PrismaFilter, { type: Type }>,
  ) => TWhere;
};

export function compilePrismaFilters<TWhere>(
  filters: FilterState,
  handlers: Record<string, PrismaFilterColumnHandlers<TWhere>>,
): TWhere[] {
  return filters.map((filter) => {
    const handler = handlers[filter.column]?.[filter.type] as
      | ((filter: PrismaFilter) => TWhere)
      | undefined;
    if (!handler) {
      throw new InvalidRequestError(
        `Unsupported Prisma filter: ${filter.column} (${filter.type})`,
      );
    }
    return handler(filter);
  });
}

type StringFilter = Extract<PrismaFilter, { type: "string" }>;

export function stringFilterToPrisma(
  filter: StringFilter,
): Prisma.StringFilter {
  const insensitive = { mode: "insensitive" as const };

  switch (filter.operator) {
    case "=":
      return { equals: filter.value, ...insensitive };
    case "contains":
      return { contains: filter.value, ...insensitive };
    case "does not contain":
      return { not: { contains: filter.value, ...insensitive } };
    case "starts with":
      return { startsWith: filter.value, ...insensitive };
    case "ends with":
      return { endsWith: filter.value, ...insensitive };
    // LITEFUSE NOTE: upstream also handles "is not empty" here; our string filter
    // operators have no such member (long-standing filter divergence — we kept our
    // filter types and adapt upstream code, see docs/jev as judge/现状-改动与差异总览.md).
  }
}

type StringOptionsFilter = Extract<PrismaFilter, { type: "stringOptions" }>;

export function stringOptionsFilterToPrisma(
  filter: StringOptionsFilter,
): Prisma.StringFilter {
  return filter.operator === "any of"
    ? { in: filter.value, mode: "insensitive" }
    : { notIn: filter.value, mode: "insensitive" };
}
