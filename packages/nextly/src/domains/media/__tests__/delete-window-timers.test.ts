/**
 * A media delete's own timer stops with the services it finishes through:
 * cleared when they are released, and a run already under way is told, so
 * it arms no timer for the next registration. `clearServices` stopping them
 * is in `di/__tests__/shutdown-clears-hook-registry`; the route's use of them,
 * and a whole instance shutting down, in `media-pending-delete.integration`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  afterDeleteWindow,
  stopDeleteWindowTimers,
} from "../delete-window-timers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  stopDeleteWindowTimers();
  vi.useRealTimers();
});

describe("a media delete's own timer", () => {
  it("runs its finish once the delay has passed, while the services stand", async () => {
    const finish = vi.fn(async (_released: () => boolean) => undefined);
    afterDeleteWindow(10_500, finish);

    await vi.advanceTimersByTimeAsync(10_499);
    expect(finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]![0]()).toBe(false);
  });

  it("tells a finish under way that the services were released since", async () => {
    let released: (() => boolean) | undefined;
    let resume: () => void = () => undefined;
    afterDeleteWindow(10_500, async isReleased => {
      released = isReleased;
      await new Promise<void>(resolve => {
        resume = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(released?.()).toBe(false);

    stopDeleteWindowTimers();
    resume();

    expect(released?.()).toBe(true);
    // A timer armed after the release belongs to the next registration.
    const next = vi.fn(async (_released: () => boolean) => undefined);
    afterDeleteWindow(10_500, next);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(next.mock.calls[0]![0]()).toBe(false);
  });
});
