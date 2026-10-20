/**
 * The users service tells an update whether the app configures its own
 * password hasher. Only this service knows, and the update needs it to judge
 * whether a stored value in another format is a password.
 */
import { describe, expect, it, vi } from "vitest";

import { hashPassword, verifyPassword } from "../../../../auth/password";
import { silentLogger } from "../../../collections/__tests__/collection-test-helpers";
import { UserService } from "../user-service";

function serviceWith(passwordHasher?: {
  hash: typeof hashPassword;
  verify: typeof verifyPassword;
  reach?: number | "unbounded";
}) {
  const updateUser = vi.fn().mockResolvedValue({
    id: "user-1",
    email: "person@example.com",
    name: "Person",
    image: null,
    emailVerified: null,
    isActive: true,
    roles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const service = new UserService(
    {} as never,
    { updateUser } as never,
    {} as never,
    passwordHasher,
    silentLogger as never
  );
  return { service, updateUser };
}

describe("UserService.update and the app's password hasher", () => {
  it("says so when the app configures its own hasher, on the plugin view too", async () => {
    const { service, updateUser } = serviceWith({
      hash: hashPassword,
      verify: verifyPassword,
      reach: "unbounded",
    });

    await service.forPlugins().update("user-1", { name: "Renamed" }, {});

    expect(updateUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Renamed" }),
      "plugin",
      { customPasswordHasher: true }
    );
  });

  it("says not when the app uses core's hashing", async () => {
    const { service, updateUser } = serviceWith();

    await service.forPlugins().update("user-1", { name: "Renamed" }, {});

    expect(updateUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Renamed" }),
      "plugin",
      { customPasswordHasher: false }
    );
  });
});

describe("UserService.changePassword and the R-5 rule", () => {
  it("refuses a new password the rule refuses, and hashes nothing", async () => {
    const hash = vi.fn(async () => "new-hash");
    const changeOwnPasswordHash = vi.fn().mockResolvedValue(true);
    const accountService = {
      getUserPasswordHashById: vi
        .fn()
        .mockResolvedValue(await hashPassword("Current-Password-9", 4)),
      changeOwnPasswordHash,
    };
    const service = new UserService(
      {} as never,
      { updateUser: vi.fn() } as never,
      accountService as never,
      { hash, verify: verifyPassword, reach: "unbounded" },
      silentLogger as never
    );

    await expect(
      service.changePassword("user-1", "Current-Password-9", "password")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(hash).not.toHaveBeenCalled();
    expect(changeOwnPasswordHash).not.toHaveBeenCalled();
  });
});
