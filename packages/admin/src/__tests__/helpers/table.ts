/**
 * Table testing utilities
 *
 * Provides helper functions for creating mock table data,
 * pagination metadata, and data fetchers for testing
 * server-side table components.
 */

import type {
  DataFetcher,
  ListResponse,
  PaginationMeta,
  TableParams,
} from "@revnixhq/ui";

/**
 * Create mock table parameters with defaults
 *
 * @param overrides - Partial table params to override defaults
 * @returns Complete table parameters object
 *
 * @example
 * const params = createMockTableParams({ pagination: { page: 2 } });
 */
export function createMockTableParams(
  overrides?: Partial<TableParams>
): TableParams {
  return {
    pagination: {
      page: 0,
      pageSize: 10,
      ...overrides?.pagination,
    },
    sorting: overrides?.sorting || [],
    filters: {
      search: "",
      ...overrides?.filters,
    },
  };
}

/**
 * Create mock pagination metadata
 *
 * @param overrides - Partial pagination meta to override defaults
 * @returns Complete pagination metadata object
 *
 * @example
 * const meta = createMockPaginationMeta({ total: 100, totalPages: 10 });
 */
export function createMockPaginationMeta(
  overrides?: Partial<PaginationMeta>
): PaginationMeta {
  const page = overrides?.page ?? 1;
  const limit = overrides?.limit ?? 10;
  const total = overrides?.total ?? 0;
  const totalPages = overrides?.totalPages ?? Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: overrides?.hasNext ?? page < totalPages,
    hasPrev: overrides?.hasPrev ?? page > 1,
  };
}

/**
 * Create a mock data fetcher that returns static data
 *
 * Useful for testing components that expect a data fetcher function.
 * The fetcher respects pagination, sorting, and search parameters.
 *
 * @param data - Array of data items to return
 * @param options - Optional configuration
 * @returns A data fetcher function
 *
 * @example
 * const fetcher = createMockDataFetcher(mockUsers);
 * const response = await fetcher({ pagination: { page: 0, pageSize: 10 } });
 */
export function createMockDataFetcher<TData extends Record<string, unknown>>(
  data: TData[],
  options?: {
    delay?: number;
    shouldFail?: boolean;
    errorMessage?: string;
  }
): DataFetcher<TData> {
  return async (params: TableParams): Promise<ListResponse<TData>> => {
    // Simulate network delay
    if (options?.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay));
    }

    // Simulate error
    if (options?.shouldFail) {
      throw new Error(options?.errorMessage || "Failed to fetch data");
    }

    const { pagination, sorting, filters } = params;
    let filteredData = [...data];

    // Apply search filter
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filteredData = filteredData.filter(item => {
        // Search across all string properties
        return Object.values(item).some(value => {
          if (typeof value === "string") {
            return value.toLowerCase().includes(searchLower);
          }
          return false;
        });
      });
    }

    // Apply sorting
    if (sorting && sorting.length > 0) {
      const sortInfo = sorting[0]; // Only handle first sort for simplicity
      filteredData.sort((a, b) => {
        const aVal = a[sortInfo.field];
        const bVal = b[sortInfo.field];

        if (aVal === bVal) return 0;

        let result = 0;
        if (typeof aVal === "string" && typeof bVal === "string") {
          result = aVal.localeCompare(bVal);
        } else if (typeof aVal === "number" && typeof bVal === "number") {
          result = aVal - bVal;
        } else {
          result = String(aVal).localeCompare(String(bVal));
        }

        return sortInfo.direction === "desc" ? -result : result;
      });
    }

    // Apply pagination. TableParams uses 0-based admin-internal page index;
    // the canonical wire meta is 1-based per spec §5.1, so the meta
    // we return shifts by 1.
    const total = filteredData.length;
    const totalPages = Math.ceil(total / pagination.pageSize);
    const start = pagination.page * pagination.pageSize;
    const end = start + pagination.pageSize;
    const paginatedData = filteredData.slice(start, end);
    const wirePage = pagination.page + 1;

    return {
      items: paginatedData,
      meta: {
        page: wirePage,
        limit: pagination.pageSize,
        total,
        totalPages,
        hasNext: wirePage < totalPages,
        hasPrev: wirePage > 1,
      },
    };
  };
}

/**
 * Create a mock data fetcher that fails with an error
 *
 * @param errorMessage - The error message to throw
 * @param delay - Optional delay before throwing error
 * @returns A data fetcher function that throws an error
 *
 * @example
 * const fetcher = createFailingDataFetcher("Network error");
 */
export function createFailingDataFetcher<TData extends Record<string, unknown>>(
  errorMessage = "Failed to fetch data",
  delay = 0
): DataFetcher<TData> {
  return async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error(errorMessage);
  };
}

/**
 * Create a large dataset for pagination testing
 *
 * @param count - Number of items to generate
 * @param itemFactory - Factory function to create each item
 * @returns Array of generated items
 *
 * @example
 * const data = createLargeDataset(100, (i) => ({ id: i, name: `Item ${i}` }));
 */
export function createLargeDataset<TData>(
  count: number,
  itemFactory: (index: number) => TData
): TData[] {
  return Array.from({ length: count }, (_, i) => itemFactory(i));
}

/**
 * Wait for a specific amount of time (for testing async operations)
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the specified time
 *
 * @example
 * await waitFor(100); // Wait 100ms
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
