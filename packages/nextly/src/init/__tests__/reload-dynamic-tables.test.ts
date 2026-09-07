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

/**
 * The loader's real return shape.
 *
 * Spelled once, because a mock that resolves something the real function never
 * returns is the defect these tests exist to catch, one layer up.
 */
const ok = (registered = 0) => ({ registered, failures: [] });

const containerGet = vi.hoisted(() => vi.fn());
vi.mock("../../di/container", () => ({ container: { get: containerGet } }));

const loadDynamicTables = vi.hoisted(() => vi.fn());
vi.mock("../../di/load-dynamic-tables", () => ({ loadDynamicTables }));

vi.mock("../../domains/schema/services/runtime-schema-generator", () => ({
  generateRuntimeSchema: () => ({ table: {} }),
}));

const registerComponentSchemas = vi.hoisted(() => vi.fn(async () => 0));
vi.mock(
  "../../domains/field-groups/services/register-field-group-schemas",
  () => ({ registerComponentSchemas })
);

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
  registerComponentSchemas.mockReset();
  registerComponentSchemas.mockResolvedValue(0);
});

describe("reloadDynamicTables", () => {
  it("reads both metadata tables", () => {
    ready();
    loadDynamicTables.mockResolvedValue(ok());
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
        new Promise(resolve => {
          release = () => resolve(ok());
        })
    );
    loadDynamicTables.mockResolvedValue(ok());

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
        new Promise(resolve => {
          release = () => resolve(ok());
        })
    );
    loadDynamicTables.mockResolvedValue(ok());

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
   * 🔴 `loadDynamicTables` RESOLVES when the registry read fails -- it swallows
   * that for the fresh database it was written for -- so a test that mocks it
   * to REJECT asserts a behaviour the real dependency never produces, and the
   * silence this path has to notice would go unnoticed. The loader now tells
   * its caller, and this drives that channel rather than a rejection.
   */
  it("reports a swallowed read failure instead of claiming success", async () => {
    ready();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // The real loader's shape: RESOLVE, carrying the failure it swallowed.
    loadDynamicTables.mockResolvedValue({
      registered: 0,
      failures: [
        { scope: "read", error: new Error("relation does not exist") },
      ],
    });

    await reloadDynamicTables("[t]");

    expect(warn.mock.calls.flat().join(" ")).toMatch(/INCOMPLETE/);
    // And it did NOT also claim the reload finished.
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/reloaded:/);
  });

  /*
   * 🔴 A ROW failure must reach the same warning a read failure does. The
   * loader skips a row whose stored `fields` will not parse or whose schema
   * will not generate, and the count merely comes back lower -- which is
   * indistinguishable from a database holding one fewer entity. Reported off
   * the count alone, the boot called the reload complete and opened the gate
   * while that collection stayed unqueryable.
   */
  it("reports a row that could not be registered, naming it", async () => {
    ready();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    loadDynamicTables.mockResolvedValue({
      registered: 2,
      failures: [
        {
          scope: "row",
          tableName: "dc_posts",
          error: new Error("stored `fields` is not an array"),
        },
      ],
    });

    await reloadDynamicTables("[t]");

    const warned = warn.mock.calls.flat().join(" ");
    expect(warned).toMatch(/INCOMPLETE/);
    // Names the entity, so an operator knows WHICH one is unqueryable rather
    // than that something is.
    expect(warned).toMatch(/dc_posts/);
    // And it did not also claim the reload finished, despite 2 registering.
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/reloaded:/);
  });

  it("still reports success when nothing failed", async () => {
    // The control: a rule that warned unconditionally would satisfy the case
    // above while never reporting a healthy reload.
    ready();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    loadDynamicTables.mockResolvedValue(ok());

    await reloadDynamicTables("[t]");

    expect(log.mock.calls.flat().join(" ")).toMatch(/reloaded:/);
    expect(warn).not.toHaveBeenCalled();
  });

  /*
   * 🔴 A migration generated from a UI manifest writes `dynamic_components`
   * rows beside the collection and single ones, and a `comp_` table missing
   * from the registry is unaddressable exactly as a collection would be.
   * Through `registerComponentSchemas` rather than a third read, because that
   * path also resolves the storage rename's type column per table and
   * registers the `_locales` companion for a localized group.
   */
  it("registers field groups through the component path", async () => {
    ready();
    loadDynamicTables.mockResolvedValue(ok());
    registerComponentSchemas.mockResolvedValue(2);

    await reloadDynamicTables("[t]");

    expect(registerComponentSchemas).toHaveBeenCalledTimes(1);
  });

  it("keeps the entity reload when field groups cannot be registered", async () => {
    // One unregisterable group must not cost the collections and singles their
    // reload -- and the caller must still not see a throw, because it reloads
    // before the boot gate opens.
    ready();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    loadDynamicTables.mockResolvedValue(ok());
    registerComponentSchemas.mockRejectedValue(new Error("comp registry gone"));

    await expect(reloadDynamicTables("[t]")).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/field groups/);
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

    loadDynamicTables.mockResolvedValue(ok());
    await reloadDynamicTables("[t]");
    expect(loadDynamicTables.mock.calls.map(c => c[1])).toContain(
      "dynamic_singles"
    );
  });
});
