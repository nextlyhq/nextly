import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useAutosave } from "../useAutosave";

/**
 * Drain pending microtasks.
 *
 * `waitFor` is unavailable here: it polls on real timers, which the fake ones
 * these tests need have replaced, so it never re-checks and only ever times
 * out. The saves under test settle on the microtask queue, so draining it is
 * both sufficient and deterministic.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// A deferred promise, so a test can hold a save in flight and observe what the
// hook does with edits that arrive while it is still going out.
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("saves once for a burst of edits, after the quiet period", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "typed" }),
        save,
        debounceMs: 1_000,
      })
    );

    act(() => {
      result.current.notifyChange();
      vi.advanceTimersByTime(400);
      result.current.notifyChange();
      vi.advanceTimersByTime(400);
      result.current.notifyChange();
    });

    // Still inside the quiet period after the last edit.
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "typed" });
  });

  it("saves during continuous typing once the ceiling is reached", async () => {
    // The property the debounce alone cannot provide: an author who never
    // pauses long enough would otherwise never be saved at all.
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "still typing" }),
        save,
        debounceMs: 1_000,
        maxWaitMs: 3_000,
      })
    );

    await act(async () => {
      // An edit every 500ms: the debounce restarts every time and never fires
      // on its own.
      for (let i = 0; i < 8; i += 1) {
        result.current.notifyChange();
        vi.advanceTimersByTime(500);
      }
    });

    expect(save).toHaveBeenCalled();
  });

  it("does nothing at all while disabled", async () => {
    // The create-form case: there is no stored record for a recovery point to
    // attach to yet.
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({
        enabled: false,
        getValues: () => ({ title: "typed" }),
        save,
        debounceMs: 1_000,
      })
    );

    await act(async () => {
      result.current.notifyChange();
      result.current.saveNow();
      vi.advanceTimersByTime(10_000);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it("never overlaps two saves on one document", async () => {
    // Overlapping writes to the same row can land out of order, which would
    // leave the stored recovery point older than the one it replaced.
    const first = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "typed" }),
        save,
        debounceMs: 0,
      })
    );

    await act(async () => {
      result.current.saveNow();
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Two more edits while the first save is still in flight.
    await act(async () => {
      result.current.saveNow();
      result.current.saveNow();
    });
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve();
    await flush();

    // Exactly one catch-up save for everything that arrived while it was busy,
    // rather than one per edit.
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("reports failure and recovers on the next success", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "typed" }),
        save,
        debounceMs: 0,
      })
    );

    act(() => {
      result.current.saveNow();
    });
    await flush();

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("offline");
    // A failure must not masquerade as a save that happened.
    expect(result.current.lastSavedAt).toBeNull();

    act(() => {
      result.current.saveNow();
    });
    await flush();

    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it("flushes a pending edit when the editor unmounts", async () => {
    // Navigating away inside the quiet period is exactly the work a recovery
    // point exists to keep.
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "half typed" }),
        save,
        debounceMs: 10_000,
      })
    );

    act(() => {
      result.current.notifyChange();
    });
    expect(save).not.toHaveBeenCalled();

    unmount();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "half typed" });
  });

  it("does not flush on unmount when nothing is pending", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => ({ title: "untouched" }),
        save,
      })
    );

    unmount();

    expect(save).not.toHaveBeenCalled();
  });

  it("sends the values current at the moment the timer fires", async () => {
    // The timer is armed before the last keystroke lands, so reading through a
    // stale closure would store the values from one edit ago.
    let current = { title: "first" };
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({
        enabled: true,
        getValues: () => current,
        save,
        debounceMs: 1_000,
      })
    );

    act(() => {
      result.current.notifyChange();
    });
    current = { title: "second" };

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(save).toHaveBeenCalledWith({ title: "second" });
  });
});
