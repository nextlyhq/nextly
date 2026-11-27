/**
 * A failed catch-up is run again by the requests that wait for the record,
 * awaited, but not by every one of them: on a busy site each would run a
 * catch-up of its own, and while the cause is still there (a lock row a
 * transaction holds, a database that is down) each try takes a connection,
 * so the tries alone could use up the database's. A request runs it again
 * once the failed run's start is `RETRY_FAILED_AFTER_MS` old: counted from
 * its start, so a run frozen with a transaction open, which fails only when
 * its function runs again, long after it started, is run again at once.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETRY_FAILED_AFTER_MS,
  addressRecordReady,
  addressRecordReadyWithin,
  lastCatchUp,
  startCatchUp,
} from "../catch-up";

/**
 * A context whose catch-up fails at its first read, counting the tries; the
 * first try's read fails only when `thaw` is called where `frozen`.
 */
function failingContext(frozen = false): {
  ctx: PluginContext;
  tries: () => number;
  thaw: () => void;
} {
  let tries = 0;
  let thaw: () => void = () => undefined;
  const ctx = {
    logger: {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
    },
    publicAddresses: {
      fingerprint: async () => {
        tries += 1;
        if (frozen && tries === 1) {
          await new Promise<void>(resolve => {
            thaw = resolve;
          });
        }
        throw new Error(
          "terminating connection due to idle-in-transaction timeout"
        );
      },
    },
    db: {
      withTransactionBounds: <R>(_bounds: unknown, work: () => Promise<R>) =>
        work(),
    },
  } as unknown as PluginContext;
  return { ctx, tries: () => tries, thaw: () => thaw() };
}

describe("a failed address-record catch-up run again", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is run by a request once its start is old enough, not by each request before", async () => {
    const { ctx, tries } = failingContext();
    await startCatchUp(ctx);
    expect(tries()).toBe(1);
    expect(addressRecordReady()).toBe(false);

    // Requests right after the failure: none runs it again, and none waits.
    expect(await addressRecordReadyWithin(5000)).toBe(false);
    expect(await addressRecordReadyWithin(5000)).toBe(false);
    expect(tries()).toBe(1);

    // Once its start is old enough, the next request runs it again, awaited.
    vi.setSystemTime(Date.now() + RETRY_FAILED_AFTER_MS);
    expect(await addressRecordReadyWithin(5000)).toBe(false);
    expect(tries()).toBe(2);

    // It failed again, at its start: the requests after it wait again.
    expect(await addressRecordReadyWithin(5000)).toBe(false);
    expect(tries()).toBe(2);
  });

  it("is run again at once where it failed only once its frozen function ran again", async () => {
    const { ctx, tries, thaw } = failingContext(true);
    const run = startCatchUp(ctx);
    // Frozen after its start, and run again long after: its transaction was
    // ended meanwhile, and it fails now.
    vi.setSystemTime(Date.now() + RETRY_FAILED_AFTER_MS);
    thaw();
    await run;
    expect(addressRecordReady()).toBe(false);

    // The request that finds it failed runs it again at once.
    expect(await addressRecordReadyWithin(5000)).toBe(false);
    expect(tries()).toBe(2);
    await lastCatchUp();
  });
});
