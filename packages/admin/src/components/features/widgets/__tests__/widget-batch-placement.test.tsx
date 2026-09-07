/**
 * An answer belongs to the PLACEMENT that asked, not to the widget it draws.
 *
 * 🔴 `WidgetPlacement` is a full snapshot with its own identity precisely so
 * one widget can sit on a dashboard twice carrying different `config`, and a
 * setting that drives the query makes those two cards genuinely different
 * questions. Keyed by widget id, both questions filed into a single entry: the
 * later response overwrote the earlier one, `ArrangedColumns` read that one
 * entry for both cards, and each reader's own choice was visible on neither.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { WidgetQuery } from "nextly/config";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { useWidgetBatch, type BatchCard } from "../useWidgetBatch";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A card drawn by a plugin component, so `worthAsking` never withholds it. */
function card(placementId: string, limit: number): BatchCard {
  const query: WidgetQuery = { source: "collection:posts", op: "list", limit };
  const widget: DashboardWidget = {
    // The SAME widget in both cards. That is the whole fixture: two placements
    // of one widget is the state the old key could not represent.
    id: "core/posts",
    title: "Posts",
    archetype: "custom",
    size: "md",
    query,
  };
  return { placementId, widget };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("two placements of one widget are two questions", () => {
  it("asks both, and files each answer under its own placement", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "list", items: [{ id: "a" }] } },
        { ok: true, result: { op: "list", items: [{ id: "b" }, { id: "c" }] } },
      ],
    });

    const { result } = renderHook(
      () => useWidgetBatch([card("p1", 1), card("p2", 2)]),
      { wrapper }
    );

    await waitFor(() => {
      expect(Object.keys(result.current.slots)).toHaveLength(2);
    });

    // Both questions left the browser. Keyed by widget id the two requests
    // still went out -- the loss was on the way back -- so the count alone
    // cannot separate the implementations, and the slots below are what does.
    const body = vi.mocked(protectedApi.post).mock.calls[0]?.[1] as {
      queries: WidgetQuery[];
    };
    expect(body.queries.map(q => q.limit)).toEqual([1, 2]);

    // The separating assertion. Under the widget-id key there was ONE entry
    // under `core/posts` holding whichever answer arrived last, and both cards
    // drew it.
    const first = result.current.slots.p1;
    const second = result.current.slots.p2;
    expect(
      first?.ok && first.result.op === "list" && first.result.items
    ).toEqual([{ id: "a" }]);
    expect(
      second?.ok && second.result.op === "list" && second.result.items
    ).toEqual([{ id: "b" }, { id: "c" }]);
  });

  it("reports both placements as having taken part", async () => {
    // `requested` gates each card's freshness line and its busy state. Built
    // from widget ids it held ONE member for two cards, so whichever card the
    // set did not name sat with no timestamp through every refetch.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "list", items: [] } },
        { ok: true, result: { op: "list", items: [] } },
      ],
    });

    const { result } = renderHook(
      () => useWidgetBatch([card("p1", 1), card("p2", 2)]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.requested.size).toBe(2));
    expect([...result.current.requested].sort()).toEqual(["p1", "p2"]);
  });
});
