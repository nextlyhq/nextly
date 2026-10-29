/**
 * Who holds a document, read by a user who may not claim it.
 *
 * A reader who may publish is never handed a claim, so the claim hook tells
 * them nothing about a colleague mid-edit. This one reads the holder on the
 * claim's own beat and never claims.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, post },
}));

import { DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS } from "nextly/document-lock";

import { useDocumentLockHolder } from "../useDocumentLockHolder";

const ref = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "42",
};
const other = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  get.mockResolvedValue({ holder: other });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentLockHolder", () => {
  it("reads who holds the document, and never claims it", async () => {
    const { result } = renderHook(() => useDocumentLockHolder(ref));

    await waitFor(() => expect(result.current).toEqual(other));
    expect(get).toHaveBeenCalledWith(
      "/document-lock?scopeKind=collection&slug=posts&entryId=42"
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("is unknown until the first read answers", () => {
    get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDocumentLockHolder(ref));

    expect(result.current).toBeUndefined();
  });

  it("answers nobody when the document is free", async () => {
    get.mockResolvedValue({ holder: null });
    const { result } = renderHook(() => useDocumentLockHolder(ref));

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("reads again on each beat, so a claim taken later is seen", async () => {
    get.mockResolvedValueOnce({ holder: null });
    const { result } = renderHook(() => useDocumentLockHolder(ref));
    await waitFor(() => expect(result.current).toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current).toEqual(other));
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the last holder through a read that fails", async () => {
    const { result } = renderHook(() => useDocumentLockHolder(ref));
    await waitFor(() => expect(result.current).toEqual(other));

    get.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(other);
  });

  it("reads nothing while it is off", async () => {
    const { result } = renderHook(() =>
      useDocumentLockHolder({ ...ref, enabled: false })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    expect(get).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("sends no read while one is still out, and is unknown while it lags", async () => {
    get.mockResolvedValueOnce({ holder: null });
    let finishSecond: (answer: unknown) => void = () => {};
    get.mockReturnValueOnce(
      new Promise(resolve => {
        finishSecond = resolve;
      })
    );
    const { result } = renderHook(() => useDocumentLockHolder(ref));
    await waitFor(() => expect(result.current).toBeNull());

    // The second read goes out on the beat and is still out at the next one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    // Reads are one at a time, so none can overtake another at the server,
    // and the last answer is not trusted while the next one lags.
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current).toBeUndefined();

    await act(async () => {
      finishSecond({ holder: other });
    });
    expect(result.current).toEqual(other);
  });

  it("is unknown again when turned back on, until its own read answers", async () => {
    get.mockResolvedValueOnce({ holder: null });
    const seen: Array<[boolean, unknown]> = [];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        const holder = useDocumentLockHolder({ ...ref, enabled });
        seen.push([enabled, holder]);
        return holder;
      },
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current).toBeNull());

    rerender({ enabled: false });
    seen.length = 0;
    get.mockReturnValue(new Promise(() => {}));
    rerender({ enabled: true });

    // Not one render after it is turned back on reads the earlier "nobody".
    expect(seen.filter(([on]) => on).map(([, h]) => h)).not.toContain(null);
  });

  it("is unknown for another document until that document's own read answers", async () => {
    get.mockResolvedValueOnce({ holder: null });
    const seen: Array<[string, unknown]> = [];
    const { result, rerender } = renderHook(
      ({ entryId }: { entryId: string }) => {
        const holder = useDocumentLockHolder({ ...ref, entryId });
        seen.push([entryId, holder]);
        return holder;
      },
      { initialProps: { entryId: "42" } }
    );
    await waitFor(() => expect(result.current).toBeNull());

    get.mockReturnValue(new Promise(() => {}));
    rerender({ entryId: "43" });

    // Not one render of the new document reads the last one's "nobody".
    expect(seen.filter(([id]) => id === "43").map(([, h]) => h)).not.toContain(
      null
    );
  });
});
