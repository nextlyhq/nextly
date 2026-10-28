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

  it("keeps the newest read's answer when an older read returns after it", async () => {
    let finishFirst: (answer: unknown) => void = () => {};
    get.mockReturnValueOnce(
      new Promise(resolve => {
        finishFirst = resolve;
      })
    );
    get.mockResolvedValueOnce({ holder: other });
    const { result } = renderHook(() => useDocumentLockHolder(ref));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current).toEqual(other));
    // The first read, sent before the colleague claimed it, answers last.
    await act(async () => {
      finishFirst({ holder: null });
    });

    expect(result.current).toEqual(other);
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
