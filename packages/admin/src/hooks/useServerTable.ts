"use client";

import type {
  DataFetcher,
  PaginationConfig,
  PaginationMeta,
  SortInfo,
  TableParams,
} from "@revnixhq/ui";
import type { SortingState } from "@tanstack/react-table";
import { useCallback, useEffect, useRef, useState } from "react";

import { PAGINATION } from "../constants/pagination";
import { UI } from "../constants/ui";

import { useDebouncedValue } from "./useDebouncedValue";

/**
 * Default configuration constants
 * Exported for reuse in other components or tests
 */
export const DEFAULT_PAGE_SIZE = PAGINATION.TABLE_DEFAULT_PAGE_SIZE;
export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 50];
export const DEFAULT_MAX_VISIBLE_PAGES = 5;
export const DEFAULT_SEARCH_DELAY = UI.SEARCH_DEBOUNCE_MS;

/**
 * Configuration options for useServerTable hook
 */
export interface UseServerTableParams<TData> {
  /** Function to fetch data from server */
  fetcher: DataFetcher<TData>;
  /** Pagination configuration */
  pagination?: Partial<PaginationConfig>;
  /** Debounce delay for search input in milliseconds (default: 300ms) */
  searchDelay?: number;
  /** Initial table parameters */
  initialParams?: Partial<TableParams>;
  /** Enable sorting functionality */
  enableSorting?: boolean;
}

/**
 * Return type for useServerTable hook
 */
export interface UseServerTableReturn<TData> {
  // State
  /** Server data */
  data: TData[];
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Pagination metadata */
  paginationMeta: PaginationMeta;
  /** Current sorting state */
  sorting: SortingState;
  /** Current search input value */
  searchInput: string;
  /** Current page number (0-indexed) */
  currentPage: number;
  /** Current page size */
  currentPageSize: number;
  /** Pagination configuration */
  paginationConfig: Required<PaginationConfig>;

  // Handlers
  /** Handle page change */
  handlePageChange: (newPage: number) => void;
  /** Handle page size change */
  handlePageSizeChange: (newPageSize: number) => void;
  /** Handle search input change */
  handleSearchChange: (search: string) => void;
  /** Handle sorting change */
  handleSortingChange: (
    updater: SortingState | ((old: SortingState) => SortingState)
  ) => void;
  /** Clear search input */
  handleClearSearch: () => void;

  // Refs
  /** Ref for search input element */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Custom hook for managing server-side table state and data fetching
 *
 * ## State Flow:
 * 1. User interactions (search, page change, sort) update local state
 * 2. Search input is debounced (300ms default) to reduce API calls
 * 3. Sorting state is converted from TanStack format to server format
 * 4. When dependencies change, fetcher is called with new params
 * 5. Server response updates data and pagination metadata
 * 6. Loading/error states are managed automatically
 *
 * ## State Dependencies:
 * - Search: searchInput → (debounced) → debouncedSearch → fetch
 * - Pagination: currentPage/currentPageSize → fetch
 * - Sorting: sorting → sortInfo → fetch
 *
 * Handles pagination, sorting, searching, loading states, and error handling
 * for tables with server-side data.
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   loading,
 *   error,
 *   paginationMeta,
 *   handlePageChange,
 *   handleSearchChange,
 * } = useServerTable({
 *   fetcher: async (params) => {
 *     const response = await api.getUsers(params);
 *     return response;
 *   },
 *   pagination: { pageSize: 20 },
 * });
 * ```
 */
export function useServerTable<TData>({
  fetcher,
  pagination = {},
  searchDelay = DEFAULT_SEARCH_DELAY,
  initialParams,
}: UseServerTableParams<TData>): UseServerTableReturn<TData> {
  // Pagination configuration with defaults
  const paginationConfig: Required<PaginationConfig> = {
    pageSize: pagination.pageSize ?? DEFAULT_PAGE_SIZE,
    pageSizeOptions: pagination.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS,
    showPageSizeSelector: pagination.showPageSizeSelector ?? true,
    maxVisiblePages: pagination.maxVisiblePages ?? DEFAULT_MAX_VISIBLE_PAGES,
  };

  // Server-side state
  const [serverData, setServerData] = useState<TData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<PaginationMeta>({
    page: initialParams?.pagination?.page ?? 0,
    pageSize: initialParams?.pagination?.pageSize ?? paginationConfig.pageSize,
    total: 0,
    totalPages: 0,
  });

  // Sorting state
  const [sortInfo, setSortInfo] = useState<SortInfo[]>(
    initialParams?.sorting || []
  );
  const [sorting, setSorting] = useState<SortingState>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(
    initialParams?.pagination?.page ?? 0
  );
  const [currentPageSize, setCurrentPageSize] = useState(
    initialParams?.pagination?.pageSize ?? paginationConfig.pageSize
  );

  // Search state
  const [searchInput, setSearchInput] = useState(
    initialParams?.filters?.search ?? ""
  );
  const debouncedSearch = useDebouncedValue(searchInput, searchDelay);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle page change
   */
  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  /**
   * Handle page size change
   */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setCurrentPageSize(newPageSize);
    setCurrentPage(0); // Reset to first page
  }, []);

  /**
   * Handle search input change
   */
  const handleSearchChange = useCallback((search: string) => {
    setSearchInput(search);
    setCurrentPage(0); // Reset to first page on search
  }, []);

  /**
   * Clear search input
   */
  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    setCurrentPage(0);
    searchInputRef.current?.focus();
  }, []);

  /**
   * Handle sorting change
   */
  const handleSortingChange = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      setSorting(updater);
    },
    []
  );

  // Update sortInfo when sorting state changes
  // Note: We only depend on 'sorting' to avoid dependency cycles.
  // The fetch effect (below) depends on sortInfo, so changes propagate correctly.
  useEffect(() => {
    if (sorting.length > 0) {
      const newSortInfo: SortInfo[] = sorting.map(sort => ({
        field: sort.id,
        direction: sort.desc ? "desc" : "asc",
      }));
      setSortInfo(newSortInfo);
      setCurrentPage(0); // Reset to first page on sort change
    } else {
      setSortInfo([]);
    }
  }, [sorting]);

  // Fetch data when parameters change
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const params: TableParams = {
        pagination: {
          page: currentPage,
          pageSize: currentPageSize,
        },
        sorting: sortInfo,
        filters: { search: debouncedSearch },
      };

      try {
        const response = await fetcher(params);
        setServerData(response.data);
        setPaginationMeta(response.meta);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setServerData([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
    // Reason: fetcher is intentionally omitted — it is expected to be stable
    // (wrapped in useCallback by caller or defined outside component). Including
    // it would cause unnecessary re-fetches when parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, currentPageSize, debouncedSearch, sortInfo]);

  return {
    // State
    data: serverData,
    loading,
    error,
    paginationMeta,
    sorting,
    searchInput,
    currentPage,
    currentPageSize,
    paginationConfig,

    // Handlers
    handlePageChange,
    handlePageSizeChange,
    handleSearchChange,
    handleSortingChange,
    handleClearSearch,

    // Refs
    searchInputRef,
  };
}
