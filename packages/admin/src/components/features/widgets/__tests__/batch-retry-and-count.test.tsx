/**
 * Retry asks one card's question again every time it is pressed, and a card that is not
 * available is not announced as updated.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { WidgetQuery } from "nextly/config";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  // No automatic retries, so each request below is one a press of Retry caused.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A count card core draws, so its outcome is counted for the announcement. */
function metric(placementId: string, source: string): BatchCard {
  const query: WidgetQuery = { source, op: "count" };
  const widget: DashboardWidget = {
    id: `core/${placementId}`,
    title: placementId,
    archetype: "metric",
    size: gridBounds(3),
    query,
  };
  return { placementId, widget };
}

/** The queries one request carried. */
function asked(call: number): string[] {
  const body = vi.mocked(protectedApi.post).mock.calls[call]?.[1] as {
    queries: WidgetQuery[];
  };
  return body.queries.map(query => query.source);
}

beforeEach(() => vi.clearAllMocks());

describe("Retry", () => {
  it("asks the card's question again on every press, a press after a failed retry included", async () => {
    const failed = { ok: false, error: "An unexpected error occurred." };
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [failed, failed],
    });
    const cards = [metric("a", "collection:a"), metric("b", "collection:b")];

    const { result } = renderHook(() => useWidgetBatch(cards), { wrapper });
    await waitFor(() => expect(result.current.slots.a).toBeDefined());
    vi.mocked(protectedApi.post).mockResolvedValue({ results: [failed] });

    act(() => result.current.retry("a"));
    await waitFor(() =>
      expect(vi.mocked(protectedApi.post)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.slots.a).toBeDefined());

    // The second press: the first retry failed, and pressing again must ask again.
    act(() => result.current.retry("a"));
    await waitFor(() =>
      expect(vi.mocked(protectedApi.post)).toHaveBeenCalledTimes(3)
    );

    // Each retry asked card a's question alone.
    expect(asked(1)).toEqual(["collection:a"]);
    expect(asked(2)).toEqual(["collection:a"]);
  });

  it("asks only the card pressed, never the cards retried before it, and keeps their answers", async () => {
    const failed = { ok: false, error: "An unexpected error occurred." };
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [failed, failed],
    });
    const cards = [metric("a", "collection:a"), metric("b", "collection:b")];

    const { result } = renderHook(() => useWidgetBatch(cards), { wrapper });
    await waitFor(() => expect(result.current.slots.a).toBeDefined());

    // Card a's retry answers.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 5 } }],
    });
    act(() => result.current.retry("a"));
    await waitFor(() => expect(result.current.slots.a?.ok).toBe(true));

    // Then card b is retried: only b is asked, and a keeps the answer its retry brought.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 7 } }],
    });
    act(() => result.current.retry("b"));
    await waitFor(() => expect(result.current.slots.b?.ok).toBe(true));

    expect(vi.mocked(protectedApi.post)).toHaveBeenCalledTimes(3);
    expect(asked(2)).toEqual(["collection:b"]);
    expect(result.current.slots.a).toEqual({
      ok: true,
      result: { op: "count", total: 5 },
    });
  });

  it("dates a retried card by its retry's answer, and every other card by the batch's", async () => {
    // A clock the test moves, so the two answers cannot land in the same millisecond.
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const failed = { ok: false, error: "An unexpected error occurred." };
      vi.mocked(protectedApi.post).mockResolvedValue({
        results: [failed, failed],
      });
      const cards = [metric("a", "collection:a"), metric("b", "collection:b")];
      const { result } = renderHook(() => useWidgetBatch(cards), { wrapper });
      await waitFor(() => expect(result.current.updatedAt).not.toBeNull());

      now.mockReturnValue(5_000);
      vi.mocked(protectedApi.post).mockResolvedValue({
        results: [{ ok: true, result: { op: "count", total: 5 } }],
      });
      act(() => result.current.retry("a"));
      await waitFor(() => expect(result.current.slots.a?.ok).toBe(true));

      expect(result.current.updatedAtFor("a")?.getTime()).toBe(5_000);
      expect(result.current.updatedAtFor("b")?.getTime()).toBe(1_000);
    } finally {
      now.mockRestore();
    }
  });
});

