/**
 * A card core answers on the server is asked for as a card, never by a query:
 * by its id at rest, with the settings it is drawn with while the dashboard is
 * being customised. What it sends, and how its answer comes back.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appliedKey,
  sentEntry,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
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

const orders: DashboardWidget = {
  id: "acme/orders",
  title: "Open orders",
  archetype: "custom",
  size: "full",
  serverData: true,
};

function sent(call = 0): unknown[] {
  return (
    vi.mocked(protectedApi.post).mock.calls[call]?.[1] as {
      queries: unknown[];
    }
  ).queries;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("what a card core answers sends", () => {
  it("asks by its id at rest, with nothing beside it", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "data", data: { total: 3 } } }],
    });
    const card: BatchCard = {
      placementId: "c-1",
      widget: orders,
      config: { items: 3 },
    };
    const { result } = renderHook(() => useWidgetBatch([card]), { wrapper });
    await waitFor(() => expect(result.current.slots["c-1"]).toBeDefined());

    // Its stored settings are the server's to read: sending them would be a
    // second copy that could disagree with the stored one.
    expect(sent()).toEqual([{ widget: "acme/orders", card: "c-1" }]);
    expect(result.current.slots["c-1"]).toEqual({
      ok: true,
      result: { op: "data", data: { total: 3 } },
    });
  });

  it("asks with the settings it is drawn with while the dashboard is customised", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "data", data: { total: 9 } } }],
    });
    const card: BatchCard = {
      placementId: "c-new",
      widget: orders,
      config: { items: 9 },
      editing: true,
    };
    const { result } = renderHook(() => useWidgetBatch([card]), { wrapper });
    await waitFor(() => expect(result.current.slots["c-new"]).toBeDefined());

    // A card not saved yet has no id the server could find, and a changed
    // setting not saved yet is not what the server holds.
    expect(sent()).toEqual([{ widget: "acme/orders", settings: { items: 9 } }]);
  });

  it("carries the server's empty verdict with the answer it was made about", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          empty: true,
          result: { op: "data", data: { total: 0 } },
        },
      ],
    });
    const { result } = renderHook(
      () => useWidgetBatch([{ placementId: "c-1", widget: orders }]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.slots["c-1"]).toBeDefined());
    // Drawn from the slot by `resolveWidgetOutcome` (declared-widget-card.test.ts).
    expect(result.current.slots["c-1"]).toMatchObject({ empty: true });
  });

  it("asks again, alone, when its stored settings change", async () => {
    vi.mocked(protectedApi.post).mockImplementation(async () => ({
      results: [{ ok: true, result: { op: "data", data: null } }],
    }));
    const other: BatchCard = {
      placementId: "c-2",
      widget: { ...orders, id: "acme/other" },
    };
    const { result, rerender } = renderHook(
      ({ items }: { items: number }) =>
        useWidgetBatch([
          { placementId: "c-1", widget: orders, config: { items } },
          other,
        ]),
      { wrapper, initialProps: { items: 3 } }
    );
    await waitFor(() => expect(result.current.slots["c-2"]).toBeDefined());
    const before = vi.mocked(protectedApi.post).mock.calls.length;

    rerender({ items: 5 });
    await waitFor(() =>
      expect(vi.mocked(protectedApi.post).mock.calls.length).toBe(before + 1)
    );
    expect(sent(before)).toEqual([{ widget: "acme/orders", card: "c-1" }]);
  });
});

describe("what a card's answer is filed under", () => {
  const stored: WidgetQueryRequest = {
    placementId: "c-1",
    card: { widget: "acme/orders", card: "c-1" },
    config: { items: 3 },
  };

  it("is its ask with its stored settings", () => {
    expect(appliedKey({ ...stored, config: { items: 5 } })).not.toBe(
      appliedKey(stored)
    );
    expect(sentEntry(stored)).toEqual({ widget: "acme/orders", card: "c-1" });
  });

  it("never reads a preview as the stored card, even with the same settings", () => {
    const preview: WidgetQueryRequest = {
      placementId: "c-1",
      card: { widget: "acme/orders", settings: { items: 3 } },
    };
    expect(appliedKey(preview)).not.toBe(appliedKey(stored));
  });
});
