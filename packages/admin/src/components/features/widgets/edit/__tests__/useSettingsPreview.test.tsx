/**
 * The settings sheet's preview: the card's own answer while the question is unchanged, and the
 * changed question asked once, as the preview's own card, after the values stop changing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { useSettingsPreview } from "../useSettingsPreview";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const WIDGET: DashboardWidget = {
  id: "core/recent",
  title: "Recent posts",
  archetype: "list",
  size: "md",
  query: { source: "collection:posts", op: "list", limit: 5 },
  settings: [{ name: "limit", type: "number", label: "Rows", defaultValue: 5 }],
};

const SHOWN: WidgetSlot = {
  ok: true,
  result: { op: "list", items: [{ title: "shown" }] },
};

/** The queries each request carried, in order. */
const sent = () =>
  vi
    .mocked(protectedApi.post)
    .mock.calls.map(
      ([, body]) => (body as { queries: Array<{ limit?: number }> }).queries
    );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: Array<{ limit?: number }> }).queries.map(
        query => ({
          ok: true,
          result: { op: "list", items: [{ title: `limit ${query.limit}` }] },
        })
      ),
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function preview(initialDraft: Record<string, unknown>) {
  return renderHook(
    ({ draft }: { draft: Record<string, unknown> }) =>
      useSettingsPreview({
        widget: WIDGET,
        placementId: "p1",
        stored: undefined,
        draft,
        shown: { slot: SHOWN, updatedAt: null, isFetching: false },
      }),
    { wrapper, initialProps: { draft: initialDraft } }
  );
}

const titleOf = (slot: WidgetSlot | undefined) =>
  (slot as { result?: { items?: Array<{ title?: string }> } } | undefined)
    ?.result?.items?.[0]?.title;

describe("the settings sheet's preview", () => {
  it("draws the card's own answer, and asks nothing, while the question is unchanged", async () => {
    const { result } = preview({});
    expect(result.current.slot).toBe(SHOWN);
    expect(result.current.placement.id).toBe("p1:preview");
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(sent()).toEqual([]);
  });

  it("asks a changed question once the values stop changing, as its own card", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = preview({});
    rerender({ draft: { limit: 1 } });
    rerender({ draft: { limit: 12 } });
    // Waiting for the values to settle: the card's answer was asked another way, so it is not
    // drawn, and nothing has been asked yet.
    expect(result.current.slot).toBeUndefined();
    expect(result.current.isFetching).toBe(true);
    expect(sent()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(titleOf(result.current.slot)).toBe("limit 12"));
    // One request, for the settled question only, with the settings it would keep.
    expect(sent()).toEqual([
      [{ source: "collection:posts", op: "list", limit: 12 }],
    ]);
    expect(result.current.placement.settings).toMatchObject({ limit: 12 });
  });
});
