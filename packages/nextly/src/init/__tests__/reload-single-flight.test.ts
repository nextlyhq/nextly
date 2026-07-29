/**
 * Reloads are serialized across callers.
 *
 * The reload captures the process-global field-type registry and then lets
 * `loadConfig` clear and rebuild it. Two runs overlapping would let one capture
 * a registry the other is halfway through replacing, and an abandoned run would
 * restore a set that was never live. HMR refuses to schedule while its own
 * reload is pending, but `boot-apply` calls straight through, so the two can
 * still meet without this.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { reloadNextlyConfig } from "../reload-config";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig,
  clearConfigCache: () => undefined,
}));

afterEach(() => {
  vi.restoreAllMocks();
  loadConfig.mockReset();
});

describe("reloadNextlyConfig single-flight", () => {
  it("hands a concurrent caller the run already in progress", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    loadConfig.mockImplementation(async () => {
      await gate;
      // No services are registered in this test, so the reload returns at its
      // DI-resolution guard shortly after this resolves.
      return { config: { collections: [] }, configPath: "/tmp/c.ts" };
    });

    const first = reloadNextlyConfig();
    const second = reloadNextlyConfig();

    // The same promise, so the second caller cannot start its own capture of
    // the registry while the first is rebuilding it.
    expect(second).toBe(first);

    release();
    await first;
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it("lets a later caller start a fresh run once the first settles", async () => {
    loadConfig.mockResolvedValue({
      config: { collections: [] },
      configPath: "/tmp/c.ts",
    });

    await reloadNextlyConfig();
    await reloadNextlyConfig();

    // Coalescing is only for overlap: a reload after the previous one finished
    // has to read the config again, or an edit made in between is never seen.
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });
});
