/**
 * Waiting, up to a limit, for the address record to catch up: an answer that
 * cannot be given without the record, such as a page's plain-text copy, asked
 * for on a server that has only just started, while its catch-up still runs.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addressRecordReady,
  addressRecordReadyWithin,
  startCatchUp,
} from "../catch-up";

/**
 * A context whose catch-up finishes, or fails, only when told to: its one
 * bounded transaction settles on cue, standing in for the catch-up's reads.
 */
function catchUpOnCue(): {
  ctx: PluginContext;
  finish: () => void;
  fail: () => void;
} {
  let finish: () => void = () => undefined;
  let fail: () => void = () => undefined;
  const ctx = {
    logger: {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
    },
    db: {
      withTransactionBounds: () =>
        new Promise((resolve, reject) => {
          finish = () => resolve({ ran: true, recorded: 0, lost: [] });
          fail = () => reject(new Error("lock not available"));
        }),
    },
  } as unknown as PluginContext;
  return { ctx, finish: () => finish(), fail: () => fail() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("waiting for the address record to catch up", () => {
  it("is ready once the catch-up under way finishes within the wait", async () => {
    const { ctx, finish } = catchUpOnCue();
    const run = startCatchUp(ctx);
    expect(addressRecordReady()).toBe(false);

    const waiting = addressRecordReadyWithin(5000);
    finish();

    expect(await waiting).toBe(true);
    await run;
  });

  it("is not ready where the catch-up outlasts the wait", async () => {
    vi.useFakeTimers();
    const { ctx, finish } = catchUpOnCue();
    const run = startCatchUp(ctx);

    const waiting = addressRecordReadyWithin(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await waiting).toBe(false);
    finish();
    await run;
    expect(addressRecordReady()).toBe(true);
  });

  it("waits for nothing where the last catch-up failed", async () => {
    vi.useFakeTimers();
    const { ctx, fail } = catchUpOnCue();
    const run = startCatchUp(ctx);
    fail();
    await run;

    // Settles with no time passing: there is nothing under way to wait for.
    expect(await addressRecordReadyWithin(5000)).toBe(false);
  });
});
