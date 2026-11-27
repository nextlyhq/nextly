/**
 * The fingerprint upgrade a start begins waits for the work handed to it
 * (`after`), the catch-up, before it reads anything: so the start's
 * background work holds one database connection at a time.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { lastFingerprintUpgrade, startFingerprintUpgrade } from "../upgrade";

/** A context whose every read is noted, and fails, so a read is seen at once. */
function watchedContext() {
  const reads: string[] = [];
  const ctx = new Proxy(
    { logger: { error: vi.fn(), warn: vi.fn() } },
    {
      get(target, name) {
        if (name === "logger") return target.logger;
        reads.push(String(name));
        throw new Error(`read ${String(name)}`);
      },
    }
  ) as unknown as PluginContext;
  return { ctx, reads };
}

/** A few turns of the event loop. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

describe("startFingerprintUpgrade", () => {
  it("reads nothing until the work it is handed settles, and is the pass waited for from the start", async () => {
    const { ctx, reads } = watchedContext();
    let finish: () => void = () => undefined;
    const catchUp = new Promise<void>(resolve => {
      finish = resolve;
    });

    const started = startFingerprintUpgrade(ctx, catchUp);
    expect(lastFingerprintUpgrade()).toBe(started);
    await settle();
    expect(reads).toEqual([]);

    finish();
    await started;
    expect(reads.length).toBeGreaterThan(0);
  });

  it("goes on once the work handed to it fails", async () => {
    const { ctx, reads } = watchedContext();

    await startFingerprintUpgrade(
      ctx,
      Promise.reject(new Error("no catch-up"))
    );

    expect(reads.length).toBeGreaterThan(0);
  });
});
