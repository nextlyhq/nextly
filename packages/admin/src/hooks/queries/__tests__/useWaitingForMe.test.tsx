/**
 * The "Waiting for my review" rows: each document's link opens the part awaiting review, in its
 * own language for a language part (`?locale=`), as the shared document-address rule spells it;
 * the shared part's opens without one. A failed read is told, not shown as an empty queue.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchWaitingForMe: vi.fn() }));

vi.mock("@admin/services/workflowApi", () => ({
  fetchWaitingForMe: api.fetchWaitingForMe,
  fetchWaitingScope: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({
    data: [{ name: "posts", label: "Post", labels: { plural: "Posts" } }],
  }),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useEverySingle: () => ({ data: [] }),
}));

import { useWaitingForMe, waitingKeys } from "../useWaitingForMe";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const item = (part: string | null) => ({
  document: { scopeKind: "collection", scopeSlug: "posts", entryId: "e1" },
  part,
  stage: "legal",
  stageLabel: "Legal check",
  stageColour: null,
  assignee: null,
  waitingFor: null,
  title: "Pricing FAQ",
  enteredAt: "2026-11-02T10:00:00.000Z",
  dueAt: null,
});

describe("useWaitingForMe", () => {
  it("links each waiting part to its document in the part's own language", async () => {
    api.fetchWaitingForMe.mockResolvedValue({
      items: [item("es"), item(null)],
      meta: {
        total: 2,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
    const { result } = renderHook(
      () => useWaitingForMe({ page: 1, limit: 50 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    const [spanish, shared] = result.current.rows;
    expect(spanish.href).toContain("/collections/posts/e1");
    expect(spanish.href).toContain("locale=es");
    expect(shared.href).toContain("/collections/posts/e1");
    expect(shared.href).not.toContain("locale=");
  });

  it("tells a failed read apart from an empty one", async () => {
    api.fetchWaitingForMe.mockRejectedValue(new Error("Unavailable"));
    const { result } = renderHook(
      () => useWaitingForMe({ page: 1, limit: 50 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.rows).toEqual([]);
  });

  it("walks to the next page by the cursor the server handed back, past where page numbers reach", async () => {
    // The server reads a bounded number of review states per request: past that, a page number
    // finds nothing, and the next page is read from the cursor the page before gave.
    api.fetchWaitingForMe.mockReset();
    api.fetchWaitingForMe.mockImplementation(
      ({ before }: { before?: string }) =>
        Promise.resolve(
          before === undefined
            ? {
                items: [item(null)],
                meta: {
                  total: 1000,
                  totalCapped: true,
                  page: 1,
                  limit: 50,
                  totalPages: 20,
                  hasNext: true,
                  hasPrev: false,
                  nextBefore: "cursor-2",
                },
              }
            : {
                items: [item("es")],
                meta: {
                  total: 1,
                  page: 1,
                  limit: 50,
                  totalPages: 1,
                  hasNext: false,
                  hasPrev: true,
                },
              }
        )
    );
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useWaitingForMe({ page, limit: 50 }),
      { wrapper, initialProps: { page: 1 } }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    rerender({ page: 2 });
    await waitFor(() =>
      expect(api.fetchWaitingForMe).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        before: "cursor-2",
      })
    );
    await waitFor(() =>
      expect(result.current.rows[0]?.where).toBe("Posts (es)")
    );
    // The count is the list's, as its first page read it, not the window this page returned.
    expect(result.current.total).toBe(1000);
    expect(result.current.totalCapped).toBe(true);
    expect(result.current.hasPrev).toBe(true);
    expect(result.current.hasNext).toBe(false);
  });

  it("refreshes the list's count with a page read by cursor, as a move or a refocus refetches it", async () => {
    // On page 2 the count is the first page's: when the waiting list is read again (a step was
    // taken, the window regained focus), the count follows the rows rather than staying as page 1
    // last read it.
    let total = 1000;
    api.fetchWaitingForMe.mockReset();
    api.fetchWaitingForMe.mockImplementation(
      ({ before }: { before?: string }) =>
        Promise.resolve(
          before === undefined
            ? {
                items: [item(null)],
                meta: {
                  total,
                  page: 1,
                  limit: 50,
                  totalPages: 20,
                  hasNext: true,
                  hasPrev: false,
                  nextBefore: "cursor-2",
                },
              }
            : {
                items: [item("es")],
                meta: {
                  total: 1,
                  page: 1,
                  limit: 50,
                  totalPages: 1,
                  hasNext: false,
                  hasPrev: true,
                },
              }
        )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useWaitingForMe({ page, limit: 50 }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
        initialProps: { page: 1 },
      }
    );
    await waitFor(() => expect(result.current.total).toBe(1000));
    rerender({ page: 2 });
    await waitFor(() =>
      expect(result.current.rows[0]?.where).toBe("Posts (es)")
    );
    expect(result.current.total).toBe(1000);

    total = 990;
    await client.invalidateQueries({ queryKey: waitingKeys.all() });
    await waitFor(() => expect(result.current.total).toBe(990));
  });
});
