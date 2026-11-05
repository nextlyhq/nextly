/**
 * A change to a role's grants retires its cached answers and checks the
 * scheduled releases again, unless the caller checks them itself, once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stop = vi.hoisted(() => vi.fn(async () => undefined));
const invalidate = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../../releases/early-stop", () => ({ stopReleasesHolding: stop }));
vi.mock("../../../../services/lib/permissions", () => ({
  invalidatePermissionCache: invalidate,
}));

const { afterRoleGrantsChanged } = await import("../role-grants-changed");

describe("afterRoleGrantsChanged", () => {
  beforeEach(() => {
    stop.mockClear();
    invalidate.mockClear();
  });

  it("retires the role's cached answers and checks the scheduled releases", async () => {
    await afterRoleGrantsChanged("r1");
    expect(invalidate).toHaveBeenCalledWith({ roleId: "r1" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("leaves the release check to a caller that runs it once itself", async () => {
    await afterRoleGrantsChanged("r1", { recheckReleases: false });
    expect(invalidate).toHaveBeenCalledWith({ roleId: "r1" });
    expect(stop).not.toHaveBeenCalled();
  });
});
