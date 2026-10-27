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
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

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

function preview(
  initialDraft: Record<string, unknown>,
  {
    widget = WIDGET,
    shown = {},
  }: {
    widget?: DashboardWidget;
    shown?: { answerTier?: "small" | "medium" | "large" };
  } = {}
) {
  return renderHook(
    ({ draft }: { draft: Record<string, unknown> }) =>
      useSettingsPreview({
        widget,
        placementId: "p1",
        stored: undefined,
        draft,
        shown: { slot: SHOWN, updatedAt: null, isFetching: false, ...shown },
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
    await waitFor(() => expect(titleOf(result.current.slot)).toBe("limit 13"));
    // One request, for the settled question only, with the settings it would keep. Sized as a
    // card the dashboard draws: one row more than the twelve it draws, which is how a list learns
    // that more exist, at the widest tier, which serves whatever width the sheet gives it.
    expect(sent()).toEqual([
      [{ source: "collection:posts", op: "list", limit: 13 }],
    ]);
    expect(result.current.answerTier).toBe("large");
    expect(result.current.placement.settings).toMatchObject({ limit: 12 });
  });

  it("draws the card's own answer with the tier it was fetched at", () => {
    // 🔴 A small card's answer is three rows and a fourth that says more exist. Drawn without its
    // tier, a wider preview shows all four as rows, and nothing says more exist.
    const { result } = preview({}, { shown: { answerTier: "small" } });
    expect(result.current.slot).toBe(SHOWN);
    expect(result.current.answerTier).toBe("small");
  });

  it("asks a custom card's changed question as declared, since its own component draws it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = preview(
      {},
      { widget: { ...WIDGET, archetype: "custom" } }
    );
    rerender({ draft: { limit: 12 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(titleOf(result.current.slot)).toBe("limit 12"));
    expect(sent()).toEqual([
      [{ source: "collection:posts", op: "list", limit: 12 }],
    ]);
    expect(result.current.answerTier).toBeUndefined();
  });

  it("asks a cells card's cells under the changed values, and hands their answers back by key", async () => {
    // 🔴 With no query of its own, a cells card asked nothing, and its preview
    // stayed on its skeleton.
    vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
      Promise.resolve({
        results: (body as { queries: unknown[] }).queries.map(() => ({
          ok: true,
          result: { op: "count", total: 4 },
        })),
      })
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const count = {
      id: "core/count",
      title: "Count",
      archetype: "custom",
      size: "sm",
      settings: [
        { name: "collection", type: "collection", label: "Collection" },
      ],
      cells: [{ key: "total", query: { op: "count" } }],
    } as DashboardWidget;
    const { result, rerender } = preview({}, { widget: count });
    rerender({ draft: { collection: "pages" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() =>
      expect(result.current.slotFor?.("total")).toMatchObject({ ok: true })
    );
    expect(sent()).toEqual([[{ op: "count", source: "collection:pages" }]]);
    // Titled by its subject, with the widget's own name beneath it.
    expect(result.current.definition.title).toBe("pages");
    expect(result.current.subtitle).toBe("Count");
  });
});
