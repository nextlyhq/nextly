// @vitest-environment jsdom
/**
 * Activity's list is the server's merged Activity under one cursor. It reads
 * itself again every 30 seconds while a queued email it shows can still
 * change by itself (waiting, retrying, sending), and every minute once all
 * have settled, so email sent or queued since still appears; each refresh
 * measures the window again, so it rolls with the clock, while a later page
 * keeps the window its first page was read in.
 *
 * @module hooks/queries/__tests__/useEmailActivity.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ActivityEntry,
  QueuedEmailActivity,
} from "@admin/services/emailActivityApi";

import { useActivityDetail, useEmailActivity } from "../useEmailActivity";

const listActivity = vi.fn();
const searchActivityByAddress = vi.fn();
vi.mock("@admin/services/emailActivityApi", () => ({
  listActivity: (...args: unknown[]) => listActivity(...args),
  searchActivityByAddress: (...args: unknown[]) =>
    searchActivityByAddress(...args),
  getQueuedEmailOverdue: vi.fn(),
  getDeliveryDetail: vi.fn(),
  getQueuedEmailDetail: (...args: unknown[]) => getQueuedEmailDetail(...args),
}));
const getQueuedEmailDetail = vi.fn();

/** One merged row: a queued email in `status`. */
function entry(
  status: ActivityEntry["status"],
  over: Partial<ActivityEntry> = {}
): ActivityEntry {
  return {
    kind: "queued",
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    status,
    template: "none",
    provider: null,
    recipientKinds: null,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: null,
    erased: false,
    ...over,
  };
}

/** A queued email's detail base, as its sheet reads it. */
function queuedEmail(state: QueuedEmailActivity["state"]): QueuedEmailActivity {
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
  listActivity.mockReset();
  searchActivityByAddress.mockReset();
});

/** What the n-th read asked for. */
function asked(n: number): Record<string, unknown> {
  return listActivity.mock.calls[n]?.[0] as Record<string, unknown>;
}

async function readsAfter(
  status: ActivityEntry["status"],
  ms: number
): Promise<number> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listActivity.mockResolvedValue({ items: [entry(status)], meta: EMPTY_META });
  const { result } = renderHook(
    () => useEmailActivity({ outcome: "any", window: "7d" }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  const before = listActivity.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  return listActivity.mock.calls.length - before;
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

  it("asks the merged Activity once per page, with the filters as the server names them", async () => {
    listActivity.mockResolvedValue({
      items: [entry("sent")],
      meta: EMPTY_META,
    });
    const { result } = renderHook(
      () =>
        useEmailActivity({
          outcome: "failed",
          template: "order-shipped",
          providerType: "smtp",
          providerOrigin: "deleted",
          window: "24h",
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(listActivity).toHaveBeenCalledTimes(1);
    expect(asked(0)).toMatchObject({
      status: "failed",
      template: "order-shipped",
      providerType: "smtp",
      providerOrigin: "deleted",
      limit: 50,
    });
    expect(asked(0)).not.toHaveProperty("before");
  });

  it("rolls the window forward on each refresh, measured when the first page is read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
    listActivity.mockResolvedValue({
      items: [entry("waiting")],
      meta: EMPTY_META,
    });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "any", window: "24h" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(asked(0).from).toBe("2026-11-15T12:00:00.000Z");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const last = asked(listActivity.mock.calls.length - 1);
    expect(Date.parse(last.from as string)).toBeGreaterThanOrEqual(
      Date.parse("2026-11-15T12:00:30.000Z")
    );
  });

  it("reads the next page by its cursor, in the window its first page was read in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
    listActivity
      .mockResolvedValueOnce({
        items: [entry("sent")],
        meta: { ...EMPTY_META, nextBefore: "cursor-1" },
      })
      .mockResolvedValue({
        items: [
          entry("sent", { id: "q2", createdAt: "2026-11-16T09:00:00.000Z" }),
        ],
        meta: EMPTY_META,
      });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "any", window: "24h" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    // Time passes before the reader asks for more: the window stays put.
    vi.setSystemTime(new Date("2026-11-16T12:05:00.000Z"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map(row => row.id)).toEqual(["q1", "q2"]);
    expect(asked(1)).toMatchObject({
      before: "cursor-1",
      from: asked(0).from,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it("stops refreshing once more than one page is loaded, so a poll never reads every page again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The first page has more; the second is the last.
    listActivity
      .mockResolvedValueOnce({
        items: [entry("waiting")],
        meta: { ...EMPTY_META, nextBefore: "cursor-1" },
      })
      .mockResolvedValue({
        items: [
          entry("waiting", {
            id: "q2",
            createdAt: "2026-11-16T09:00:00.000Z",
          }),
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
    const before = listActivity.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(listActivity.mock.calls.length - before).toBe(0);
  });
});

describe("useEmailActivity searching by address", () => {
  const NOTICE =
    "Only records sent under the current secret, or a previous secret still configured, can be found by address.";
  const search = { id: 1, address: "ada@example.test" };

  it("searches the address under the list's filters, and passes the server's notice on", async () => {
    searchActivityByAddress.mockResolvedValue({
      items: [entry("sent")],
      meta: EMPTY_META,
      notice: NOTICE,
    });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "failed", window: "7d" }, { search }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(listActivity).not.toHaveBeenCalled();
    expect(searchActivityByAddress.mock.calls[0][0]).toMatchObject({
      address: "ada@example.test",
      status: "failed",
      limit: 50,
    });
    expect(result.current.notice).toBe(NOTICE);
  });

  it("never searches again by itself, since each search is recorded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A queued email still waiting would make the list poll every 30 s.
    searchActivityByAddress.mockResolvedValue({
      items: [entry("waiting")],
      meta: EMPTY_META,
      notice: NOTICE,
    });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "any", window: "7d" }, { search }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000);
    });
    window.dispatchEvent(new Event("focus"));
    expect(searchActivityByAddress).toHaveBeenCalledTimes(1);
  });

  it("keeps the address out of every cache key, keying a search by its number", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    searchActivityByAddress.mockResolvedValue({
      items: [entry("sent")],
      meta: EMPTY_META,
      notice: NOTICE,
    });
    const { result } = renderHook(
      () => useEmailActivity({ outcome: "any", window: "7d" }, { search }),
      { wrapper: shared }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const keys = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map(query => query.queryKey)
    );
    expect(keys).toContain('"search"');
    expect(keys).not.toContain("ada");
  });

  it("reads the same address again when it is searched again", async () => {
    searchActivityByAddress.mockResolvedValue({
      items: [entry("sent")],
      meta: EMPTY_META,
      notice: NOTICE,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender, result } = renderHook(
      ({ id }: { id: number }) =>
        useEmailActivity(
          { outcome: "any", window: "7d" },
          { search: { id, address: "ada@example.test" } }
        ),
      { wrapper: shared, initialProps: { id: 1 } }
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    rerender({ id: 2 });
    await waitFor(() =>
      expect(searchActivityByAddress).toHaveBeenCalledTimes(2)
    );
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
    getQueuedEmailDetail.mockResolvedValue({ ...queuedEmail("sent") });
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
    getQueuedEmailDetail.mockResolvedValue({ ...queuedEmail("sent") });
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
