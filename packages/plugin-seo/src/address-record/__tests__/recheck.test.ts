/**
 * The later look at what an earlier version wrote during a deploy: taken
 * once, after its delay, by a timer that never keeps the process alive, and
 * not at all once cancelled.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { RECHECK_AFTER_MS, startRecheck } from "../recheck";

afterEach(() => {
  vi.useRealTimers();
});

describe("the later look after a start", () => {
  it("is taken once, after its delay, and its failure is handed on", async () => {
    vi.useFakeTimers();
    const failure = new Error("the database is away");
    const look = vi.fn(() => Promise.reject(failure));
    const failed = vi.fn();
    startRecheck(look, failed);

    await vi.advanceTimersByTimeAsync(RECHECK_AFTER_MS - 1);
    expect(look).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(look).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(failure);

    await vi.advanceTimersByTimeAsync(RECHECK_AFTER_MS * 4);
    expect(look).toHaveBeenCalledTimes(1);
  });

  it("is never taken once cancelled", async () => {
    vi.useFakeTimers();
    const look = vi.fn(() => Promise.resolve());
    const stop = startRecheck(look, () => undefined, 1_000);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(look).not.toHaveBeenCalled();
  });

  it("never keeps the process alive", () => {
    const made: NodeJS.Timeout[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      ...args: Parameters<typeof setTimeout>
    ) => {
      const timer = real(...args);
      made.push(timer);
      return timer;
    }) as typeof setTimeout);
    const stop = startRecheck(
      () => Promise.resolve(),
      () => undefined,
      60_000
    );
    try {
      expect(made).toHaveLength(1);
      expect(made[0]?.hasRef()).toBe(false);
    } finally {
      stop();
      spy.mockRestore();
    }
  });
});
