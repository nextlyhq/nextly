/**
 * A failed catch-up is tried again by the requests that find the record not
 * ready, but not by every one of them: on a busy site each would start a
 * catch-up of its own, and while the cause is still there (a lock row a
 * transaction holds) each try takes a connection, so the tries alone could
 * use up the database's. A request tries it again once the last failure is
 * `RETRY_FAILED_AFTER_MS` old.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RETRY_FAILED_AFTER_MS,
  addressRecordReady,
  lastCatchUp,
  retryFailedCatchUp,
  startCatchUp,
} from "../catch-up";

/** A context whose catch-up always fails at its first read, counting the tries. */
function failingContext(): { ctx: PluginContext; tries: () => number } {
  let tries = 0;
  const ctx = {
    logger: {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
    },
    publicAddresses: {
      fingerprint: async () => {
        tries += 1;
        throw new Error("lock not available");
      },
    },
    db: {
      withTransactionBounds: <R>(_bounds: unknown, work: () => Promise<R>) =>
        work(),
    },
  } as unknown as PluginContext;
  return { ctx, tries: () => tries };
}

/** Let a catch-up retried without being awaited settle. */
async function settle(): Promise<void> {
  await lastCatchUp();
  await lastCatchUp();
}

describe("a failed address-record catch-up tried again", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 12, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is tried once its failure is old enough, not by each request before", async () => {
    const { ctx, tries } = failingContext();
    await startCatchUp(ctx);
    expect(tries()).toBe(1);
    expect(addressRecordReady()).toBe(false);

    // Requests right after the failure: none tries again.
    retryFailedCatchUp();
    retryFailedCatchUp();
    await settle();
    expect(tries()).toBe(1);

    // Once the failure is old enough, one request tries again.
    vi.setSystemTime(Date.now() + RETRY_FAILED_AFTER_MS);
    retryFailedCatchUp();
    retryFailedCatchUp();
    await settle();
    expect(tries()).toBe(2);

    // It failed again: the requests after it wait again.
    retryFailedCatchUp();
    await settle();
    expect(tries()).toBe(2);
  });
});
