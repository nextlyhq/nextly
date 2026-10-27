/**
 * A change to one card's settings asks that card again, alone, and quietly.
 *
 * The batch keys each card by the question it DECLARES and sends the one its settings ask, so
 * changing a card's settings is not a new question for the dashboard: no other card is asked,
 * none goes back to its skeleton, and the changed card keeps what it shows until its new answer
 * arrives.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { WidgetQuery } from "nextly/config";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { useWidgetBatch, type BatchCard } from "../useWidgetBatch";
import { gridBounds } from "./grid-bounds";

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
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DECLARED: WidgetQuery = {
  source: "collection:posts",
  op: "list",
  limit: 5,
};

/** A plugin-drawn card, asked as declared or with its settings' `limit`. */
function card(placementId: string, limit?: number): BatchCard {
  const widget: DashboardWidget = {
    id: `core/${placementId}`,
    title: placementId,
    archetype: "custom",
    size: gridBounds(4),
    query: limit === undefined ? DECLARED : { ...DECLARED, limit },
  };
  return limit === undefined
    ? { placementId, widget }
    : { placementId, widget, declaredQuery: DECLARED };
}

/** The queries each request to the batch endpoint carried, in order. */
function sent(): Array<Array<{ limit?: number }>> {
  return vi
    .mocked(protectedApi.post)
    .mock.calls.map(
      ([, body]) => (body as { queries: Array<{ limit?: number }> }).queries
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: Array<{ limit?: number }> }).queries.map(
        // The limit asked comes back as the one row's title, so a test can tell which answer
        // a card is showing.
        query => ({
          ok: true,
          result: { op: "list", items: [{ title: `limit ${query.limit}` }] },
        })
      ),
    })
  );
});
afterEach(() => vi.restoreAllMocks());

describe("a change to one card's settings", () => {
  it("asks that card again alone, keeping its answer on screen meanwhile", async () => {
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [card("a"), card("b")] } }
    );
    await waitFor(() => expect(result.current.slots.b).toBeDefined());
    expect(sent()).toEqual([[{ ...DECLARED }, { ...DECLARED }]]);

    // Card b's settings now ask 12 rows.
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(sent()).toHaveLength(2));
    // One request, for b alone, sent as its settings ask it.
    expect(sent()[1]).toEqual([{ ...DECLARED, limit: 12 }]);
    // Neither card went back to having no answer while it was asked.
    expect(result.current.slots.a).toBeDefined();
    expect(result.current.slots.b).toBeDefined();

    await waitFor(() =>
      expect(
        (
          result.current.slots.b as {
            result?: { items?: Array<{ title?: string }> };
          }
        )?.result?.items?.[0]?.title
      ).toBe("limit 12")
    );
    // And nothing more: a, untouched, is not asked again.
    expect(sent()).toHaveLength(2);
  });

  it("asks a refused setting again once the reader has come back to it", async () => {
    // The first ask for 12 rows is refused; every other question answers.
    let refuseTwelve = true;
    vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
      Promise.resolve({
        results: (body as { queries: Array<{ limit?: number }> }).queries.map(
          query => {
            if (query.limit === 12 && refuseTwelve) {
              refuseTwelve = false;
              return { ok: false, error: "Refused" };
            }
            return {
              ok: true,
              result: {
                op: "list",
                items: [{ title: `limit ${query.limit}` }],
              },
            };
          }
        ),
      })
    );
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [card("a"), card("b")] } }
    );
    const shownOnB = () =>
      (
        result.current.slots.b as {
          result?: { items?: Array<{ title?: string }> };
        }
      )?.result?.items?.[0]?.title;
    await waitFor(() => expect(shownOnB()).toBe("limit 5"));

    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(sent()).toHaveLength(2));
    rerender({ cards: [card("a"), card("b", 20)] });
    await waitFor(() => expect(shownOnB()).toBe("limit 20"));

    // Back to 12: a different question from the 20 rows shown, so it is asked.
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(shownOnB()).toBe("limit 12"));
    expect(sent().at(-1)).toEqual([{ ...DECLARED, limit: 12 }]);
  });

  it("asks a card again when its settings change after its first request failed", async () => {
    vi.mocked(protectedApi.post).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(protectedApi.post).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(protectedApi.post).mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [card("a"), card("b")] } }
    );
    // The first request and both its retries fail, so every card shows the failure.
    await waitFor(() => expect(result.current.slots.b?.ok).toBe(false));
    expect(sent()).toHaveLength(3);

    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(result.current.slots.b?.ok).toBe(true));
    // b alone, as its new settings ask it.
    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toEqual([{ ...DECLARED, limit: 12 }]);
  });

  it("asks nothing again when a render hands the same settings", async () => {
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [card("a"), card("b", 12)] } }
    );
    await waitFor(() => expect(result.current.slots.b).toBeDefined());
    rerender({ cards: [card("a"), card("b", 12)] });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(sent()).toHaveLength(1);
  });
});
