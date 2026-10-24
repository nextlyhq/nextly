/**
 * A card asking through cells, in the batch: keyed by the cells it declares and sent as its
 * settings ask them, so a change of one card's settings asks that card again alone; and asking
 * only the cells its tier draws, the rest once it widens to draw them.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { useWidgetBatch, type BatchCard } from "../useWidgetBatch";

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

/** Count's shape: a number at every tier, a trend from large. Sourceless, as declared. */
const DECLARED_CELLS = [
  { key: "total", query: { op: "count" } },
  {
    key: "trend",
    drawnFrom: "large",
    query: { op: "timeseries", dateField: "createdAt", interval: "day" },
  },
] as unknown as NonNullable<DashboardWidget["cells"]>;

interface SentQuery {
  op: string;
  source?: string;
  where?: unknown;
}

/** A Count card set to posts, with its settings' Filter, at its tier. */
function countCard(
  placementId: string,
  over: { filter?: Record<string, unknown>; tier?: SizeTier } = {}
): BatchCard {
  const cells = DECLARED_CELLS.map(cell => ({
    ...cell,
    query: {
      ...cell.query,
      source: "collection:posts",
      ...(over.filter ? { where: over.filter } : {}),
    },
  })) as unknown as NonNullable<DashboardWidget["cells"]>;
  return {
    placementId,
    widget: {
      id: "core/count",
      title: "Count",
      archetype: "custom",
      size: "sm",
      cells,
    },
    declaredCells: DECLARED_CELLS,
    ...(over.tier ? { tier: over.tier } : {}),
  };
}

/** The queries each request to the batch endpoint carried, in order. */
function sent(): SentQuery[][] {
  return vi
    .mocked(protectedApi.post)
    .mock.calls.map(([, body]) => (body as { queries: SentQuery[] }).queries);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: SentQuery[] }).queries.map(query =>
        query.op === "count"
          ? { ok: true, result: { op: "count", total: 1 } }
          : {
              ok: true,
              result: { op: "timeseries", points: [], interval: "day" },
            }
      ),
    })
  );
});
afterEach(() => vi.restoreAllMocks());

describe("a card asking through cells", () => {
  it("asks its cells again alone when its settings change, keeping the other card's answers", async () => {
    // 🔴 Keyed by the cells as asked, one card's Filter is a new question for
    // the whole partition, and every card is asked again.
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [countCard("a"), countCard("b")] } }
    );
    await waitFor(() =>
      expect(result.current.cellSlots.b?.trend).toBeDefined()
    );
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toHaveLength(4);

    const filter = { title: { equals: "news" } };
    rerender({ cards: [countCard("a"), countCard("b", { filter })] });
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1].map(query => [query.op, query.where])).toEqual([
      ["count", filter],
      ["timeseries", filter],
    ]);
    expect(result.current.cellSlots.a?.total).toBeDefined();
    await waitFor(() =>
      expect(result.current.fetchingPlacementIds.size).toBe(0)
    );
    expect(sent()).toHaveLength(2);
  });

  it("asks only the cells its tier draws, and the rest alone once it widens", async () => {
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      {
        wrapper,
        initialProps: {
          cards: [
            countCard("a", { tier: "small" }),
            countCard("b", { tier: "small" }),
          ],
        },
      }
    );
    await waitFor(() =>
      expect(result.current.cellSlots.b?.total).toBeDefined()
    );
    // 🔴 The trend no small card draws is never read.
    expect(sent()).toEqual([
      [
        expect.objectContaining({ op: "count" }),
        expect.objectContaining({ op: "count" }),
      ],
    ]);
    expect(result.current.cellSlots.b?.trend).toBeUndefined();
    // Nothing a small card draws is still awaited.
    expect(result.current.settling).toBe(false);

    rerender({
      cards: [
        countCard("a", { tier: "small" }),
        countCard("b", { tier: "large" }),
      ],
    });
    await waitFor(() =>
      expect(result.current.cellSlots.b?.trend).toBeDefined()
    );
    // b alone, its number kept on screen; a is not asked again.
    expect(sent()).toHaveLength(2);
    expect(sent()[1].map(query => query.op)).toEqual(["count", "timeseries"]);
    expect(result.current.cellSlots.a?.trend).toBeUndefined();
  });

  it("asks a card's cells once it widens, though its first tier sent none of them", async () => {
    // 🔴 With no record of a request that sent nothing, the widened card had
    // nothing to compare against, never asked, and stayed loading.
    const trendOnly = (tier: SizeTier): BatchCard => {
      const card = countCard("t", { tier });
      const cells = (card.widget.cells ?? []).filter(
        cell => cell.key === "trend"
      );
      return {
        ...card,
        widget: { ...card.widget, cells } as DashboardWidget,
        declaredCells: DECLARED_CELLS.filter(
          cell => cell.key === "trend"
        ) as NonNullable<DashboardWidget["cells"]>,
      };
    };
    const { result, rerender } = renderHook(
      ({ cards }: { cards: BatchCard[] }) => useWidgetBatch(cards),
      { wrapper, initialProps: { cards: [trendOnly("small")] } }
    );
    await waitFor(() =>
      expect(result.current.fetchingPlacementIds.size).toBe(0)
    );
    expect(sent()).toEqual([]);

    rerender({ cards: [trendOnly("large")] });
    await waitFor(() =>
      expect(result.current.cellSlots.t?.trend).toBeDefined()
    );
    expect(sent()).toEqual([[expect.objectContaining({ op: "timeseries" })]]);
  });
});
