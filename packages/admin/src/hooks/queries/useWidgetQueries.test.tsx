/**
 * The batching hook. Every assertion here is about an OUTCOME the dashboard
 * can observe — how many requests left the browser, and which widget got which
 * answer — rather than about `protectedApi.post` having been reached.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";

import { useWidgetQueries } from "./useWidgetQueries";

import type { WidgetQuery } from "nextly/config";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    // `retry` is NOT disabled here. The hook sets `retry: 2` itself, following
    // `useDashboardStats`, and a query-level option wins over this default — so
    // turning it off here would only make the tests look like they had. What is
    // disabled is the BACKOFF, which is where the seconds go: three immediate
    // attempts exercise the same retry path in milliseconds.
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const countQuery = (source: string): WidgetQuery => ({ source, op: "count" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWidgetQueries", () => {
  it("sends N queries as ONE request", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
        { ok: true, result: { op: "count", total: 3 } },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
          { widgetId: "core/b", query: countQuery("collection:pages") },
          { widgetId: "core/c", query: countQuery("collection:media") },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(Object.keys(result.current.slots)).toHaveLength(3)
    );
    expect(protectedApi.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(protectedApi.post).mock.calls[0][0]).toBe(
      "/dashboard/query"
    );
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        countQuery("collection:posts"),
        countQuery("collection:pages"),
        countQuery("collection:media"),
      ],
    });
  });

  it("keys positional results back onto their widget ids", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 11 } },
        { ok: true, result: { op: "count", total: 22 } },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/posts", query: countQuery("collection:posts") },
          { widgetId: "core/pages", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.slots["core/posts"]).toBeDefined()
    );
    expect(result.current.slots["core/posts"]).toEqual({
      ok: true,
      result: { op: "count", total: 11 },
    });
    expect(result.current.slots["core/pages"]).toEqual({
      ok: true,
      result: { op: "count", total: 22 },
    });
  });

  it("does not blank a neighbour when one slot fails", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: false, error: "Source unavailable." },
        { ok: true, result: { op: "count", total: 7 } },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/broken", query: countQuery("collection:gone") },
          { widgetId: "core/fine", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.slots["core/fine"]).toBeDefined()
    );
    expect(result.current.slots["core/broken"]).toEqual({
      ok: false,
      error: "Source unavailable.",
    });
    expect(result.current.slots["core/fine"]).toEqual({
      ok: true,
      result: { op: "count", total: 7 },
    });
    // A failing slot is data, not a rejected query.
    expect(result.current.error).toBeNull();
  });

  it("issues no request at all when there is nothing to ask", async () => {
    const { result } = renderHook(() => useWidgetQueries([]), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(protectedApi.post).not.toHaveBeenCalled();
    expect(result.current.slots).toEqual({});
  });

  it("gives a widget the server answered short an explicit failed slot", async () => {
    // A server that returns fewer slots than queries would otherwise leave the
    // trailing widgets in a permanent, silent loading state.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 5 } }],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
          { widgetId: "core/b", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.slots["core/b"]).toBeDefined());
    expect(result.current.slots["core/b"]).toEqual({
      ok: false,
      error: expect.stringMatching(/no result/i),
    });
  });

  it("gives every widget a FAILED slot when the whole request fails", async () => {
    // Not an empty `slots`. A widget with no slot is busy by the renderer's
    // contract, so a settled failure that produced no slots left every card on
    // the dashboard spinning forever.
    vi.mocked(protectedApi.post).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
          { widgetId: "core/b", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("network down");
    expect(result.current.slots).toEqual({
      "core/a": { ok: false, error: expect.stringMatching(/could not be/i) },
      "core/b": { ok: false, error: expect.stringMatching(/could not be/i) },
    });
  });

  it("says nothing per widget while the request is still being retried", async () => {
    // Absent, not failed: the batch has not settled, so the cards are busy
    // rather than broken.
    vi.mocked(protectedApi.post).mockImplementation(
      () => new Promise(() => {})
    );

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    expect(result.current.slots).toEqual({});
  });

  it("reports loading while the single request is in flight", async () => {
    vi.mocked(protectedApi.post).mockImplementation(
      () => new Promise(() => {})
    );

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);
  });

  it("refetches through one request, not one per widget", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
          { widgetId: "core/b", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.slots["core/b"]).toBeDefined());
    expect(protectedApi.post).toHaveBeenCalledTimes(1);

    await result.current.refetch();
    expect(protectedApi.post).toHaveBeenCalledTimes(2);
  });

  it("refuses a body the server did not shape as a results array", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({ nope: true });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { widgetId: "core/a", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Refused, so it settled by failing -- which the widget hears about in its
    // own slot rather than by waiting forever.
    expect(result.current.slots["core/a"]).toEqual({
      ok: false,
      error: expect.stringMatching(/could not be/i),
    });
  });
});
