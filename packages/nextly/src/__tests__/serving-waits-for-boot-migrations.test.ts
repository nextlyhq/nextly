/**
 * The gate is only worth anything if the SERVING surfaces consult it.
 *
 * `getCachedNextly()` is the one that made the race real: it builds and returns
 * an instance on `isServicesRegistered()` alone, and that flag is true
 * throughout another surface's migration wait. Wiring the gate into the module
 * that owns it is not the same as wiring it into the callers, and only the
 * second one stops a request being served.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const awaitBootMigrations = vi.fn();

vi.mock("../init/boot-migrations-gate", () => ({
  awaitBootMigrations: () => awaitBootMigrations(),
  beginBootMigrations: () => ({ allow: vi.fn(), refuse: vi.fn() }),
}));

const { getCachedNextly } = await import("../init");

beforeEach(() => {
  vi.clearAllMocks();
  awaitBootMigrations.mockResolvedValue(undefined);
  // The cached instance is the FIRST early return in `getCachedNextly`, so it
  // is the hardest case for the gate: the check has to precede it.
  (
    globalThis as { __nextly_cachedInstance?: unknown }
  ).__nextly_cachedInstance = { find: vi.fn() };
});

describe("serving surfaces consult the boot-migrations gate", () => {
  it("refuses a cached instance when the gate refuses", async () => {
    awaitBootMigrations.mockRejectedValue(
      Object.assign(new Error("refused"), {
        code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
      })
    );

    await expect(getCachedNextly()).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * The control. Without it the assertion above is satisfied by a function that
   * throws unconditionally, and by one that never returns the cached instance
   * at all.
   */
  it("returns the cached instance when the gate allows", async () => {
    await expect(getCachedNextly()).resolves.toBeDefined();
    expect(awaitBootMigrations).toHaveBeenCalled();
  });
});
