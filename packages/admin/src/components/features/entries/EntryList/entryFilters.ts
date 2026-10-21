/** Translation-status list filter: keep entries in a given state for a locale. */
export interface TranslationListFilter {
  locale: string;
  state: "missing" | "translated" | "draft" | "published";
}

export interface EntryFilterState {
  whereParam?: string | null;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  /** The active language filter, if any. */
  translated?: TranslationListFilter | null;
}

/**
 * The keys the server reads only at the TOP level of a filter, each a
 * condition on another table: the language filter and the two workflow keys
 * (`_pendingChange`, `_inRelease`) the dashboard's counts link with. The
 * server refuses any of them nested inside `and`, so a link carrying one must
 * keep it at the top level when this list adds its own filters beside it.
 */
const TOP_LEVEL_KEYS = ["_translated", "_pendingChange", "_inRelease"] as const;

/** A filter split into its top-level-only keys and everything else. */
function splitTopLevelKeys(filter: Record<string, unknown>): {
  topLevel: Record<string, unknown>;
  rest: Record<string, unknown> | undefined;
} {
  const topLevel: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if ((TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      topLevel[key] = value;
    } else {
      rest[key] = value;
    }
  }
  return {
    topLevel,
    rest: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

const toStartOfDayIso = (value: string): string =>
  new Date(`${value}T00:00:00.000Z`).toISOString();

const toEndOfDayIso = (value: string): string =>
  new Date(`${value}T23:59:59.999Z`).toISOString();

const buildDateRangeFilter = (
  from: string,
  to: string
): Record<string, unknown> | undefined => {
  const range: Record<string, unknown> = {};
  if (from) {
    range.greater_than_equal = toStartOfDayIso(from);
  }
  if (to) {
    range.less_than_equal = toEndOfDayIso(to);
  }
  return Object.keys(range).length > 0 ? range : undefined;
};

/**
 * The filter a link carried in `?where=`, split into its top-level-only keys
 * and the rest. Lifted out so the status and date filters added beside it can
 * never wrap those keys in an `and` the server refuses. A malformed filter is
 * ignored, as before.
 */
function linkedFilter(whereParam: string | null | undefined): {
  topLevel: Record<string, unknown>;
  rest: Record<string, unknown> | undefined;
} {
  if (!whereParam) return { topLevel: {}, rest: undefined };
  try {
    const parsed: unknown = JSON.parse(whereParam);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return splitTopLevelKeys(parsed as Record<string, unknown>);
    }
  } catch {
    // Ignore malformed URL filters.
  }
  return { topLevel: {}, rest: undefined };
}

/** The list's own filters, beside the rest of a linked one, joined with `and`. */
function joinedFilters(
  filters: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

export function buildEntryWhereFilter({
  whereParam,
  status = "all",
  createdFrom = "",
  createdTo = "",
  updatedFrom = "",
  updatedTo = "",
  translated = null,
}: EntryFilterState): Record<string, unknown> | undefined {
  const linked = linkedFilter(whereParam);
  const createdRange = buildDateRangeFilter(createdFrom, createdTo);
  const updatedRange = buildDateRangeFilter(updatedFrom, updatedTo);
  const filters = [
    linked.rest,
    status !== "all" ? { status: { equals: status } } : undefined,
    createdRange ? { createdAt: createdRange } : undefined,
    updatedRange ? { updatedAt: updatedRange } : undefined,
  ].filter((f): f is Record<string, unknown> => f !== undefined);

  // The top-level-only keys go back at the TOP level, never nested inside
  // `and`: the linked ones, then the language filter, which wins over a
  // linked `_translated`.
  const topLevel = {
    ...linked.topLevel,
    ...(translated ? { _translated: translated } : {}),
  };
  const result = joinedFilters(filters);
  if (Object.keys(topLevel).length === 0) return result;
  return { ...(result ?? {}), ...topLevel };
}
