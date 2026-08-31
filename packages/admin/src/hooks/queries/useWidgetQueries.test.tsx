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

import { MAX_QUERIES_PER_REQUEST, type WidgetQuery } from "nextly/config";

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

  it("splits a dashboard past the endpoint's cap into requests it will accept", async () => {
    // The endpoint REFUSES a body above `MAX_QUERIES_PER_REQUEST`, so one
    // oversized batch is rejected whole -- every widget on the dashboard dark
    // at once, over a limit none of them individually crossed.
    const over = MAX_QUERIES_PER_REQUEST + 1;
    const requests = Array.from({ length: over }, (_, i) => ({
      widgetId: `core/${i}`,
      query: countQuery(`collection:c${i}`),
    }));
    vi.mocked(protectedApi.post).mockImplementation(
      async (_path: string, body: unknown) => ({
        results: (body as { queries: unknown[] }).queries.map((_q, i) => ({
          ok: true,
          result: { op: "count", total: i },
        })),
      })
    );

    const { result } = renderHook(() => useWidgetQueries(requests), {
      wrapper,
    });

    await waitFor(() =>
      expect(Object.keys(result.current.slots)).toHaveLength(over)
    );
    // Every widget answered, and no request exceeded the cap.
    for (const call of vi.mocked(protectedApi.post).mock.calls) {
      expect(
        (call[1] as { queries: unknown[] }).queries.length
      ).toBeLessThanOrEqual(MAX_QUERIES_PER_REQUEST);
    }
    // The keying survives the split: the last widget belongs to the second
    // partition and reads position 0 of ITS response, not position 30.
    expect(result.current.slots[`core/${over - 1}`]).toEqual({
      ok: true,
      result: { op: "count", total: 0 },
    });
    expect(result.current.slots["core/0"]).toEqual({
      ok: true,
      result: { op: "count", total: 0 },
    });
    expect(result.current.slots["core/5"]).toEqual({
      ok: true,
      result: { op: "count", total: 5 },
    });
  });

  it("keeps one request while the dashboard fits in one", async () => {
    // The control for the split above: partitioning must not turn the common
    // case into several round trips.
    const requests = Array.from(
      { length: MAX_QUERIES_PER_REQUEST },
      (_, i) => ({
        widgetId: `core/${i}`,
        query: countQuery(`collection:c${i}`),
      })
    );
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: requests.map(() => ({
        ok: true,
        result: { op: "count", total: 1 },
      })),
    });

    const { result } = renderHook(() => useWidgetQueries(requests), {
      wrapper,
    });

    await waitFor(() =>
      expect(Object.keys(result.current.slots)).toHaveLength(
        MAX_QUERIES_PER_REQUEST
      )
    );
    expect(protectedApi.post).toHaveBeenCalledTimes(1);
  });

  it("fails only the partition that failed, not the widgets beside it", async () => {
    const over = MAX_QUERIES_PER_REQUEST + 1;
    const requests = Array.from({ length: over }, (_, i) => ({
      widgetId: `core/${i}`,
      query: countQuery(`collection:c${i}`),
    }));
    vi.mocked(protectedApi.post).mockImplementation(
      async (_path: string, body: unknown) => {
        const sent = (body as { queries: unknown[] }).queries;
        if (sent.length === 1) throw new Error("second batch down");
        return {
          results: sent.map(() => ({
            ok: true,
            result: { op: "count", total: 3 },
          })),
        };
      }
    );

    const { result } = renderHook(() => useWidgetQueries(requests), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.slots[`core/${over - 1}`]).toBeDefined()
    );
    expect(result.current.slots[`core/${over - 1}`]).toEqual({
      ok: false,
      error: expect.stringMatching(/could not be/i),
    });
    expect(result.current.slots["core/0"]).toEqual({
      ok: true,
      result: { op: "count", total: 3 },
    });
  });

  describe("a member of results that is not a slot", () => {
    async function slotFor(member: unknown) {
      vi.mocked(protectedApi.post).mockResolvedValue({ results: [member] });
      const { result } = renderHook(
        () =>
          useWidgetQueries([
            { widgetId: "core/a", query: countQuery("collection:posts") },
          ]),
        { wrapper }
      );
      await waitFor(() => expect(result.current.slots["core/a"]).toBeDefined());
      return result.current.slots["core/a"];
    }

    it("isolates an ok slot carrying no result", async () => {
      // `{ ok: true }` is where this actually bites: the renderer hands
      // `slot.result` to an archetype body, which reads `result.op` and throws
      // a TypeError into the dashboard's error boundary -- one malformed entry
      // replacing the whole page.
      expect(await slotFor({ ok: true })).toEqual({
        ok: false,
        error: expect.stringMatching(/unreadable/i),
      });
    });

    it("isolates a primitive where a slot belongs", async () => {
      // Quieter and no better: `ok` is absent, so the card took the failure
      // branch with `undefined` for its message and drew a blank body.
      expect(await slotFor(42)).toEqual({
        ok: false,
        error: expect.stringMatching(/unreadable/i),
      });
    });

    it("isolates an object with no discriminator", async () => {
      expect(await slotFor({})).toEqual({
        ok: false,
        error: expect.stringMatching(/unreadable/i),
      });
    });

    it("isolates a failed slot whose message is missing", async () => {
      expect(await slotFor({ ok: false })).toEqual({
        ok: false,
        error: expect.stringMatching(/unreadable/i),
      });
    });

    it("isolates a count result carrying no total", async () => {
      // The crash this closes. `{ op: "count" }` passed an "is it an object"
      // check, the cast said it was a `WidgetResult`, and `metricBody` read
      // `result.total.toLocaleString()` on `undefined` -- taking the whole grid
      // down with it, which is what the per-slot shape exists to prevent.
      expect(await slotFor({ ok: true, result: { op: "count" } })).toEqual({
        ok: false,
        error: expect.stringMatching(/unreadable/i),
      });
    });

    it("isolates a count whose total is not a number", async () => {
      expect(
        await slotFor({ ok: true, result: { op: "count", total: "12" } })
      ).toEqual({ ok: false, error: expect.stringMatching(/unreadable/i) });
    });

    it("isolates a list whose items are not rows", async () => {
      // The same shape one level down: `[null]` is an array, and the failure
      // moves to whoever reads a field off the row rather than happening here.
      expect(
        await slotFor({ ok: true, result: { op: "list", items: [null] } })
      ).toEqual({ ok: false, error: expect.stringMatching(/unreadable/i) });
    });

    it("isolates a result whose op this admin cannot draw", async () => {
      expect(
        await slotFor({ ok: true, result: { op: "histogram", buckets: [] } })
      ).toEqual({ ok: false, error: expect.stringMatching(/unreadable/i) });
    });

    it("still passes a well-formed LIST through untouched", async () => {
      // The second positive control, so the arm added beside `count` is known
      // to accept as well as refuse.
      expect(
        await slotFor({ ok: true, result: { op: "list", items: [{ id: 1 }] } })
      ).toEqual({ ok: true, result: { op: "list", items: [{ id: 1 }] } });
    });

    it("still reads a null member as the server answering short", async () => {
      // The control: `null` was always handled, and must stay handled with its
      // own sentence rather than being folded into the malformed case.
      expect(await slotFor(null)).toEqual({
        ok: false,
        error: expect.stringMatching(/no result/i),
      });
    });

    it("still passes a well-formed slot through untouched", async () => {
      // The positive control. A validator that refused everything would satisfy
      // every assertion above.
      expect(
        await slotFor({ ok: true, result: { op: "count", total: 8 } })
      ).toEqual({ ok: true, result: { op: "count", total: 8 } });
    });
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
