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

import { useWaitingForMe } from "../useWaitingForMe";

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
});
