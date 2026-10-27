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
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

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

const groupQuery = (source: string): WidgetQuery => ({
  source,
  op: "groupBy",
  groupBy: "status",
});

const seriesQuery = (source: string): WidgetQuery => ({
  source,
  op: "timeseries",
  dateField: "createdAt",
  interval: "day",
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWidgetQueries", () => {
  it("files a `__proto__` widget id as DATA, not onto the prototype", async () => {
    // 🔴 A contributed widget id is checked only for being usable text, so it
    // may be `"__proto__"`. On a `{}` dictionary that key is not data: reading
    // it returns `Object.prototype`, so `dict[id] ??= {}` never assigns and the
    // cell key is written onto the prototype every object in the admin
    // inherits. A declarative widget could corrupt property lookup across the
    // whole app merely by receiving an answer.
    const canary: Record<string, unknown> = {};
    expect(canary.total).toBeUndefined();

    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 7 } }],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "__proto__",
            cellKey: "total",
            query: countQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots["__proto__"]?.total).toBeDefined()
    );

    // The answer is reachable where it was filed, and NOWHERE else.
    expect(result.current.cellSlots["__proto__"]?.total).toEqual({
      ok: true,
      result: { op: "count", total: 7 },
    });
    expect(canary.total).toBeUndefined();
    expect(({} as Record<string, unknown>).total).toBeUndefined();
  });

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
          { placementId: "core/a", query: countQuery("collection:posts") },
          { placementId: "core/b", query: countQuery("collection:pages") },
          { placementId: "core/c", query: countQuery("collection:media") },
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
          { placementId: "core/posts", query: countQuery("collection:posts") },
          { placementId: "core/pages", query: countQuery("collection:pages") },
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
          { placementId: "core/broken", query: countQuery("collection:gone") },
          { placementId: "core/fine", query: countQuery("collection:posts") },
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

  it("keeps the server's unavailable code on a failed slot, and only that code", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: false, error: "Unavailable.", code: "unavailable" },
        { ok: false, error: "Something else.", code: "teapot" },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "core/forbidden",
            query: countQuery("collection:secret"),
          },
          { placementId: "core/odd", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.slots["core/odd"]).toBeDefined());
    // The card can only say "Not available to you" if the code survives the parse...
    expect(result.current.slots["core/forbidden"]).toEqual({
      ok: false,
      error: "Unavailable.",
      code: "unavailable",
    });
    // ...and a code it does not know is not passed on as if it meant something.
    expect(result.current.slots["core/odd"]).toEqual({
      ok: false,
      error: "Something else.",
    });
  });

  it("drops the unavailable code from a refusal with no usable message", async () => {
    // A slot missing its message is a broken answer that may recover; kept, the code would hide
    // that behind the unavailable state, which offers no Retry.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: false, error: "", code: "unavailable" }],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          { placementId: "core/broken", query: countQuery("collection:posts") },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.slots["core/broken"]).toBeDefined()
    );
    const slot = result.current.slots["core/broken"];
    expect(slot?.ok).toBe(false);
    expect(slot).not.toHaveProperty("code");
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
          { placementId: "core/a", query: countQuery("collection:posts") },
          { placementId: "core/b", query: countQuery("collection:pages") },
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
          { placementId: "core/a", query: countQuery("collection:posts") },
          { placementId: "core/b", query: countQuery("collection:pages") },
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

  it("hands a card the SAME slot object on every render while its cached answer is unchanged", async () => {
    // 🔴 A card keys its component's draw on the slot it is handed: a new object
    // is a new answer to draw. Rebuilt on every render, a component that throws
    // was caught, re-rendered the grid by reporting it, met a "new" answer, drew
    // and threw again until React stopped it, and every component card remounted
    // whenever the grid re-rendered. An ok slot, a refusal and a short answer
    // each keep their object.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 7 } },
        { ok: false, error: "Source unavailable." },
      ],
    });

    const { result, rerender } = renderHook(
      () =>
        useWidgetQueries([
          { placementId: "core/fine", query: countQuery("collection:posts") },
          { placementId: "core/broken", query: countQuery("collection:gone") },
          { placementId: "core/short", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.slots["core/short"]).toBeDefined()
    );
    const first = { ...result.current.slots };
    rerender();
    rerender();
    for (const id of ["core/fine", "core/broken", "core/short"]) {
      expect(result.current.slots[id]).toBe(first[id]);
    }
    // The control: the slots are the answers, not one shared placeholder.
    expect(first["core/fine"]).toEqual({
      ok: true,
      result: { op: "count", total: 7 },
    });
    expect(first["core/broken"]).not.toBe(first["core/short"]);
  });

  it("keeps a whole-request failure's slots the same objects across renders", async () => {
    vi.mocked(protectedApi.post).mockRejectedValue(new Error("network down"));

    const { result, rerender } = renderHook(
      () =>
        useWidgetQueries([
          { placementId: "core/a", query: countQuery("collection:posts") },
          { placementId: "core/b", query: countQuery("collection:pages") },
        ]),
      { wrapper }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    const first = { ...result.current.slots };
    rerender();
    expect(result.current.slots["core/a"]).toBe(first["core/a"]);
    expect(result.current.slots["core/b"]).toBe(first["core/b"]);
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
          { placementId: "core/a", query: countQuery("collection:posts") },
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
          { placementId: "core/a", query: countQuery("collection:posts") },
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
          { placementId: "core/a", query: countQuery("collection:posts") },
          { placementId: "core/b", query: countQuery("collection:pages") },
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
      placementId: `core/${i}`,
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
        placementId: `core/${i}`,
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
      placementId: `core/${i}`,
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

  it("reports only the partition still in flight as fetching, not every card", async () => {
    // 🔴 The same independence the failure case above relies on. A dashboard
    // over the cap is split into partitions that settle separately, so a card
    // whose own request has answered must stop reporting itself busy even while
    // another partition is still running -- otherwise settled numbers stay
    // dimmed for a reason no reader can see, and the published
    // `WidgetComponentProps.isFetching` contract is not kept.
    const over = MAX_QUERIES_PER_REQUEST + 1;
    const requests = Array.from({ length: over }, (_, i) => ({
      placementId: `core/${i}`,
      query: countQuery(`collection:c${i}`),
    }));

    let releaseSecond: (() => void) | undefined;
    const secondAnswered = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    vi.mocked(protectedApi.post).mockImplementation(
      async (_path: string, body: unknown) => {
        const sent = (body as { queries: unknown[] }).queries;
        // The trailing partition holds exactly the one query over the cap.
        if (sent.length === 1) await secondAnswered;
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

    // The first partition answers while the second is still held.
    await waitFor(() => expect(result.current.slots["core/0"]).toBeDefined());

    expect(result.current.fetchingPlacementIds.has("core/0")).toBe(false);
    expect(result.current.fetchingPlacementIds.has(`core/${over - 1}`)).toBe(
      true
    );
    // CONTROL: the batch-wide flag is still true, which is exactly why a card
    // reading it rather than this set was wrong.
    expect(result.current.isFetching).toBe(true);

    releaseSecond?.();
    await waitFor(() =>
      expect(result.current.slots[`core/${over - 1}`]).toBeDefined()
    );
    await waitFor(() =>
      expect(result.current.fetchingPlacementIds.size).toBe(0)
    );
    // The batch-wide flag is DERIVED from that set, so it has to fall with it.
    // Asserted because nothing else did: a flag stuck at `true` left every
    // card's busy affordance on forever and no test noticed.
    expect(result.current.isFetching).toBe(false);
  });

  describe("a member of results that is not a slot", () => {
    async function slotFor(member: unknown) {
      vi.mocked(protectedApi.post).mockResolvedValue({ results: [member] });
      const { result } = renderHook(
        () =>
          useWidgetQueries([
            { placementId: "core/a", query: countQuery("collection:posts") },
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

    it("carries the server's column descriptions through", async () => {
      // The arm rebuilds a list result from checked fields, so anything not
      // named here is discarded -- which is exactly what happened when the
      // server started describing its columns and nothing in the admin could
      // see them. A table archetype reads these to head its columns.
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "list",
            items: [{ title: "Hello" }],
            fields: [{ name: "title", label: "Title" }],
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "list",
          items: [{ title: "Hello" }],
          fields: [{ name: "title", label: "Title" }],
        },
      });
    });

    /*
     * 🔴 The column's declared KIND, which is what lets a cell be presented
     * rather than printed. This arm rebuilds the result from named fields, so a
     * property it does not name is discarded -- the exact way `label` was lost
     * when the server first started describing columns, and the exact way
     * `type` was lost again the day it was added. A renderer test cannot catch
     * it: those hand the fields straight to the archetype and never cross this
     * boundary.
     */
    it("carries the column's declared type through", async () => {
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "list",
            items: [{ when: "2026-09-01T07:00:00.000Z" }],
            fields: [{ name: "when", label: "Scheduled", type: "date" }],
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "list",
          items: [{ when: "2026-09-01T07:00:00.000Z" }],
          fields: [{ name: "when", label: "Scheduled", type: "date" }],
        },
      });
    });

    /*
     * An unrecognised kind degrades to an untyped column instead of refusing the
     * result. A newer server may name a type this build has not learned, and
     * blanking the card over it would make every future type a breaking change
     * -- where rendering the value as text is what every column did before types
     * existed at all.
     */
    it("drops an unrecognised type but keeps the column", async () => {
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "list",
            items: [{ when: "soon" }],
            fields: [{ name: "when", type: "duration" }],
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "list",
          items: [{ when: "soon" }],
          fields: [{ name: "when" }],
        },
      });
    });

    it("carries a column's value labels through", async () => {
      // Rebuilt from checked fields, so labels it did not read would be lost here, and a row
      // would print `needs_review` where the server said "Needs review".
      const fields = [
        {
          name: "stage",
          type: "string",
          choices: [{ value: "needs_review", label: "Needs review" }],
        },
      ];
      expect(
        await slotFor({
          ok: true,
          result: { op: "list", items: [{ stage: "needs_review" }], fields },
        })
      ).toEqual({
        ok: true,
        result: { op: "list", items: [{ stage: "needs_review" }], fields },
      });
    });

    it.each([
      ["a value that is not a string", { value: 3, label: "Three" }],
      ["an empty label", { value: "done", label: "" }],
      ["a label of spaces", { value: "done", label: "   " }],
    ])("drops value labels with %s but keeps the column", async (_, choice) => {
      // Presentation, so a broken list costs the labels, not the column or the rows.
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "list",
            items: [{ stage: "done" }],
            fields: [{ name: "stage", label: "Stage", choices: [choice] }],
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "list",
          items: [{ stage: "done" }],
          fields: [{ name: "stage", label: "Stage" }],
        },
      });
    });

    it("carries a grouped result's field through", async () => {
      const field = {
        name: "stage",
        label: "Stage",
        type: "string",
        choices: [{ value: "done", label: "Done" }],
      };
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "groupBy",
            buckets: [{ value: "done", count: 2 }],
            field,
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "groupBy",
          buckets: [{ value: "done", count: 2 }],
          field,
        },
      });
    });

    it("carries a bucket's own floor through, and only a true one", async () => {
      // A bucket's floor is its own claim: dropped, the card would draw "12"
      // where the source said "12 or more".
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "groupBy",
            buckets: [
              { value: "unpublished", count: 12, atLeast: true },
              { value: "overdue", count: 2, atLeast: false },
              { value: "scheduled", count: 1, atLeast: "yes" },
            ],
            atLeast: true,
          },
        })
      ).toEqual({
        ok: true,
        result: {
          op: "groupBy",
          buckets: [
            { value: "unpublished", count: 12, atLeast: true },
            { value: "overdue", count: 2 },
            { value: "scheduled", count: 1 },
          ],
          atLeast: true,
        },
      });
    });

    it("carries a grouped answer's instant through only as an exact instant", async () => {
      // The card measures its "this week" link from this instant, so a value
      // that is not one is dropped and the card falls back to its own clock.
      const answer = (asOf: unknown) =>
        slotFor({
          ok: true,
          result: {
            op: "groupBy",
            buckets: [{ value: "overdue", count: 1 }],
            asOf,
          },
        });
      expect(await answer("2026-10-22T12:00:00.000Z")).toEqual({
        ok: true,
        result: {
          op: "groupBy",
          buckets: [{ value: "overdue", count: 1 }],
          asOf: "2026-10-22T12:00:00.000Z",
        },
      });
      for (const asOf of [
        "2026-10-22",
        "2026-02-30T12:00:00.000Z",
        1761134400000,
      ]) {
        expect(await answer(asOf)).toEqual({
          ok: true,
          result: { op: "groupBy", buckets: [{ value: "overdue", count: 1 }] },
        });
      }
    });

    it("keeps the buckets when the grouped field is malformed", async () => {
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "groupBy",
            buckets: [{ value: "done", count: 2 }],
            field: { label: "no name" },
          },
        })
      ).toEqual({
        ok: true,
        result: { op: "groupBy", buckets: [{ value: "done", count: 2 }] },
      });
    });

    it("drops malformed column descriptions without losing the rows", async () => {
      // A malformed heading costs the columns and nothing more. The rows are
      // the answer, and refusing the whole result over its headings would turn
      // a cosmetic problem into a blank card.
      expect(
        await slotFor({
          ok: true,
          result: {
            op: "list",
            items: [{ title: "Hello" }],
            fields: [{ label: "no name here" }],
          },
        })
      ).toEqual({
        ok: true,
        result: { op: "list", items: [{ title: "Hello" }] },
      });
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
          { placementId: "core/a", query: countQuery("collection:posts") },
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

describe("useWidgetQueries, grouped results", () => {
  it("carries a grouped answer through to the slot", async () => {
    // The decoder recognised `count` and `list` only, so every grouped payload
    // became the malformed-response error and no card could ever draw one.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "groupBy",
            buckets: [
              { value: "published", count: 4 },
              { value: null, count: 1 },
            ],
            truncated: true,
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "byStatus",
            query: groupQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.byStatus).toBeDefined()
    );

    // The WHOLE slot: a decoder that dropped `truncated` would present a
    // capped bucket set as the entire picture, and one that dropped the null
    // bucket would lose the rows whose column is empty.
    expect(result.current.cellSlots.p1?.byStatus).toEqual({
      ok: true,
      result: {
        op: "groupBy",
        buckets: [
          { value: "published", count: 4 },
          { value: null, count: 1 },
        ],
        truncated: true,
      },
    });
  });

  it("carries a grouped answer's floor through to the slot, and only a boolean one", async () => {
    // The decoder rebuilds each result from the fields it knows. A floor it did
    // not carry would be dropped, and every bucket's short count would reach
    // the chart as a whole one. Answered by source rather than by position, so
    // the batch's own ordering cannot decide which slot gets which answer.
    vi.mocked(protectedApi.post).mockImplementation(async (_path, body) => ({
      results: (body as { queries: Array<{ source: string }> }).queries.map(
        query => ({
          ok: true,
          result: {
            op: "groupBy",
            buckets: [{ value: "published", count: 4 }],
            atLeast: query.source === "collection:posts" ? true : "true",
          },
        })
      ),
    }));

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "bounded",
            query: groupQuery("collection:posts"),
          },
          {
            placementId: "p2",
            cellKey: "garbled",
            query: groupQuery("collection:pages"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.cellSlots.p1?.bounded).toBeDefined();
      expect(result.current.cellSlots.p2?.garbled).toBeDefined();
    });

    expect(result.current.cellSlots.p1?.bounded).toEqual({
      ok: true,
      result: {
        op: "groupBy",
        buckets: [{ value: "published", count: 4 }],
        atLeast: true,
      },
    });
    // A string is not a claim the contract makes, so it is not carried.
    expect(result.current.cellSlots.p2?.garbled).toEqual({
      ok: true,
      result: { op: "groupBy", buckets: [{ value: "published", count: 4 }] },
    });
  });

  it("refuses a bucket whose count is not a finite number", async () => {
    // `1e400` is valid JSON and parses to `Infinity`, which would draw as a bar
    // dwarfing every real bucket rather than as a card admitting it cannot
    // answer.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "groupBy",
            buckets: [{ value: "published", count: Number.POSITIVE_INFINITY }],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "byStatus",
            query: groupQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.byStatus?.ok).toBe(false)
    );
  });
});

