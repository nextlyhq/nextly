import type { DataFetcher, TableResponse } from "@revnixhq/ui";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mockUsers } from "../__tests__/fixtures";
import {
  createMockDataFetcher,
  createFailingDataFetcher,
} from "../__tests__/helpers/table";

import {
  useServerTable,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_DELAY,
} from "./useServerTable";

describe("useServerTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initialization", () => {
    it("initializes with default state", () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      expect(result.current.data).toEqual([]);
      expect(result.current.loading).toBe(true); // Initially loading
      expect(result.current.error).toBe(null);
      expect(result.current.currentPage).toBe(0);
      expect(result.current.currentPageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(result.current.searchInput).toBe("");
      expect(result.current.sorting).toEqual([]);
    });

    it("calls fetcher on mount", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 2000 }
      );

      // Note: In React 18+ StrictMode or certain test environments, effects may run twice
      // We verify the fetcher was called at least once with correct params
      expect(fetcher).toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({ page: 0, pageSize: 10 }),
          filters: expect.objectContaining({ search: "" }),
          sorting: [],
        })
      );
    });

    it("applies initial params", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
      });

      renderHook(() =>
        useServerTable({
          fetcher,
          initialParams: {
            pagination: { page: 2, pageSize: 20 },
            filters: { search: "test" },
            sorting: [{ field: "name", direction: "asc" }],
          },
        })
      );

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            pagination: expect.objectContaining({ page: 2, pageSize: 20 }),
            filters: expect.objectContaining({ search: "test" }),
            sorting: expect.arrayContaining([
              expect.objectContaining({ field: "name", direction: "asc" }),
            ]),
          })
        );
      });
    });

    it("applies custom pagination config", () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 0, pageSize: 20, total: 0, totalPages: 0 },
      });

      const { result } = renderHook(() =>
        useServerTable({
          fetcher,
          pagination: {
            pageSize: 20,
            pageSizeOptions: [20, 40, 60],
            showPageSizeSelector: false,
          },
        })
      );

      expect(result.current.paginationConfig.pageSize).toBe(20);
      expect(result.current.paginationConfig.pageSizeOptions).toEqual([
        20, 40, 60,
      ]);
      expect(result.current.paginationConfig.showPageSizeSelector).toBe(false);
    });
  });

  describe("Data Fetching", () => {
    it("sets loading state during fetch", async () => {
      const fetcher = vi.fn(
        () =>
          new Promise<TableResponse<unknown>>(resolve =>
            setTimeout(
              () =>
                resolve({
                  data: [],
                  meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
                }),
              50
            )
          )
      );

      const { result } = renderHook(() =>
        useServerTable({ fetcher: fetcher as DataFetcher<unknown> })
      );

      // Initially loading
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it("updates data after successful fetch", async () => {
      const fetcher = createMockDataFetcher(mockUsers.slice(0, 3));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      await waitFor(() => {
        expect(result.current.data).toHaveLength(3);
        expect(result.current.loading).toBe(false);
      });
    });

    it("updates pagination metadata", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: mockUsers.slice(0, 10),
        meta: { page: 0, pageSize: 10, total: 50, totalPages: 5 },
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      await waitFor(() => {
        expect(result.current.paginationMeta).toEqual({
          page: 0,
          pageSize: 10,
          total: 50,
          totalPages: 5,
        });
      });
    });

    it("handles fetch errors", async () => {
      const fetcher = createFailingDataFetcher("Network error");

      const { result } = renderHook(() => useServerTable({ fetcher }));

      await waitFor(() => {
        expect(result.current.error).toBe("Network error");
        expect(result.current.data).toEqual([]);
        expect(result.current.loading).toBe(false);
      });
    });

    it("clears error on successful refetch", async () => {
      let shouldFail = true;
      const fetcher = vi.fn(async () => {
        if (shouldFail) {
          throw new Error("Network error");
        }
        return {
          data: mockUsers.slice(0, 3),
          meta: { page: 0, pageSize: 10, total: 3, totalPages: 1 },
        };
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial error
      await waitFor(() => {
        expect(result.current.error).toBe("Network error");
        expect(result.current.loading).toBe(false);
      });

      // Change fetcher to succeed
      shouldFail = false;

      // Trigger refetch by changing page
      act(() => {
        result.current.handlePageChange(1);
      });

      await waitFor(
        () => {
          expect(result.current.error).toBe(null);
          expect(result.current.data).toHaveLength(3);
        },
        { timeout: 2000 }
      );
    });
  });

  describe("Pagination Handlers", () => {
    it("handlePageChange updates page and triggers fetch", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Change page
      act(() => {
        result.current.handlePageChange(2);
      });

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2);
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            pagination: expect.objectContaining({ page: 2 }),
          })
        );
      });
    });

    it("handlePageSizeChange resets to page 0", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Go to page 2
      act(() => {
        result.current.handlePageChange(2);
      });

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2);
      });

      // Change page size
      act(() => {
        result.current.handlePageSizeChange(20);
      });

      await waitFor(() => {
        expect(result.current.currentPage).toBe(0);
        expect(result.current.currentPageSize).toBe(20);
      });
    });

    it("handlePageSizeChange triggers fetch", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = fetcher.mock.calls.length;

      // Change page size
      act(() => {
        result.current.handlePageSizeChange(20);
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledTimes(initialCallCount + 1);
        expect(fetcher).toHaveBeenLastCalledWith(
          expect.objectContaining({
            pagination: expect.objectContaining({ page: 0, pageSize: 20 }),
          })
        );
      });
    });
  });

  describe("Search Handlers", () => {
    it("handleSearchChange updates search input", async () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Call handler in act()
      act(() => {
        result.current.handleSearchChange("test");
      });

      // Wait for state to update
      await waitFor(() => {
        expect(result.current.searchInput).toBe("test");
      });

      // Verify page was reset
      expect(result.current.currentPage).toBe(0);
    });

    it("debounces search input before fetch", async () => {
      vi.useFakeTimers();

      try {
        const fetcher = vi.fn(createMockDataFetcher(mockUsers));

        const { result } = renderHook(() =>
          useServerTable({ fetcher, searchDelay: 300 })
        );

        // Wait for initial fetch with fake timers - run all pending timers
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const initialCallCount = fetcher.mock.calls.length;

        // Type quickly
        act(() => {
          result.current.handleSearchChange("a");
          result.current.handleSearchChange("ab");
          result.current.handleSearchChange("abc");
        });

        // Should not fetch yet
        expect(fetcher).toHaveBeenCalledTimes(initialCallCount);

        // Advance timers past debounce delay and run pending promises
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });

        // Check that fetcher was called with the debounced value
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({ search: "abc" }),
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets to page 0 when searching", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() =>
        useServerTable({ fetcher, searchDelay: 0 })
      );

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Go to page 2
      act(() => {
        result.current.handlePageChange(2);
      });

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2);
      });

      // Search
      act(() => {
        result.current.handleSearchChange("test");
      });

      // Should reset to page 0
      await waitFor(() => {
        expect(result.current.currentPage).toBe(0);
      });
    });

    it("handleClearSearch clears input and resets page", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() =>
        useServerTable({ fetcher, searchDelay: 0 })
      );

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set search
      act(() => {
        result.current.handleSearchChange("test");
      });

      await waitFor(() => {
        expect(result.current.searchInput).toBe("test");
      });

      // Clear search
      act(() => {
        result.current.handleClearSearch();
      });

      await waitFor(() => {
        expect(result.current.searchInput).toBe("");
      });

      expect(result.current.currentPage).toBe(0);
    });

    it("uses custom search delay", async () => {
      vi.useFakeTimers();

      try {
        const fetcher = vi.fn(createMockDataFetcher(mockUsers));

        const { result } = renderHook(() =>
          useServerTable({ fetcher, searchDelay: 500 })
        );

        // Wait for initial fetch with fake timers
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const initialCallCount = fetcher.mock.calls.length;

        act(() => {
          result.current.handleSearchChange("test");
        });

        // Advance by 300ms - should not fetch yet
        act(() => {
          vi.advanceTimersByTime(300);
        });
        expect(fetcher).toHaveBeenCalledTimes(initialCallCount);

        // Advance by another 200ms (total 500ms) and run pending promises
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });

        // Should have fetched now
        expect(fetcher).toHaveBeenCalledTimes(initialCallCount + 1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Sorting Handlers", () => {
    it("handleSortingChange updates sorting state", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Change sorting
      act(() => {
        result.current.handleSortingChange([{ id: "username", desc: false }]);
      });

      await waitFor(() => {
        expect(result.current.sorting).toEqual([
          { id: "username", desc: false },
        ]);
      });
    });

    it("converts TanStack sorting to server format", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set sorting
      act(() => {
        result.current.handleSortingChange([{ id: "email", desc: true }]);
      });

      // Should trigger fetch with converted format
      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            sorting: [{ field: "email", direction: "desc" }],
          })
        );
      });
    });

    it("resets to page 0 when sorting changes", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Go to page 2
      act(() => {
        result.current.handlePageChange(2);
      });

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2);
      });

      // Change sorting
      act(() => {
        result.current.handleSortingChange([{ id: "username", desc: false }]);
      });

      // Should reset to page 0
      await waitFor(() => {
        expect(result.current.currentPage).toBe(0);
      });
    });

    it("handles clearing sorting", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set sorting
      act(() => {
        result.current.handleSortingChange([{ id: "username", desc: false }]);
      });

      await waitFor(() => {
        expect(result.current.sorting).toHaveLength(1);
      });

      // Clear sorting
      act(() => {
        result.current.handleSortingChange([]);
      });

      await waitFor(() => {
        expect(result.current.sorting).toEqual([]);
        expect(fetcher).toHaveBeenLastCalledWith(
          expect.objectContaining({
            sorting: [],
          })
        );
      });
    });

    it("handles multiple sort columns", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() => useServerTable({ fetcher }));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set multiple sorts
      act(() => {
        result.current.handleSortingChange([
          { id: "username", desc: false },
          { id: "email", desc: true },
        ]);
      });

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            sorting: [
              { field: "username", direction: "asc" },
              { field: "email", direction: "desc" },
            ],
          })
        );
      });
    });
  });

  describe("References", () => {
    it("provides searchInputRef", () => {
      const fetcher = vi.fn().mockResolvedValue({
        data: [],
        meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
      });

      const { result } = renderHook(() => useServerTable({ fetcher }));

      expect(result.current.searchInputRef).toBeDefined();
      expect(result.current.searchInputRef.current).toBe(null); // Not attached yet
    });
  });

  describe("Edge Cases", () => {
    it("handles empty data", async () => {
      const fetcher = createMockDataFetcher([]);

      const { result } = renderHook(() => useServerTable({ fetcher }));

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
        expect(result.current.paginationMeta.total).toBe(0);
        expect(result.current.paginationMeta.totalPages).toBe(0);
      });
    });

    it("handles very large datasets", async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `u${i}`,
        email: `user${i}@example.com`,
        username: `user${i}`,
      }));

      const fetcher = createMockDataFetcher(largeDataset);

      const { result } = renderHook(() =>
        useServerTable({ fetcher, pagination: { pageSize: 10 } })
      );

      await waitFor(() => {
        expect(result.current.paginationMeta.total).toBe(1000);
        expect(result.current.paginationMeta.totalPages).toBe(100);
        expect(result.current.data).toHaveLength(10); // First page only
      });
    });

    it("handles rapid state changes", async () => {
      const fetcher = vi.fn(createMockDataFetcher(mockUsers));

      const { result } = renderHook(() =>
        useServerTable({ fetcher, searchDelay: 0 })
      );

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Rapid changes
      act(() => {
        result.current.handlePageChange(1);
        result.current.handlePageSizeChange(20);
        result.current.handleSearchChange("test");
        result.current.handleSortingChange([{ id: "username", desc: false }]);
      });

      // Should eventually settle
      await waitFor(() => {
        expect(result.current.currentPage).toBe(0); // Reset by search and pageSize
        expect(result.current.currentPageSize).toBe(20);
        expect(result.current.searchInput).toBe("test");
      });
    });
  });
});
