/**
 * The types the New button and the palette offer come from every page of
 * collections, not the first.
 *
 * The collections list is paged a hundred at a time. A reader with more than a
 * hundred collections would otherwise never be offered one past the first
 * page, and a recent type there would be dropped from the New button.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const fetchCollections = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/collectionApi", () => ({
  collectionApi: { fetchCollections },
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    canAccessCollection: (_slug: string, action: string) => action === "create",
    content: { isLoading: false, hasAnswer: true },
  }),
}));

import { useCreatableCollections } from "../useCreatableCollections";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const named = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${from + i}`,
    name: `c${from + i}`,
    label: `C${from + i}`,
  }));

describe("the creatable collections", () => {
  it("are read from every page, past the first hundred", async () => {
    fetchCollections.mockImplementation(
      (params: { pagination: { page: number } }) =>
        Promise.resolve(
          params.pagination.page === 0
            ? { items: named(0, 100), meta: { hasNext: true } }
            : { items: named(100, 5), meta: { hasNext: false } }
        )
    );
    const { result } = renderHook(() => useCreatableCollections(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const names = result.current.collections.map(c => c.name);
    expect(names).toHaveLength(105);
    expect(names.at(-1)).toBe("c104");
    // Each page asked once, in order, at the navigation's page size.
    expect(
      fetchCollections.mock.calls.map(
        call =>
          (call[0] as { pagination: { page: number; pageSize: number } })
            .pagination
      )
    ).toEqual([
      { page: 0, pageSize: 100 },
      { page: 1, pageSize: 100 },
    ]);
  });
});
