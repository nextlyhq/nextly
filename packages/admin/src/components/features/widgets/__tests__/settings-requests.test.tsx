/**
 * A change to one card's settings asks that card again, alone, and quietly.
 *
 * The batch keys each card by its card id and files its answer under the stored settings it was
 * asked with, so changing a card's settings is not a new question for the dashboard: no other
 * card is asked, none goes back to its skeleton, and the changed card keeps what it shows until
 * its new answer arrives. The server reads a card's stored settings itself, so the mock below
 * answers from the settings the test has stored for each card.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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

/** The items setting each card has stored on the server, by placement; five when unset. */
let stored: Record<string, number> = {};

/** A declared card, asked by its id with the settings it has stored: an items setting, if any. */
function card(placementId: string, limit?: number): BatchCard {
  const widget: DashboardWidget = {
    id: `core/${placementId}`,
    title: placementId,
    archetype: "custom",
    size: gridBounds(4),
  };
  return limit === undefined
    ? { placementId, widget }
    : { placementId, widget, config: { items: limit } };
}

/** The cards each request to the batch endpoint asked for, by placement, in order. */
function sent(): string[][] {
  return vi
    .mocked(protectedApi.post)
    .mock.calls.map(([, body]) =>
      (body as { queries: Array<{ card: string }> }).queries.map(
        query => query.card
      )
    );
}

/** The items setting the server reads for a card it is asked for. */
const limitOf = (query: { card: string }) => stored[query.card] ?? 5;

beforeEach(() => {
  vi.clearAllMocks();
  stored = {};
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: Array<{ card: string }> }).queries.map(
        // The items read come back as the one row's title, so a test can tell which answer a
        // card is showing.
        query => ({
          ok: true,
          result: { op: "list", items: [{ title: `limit ${limitOf(query)}` }] },
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
    expect(sent()).toEqual([["a", "b"]]);

    // Card b's stored settings now ask 12 rows.
    stored.b = 12;
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(sent()).toHaveLength(2));
    // One request, for b alone.
    expect(sent()[1]).toEqual(["b"]);
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
        results: (body as { queries: Array<{ card: string }> }).queries.map(
          query => {
            if (limitOf(query) === 12 && refuseTwelve) {
              refuseTwelve = false;
              return { ok: false, error: "Refused" };
            }
            return {
              ok: true,
              result: {
                op: "list",
                items: [{ title: `limit ${limitOf(query)}` }],
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

    stored.b = 12;
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(sent()).toHaveLength(2));
    stored.b = 20;
    rerender({ cards: [card("a"), card("b", 20)] });
    await waitFor(() => expect(shownOnB()).toBe("limit 20"));

    // Back to 12: a different question from the 20 rows shown, so it is asked.
    stored.b = 12;
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(shownOnB()).toBe("limit 12"));
    expect(sent().at(-1)).toEqual(["b"]);
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

    stored.b = 12;
    rerender({ cards: [card("a"), card("b", 12)] });
    await waitFor(() => expect(result.current.slots.b?.ok).toBe(true));
    // b alone, asked with its new settings.
    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toEqual(["b"]);
  });

  it("asks nothing again when a render hands the same settings", async () => {
    stored.b = 12;
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
