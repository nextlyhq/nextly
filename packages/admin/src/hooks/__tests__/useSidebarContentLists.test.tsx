/**
 * The sidebar's Singles list says it is complete only once every page of
 * Singles has arrived.
 *
 * The list walks a paged endpoint, a hundred at a time. The Content panel reads
 * "complete" as "a search that matched nothing found nothing", so a list
 * that called itself complete after its first page would tell a reader with more
 * than a hundred Singles that the one they searched for doesn't exist while
 * the page holding it is still on its way.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const fetchSingles = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/singleApi", () => ({ singleApi: { fetchSingles } }));
const collectionsResult = vi.hoisted(() => ({
  current: {
    data: { items: [] as unknown[], meta: { hasNext: false } },
    isLoading: false,
  },
}));
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollections: () => ({ ...collectionsResult.current, error: null }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    // A Single's read permission sits in the same per-slug map as a
    // collection's.
    capabilities: { collections: { "single-1": { canRead: true } } },
  }),
}));

import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "../useSidebarContentLists";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("the sidebar's Singles list", () => {
  it("isn't complete while later pages are on their way", async () => {
    fetchSingles
      .mockResolvedValueOnce({
        items: [{ id: "s1", slug: "single-1", label: "Single 1" }],
        meta: { hasNext: true },
      })
      .mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useSidebarSingleList(), { wrapper });

    // POPULATION CONTROL: the first page has arrived and the walk has asked
    // for the second.
    await waitFor(() => expect(fetchSingles).toHaveBeenCalledTimes(2));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.isComplete).toBe(false);
  });

  it("is complete once the last page has arrived", async () => {
    fetchSingles.mockResolvedValueOnce({
      items: [{ id: "s1", slug: "single-1", label: "Single 1" }],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useSidebarSingleList(), { wrapper });

    await waitFor(() => expect(result.current.isComplete).toBe(true));
    expect(result.current.items).toHaveLength(1);
  });

  it("asks for each page once when two parts of the sidebar read it", async () => {
    fetchSingles
      .mockResolvedValueOnce({
        items: [{ id: "s1", slug: "single-1", label: "Single 1" }],
        meta: { hasNext: true },
      })
      .mockResolvedValueOnce({ items: [], meta: { hasNext: false } });

    // The Content panel and the Singles list each read the list.
    const { result } = renderHook(
      () => [useSidebarSingleList(), useSidebarSingleList()] as const,
      { wrapper }
    );

    await waitFor(() => expect(result.current[0].isComplete).toBe(true));
    const pagesAsked = fetchSingles.mock.calls.map(
      ([q]) => (q as { pagination: { page: number } }).pagination.page
    );
    expect(pagesAsked).toEqual([0, 1]);
  });

  it("isn't complete when a later page fails", async () => {
    fetchSingles
      .mockResolvedValueOnce({
        items: [{ id: "s1", slug: "single-1", label: "Single 1" }],
        meta: { hasNext: true },
      })
      .mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useSidebarSingleList(), { wrapper });

    await waitFor(() => expect(fetchSingles).toHaveBeenCalledTimes(2));
    // Settled on the failure: no further page is being asked for.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchSingles).toHaveBeenCalledTimes(2);
    expect(result.current.isComplete).toBe(false);
  });
});

describe("the sidebar's collections list", () => {
  it("isn't complete while the server says more collections exist", () => {
    collectionsResult.current = {
      data: { items: [], meta: { hasNext: true } },
      isLoading: false,
    };
    const { result } = renderHook(() => useSidebarCollectionList(), {
      wrapper,
    });
    expect(result.current.isComplete).toBe(false);

    // POPULATION CONTROL: with every collection in one page, it is.
    collectionsResult.current = {
      data: { items: [], meta: { hasNext: false } },
      isLoading: false,
    };
    const second = renderHook(() => useSidebarCollectionList(), { wrapper });
    expect(second.result.current.isComplete).toBe(true);
  });
});
