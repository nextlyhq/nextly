/**
 * Registry reloads are serialized, and a boot arriving mid-reload still gets
 * its own rows read.
 *
 * Both boot paths call this, and in a Next.js dev server several workers reach
 * it at once. Two reloads overlapping would let one register schemas from a
 * read the other has already superseded; handing a mid-reload caller the
 * running promise would serialize them and lose that caller's entities, since
 * the run already going may have read the metadata tables before those rows
 * were committed — which is the defect this module exists to close, arriving
 * through the fix for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reloadDynamicTables } from "../reload-dynamic-tables";

const containerGet = vi.hoisted(() => vi.fn());
vi.mock("../../di/container", () => ({ container: { get: containerGet } }));

const loadDynamicTables = vi.hoisted(() => vi.fn());
vi.mock("../../di/load-dynamic-tables", () => ({ loadDynamicTables }));

vi.mock("../../domains/schema/services/runtime-schema-generator", () => ({
  generateRuntimeSchema: () => ({ table: {} }),
}));

// The in-flight and queued runs are pinned to `globalThis`, so one test's
// leftovers would otherwise be answered to the next test's callers.
const reloadGlobals = globalThis as unknown as {
  __nextly_registryReloadInFlight?: Promise<void>;
  __nextly_registryReloadQueued?: Promise<void>;
};

/** A container holding both services, so the reload reaches the loader. */
function ready(): void {
  containerGet.mockImplementation((name: string) =>
    name === "adapter"
      ? { getCapabilities: () => ({ dialect: "postgresql" as const }) }
      : { registerDynamicSchema: vi.fn() }
  );
}

/** Waits until the paused load has actually started, then releases it. */
async function releaseWhenStarted(get: () => (() => void) | undefined) {
  for (let i = 0; i < 200 && !get(); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const release = get();
  // 🔴 Refuses rather than returning: `release?.()` on an unset value is a
  // no-op, and the awaits below would then hang until the suite timed out --
  // reporting a fixture that never armed as a product defect.
  if (!release) throw new Error("the paused load never started");
  release();
}

afterEach(() => {
  delete reloadGlobals.__nextly_registryReloadInFlight;
  delete reloadGlobals.__nextly_registryReloadQueued;
  vi.restoreAllMocks();
  containerGet.mockReset();
  loadDynamicTables.mockReset();
});

describe("reloadDynamicTables", () => {
  it("reads both metadata tables", () => {
    ready();
    loadDynamicTables.mockResolvedValue(undefined);
    return reloadDynamicTables("[t]").then(() => {
      expect(loadDynamicTables.mock.calls.map(c => c[1])).toEqual([
        "dynamic_collections",
        "dynamic_singles",
      ]);
    });
  });

  it("gives a caller arriving mid-reload a run of its OWN", async () => {
    ready();
    let release: (() => void) | undefined;
    loadDynamicTables.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    loadDynamicTables.mockResolvedValue(undefined);

    const first = reloadDynamicTables("[a]");
    // Arrives while the first is still reading, which is the boot whose rows
    // that read may have been too early to see.
    const second = reloadDynamicTables("[b]");
    void first;
    expect(second).not.toBe(first);

    await releaseWhenStarted(() => release);
    await Promise.all([first, second]);

    // Two passes over two tables: the first run, then the trailing one.
    expect(loadDynamicTables).toHaveBeenCalledTimes(4);
  });

  it("coalesces every further caller onto the ONE trailing run", async () => {
    ready();
    let release: (() => void) | undefined;
    loadDynamicTables.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    loadDynamicTables.mockResolvedValue(undefined);

    const first = reloadDynamicTables("[a]");
    const second = reloadDynamicTables("[b]");
    const third = reloadDynamicTables("[c]");
    // They all want the state after the last of them, so one trailing run
    // serves them both -- otherwise a busy dev server queues a run per worker.
    expect(third).toBe(second);

    await releaseWhenStarted(() => release);
    await Promise.all([first, second, third]);
    expect(loadDynamicTables).toHaveBeenCalledTimes(4);
  });

  /*
   * 🔴 Never throws, and the production caller depends on it: it reloads before
   * `allowBootMigrations()`, so an exception escaping here would leave that gate
   * closed and hang every consumer waiting on it.
   */
  it("does not throw when the load fails", async () => {
    ready();
    loadDynamicTables.mockRejectedValue(new Error("table is gone"));
    await expect(reloadDynamicTables("[t]")).resolves.toBeUndefined();
  });

  it("does not throw when the registry is not in the container", async () => {
    containerGet.mockImplementation((name: string) =>
      name === "adapter" ? {} : undefined
    );
    await expect(reloadDynamicTables("[t]")).resolves.toBeUndefined();
    // And it stopped rather than reading with a registry it could not write to.
    expect(loadDynamicTables).not.toHaveBeenCalled();
  });

  it("recovers after a failed reload rather than wedging", async () => {
    // The control for the two above: swallowing a failure must not leave the
    // in-flight latch set, or every later boot would be handed a dead promise.
    ready();
    loadDynamicTables.mockRejectedValueOnce(new Error("transient"));
    await reloadDynamicTables("[t]");

    loadDynamicTables.mockResolvedValue(undefined);
    await reloadDynamicTables("[t]");
    expect(loadDynamicTables.mock.calls.map(c => c[1])).toContain(
      "dynamic_singles"
    );
  });
});
