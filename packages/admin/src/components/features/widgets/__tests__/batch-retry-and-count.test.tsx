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

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

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
    size: "sm",
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
});
