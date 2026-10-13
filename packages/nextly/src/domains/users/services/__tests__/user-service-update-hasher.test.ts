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
