/**
 * Bounding the startup schema check.
 *
 * The check runs on the initialized-boot path, where it is a diagnostic rather
 * than a prerequisite. A rejected query is caught, but a STALLED one never
 * rejects: without a bound, an unresponsive database or a saturated pool holds
 * the await for the driver's own timeout and startup waits with it.
 */
import { describe, expect, it, vi } from "vitest";

import { warnIfCoreSchemaIsBehind } from "../first-run";

const adapter = {
  dialect: "sqlite" as const,
  getDrizzle: () => ({}),
  tableExists: async () => true,
  executeQuery: async () => undefined,
};

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("warnIfCoreSchemaIsBehind", () => {
  it("returns without waiting for a check that never settles", async () => {
    // The failure this guards: a promise that neither resolves nor rejects.
    const log = logger();
    const started = Date.now();

    await warnIfCoreSchemaIsBehind(
      adapter,
      log,
      25,
      () => new Promise(() => {})
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining("timed out")
    );
    // A timeout is not a schema problem, so nothing is reported to the user.
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does not report a failed check as drift", async () => {
    const log = logger();
    await warnIfCoreSchemaIsBehind(adapter, log, 25, () =>
      Promise.reject(new Error("connection refused"))
    );

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining("connection refused")
    );
  });

  it("lets a prompt check complete normally", async () => {
    const log = logger();
    const ran = vi.fn(async () => {});

    await warnIfCoreSchemaIsBehind(adapter, log, 1_000, ran);

    expect(ran).toHaveBeenCalledTimes(1);
    expect(log.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("timed out")
    );
  });
});
