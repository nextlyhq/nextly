/**
 * The batching hook while its answer streams: each card drawn as its own slot
 * arrives, held numbers kept through a refetch, and what an answer that ends
 * short, or breaks, leaves each card showing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { WidgetQuery } from "nextly/config";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWidgetQueries, type WidgetQueryRequest } from "./useWidgetQueries";
import { fetchWidgetBatch, type StreamedSlot } from "./widget-query-stream";

vi.mock("./widget-query-stream", () => ({ fetchWidgetBatch: vi.fn() }));

const fetchBatch = vi.mocked(fetchWidgetBatch);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const count = (source: string): WidgetQuery => ({ source, op: "count" });
const total = (n: number) => ({ ok: true, result: { op: "count", total: n } });

const REQUESTS: WidgetQueryRequest[] = [
  { placementId: "fast", query: count("collection:posts") },
  { placementId: "slow", query: count("system:slow") },
];

/**
 * One request's answer, written by the test: `send` hands slots over as the stream would, and
 * `end` / `fail` settle it.
 */
function heldAnswer() {
  let onSlots!: (slots: readonly StreamedSlot[]) => void;
  let end!: (slots: unknown[]) => void;
  let fail!: (error: Error) => void;
  const started = new Promise<void>(resolveStarted => {
    fetchBatch.mockImplementationOnce((_queries, options) => {
      onSlots = options.onSlots;
      resolveStarted();
      return new Promise<unknown[]>((resolve, reject) => {
        end = resolve;
        fail = reject;
      });
    });
  });
  return {
    started,
    send: (index: number, slot: unknown) =>
      act(() => onSlots([{ index, slot }])),
    end: (slots: unknown[]) => act(() => end(slots)),
    fail: (error: Error) => act(() => fail(error)),
  };
}

beforeEach(() => {
  // Reset, not cleared: an answer one case queued and never used must not reach the next. A
  // request no case wrote an answer for stays in flight rather than answering by accident.
  fetchBatch.mockReset();
  fetchBatch.mockImplementation(() => new Promise<never>(() => {}));
});

describe("useWidgetQueries, streamed", () => {
  it("draws each card as its own slot arrives, without waiting for the rest", async () => {
    const answer = heldAnswer();
    const { result } = renderHook(() => useWidgetQueries(REQUESTS), {
      wrapper,
    });
    await answer.started;

    await answer.send(0, total(9));

    await waitFor(() => expect(result.current.slots.fast).toEqual(total(9)));
    // Still on its way: no slot at all, which a card draws as busy, never as "missing".
    expect(result.current.slots.slow).toBeUndefined();
    expect([...result.current.fetchingPlacementIds]).toEqual(["slow"]);
    expect(result.current.isFetching).toBe(true);

    await answer.end([total(9), total(2)]);

    await waitFor(() => expect(result.current.slots.slow).toEqual(total(2)));
    expect(result.current.fetchingPlacementIds.size).toBe(0);
    expect(result.current.updatedAt).toBeInstanceOf(Date);
  });

  it("hands the request its own signal, so leaving the dashboard stops the read", async () => {
    const answer = heldAnswer();
    renderHook(() => useWidgetQueries(REQUESTS), { wrapper });
    await answer.started;

    expect(fetchBatch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the numbers on screen through a refetch until each card's new one arrives", async () => {
    const first = heldAnswer();
    const { result } = renderHook(() => useWidgetQueries(REQUESTS), {
      wrapper,
    });
    await first.started;
    await first.end([total(1), total(2)]);
    await waitFor(() => expect(result.current.slots.slow).toEqual(total(2)));
    const shownSince = result.current.updatedAt;

    const second = heldAnswer();
    // Not inside `act`: an `act` left open until the refetch settles would hold every later
    // case's updates; `waitFor` below observes the result instead.
    void result.current.refetch();
    await second.started;
    // Refetching: both cards say so, and both keep what they showed.
    await waitFor(() =>
      expect(result.current.fetchingPlacementIds.size).toBe(2)
    );
    expect(result.current.slots.fast).toEqual(total(1));
    expect(result.current.slots.slow).toEqual(total(2));

    await second.send(0, total(10));

    await waitFor(() => expect(result.current.slots.fast).toEqual(total(10)));
    expect(result.current.slots.slow).toEqual(total(2));
    expect([...result.current.fetchingPlacementIds]).toEqual(["slow"]);
    // A slot arriving is not the whole answer arriving: the freshness line has not moved.
    expect(result.current.updatedAt).toEqual(shownSince);

    await second.end([total(10), total(20)]);
    await waitFor(() => expect(result.current.slots.slow).toEqual(total(20)));
  });

  it("says a slot the ended answer never carried is missing", async () => {
    const answer = heldAnswer();
    const { result } = renderHook(() => useWidgetQueries(REQUESTS), {
      wrapper,
    });
    await answer.started;

    await answer.end([total(9), undefined]);

    await waitFor(() =>
      expect(result.current.slots.slow).toEqual({
        ok: false,
        error: "The server returned no result for this widget.",
      })
    );
    expect(result.current.slots.fast).toEqual(total(9));
  });

  it("keeps what a broken stream delivered, and fails only the cards it did not", async () => {
    // Every attempt delivers the fast card's slot and then breaks; the hook retries twice.
    const attempts = [heldAnswer()];
    const { result } = renderHook(() => useWidgetQueries(REQUESTS), {
      wrapper,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = attempts[attempt]!;
      await current.started;
      if (attempt < 2) attempts.push(heldAnswer());
      await current.send(0, total(9));
      await current.fail(new TypeError("network error"));
    }

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.slots.fast).toEqual(total(9));
    expect(result.current.slots.slow).toEqual({
      ok: false,
      error: "Dashboard data could not be loaded.",
    });
    expect(result.current.fetchingPlacementIds.size).toBe(0);
  });
});
