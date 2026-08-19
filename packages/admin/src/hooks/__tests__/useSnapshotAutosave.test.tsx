/**
 * The recording machinery, exercised without a form in sight.
 *
 * That absence IS the property under test. This core exists so a second editor
 * can record recovery points without reimplementing the timing, and a test that
 * reached for `useForm` to drive it would prove the opposite of what it is for.
 * Everything here hands it a plain callback.
 *
 * @module hooks/__tests__/useSnapshotAutosave.test
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSnapshotAutosave } from "../useSnapshotAutosave";

const DEBOUNCE = 2000;
const STORED_AT = "2026-08-19T02:00:00.000Z";

function saved(updatedAt = STORED_AT) {
  return Promise.resolve({ updatedAt });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSnapshotAutosave", () => {
  it("waits for the debounce before recording anything", async () => {
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: "doc-1", save, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(DEBOUNCE));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("records ONCE for a burst, restarting the wait each time", async () => {
    // The property that makes this a debounce rather than a throttle: typing
    // for a minute records at the end of it, not sixty times during it.
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: "doc-1", save, debounceMs: DEBOUNCE })
    );

    act(() => {
      result.current.schedule();
      vi.advanceTimersByTime(DEBOUNCE - 100);
      result.current.schedule();
      vi.advanceTimersByTime(DEBOUNCE - 100);
      result.current.schedule();
    });
    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(DEBOUNCE));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("reads the snapshot AT flush time, not when it was scheduled", async () => {
    // The contract that lets the caller keep the freshest copy. A core that
    // captured the value when `schedule` was called would record what the
    // author had typed two seconds ago.
    let current = "first";
    const seen: string[] = [];
    const save = vi.fn(() => {
      seen.push(current);
      return saved();
    });
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: "doc-1", save, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    current = "second";
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(seen).toEqual(["second"]));
  });

  it("takes the timestamp from the SERVER's response", async () => {
    // Never `Date.now()`: a "saved 2 minutes ago" reading must not drift with
    // an unsynchronised browser clock.
    const save = vi.fn(() => saved(STORED_AT));
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: "doc-1", save, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() =>
      expect(result.current.lastSavedAt?.toISOString()).toBe(STORED_AT)
    );
  });

  it("reports an error through status instead of throwing", async () => {
    // A recovery point nobody asked for must not surface an error over the
    // editor or interrupt typing.
    const save = vi.fn(() => Promise.reject(new Error("network")));
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: "doc-1", save, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

describe("what switches recording off", () => {
  it("records nothing when the identity is null", async () => {
    // A document with no address has nothing for the endpoint to write
    // against, so recording is disabled rather than given an invented key.
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({ identity: null, save, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(save).not.toHaveBeenCalled();
  });

  it("records nothing while disabled, and the policy is HANDED in", async () => {
    // `enabled` is how the owner's setting reaches this module. The core never
    // infers that recording is allowed from having been given a snapshot: if it
    // did, every caller that forgot would rediscover the server's refusal one
    // request at a time.
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({
        identity: "doc-1",
        save,
        debounceMs: DEBOUNCE,
        enabled: false,
      })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(save).not.toHaveBeenCalled();
  });

  it("still records when enabled, which is the control", async () => {
    // Without this, the two cases above pass on a core that never records at
    // all under any circumstances.
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({
        identity: "doc-1",
        save,
        debounceMs: DEBOUNCE,
        enabled: true,
      })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});

describe("the identity is opaque, and it bounds a pending recording", () => {
  it("drops a pending recording when the identity changes", async () => {
    // The one failure this module can cause that its caller cannot see: a
    // timer scheduled for one document firing after the editor has moved to
    // another would write the first snapshot against the second's key.
    const save = vi.fn(() => saved());
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useSnapshotAutosave({ identity: id, save, debounceMs: DEBOUNCE }),
      { initialProps: { id: "doc-1" } }
    );

    act(() => result.current.schedule());
    rerender({ id: "doc-2" });
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(save).not.toHaveBeenCalled();
  });

  it("accepts any string as a key without reading it", async () => {
    // Recovery rows are keyed per document and per author today, and pending
    // changes are becoming per-language. The core is asked to hold none of
    // that: whatever the caller passes is the key it records under.
    const save = vi.fn(() => saved());
    const { result } = renderHook(() =>
      useSnapshotAutosave({
        identity: "single:homepage:601b:fr-CA",
        save,
        debounceMs: DEBOUNCE,
      })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