describe("useWidgetQueries, timeline results", () => {
  it("carries a timeline through to the slot, zeros included", async () => {
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "timeseries",
            interval: "day",
            points: [
              { start: "2026-03-02T00:00:00.000Z", count: 2 },
              { start: "2026-03-03T00:00:00.000Z", count: 0 },
              { start: "2026-03-04T00:00:00.000Z", count: 5 },
            ],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "trend",
            query: seriesQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.trend).toBeDefined()
    );

    // The WHOLE slot. A decoder that dropped the zero point would hand a chart
    // two points where three were read, and the line would join 2 straight to
    // 5 across a day that actually had nothing.
    expect(result.current.cellSlots.p1?.trend).toEqual({
      ok: true,
      result: {
        op: "timeseries",
        interval: "day",
        points: [
          { start: "2026-03-02T00:00:00.000Z", count: 2 },
          { start: "2026-03-03T00:00:00.000Z", count: 0 },
          { start: "2026-03-04T00:00:00.000Z", count: 5 },
        ],
      },
    });
  });

  it("refuses a point whose count is not a finite number", async () => {
    // `Infinity` is `typeof "number"`, and it reaches a chart as a bar that
    // dwarfs every real point rather than as an error.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "timeseries",
            interval: "day",
            points: [{ start: "2026-03-02T00:00:00.000Z", count: Number.NaN }],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "trend",
            query: seriesQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.trend?.ok).toBe(false)
    );
  });

  it("refuses an interval outside the vocabulary", async () => {
    // The interval labels the axis. A width nothing knows how to render is a
    // malformed answer rather than a chart drawn on a guess.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "timeseries",
            interval: "fortnight",
            points: [{ start: "2026-03-02T00:00:00.000Z", count: 1 }],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "trend",
            query: seriesQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.trend?.ok).toBe(false)
    );
  });
});

