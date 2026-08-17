/**
 * The resets are the whole point, so they are what is asserted.
 *
 * A test that only checked `setPage(2)` moves to page 2 would pass against two
 * bare `useState` calls, which is the arrangement this hook exists to replace —
 * so it would report success without separating the two implementations. Each
 * assertion below is written to fail against that version.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePagination } from "./usePagination";

describe("usePagination", () => {
  it("starts where it was told to", () => {
    const { result } = renderHook(() =>
      usePagination({ initialPage: 2, initialPageSize: 25 })
    );
    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(25);
  });

  it("moves between pages without resetting anything", () => {
    // The negative half. A hook that reset on every change would satisfy every
    // other assertion here and make paging impossible.
    const { result } = renderHook(() => usePagination({ initialPageSize: 10 }));

    act(() => result.current.setPage(3));

    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(10);
  });

  it("returns to the first page when the page size grows", () => {
    // The defect this replaces: page 3 of ten-row pages holds rows 30-39, and
    // at fifty rows a page that range is past the end of most lists. The table
    // then renders its empty message over a list that has rows.
    const { result } = renderHook(() => usePagination({ initialPageSize: 10 }));

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(50));

    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(0);
  });

  it("returns to the first page when the page size shrinks", () => {
    // Shrinking is the direction that looks safe and is not: page 3 of fifty
    // is row 150, which a ten-row page size rarely reaches either.
    const { result } = renderHook(() => usePagination({ initialPageSize: 50 }));

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(10));

    expect(result.current.page).toBe(0);
  });

  it("resets both settings in one update", () => {
    // Asserted because the batching is load-bearing, not incidental: a query
    // keyed on `{ page, pageSize }` refetches once per distinct key, so two
    // separate updates would fire a request for a page that is about to be
    // abandoned. One render means one key change.
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePagination({ initialPageSize: 10 });
    });

    act(() => result.current.setPage(3));
    const before = renders;
    act(() => result.current.setPageSize(25));

    expect(renders - before).toBe(1);
    expect(result.current).toMatchObject({ page: 0, pageSize: 25 });
  });

  it("returns to the first page on demand, for a filter or a search", () => {
    const { result } = renderHook(() => usePagination());

    act(() => result.current.setPage(4));
    act(() => result.current.resetPage());

    expect(result.current.page).toBe(0);
  });

  it("keeps its callbacks stable across renders", () => {
    // Every call site passes these straight to `Pagination`, and several list
    // pages put `resetPage` in an effect's dependency array. An identity that
    // changed per render would re-run that effect on every render and reset the
    // page the user just moved to.
    const { result, rerender } = renderHook(() => usePagination());

    const first = {
      setPage: result.current.setPage,
      setPageSize: result.current.setPageSize,
      resetPage: result.current.resetPage,
    };
    act(() => result.current.setPage(2));
    rerender();

    expect(result.current.setPage).toBe(first.setPage);
    expect(result.current.setPageSize).toBe(first.setPageSize);
    expect(result.current.resetPage).toBe(first.resetPage);
  });
});
