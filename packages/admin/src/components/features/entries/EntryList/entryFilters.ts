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

export function buildEntryWhereFilter({
  whereParam,
  status = "all",
  createdFrom = "",
  createdTo = "",
  updatedFrom = "",
  updatedTo = "",
  translated = null,
}: EntryFilterState): Record<string, unknown> | undefined {
  const filters: Array<Record<string, unknown>> = [];
  let topLevel: Record<string, unknown> = {};

  if (whereParam) {
    try {
      const parsed = JSON.parse(whereParam);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // The top-level-only keys are lifted out, so the status and date
        // filters below can never wrap them in an `and` the server refuses.
        const split = splitTopLevelKeys(parsed as Record<string, unknown>);
        topLevel = split.topLevel;
        if (split.rest) filters.push(split.rest);
      }
    } catch {
      // Ignore malformed URL filters.
    }
  }

  if (status !== "all") {
    filters.push({ status: { equals: status } });
  }

  const createdRange = buildDateRangeFilter(createdFrom, createdTo);
  if (createdRange) {
    filters.push({ createdAt: createdRange });
  }

  const updatedRange = buildDateRangeFilter(updatedFrom, updatedTo);
  if (updatedRange) {
    filters.push({ updatedAt: updatedRange });
  }

  let result: Record<string, unknown> | undefined;
  if (filters.length === 0) result = undefined;
  else if (filters.length === 1) result = filters[0];
  else result = { and: filters };

  if (Object.keys(topLevel).length > 0) {
    result = { ...(result ?? {}), ...topLevel };
  }

  // Attach the language filter as a TOP-LEVEL reserved `_translated` key (the backend
  // extractor only reads it at the top level, never nested inside `and`).
  if (translated) {
    result = { ...(result ?? {}), _translated: translated };
  }

  return result;
}
