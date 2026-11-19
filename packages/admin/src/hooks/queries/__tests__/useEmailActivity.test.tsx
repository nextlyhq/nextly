// @vitest-environment jsdom
/**
 * Activity's list reads itself again every 30 seconds while a queued email it
 * shows can still change by itself (waiting, retrying, sending), so a row
 * never keeps a state the queue has moved past, and every minute once all
 * have settled, so email sent or queued since still appears.
 *
 * @module hooks/queries/__tests__/useEmailActivity.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueuedEmailActivity } from "@admin/services/emailActivityApi";

import { useActivityDetail, useEmailActivity } from "../useEmailActivity";

const listDeliveryActivity = vi.fn();
const listQueuedEmailActivity = vi.fn();
vi.mock("@admin/services/emailActivityApi", () => ({
  listDeliveryActivity: (...args: unknown[]) => listDeliveryActivity(...args),
  listQueuedEmailActivity: (...args: unknown[]) =>
    listQueuedEmailActivity(...args),
  getQueuedEmailOverdue: vi.fn(),
  getDeliveryDetail: vi.fn(),
  getQueuedEmailDetail: (...args: unknown[]) => getQueuedEmailDetail(...args),
}));
const getQueuedEmailDetail = vi.fn();

function queued(state: QueuedEmailActivity["state"]): QueuedEmailActivity {
  return {
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:00.000Z",
    settledAt: null,
    state,
    attempts: 0,
    nextAttemptAt: null,
    lastFailure: null,
    messageHeld: true,
    templateSlug: null,
    queuedBy: "site",
  };
}

const EMPTY_META = {
  total: 0,
  page: 1,
  limit: 50,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  getQueuedEmailDetail.mockReset();
  vi.useRealTimers();
  listDeliveryActivity.mockReset();
  listQueuedEmailActivity.mockReset();
});

async function readsAfter(
  state: QueuedEmailActivity["state"],
  ms: number
): Promise<number> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listDeliveryActivity.mockResolvedValue({ items: [], meta: EMPTY_META });
  listQueuedEmailActivity.mockResolvedValue({
    items: [queued(state)],
    meta: EMPTY_META,
  });
  const { result } = renderHook(
    () => useEmailActivity({ outcome: "any", window: "7d" }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  const before = listQueuedEmailActivity.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  return listQueuedEmailActivity.mock.calls.length - before;
}

describe("useEmailActivity", () => {
  it("reads the list again within 30 seconds while a queued email it shows is still waiting", async () => {
    expect(await readsAfter("waiting", 31_000)).toBeGreaterThan(0);
  });

  it("reads a settled list again less often, not within 30 seconds", async () => {
    expect(await readsAfter("sent", 31_000)).toBe(0);
  });

  it("still reads a settled list again within a minute, for email sent since", async () => {
    expect(await readsAfter("sent", 61_000)).toBeGreaterThan(0);
  });

  it("stops refreshing once more than one page is loaded, so a poll never reads every page again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listDeliveryActivity.mockResolvedValue({ items: [], meta: EMPTY_META });
    // The first page has more; the second is the last.
    listQueuedEmailActivity
      .mockResolvedValueOnce({
        items: [queued("waiting")],
        meta: { ...EMPTY_META, nextBefore: "cursor-1" },
      })
      .mockResolvedValue({
        items: [
          {
            ...queued("waiting"),
            id: "q2",
            createdAt: "2026-11-16T09:00:00.000Z",
          },
        ],
        meta: EMPTY_META,
      });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "any", window: "7d" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    const before =
      listQueuedEmailActivity.mock.calls.length +
      listDeliveryActivity.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(
      listQueuedEmailActivity.mock.calls.length +
        listDeliveryActivity.mock.calls.length -
        before
    ).toBe(0);
  });
});

describe("useActivityDetail", () => {
  it("reads a sheet's detail afresh each time it opens, whatever the cache's freshness", async () => {
    // The admin's own client keeps data fresh for five minutes; a sheet
    // reopened inside that must still read again, since its email may have
    // settled since.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    getQueuedEmailDetail.mockResolvedValue({ ...queued("sent") });
    const open = { source: "queued" as const, id: "q1" };
    const first = renderHook(() => useActivityDetail(open), {
      wrapper: shared,
    });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();
    const second = renderHook(() => useActivityDetail(open), {
      wrapper: shared,
    });
    await waitFor(() => expect(getQueuedEmailDetail).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it("reads it afresh when the same sheet closes and reopens on a row, without remounting", async () => {
    // The screen keeps one sheet mounted and only changes which row is open.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    getQueuedEmailDetail.mockReset();
    getQueuedEmailDetail.mockResolvedValue({ ...queued("sent") });
    const row = { source: "queued" as const, id: "q1" };
    const sheet = renderHook(
      ({ open }: { open: typeof row | null }) => useActivityDetail(open),
      { wrapper: shared, initialProps: { open: row as typeof row | null } }
    );
    await waitFor(() => expect(getQueuedEmailDetail).toHaveBeenCalledTimes(1));
    sheet.rerender({ open: null });
    sheet.rerender({ open: row });
    await waitFor(() => expect(getQueuedEmailDetail).toHaveBeenCalledTimes(2));
    sheet.unmount();
  });
});
