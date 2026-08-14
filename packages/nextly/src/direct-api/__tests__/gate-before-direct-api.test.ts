/**
 * The Direct API's `getNextly()` is exported from the package root, so a Server
 * Component can call `nextly.find()` on it. It is SYNCHRONOUS, so it cannot
 * wait for boot migrations the way the async surfaces do — and it decided
 * readiness from `isServicesRegistered()` alone, which is true throughout a
 * production boot's migration wait.
 *
 * Wiring the assertion into the gate module is not the same as wiring it into
 * this caller, and only the second one stops a query reaching an unverified
 * schema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const assertBootMigrationsSettled = vi.fn();

vi.mock("../../init/boot-migrations-gate", () => ({
  assertBootMigrationsSettled: () => assertBootMigrationsSettled(),
}));
// `../di/register`, which is what `nextly.ts` actually imports — mocking
// `../di` left the real one in place and it returned false, so the control
// failed for a reason that had nothing to do with the gate.
vi.mock("../../di/register", () => ({
  isServicesRegistered: () => true,
  getService: () => undefined,
}));

const { getNextly } = await import("../nextly");

beforeEach(() => {
  // `mockReset`, not `clearAllMocks`: the latter clears recorded CALLS but
  // leaves the implementation in place, so the throwing stub from one case
  // leaked into the control below and made it fail for the wrong reason.
  assertBootMigrationsSettled.mockReset();
});

describe("the Direct API consults the boot-migrations gate", () => {
  it("refuses while the gate is unsettled", () => {
    assertBootMigrationsSettled.mockImplementation(() => {
      throw Object.assign(new Error("pending"), {
        code: "NEXTLY_BOOT_MIGRATIONS_PENDING",
      });
    });

    expect(() => getNextly()).toThrow(
      expect.objectContaining({ code: "NEXTLY_BOOT_MIGRATIONS_PENDING" })
    );
  });

  /**
   * The control. Without it the assertion above is satisfied by a `getNextly`
   * that throws unconditionally — which would break every Direct API call in
   * development and in any app that does not run boot migrations.
   */
  it("returns an instance once the gate has settled", () => {
    expect(() => getNextly()).not.toThrow();
    expect(assertBootMigrationsSettled).toHaveBeenCalled();
  });
});
