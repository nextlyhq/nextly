export interface EntryFilterState {
  whereParam?: string | null;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
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

  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];

  return { and: filters };
}
