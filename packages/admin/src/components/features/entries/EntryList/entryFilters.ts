// The server's own list of the keys a filter may carry only at its top level,
// so a key added there is kept at the top level here without a second edit.
import { isReservedTopLevelKey } from "nextly/reserved-filter-keys";

export interface EntryFilterState {
  whereParam?: string | null;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  /**
   * Whether the user may read every language's translation state, which a
   * language filter (`_translated`) reads. Without it no such filter is sent,
   * a chosen one or a link's, since the server refuses the whole list for one.
   * Defaults to true.
   */
  readsTranslationState?: boolean;
  /**
   * The `where` of each plugin filter option chosen, added to the request
   * beside the list's own filters, so each can only narrow it.
   */
  pluginWheres?: readonly Record<string, unknown>[];
}

/** A filter split into its top-level-only keys and everything else. */
function splitTopLevelKeys(filter: Record<string, unknown>): {
  topLevel: Record<string, unknown>;
  rest: Record<string, unknown> | undefined;
} {
  const topLevel: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    // Defined, not assigned: `JSON.parse` makes `__proto__` an own key, and
    // assigning it would set the object's prototype instead, dropping the
    // condition so the list asked for MORE entries than the link named. Kept
    // as a key, it reaches the server, which refuses it.
    Object.defineProperty(isReservedTopLevelKey(key) ? topLevel : rest, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
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

/**
 * Top-level keys as the list sends them: all of them, except that no language
 * filter (`_translated`) is sent for a user who may not read every language's
 * translation state.
 */
function topLevelKeys(
  keys: Record<string, unknown>,
  readsTranslationState: boolean
): Record<string, unknown> {
  if (readsTranslationState) return keys;
  return Object.fromEntries(
    Object.entries(keys).filter(([key]) => key !== "_translated")
  );
}

export function buildEntryWhereFilter({
  whereParam,
  status = "all",
  createdFrom = "",
  createdTo = "",
  updatedFrom = "",
  updatedTo = "",
  readsTranslationState = true,
  pluginWheres = [],
}: EntryFilterState): Record<string, unknown> | undefined {
  const linked = linkedFilter(whereParam);
  const createdRange = buildDateRangeFilter(createdFrom, createdTo);
  const updatedRange = buildDateRangeFilter(updatedFrom, updatedTo);
  // A chosen filter's top-level-only keys (the workflow filters' `_stage`,
  // `_waitingForMe`, ...) are lifted out as a link's are, so they reach the
  // server at the top level rather than inside the `and` it refuses them in.
  const chosen = pluginWheres.map(splitTopLevelKeys);
  const filters = [
    linked.rest,
    status !== "all" ? { status: { equals: status } } : undefined,
    createdRange ? { createdAt: createdRange } : undefined,
    updatedRange ? { updatedAt: updatedRange } : undefined,
    ...chosen.map(each => each.rest),
  ].filter((f): f is Record<string, unknown> => f !== undefined);

  // The top-level-only keys go back at the TOP level, never nested inside
  // `and`; a chosen filter's after a link's, so the toolbar's choice wins
  // (the language filter's `_translated` over a link's among them).
  const topLevel = {
    ...topLevelKeys(linked.topLevel, readsTranslationState),
    // Held to the same rule as a link's: no language filter for a user who
    // may not read every language's translation state.
    ...topLevelKeys(
      Object.assign({}, ...chosen.map(each => each.topLevel)) as Record<
        string,
        unknown
      >,
      readsTranslationState
    ),
  };
  const result = joinedFilters(filters);
  if (Object.keys(topLevel).length === 0) return result;
  return { ...(result ?? {}), ...topLevel };
}
