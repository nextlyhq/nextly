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
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    // A Single's read permission sits in the same per-slug map as a
    // collection's.
    capabilities: { collections: { "single-1": { canRead: true } } },
  }),
}));

import { useSidebarSingleList } from "../useSidebarContentLists";

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
});