describe("Retry past the per-request cap", () => {
  it("dates each card by its own answer when its request settles before another's", async () => {
    // More retries in flight than one request may carry are split into requests that settle
    // separately. A card whose request answered must be dated then, not when the last one does.
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const failed = { ok: false, error: "An unexpected error occurred." };
      const ids = Array.from(
        { length: 31 },
        (_, i) => `c${String(i).padStart(2, "0")}`
      );
      const cards = ids.map(id => metric(id, `collection:${id}`));
      vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
        Promise.resolve({
          results: (body as { queries: unknown[] }).queries.map(() => failed),
        })
      );
      const { result } = renderHook(() => useWidgetBatch(cards), { wrapper });
      await waitFor(() => expect(result.current.updatedAt).not.toBeNull());

      // The retries: the full request answers, the one-card request is held.
      now.mockReturnValue(5_000);
      vi.mocked(protectedApi.post).mockImplementation((_url, body) => {
        const queries = (body as { queries: unknown[] }).queries;
        if (queries.length === 1) return new Promise(() => undefined);
        return Promise.resolve({
          results: queries.map(() => ({
            ok: true,
            result: { op: "count", total: 1 },
          })),
        });
      });
      act(() => {
        for (const id of ids) result.current.retry(id);
      });
      await waitFor(() => expect(result.current.slots.c00?.ok).toBe(true));

      // c00 rode the request that answered; c30 is still in flight.
      expect(result.current.updatedAtFor("c00")?.getTime()).toBe(5_000);
      expect(result.current.slots.c30).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  });
});

describe("the announcement's count", () => {
  it("does not count a card that is not available as updated", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 3 } },
        {
          ok: false,
          error: "Invalid widget query: unavailable source or unsupported op",
          code: "unavailable",
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetBatch([
          metric("a", "collection:a"),
          metric("b", "collection:b"),
        ]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.settling).toBe(false));
    await waitFor(() => expect(result.current.slots.b).toBeDefined());

    // "1 of 1 widget updated", not "2 of 2": the unavailable card was not updated, and it did
    // not fail either.
    expect(result.current.counted).toBe(1);
    expect(result.current.failed).toBe(0);
  });

  it("does not count a card its widget does not show for this person", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 3 } },
        { ok: false, error: "Not shown for you", code: "not-shown" },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetBatch([
          metric("a", "collection:a"),
          metric("b", "collection:b"),
        ]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.settling).toBe(false));
    await waitFor(() => expect(result.current.slots.b).toBeDefined());

    // Off this person's dashboard: neither one of its cards updated nor one that failed.
    expect(result.current.counted).toBe(1);
    expect(result.current.failed).toBe(0);
  });

  it("counts a card whose own component failed to draw a fine answer as failed, not updated", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "data", data: 1 } }],
    });
    const cards: BatchCard[] = [
      {
        placementId: "d",
        widget: {
          id: "acme/revenue",
          title: "Revenue",
          archetype: "custom",
          size: gridBounds(4),
          component: "@acme/admin#Revenue",
          serverData: true,
        },
      },
    ];
    const { result, rerender } = renderHook(
      ({ drawFailed }: { drawFailed: ReadonlySet<string> }) =>
        useWidgetBatch(cards, drawFailed),
      { wrapper, initialProps: { drawFailed: new Set<string>() } }
    );
    await waitFor(() => expect(result.current.slots.d).toBeDefined());
    // The control: drawn, it is one card updated.
    expect(result.current.counted).toBe(1);
    expect(result.current.failed).toBe(0);
    // 🔴 Its answer was fine and its component threw: one card failed.
    rerender({ drawFailed: new Set(["d"]) });
    expect(result.current.failed).toBe(1);
  });
});