describe("useWidgetQueries, a malformed timeline point", () => {
  it("refuses a start that is not a canonical instant", async () => {
    // `start` is contractually a UTC instant. Arbitrary text reaches a chart as
    // an unlabelled tick, or throws when a component formats it as a date,
    // turning one bad slot into a rendering error for the whole dashboard.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "timeseries",
            interval: "day",
            points: [{ start: "not-a-date", count: 1 }],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "trend",
            query: seriesQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.trend?.ok).toBe(false)
    );
  });

  it("refuses a start that parses but is not the canonical spelling", async () => {
    // `Date.parse` alone accepts a bare year and platform-specific spellings,
    // so a response that drifted from the contract would pass a parse check
    // while carrying something no component can format consistently.
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "timeseries",
            interval: "day",
            points: [{ start: "2026-03-04", count: 1 }],
          },
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useWidgetQueries([
          {
            placementId: "p1",
            cellKey: "trend",
            query: seriesQuery("collection:posts"),
          },
        ]),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.cellSlots.p1?.trend?.ok).toBe(false)
    );
  });
});

describe("the tier an answer was fetched at", () => {
  it("travels with the cached answer, to a card that returns while it is still in flight", async () => {
    // A card asked at small is drawn again wider before its answer lands -- a remount while the
    // first render still holds the request -- and the first then leaves: the new render takes
    // over the request already in flight. The answer it receives is the small one, so it must
    // know that, or it never asks for the rows it is missing. (Once every render has left, the
    // request is cancelled through its signal, and a card that comes back asks anew.)
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0, gcTime: 60_000 } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    let answer: (body: unknown) => void = () => {};
    vi.mocked(protectedApi.post).mockImplementation(
      () => new Promise(resolve => (answer = resolve))
    );
    const list: WidgetQuery = {
      source: "collection:posts",
      op: "list",
      limit: 8,
    };
    const asked = (tier: "small" | "medium") => [
      {
        placementId: "p1",
        query: list,
        sized: { query: { ...list, limit: tier === "small" ? 4 : 9 }, tier },
      },
    ];

    const left = renderHook(() => useWidgetQueries(asked("small")), {
      wrapper: shared,
    });
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    const back = renderHook(() => useWidgetQueries(asked("medium")), {
      wrapper: shared,
    });
    left.unmount();

    answer({ results: [{ ok: true, result: { op: "list", items: [] } }] });
    await waitFor(() => expect(back.result.current.slots.p1).toBeDefined());
    expect(back.result.current.fetchedTierFor("p1")).toBe("small");
  });
});
