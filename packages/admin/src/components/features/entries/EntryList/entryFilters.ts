/** i18n M7 translation-status list filter: keep entries in a given state for a locale. */
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
  /** i18n M7: the active language filter, if any. */
  translated?: TranslationListFilter | null;
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

  if (whereParam) {
    try {
      const parsed = JSON.parse(whereParam);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        filters.push(parsed as Record<string, unknown>);
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

  // i18n M7: attach the language filter as a TOP-LEVEL reserved `_translated` key (the backend
  // extractor only reads it at the top level, never nested inside `and`).
  if (translated) {
    result = { ...(result ?? {}), _translated: translated };
  }

  return result;
}
