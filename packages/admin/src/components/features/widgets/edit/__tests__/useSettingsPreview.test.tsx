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
import { gridBounds } from "../../__tests__/grid-bounds";

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
  size: gridBounds(4),
  // The card's Collection: what it is set to is part of the question its
  // widget's `load` answers.
  settings: [
    {
      name: "collection",
      type: "collection",
      label: "Collection",
      defaultValue: "posts",
    },
  ],
};

const SHOWN: WidgetSlot = {
  ok: true,
  result: { op: "list", items: [{ title: "shown" }] },
};

/** A card ask as the preview sends it: its widget, with the settings it is drawn with. */
type SentAsk = { widget: string; settings?: Record<string, unknown> };

/** The cards each request asked for, in order. */
const sent = () =>
  vi
    .mocked(protectedApi.post)
    .mock.calls.map(([, body]) => (body as { queries: SentAsk[] }).queries);

beforeEach(() => {
  vi.clearAllMocks();
  // Each card answered with one row titled by the collection it was asked with.
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: SentAsk[] }).queries.map(query => ({
        ok: true,
        result: {
          op: "list",
          items: [{ title: `${String(query.settings?.collection)}` }],
        },
      })),
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
    size,
  }: {
    widget?: DashboardWidget;
    /** The size the card is drawn at on the dashboard. */
    size?: { w: number; h: number };
  } = {}
) {
  return renderHook(
    ({ draft }: { draft: Record<string, unknown> }) =>
      useSettingsPreview({
        widget,
        placementId: "p1",
        stored: undefined,
        draft,
        shown: { slot: SHOWN, updatedAt: null, isFetching: false },
        ...(size === undefined ? {} : { size }),
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
    rerender({ draft: { collection: "pages" } });
    rerender({ draft: { collection: "tags" } });
    // Waiting for the values to settle: the card's answer was asked another way, so it is not
    // drawn, and nothing has been asked yet.
    expect(result.current.slot).toBeUndefined();
    expect(result.current.isFetching).toBe(true);
    expect(sent()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(titleOf(result.current.slot)).toBe("tags"));
    // One request, for the settled question only: the card asked for with the settings it would
    // keep, never by the stored card's id, so its answer is never filed as the stored card's.
    expect(sent()).toEqual([
      [{ widget: "core/recent", settings: { collection: "tags" } }],
    ]);
    expect(result.current.placement.settings).toMatchObject({
      collection: "tags",
    });
  });

  it("asks again when only the density changes, which its `load` reads too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const widget: DashboardWidget = {
      ...WIDGET,
      settings: [
        {
          name: "density",
          type: "select",
          label: "Density",
          defaultValue: "default",
          options: [
            { label: "Default", value: "default" },
            { label: "Compact", value: "compact" },
          ],
        },
      ],
    };
    const { result, rerender } = preview({}, { widget, size: { w: 4, h: 4 } });
    rerender({ draft: { density: "compact" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.[0]?.settings).toEqual({ density: "compact" });
    expect(result.current.placement.settings).toMatchObject({
      density: "compact",
    });
  });
});
