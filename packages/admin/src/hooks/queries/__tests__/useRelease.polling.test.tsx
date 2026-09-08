/**
 * The detail page has to learn that the launch it is watching stopped.
 *
 * This is the screen somebody sits on across a scheduled instant, and the
 * release settles without any action from this browser: the drain publishes it,
 * or stops it. With no interval and focus refetching disabled globally, the
 * page would go on showing `scheduled` until an unrelated mutation or a
 * remount — so the person most likely to be watching would be the last to find
 * out. A `staleTime` cannot cover it, because it governs whether a NEW
 * subscriber refetches and never initiates a request for a mounted query.
 *
 * Asserted as the OUTCOME — what the hook reports after the server's answer
 * changes underneath it — rather than by reading the interval back off the
 * query, which would pass for any number including one nothing acts on.
 *
 * @module hooks/queries/__tests__/useRelease.polling.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchReleaseSpy } = vi.hoisted(() => ({ fetchReleaseSpy: vi.fn() }));

vi.mock("@admin/services/releaseApi", () => ({
  fetchRelease: fetchReleaseSpy,
  fetchReleases: vi.fn(),
  fetchReleaseMembers: vi.fn(),
  createRelease: vi.fn(),
  scheduleRelease: vi.fn(),
  cancelRelease: vi.fn(),
  addReleaseMember: vi.fn(),
  removeReleaseMember: vi.fn(),
}));

import { useRelease } from "../useReleases";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const release = (state: string) => ({
  id: "r1",
  title: "Spring launch",
  description: null,
  scheduledAt: "2026-09-01T00:00:00.000Z",
  timezone: "UTC",
  state,
  publishedAt: null,
  ...(state === "blocked"
    ? { blockedBy: [{ memberId: "m1", reason: "AUTHOR_GONE" }] }
    : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("a release detail page held open across the instant", () => {
  it("learns that the release STOPPED, without anybody touching the page", async () => {
    // The drain blocks it between two polls. Nothing in this browser wrote
    // anything, so no mutation invalidates the cache — the only way this page
    // finds out is by asking again.
    fetchReleaseSpy
      .mockResolvedValueOnce(release("scheduled"))
      .mockResolvedValue(release("blocked"));

    const { result } = renderHook(() => useRelease("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe("scheduled");

    await vi.advanceTimersByTimeAsync(60_000);

    await waitFor(() => expect(result.current.data?.state).toBe("blocked"));
    // And the reason arrived with it: the blockers ride on this response, so
    // refreshing the state is also what fills the notice that says what to fix.
    expect(result.current.data?.blockedBy).toHaveLength(1);
  });

  it("keeps asking while the release is still scheduled", async () => {
    // The control for the interval itself. Without it, the case above is
    // satisfied by a single refetch that happens to fire once.
    fetchReleaseSpy.mockResolvedValue(release("scheduled"));

    const { result } = renderHook(() => useRelease("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchReleaseSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchReleaseSpy).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchReleaseSpy).toHaveBeenCalledTimes(3));
  });

  it("does not go silent once the release has settled", async () => {
    // A settled release is polled SLOWLY, not never. Stopping altogether is
    // the shape that turns a transient wrong answer into a permanent one: a
    // row read once as settled would never be corrected, and this page would
    // hold that claim for as long as it stayed open. It is also wrong on the
    // facts — another administrator can reschedule a blocked release, and
    // nothing they do reaches this browser.
    fetchReleaseSpy.mockResolvedValue(release("blocked"));

    const { result } = renderHook(() => useRelease("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchReleaseSpy).toHaveBeenCalledTimes(1);

    // Not at the fast cadence...
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchReleaseSpy).toHaveBeenCalledTimes(1);

    // ...but it does come back.
    await vi.advanceTimersByTimeAsync(240_000);
    await waitFor(() => expect(fetchReleaseSpy).toHaveBeenCalledTimes(2));
  });
});
