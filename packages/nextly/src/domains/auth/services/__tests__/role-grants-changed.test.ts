/**
 * A change to a role's grants retires its cached answers, expires the cached
 * content reads and checks the scheduled releases again, unless the caller
 * runs those last two itself, once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stop = vi.hoisted(() => vi.fn(async () => undefined));
const invalidate = vi.hoisted(() => vi.fn(async () => undefined));
const expire = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));

vi.mock("../../../releases/early-stop", () => ({ stopReleasesHolding: stop }));
vi.mock("../../../flush-content-change", () => ({
  flushEveryContentScope: expire,
}));
vi.mock("../../../../services/lib/permissions", () => ({
  invalidatePermissionCache: invalidate,
}));

const { afterRoleGrantsChanged } = await import("../role-grants-changed");

describe("afterRoleGrantsChanged", () => {
  beforeEach(() => {
    stop.mockClear();
    invalidate.mockClear();
    expire.mockReset();
    expire.mockResolvedValue(undefined);
  });

  it("retires the role's cached answers, expires the content reads and checks the scheduled releases", async () => {
    await afterRoleGrantsChanged("r1");
    expect(invalidate).toHaveBeenCalledWith({ roleId: "r1" });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("leaves the expiry and the release check to a caller that runs them once itself", async () => {
    await afterRoleGrantsChanged("r1", { recheckReleases: false });
    expect(invalidate).toHaveBeenCalledWith({ roleId: "r1" });
    expect(expire).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("still checks the releases, and does not throw, when the expiry fails", async () => {
    expire.mockRejectedValue(new Error("registry unreadable"));
    await expect(afterRoleGrantsChanged("r1")).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
